import Screenshare from '/imports/api/screenshare';
import KurentoBridge from '/imports/api/screenshare/client/bridge';
import BridgeService from '/imports/api/screenshare/client/bridge/service';
import Settings from '/imports/ui/services/settings';
import logger from '/imports/startup/client/logger';
import { stopWatching } from '/imports/ui/components/external-video-player/service';
import Meetings from '/imports/api/meetings';
import Auth from '/imports/ui/services/auth';
import AudioService from '/imports/ui/components/audio/service';
import { Meteor } from "meteor/meteor";
import MediaStreamUtils from '/imports/utils/media-stream-utils';
import ConnectionStatusService from '/imports/ui/components/connection-status/service';
import browserInfo from '/imports/utils/browserInfo';
import NotesService from '/imports/ui/components/notes/service';

const VOLUME_CONTROL_ENABLED = Meteor.settings.public.kurento.screenshare.enableVolumeControl;
const SCREENSHARE_MEDIA_ELEMENT_NAME = 'screenshareVideo';

const DEFAULT_SCREENSHARE_STATS_TYPES = [
  'outbound-rtp',
  'inbound-rtp',
];

const CONTENT_TYPE_CAMERA = "camera";
const CONTENT_TYPE_SCREENSHARE = "screenshare";

let _isSharingScreen = false;
const _isSharingDep = {
  value: false,
  tracker: new Tracker.Dependency(),
};

const _sharingContentTypeDep = {
  value: false,
  tracker: new Tracker.Dependency(),
};

const _cameraAsContentDeviceIdTypeDep = {
  value: '',
  tracker: new Tracker.Dependency(),
};

const isSharing = () => {
  _isSharingDep.tracker.depend();
  return _isSharingDep.value;
};

const setIsSharing = (isSharing) => {
  if (_isSharingDep.value !== isSharing) {
    _isSharingDep.value = isSharing;
    _isSharingDep.tracker.changed();
  }
};

const setSharingContentType = (contentType) => {
  if (_sharingContentTypeDep.value !== contentType) {
    _sharingContentTypeDep.value = contentType;
    _sharingContentTypeDep.tracker.changed();
  }
}

const getSharingContentType = () => {
  _sharingContentTypeDep.tracker.depend();
  return _sharingContentTypeDep.value;
};

const getCameraAsContentDeviceId = () => {
  _cameraAsContentDeviceIdTypeDep.tracker.depend();
  return _cameraAsContentDeviceIdTypeDep.value;
};

const setCameraAsContentDeviceId = (deviceId) => {
  if (_cameraAsContentDeviceIdTypeDep.value !== deviceId) {
    _cameraAsContentDeviceIdTypeDep.value = deviceId;
    _cameraAsContentDeviceIdTypeDep.tracker.changed();
  }
};

const _trackStreamTermination = (stream, handler) => {
  if (typeof stream !== 'object' || typeof handler !== 'function') {
    throw new TypeError('Invalid trackStreamTermination arguments');
  }

  if (stream.oninactive === null) {
    stream.addEventListener('inactive', handler, { once: true });
  } else {
    const track = MediaStreamUtils.getVideoTracks(stream)[0];
    if (track) {
      track.addEventListener('ended', handler, { once: true });
      track.onended = handler;
    }
  }
};

const _isStreamActive = (stream) => {
  const tracksAreActive = !stream.getTracks().some(track => track.readyState === 'ended');

  return tracksAreActive && stream.active;
}

const _handleStreamTermination = () => {
  screenshareHasEnded();
};

// A simplified, trackable version of isScreenBroadcasting that DOES NOT
// account for the presenter's local sharing state.
// It reflects the GLOBAL screen sharing state (akka-apps)
const isScreenGloballyBroadcasting = () => {
  const screenshareEntry = Screenshare.findOne({ meetingId: Auth.meetingID, "screenshare.contentType": CONTENT_TYPE_SCREENSHARE },
    { fields: { 'screenshare.stream': 1 } });

  return (!screenshareEntry ? false : !!screenshareEntry.screenshare.stream);
}

// A simplified, trackable version of isCameraContentBroadcasting that DOES NOT
// account for the presenter's local sharing state.
// It reflects the GLOBAL camera as content sharing state (akka-apps)
const isCameraAsContentGloballyBroadcasting = () => {
  const cameraAsContentEntry = Screenshare.findOne({ meetingId: Auth.meetingID, "screenshare.contentType": CONTENT_TYPE_CAMERA },
    { fields: { 'screenshare.stream': 1 } });
  
  return (!cameraAsContentEntry ? false : !!cameraAsContentEntry.screenshare.stream);
}

// when the meeting information has been updated check to see if it was
// screensharing. If it has changed either trigger a call to receive video
// and display it, or end the call and hide the video
const isScreenBroadcasting = () => {
  const sharing = isSharing() && getSharingContentType() == CONTENT_TYPE_SCREENSHARE;
  const screenshareEntry = Screenshare.findOne({ meetingId: Auth.meetingID, "screenshare.contentType": CONTENT_TYPE_SCREENSHARE },
    { fields: { 'screenshare.stream': 1 } });
  const screenIsShared = !screenshareEntry ? false : !!screenshareEntry.screenshare.stream;

  if (screenIsShared && isSharing) {
    setIsSharing(false);
  }

  return sharing || screenIsShared;
};

// when the meeting information has been updated check to see if it was
// sharing camera as content. If it has changed either trigger a call to receive video
// and display it, or end the call and hide the video
const isCameraAsContentBroadcasting = () => {
  const sharing = isSharing() && getSharingContentType() === CONTENT_TYPE_CAMERA;
  const screenshareEntry = Screenshare.findOne({ meetingId: Auth.meetingID, "screenshare.contentType": CONTENT_TYPE_CAMERA },
    { fields: { 'screenshare.stream': 1 } });
  const cameraAsContentIsShared = !screenshareEntry ? false : !!screenshareEntry.screenshare.stream;

  if (cameraAsContentIsShared && isSharing) {
    setIsSharing(false);
  }

  return sharing || cameraAsContentIsShared;
};


const screenshareHasAudio = () => {
  const screenshareEntry = Screenshare.findOne({ meetingId: Auth.meetingID },
    { fields: { 'screenshare.hasAudio': 1 } });

  if (!screenshareEntry) {
    return false;
  }

  return !!screenshareEntry.screenshare.hasAudio;
}

const getBroadcastContentType = () => {
  const screenshareEntry = Screenshare.findOne({meetindId: Auth.meedingID},
    { fields: { 'screenshare.contentType': 1} });
  
  if (!screenshareEntry) {
    // defaults to contentType: "camera"
    return CONTENT_TYPE_CAMERA;
  }

  return screenshareEntry.screenshare.contentType;
}

const screenshareHasEnded = () => {
  if (isSharing()) {
    setIsSharing(false);
  }
  if (getSharingContentType() === CONTENT_TYPE_CAMERA) {
    setCameraAsContentDeviceId('');
  }

  KurentoBridge.stop();
};

const getMediaElement = () => {
  return document.getElementById(SCREENSHARE_MEDIA_ELEMENT_NAME);
}

const getMediaElementDimensions = () => {
  const element = getMediaElement();
  return {
    width: element?.videoWidth ?? 0,
    height: element?.videoHeight ?? 0,
  };
};

const setVolume = (volume) => {
  KurentoBridge.setVolume(volume);
};

const getVolume = () => KurentoBridge.getVolume();

const shouldEnableVolumeControl = () => VOLUME_CONTROL_ENABLED && screenshareHasAudio();

const attachLocalPreviewStream = (mediaElement) => {
  const {isTabletApp} = browserInfo;
  if (isTabletApp) {
    // We don't show preview for mobile app, as the stream is only available in native code
    return;
  }
  const stream = KurentoBridge.gdmStream;
  if (stream && mediaElement) {
    // Always muted, presenter preview.
    BridgeService.screenshareLoadAndPlayMediaStream(stream, mediaElement, true);
  }
}

const screenshareHasStarted = (isPresenter) => {
  // Presenter's screen preview is local, so skip
  if (!isPresenter) {
    viewScreenshare();
  }
};

const shareScreen = async (isPresenter, onFail, options = {}) => {
  if (isCameraAsContentBroadcasting()) {
    screenshareHasEnded();
  }
  // stop external video share if running
  const meeting = Meetings.findOne({ meetingId: Auth.meetingID });

  if (meeting && meeting.externalVideoUrl) {
    stopWatching();
  }

  try {
    let stream;
    let contentType = CONTENT_TYPE_SCREENSHARE;
    if (options.stream == null) {
      stream = await BridgeService.getScreenStream();
    } else {
      contentType = CONTENT_TYPE_CAMERA;
      stream = options.stream;
    }
    _trackStreamTermination(stream, _handleStreamTermination);

    if (!isPresenter) {
      MediaStreamUtils.stopMediaStreamTracks(stream);
      return;
    }

    await KurentoBridge.share(stream, onFail, contentType);

    // Stream might have been disabled in the meantime. I love badly designed
    // async components like this screen sharing bridge :) - prlanzarin 09 May 22
    if (!_isStreamActive(stream)) {
      _handleStreamTermination();
      return;
    }

    // Close Shared Notes if open.
    NotesService.pinSharedNotes(false);

    setSharingContentType(contentType);
    setIsSharing(true);
  } catch (error) {
    onFail(error);
  }
};

const viewScreenshare = () => {
  const hasAudio = screenshareHasAudio();
  KurentoBridge.view(hasAudio).catch((error) => {
    logger.error({
      logCode: 'screenshare_view_failed',
      extraInfo: {
        errorName: error.name,
        errorMessage: error.message,
      },
    }, `Screenshare viewer failure`);
  });
};

const screenShareEndAlert = () => AudioService
  .playAlertSound(`${Meteor.settings.public.app.cdn
    + Meteor.settings.public.app.basename
    + Meteor.settings.public.app.instanceId}`
    + '/resources/sounds/ScreenshareOff.mp3');

const dataSavingSetting = () => Settings.dataSaving.viewScreenshare;

/**
   * Get stats about all active screenshare peers.
   *
   * For more information see:
   *  - https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats
   *  - https://developer.mozilla.org/en-US/docs/Web/API/RTCStatsReport

   * @param {Array[String]} statsType - An array containing valid RTCStatsType
   *                                    values to include in the return object
   *
   * @returns {Object} The information about each active screen sharing peer.
   *          The returned format follows the format returned by video's service
   *          getStats, which considers more than one peer connection to be returned.
   *          The format is given by:
   *          {
   *            peerIdString: RTCStatsReport
   *          }
   */
const getStats = async (statsTypes = DEFAULT_SCREENSHARE_STATS_TYPES) => {
  const screenshareStats = {};
  const peer = KurentoBridge.getPeerConnection();

  if (!peer) return null;

  const peerStats = await peer.getStats();

  peerStats.forEach((stat) => {
    if (statsTypes.includes(stat.type)) {
      screenshareStats[stat.type] = stat;
    }
  });

  return { screenshareStats };
};

// This method may throw errors
const isMediaFlowing = (previousStats, currentStats) => {
  const bpsData = ConnectionStatusService.calculateBitsPerSecond(
    currentStats?.screenshareStats,
    previousStats?.screenshareStats,
  );
  const bpsDataAggr = Object.values(bpsData)
    .reduce((sum, partialBpsData = 0) => sum + parseFloat(partialBpsData), 0);

  return bpsDataAggr > 0;
};

export {
  SCREENSHARE_MEDIA_ELEMENT_NAME,
  isMediaFlowing,
  isScreenBroadcasting,
  isCameraAsContentBroadcasting,
  screenshareHasEnded,
  screenshareHasStarted,
  screenshareHasAudio,
  getBroadcastContentType,
  shareScreen,
  screenShareEndAlert,
  dataSavingSetting,
  isSharing,
  setIsSharing,
  setSharingContentType,
  getSharingContentType,
  getMediaElement,
  getMediaElementDimensions,
  attachLocalPreviewStream,
  isScreenGloballyBroadcasting,
  isCameraAsContentGloballyBroadcasting,
  getStats,
  setVolume,
  getVolume,
  shouldEnableVolumeControl,
  setCameraAsContentDeviceId,
  getCameraAsContentDeviceId,
};

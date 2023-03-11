/**
* BigBlueButton open source conferencing system - http://www.bigbluebutton.org/
*
* Copyright (c) 2019 BigBlueButton Inc. and by respective authors (see below).
*
* This program is free software; you can redistribute it and/or modify it under the
* terms of the GNU Lesser General Public License as published by the Free Software
* Foundation; either version 3.0 of the License, or (at your option) any later
* version.
*
* BigBlueButton is distributed in the hope that it will be useful, but WITHOUT ANY
* WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
* PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
*
* You should have received a copy of the GNU Lesser General Public License along
* with BigBlueButton; if not, see <http://www.gnu.org/licenses/>.
*
*/
package org.bigbluebutton.web.controllers

import groovy.json.JsonBuilder
import org.bigbluebutton.api.MeetingService
import org.bigbluebutton.api.domain.UserSession
import org.bigbluebutton.api.util.ParamsUtil
import org.bigbluebutton.api.ParamsProcessorUtil

class ConnectionController {
  MeetingService meetingService
  ParamsProcessorUtil paramsProcessorUtil

  def checkAuthorization = {
    try {
      def sessionToken = ""

      if(request.getHeader("User-Agent").startsWith('hasura-graphql-engine')) {
        sessionToken = request.getHeader("x-session-token")
      } else {
        def uri = request.getHeader("x-original-uri")
        sessionToken = ParamsUtil.getSessionToken(uri)
      }

      UserSession userSession = meetingService.getUserSessionWithAuthToken(sessionToken)
      Boolean allowRequestsWithoutSession = meetingService.getAllowRequestsWithoutSession(sessionToken)
      Boolean isSessionTokenInvalid = !session[sessionToken] && !allowRequestsWithoutSession

      response.addHeader("Cache-Control", "no-cache")

      if (userSession != null && !isSessionTokenInvalid) {
        if(request.getHeader("User-Agent").startsWith('hasura-graphql-engine')) {
          response.setStatus(200)
          withFormat {
            json {
              def builder = new JsonBuilder()
              builder {
                "x-hasura-role" "bbb_client"
                "X-Hasura-UserId" userSession.internalUserId
                "X-Hasura-MeetingId" userSession.meetingID
              }
              render(contentType: "application/json", text: builder.toPrettyString())
            }
          }
          return
        }

        response.contentType = 'plain/text'
        response.addHeader("User-Id", userSession.internalUserId)
        response.addHeader("Meeting-Id", userSession.meetingID)
        response.addHeader("Voice-Bridge", userSession.voicebridge )
        response.addHeader("User-Name", userSession.fullname)
        response.setStatus(200)
        response.outputStream << 'authorized'
      } else {
        response.contentType = 'plain/text'
        response.setStatus(401)
        response.outputStream << 'unauthorized'
      }
    } catch (IOException e) {
      log.error("Error while authenticating connection.\n" + e.getMessage())
    }
  }

  def legacyCheckAuthorization = {
    try {
      def uri = request.getHeader("x-original-uri")
      def sessionToken = ParamsUtil.getSessionToken(uri)
      UserSession userSession = meetingService.getUserSessionWithAuthToken(sessionToken)

      response.addHeader("Cache-Control", "no-cache")
      response.contentType = 'plain/text'
      if (userSession != null) {
        response.setStatus(200)
        response.outputStream << 'authorized'
      } else {
        response.setStatus(401)
        response.outputStream << 'unauthorized'
      }
    } catch (IOException e) {
      log.error("Error while authenticating connection.\n" + e.getMessage())
    }
  }
}

// src/tools/core/calendar.ts

import { google, calendar_v3 } from "googleapis";
import * as chrono from "chrono-node";
import { addMinutes, format, parseISO, startOfDay, endOfDay } from "date-fns";
import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline";
import { logger } from "../../utils/logger";
import { registry } from "../registry";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

export class CalendarTool {
  private calendar: calendar_v3.Calendar;

  constructor() {
    this.calendar = google.calendar("v3");
  }

  private async getAuth() {
    try {
      const content = await fs.readFile(CREDENTIALS_PATH, "utf8");
      const credentials = JSON.parse(content);
      const { client_secret, client_id, redirect_uris } = credentials.installed;
      const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0],
      );

      try {
        const token = await fs.readFile(TOKEN_PATH, "utf8");
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
      } catch (err) {
        return this.getNewToken(oAuth2Client);
      }
    } catch (error) {
      throw new Error(
        "Calendar not configured. Please:\n" +
          "1. Download credentials.json from Google Cloud Console\n" +
          "2. Place it in project root\n" +
          "3. See GOOGLE_SETUP.md for instructions",
      );
    }
  }

  private async getNewToken(oAuth2Client: any): Promise<any> {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
    });

    logger.warn(
      `\n\n🔐 AUTHORIZATION REQUIRED\nVisit this URL to connect your Google account:\n${authUrl}\n`,
    );

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve, reject) => {
      rl.question(
        "Enter the authorization code from that page here: ",
        async (code) => {
          rl.close();
          try {
            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);

            logger.info(`Writing token to: ${TOKEN_PATH}`);
            await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
            logger.success("✅ Token stored to token.json");

            resolve(oAuth2Client);
          } catch (error) {
            logger.error(`Error saving token: ${error}`);
            reject(error);
          }
        },
      );
    });
  }

  private parseDatetime(dateStr: string): Date {
    const results = chrono.parseDate(dateStr);
    if (results) return results;

    const lower = dateStr.toLowerCase();
    const now = new Date();

    if (lower.includes("today")) {
      return new Date(now.setHours(9, 0, 0, 0));
    } else if (lower.includes("tomorrow")) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return new Date(tomorrow.setHours(9, 0, 0, 0));
    } else if (lower.includes("next week")) {
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);
      return new Date(nextWeek.setHours(9, 0, 0, 0));
    }

    return new Date(now.setHours(9, 0, 0, 0));
  }

  async createEvent(
    title: string,
    startTime: string,
    durationMinutes: number = 60,
    description?: string,
    location?: string,
    attendees?: string,
  ): Promise<string> {
    try {
      const auth = await this.getAuth();
      const startDt = this.parseDatetime(startTime);
      const endDt = addMinutes(startDt, durationMinutes);

      const res = await this.calendar.events.insert({
        auth,
        calendarId: "primary",
        requestBody: {
          summary: title,
          description,
          location,
          start: {
            dateTime: startDt.toISOString(),
            timeZone: "America/Los_Angeles",
          },
          end: {
            dateTime: endDt.toISOString(),
            timeZone: "America/Los_Angeles",
          },
          attendees: attendees
            ? attendees.split(",").map((e) => ({ email: e.trim() }))
            : [],
        },
      });

      let result = `✅ Event created successfully!\n`;
      result += `📅 ${title}\n`;
      result += `🕐 ${format(startDt, "yyyy-MM-dd hh:mm a")} - ${format(endDt, "hh:mm a")}\n`;
      if (location) result += `📍 ${location}\n`;
      result += `\n🔗 ${res.data.htmlLink || "N/A"}`;

      return result;
    } catch (error) {
      return `Error creating event: ${error}`;
    }
  }

  async deleteEvent(eventId: string): Promise<string> {
    try {
      const auth = await this.getAuth();

      await this.calendar.events.delete({
        auth,
        calendarId: "primary",
        eventId: eventId,
      });

      return `✅ Event deleted successfully!`;
    } catch (error: any) {
      if (error.code === 404) {
        return `❌ Event not found. It may have already been deleted.`;
      }
      return `Error deleting event: ${error.message}`;
    }
  }

  async viewEvents(
    daysAhead: number = 7,
    maxResults: number = 10,
  ): Promise<string> {
    try {
      const auth = await this.getAuth();
      const now = new Date();

      // FIX: When daysAhead is 0 (today), we want from start of today to end of today
      // When daysAhead is 1 (tomorrow), from start of tomorrow to end of tomorrow, etc.
      let timeMin: Date;
      let timeMax: Date;

      if (daysAhead === 0) {
        // Today: from start of day to end of day
        timeMin = startOfDay(now);
        timeMax = endOfDay(now);
      } else {
        // Future days: from now to end of that future day
        timeMin = now;
        const futureDate = new Date(
          now.getTime() + daysAhead * 24 * 60 * 60 * 1000,
        );
        timeMax = endOfDay(futureDate);
      }

      const res = await this.calendar.events.list({
        auth,
        calendarId: "primary",
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = res.data.items || [];
      if (events.length === 0) {
        return `No events found in the next ${daysAhead} days.`;
      }

      let output = `📅 Upcoming events (next ${daysAhead} days):\n\n`;

      events.forEach((event, i) => {
        const start = event.start?.dateTime || event.start?.date || "";
        const startDt = parseISO(start);

        output += `${i + 1}. ${event.summary}\n`;
        output += `   🕐 ${format(startDt, "EEEE, MMMM dd 'at' hh:mm a")}\n`;
        output += `   🆔 Event ID: ${event.id}\n`;

        if (event.location) output += `   📍 ${event.location}\n`;
        if (event.description) {
          const desc = event.description.substring(0, 100);
          output += `   📝 ${desc}...\n`;
        }
        output += "\n";
      });

      return output.trim();
    } catch (error) {
      return `Error viewing events: ${error}`;
    }
  }
}

const calendar = new CalendarTool();

registry.register({
  name: "create_event",
  description:
    "Create a Google Calendar event. " +
    "Input: title (required), startTime in natural language e.g. 'tomorrow at 2pm' (required), " +
    "durationMinutes (default 60), description, location, attendees as comma-separated emails. " +
    "Output: confirmation string with event link, or an error.",
  category: "communication",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Event title" },
      startTime: {
        type: "string",
        description: "Start time (e.g., 'tomorrow at 2pm')",
      },
      durationMinutes: {
        type: "integer",
        description: "Duration in minutes (default 60)",
      },
      description: { type: "string", description: "Optional notes" },
      location: { type: "string", description: "Optional location" },
      attendees: {
        type: "string",
        description: "Optional comma-separated emails",
      },
    },
    required: ["title", "startTime"],
  },
  function: (args: any) =>
    calendar.createEvent(
      args.title,
      args.startTime,
      args.durationMinutes,
      args.description,
      args.location,
      args.attendees,
    ),
});

registry.register({
  name: "view_events",
  description:
    "Fetch upcoming Google Calendar events. " +
    "Input: daysAhead (default 7, pass 0 for today only), maxResults (default 10). " +
    "Output: list of events with title, time, and eventId. " +
    "eventId values from this output are required by delete_event.",
  category: "communication",
  input_schema: {
    type: "object",
    properties: {
      daysAhead: {
        type: "integer",
        description: "Days to look ahead (default 7, use 0 for today only)",
      },
      maxResults: {
        type: "integer",
        description: "Max events to show (default 10)",
      },
    },
  },
  function: (args: any) => calendar.viewEvents(args.daysAhead, args.maxResults),
});

registry.register({
  name: "delete_event",
  description:
    "Delete a Google Calendar event by ID. " +
    "Input: eventId — get this from view_events output. " +
    "Output: confirmation or not-found error.",
  category: "communication",
  input_schema: {
    type: "object",
    properties: {
      eventId: {
        type: "string",
        description: "The Google Calendar event ID (obtained from view_events)",
      },
    },
    required: ["eventId"],
  },
  function: (args: any) => calendar.deleteEvent(args.eventId),
});

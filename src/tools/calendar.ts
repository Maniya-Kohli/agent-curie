import { google, calendar_v3 } from "googleapis";
import * as chrono from "chrono-node";
import { addMinutes, format, parseISO } from "date-fns";
import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline";
import { logger } from "../utils/logger";

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
      `\n\n🔑 AUTHORIZATION REQUIRED\nVisit this URL to connect your Google account:\n${authUrl}\n`,
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
  // --- Natural Language Parsing ---
  private parseDatetime(dateStr: string): Date {
    const results = chrono.parseDate(dateStr);
    if (results) return results;

    // Handle relative dates
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

  // --- Create Event ---
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
      if (location) {
        result += `📍 ${location}\n`;
      }
      result += `\n🔗 ${res.data.htmlLink || "N/A"}`;

      return result;
    } catch (error) {
      return `Error creating event: ${error}`;
    }
  }

  // --- View Events ---
  async viewEvents(
    daysAhead: number = 7,
    maxResults: number = 10,
  ): Promise<string> {
    try {
      const auth = await this.getAuth();
      const now = new Date();
      const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

      const res = await this.calendar.events.list({
        auth,
        calendarId: "primary",
        timeMin: now.toISOString(),
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

        if (event.location) {
          output += `   📍 ${event.location}\n`;
        }

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

  // --- Check Availability ---
  async checkAvailability(
    dateTime: string,
    durationMinutes: number = 60,
  ): Promise<string> {
    try {
      const auth = await this.getAuth();
      const checkDt = this.parseDatetime(dateTime);
      const endDt = addMinutes(checkDt, durationMinutes);

      const res = await this.calendar.events.list({
        auth,
        calendarId: "primary",
        timeMin: checkDt.toISOString(),
        timeMax: endDt.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = res.data.items || [];

      if (events.length === 0) {
        return (
          `✅ You're free!\n` +
          `📅 ${format(checkDt, "EEEE, MMMM dd 'at' hh:mm a")}\n` +
          `⏱️ For ${durationMinutes} minutes`
        );
      } else {
        const conflicts = events.map((e) => `   • ${e.summary}`).join("\n");
        return (
          `❌ Conflict found:\n` +
          `📅 ${format(checkDt, "EEEE, MMMM dd 'at' hh:mm a")}\n` +
          `Conflicts with:\n${conflicts}`
        );
      }
    } catch (error) {
      return `Error checking availability: ${error}`;
    }
  }
}

// Tool definitions for Claude API
export const CREATE_EVENT_TOOL = {
  name: "create_event",
  description:
    "Create a new calendar event in Google Calendar. Can specify title, time, duration, location, and attendees.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Event title/name",
      },
      start_time: {
        type: "string",
        description:
          "Start time (flexible formats: '2024-03-20 14:00', 'tomorrow at 2pm', 'next Monday at 9am')",
      },
      duration_minutes: {
        type: "integer",
        description: "Event duration in minutes (default: 60)",
        default: 60,
      },
      description: {
        type: "string",
        description: "Event description/notes (optional)",
      },
      location: {
        type: "string",
        description: "Event location (optional)",
      },
      attendees: {
        type: "string",
        description: "Comma-separated email addresses of attendees (optional)",
      },
    },
    required: ["title", "start_time"],
  },
};

export const VIEW_EVENTS_TOOL = {
  name: "view_events",
  description:
    "View upcoming events from Google Calendar. Shows events for the next 7 days by default.",
  input_schema: {
    type: "object",
    properties: {
      days_ahead: {
        type: "integer",
        description: "Number of days to look ahead (default: 7)",
        default: 7,
      },
      max_results: {
        type: "integer",
        description: "Maximum number of events to show (default: 10)",
        default: 10,
      },
    },
    required: [],
  },
};

export const CHECK_AVAILABILITY_TOOL = {
  name: "check_availability",
  description:
    "Check if a specific time slot is available in the calendar. Useful for scheduling meetings.",
  input_schema: {
    type: "object",
    properties: {
      date_time: {
        type: "string",
        description:
          "Date and time to check (e.g., '2024-03-20 14:00', 'tomorrow at 2pm', 'Friday at 3pm')",
      },
      duration_minutes: {
        type: "integer",
        description: "Duration to check in minutes (default: 60)",
        default: 60,
      },
    },
    required: ["date_time"],
  },
};

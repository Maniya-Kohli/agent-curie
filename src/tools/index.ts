// src/tools/index.ts

import { Tool } from "@anthropic-ai/sdk/resources";
import { getWeather } from "./weather";
import { webSearch } from "./webSearch";
import { calculate } from "./calculator";
import { fileOps } from "./fileOps";
import { GmailTool } from "./gmail";
import { CalendarTool } from "./calendar";
import { sendMessage, setGatewayForTools } from "./sendMessage";
import { directory } from "../memory/directory";

const gmail = new GmailTool();
const calendar = new CalendarTool();

// Build contact list dynamically
const buildContactList = (): string => {
  return Array.from(directory.contacts.values())
    .map((c) => c.aliases.join("/"))
    .join(", ");
};

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: "get_weather",
    description: "Get current weather information for any location worldwide.",
    input_schema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "The city or location (e.g., 'San Francisco')",
        },
      },
      required: ["location"],
    },
  },
  {
    name: "send_message",
    description: `Send messages via WhatsApp/Telegram/Discord. Known contacts: ${buildContactList()}. Extract alias from user request.`,
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["whatsapp", "telegram", "discord"] },
        recipient: { type: "string", description: "Contact alias or full ID" },
        message: { type: "string" },
      },
      required: ["channel", "recipient", "message"],
    },
  },
  {
    name: "web_search",
    description: "Search the web for current information, news, or facts.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        numResults: {
          type: "integer",
          description: "Number of results to return (default 5)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "calculate",
    description:
      "Perform mathematical calculations safely. Supports basic arithmetic and math functions.",
    input_schema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Math expression (e.g., 'sqrt(144) + 2')",
        },
      },
      required: ["expression"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the sandbox directory.",
    input_schema: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Name of the file" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["fileName", "content"],
    },
  },
  {
    name: "read_file",
    description: "Read content from a file in the sandbox directory.",
    input_schema: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Name of the file to read" },
      },
      required: ["fileName"],
    },
  },
  {
    name: "send_email",
    description:
      "Send an email via Gmail. Can include multiple recipients and optional CC.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body content" },
        cc: {
          type: "string",
          description: "Optional CC recipients (comma-separated)",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "view_events",
    description: "View upcoming calendar events from Google Calendar.",
    input_schema: {
      type: "object",
      properties: {
        daysAhead: {
          type: "integer",
          description: "Days to look ahead (default 7)",
        },
        maxResults: {
          type: "integer",
          description: "Max events to show (default 10)",
        },
      },
    },
  },
  {
    name: "create_event",
    description: "Create a new event in Google Calendar.",
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
  },
];

export const TOOL_FUNCTIONS: Record<string, Function> = {
  get_weather: (args: { location: string }) => getWeather(args.location),
  web_search: (args: { query: string; numResults?: number }) =>
    webSearch(args.query, args.numResults),
  calculate: (args: { expression: string }) => calculate(args.expression),
  write_file: (args: { fileName: string; content: string }) =>
    fileOps.writeFile(args.fileName, args.content),
  read_file: (args: { fileName: string }) => fileOps.readFile(args.fileName),
  send_email: (args: any) =>
    gmail.sendEmail(args.to, args.subject, args.body, args.cc),
  view_events: (args: any) =>
    calendar.viewEvents(args.daysAhead, args.maxResults),
  send_message: sendMessage,
  create_event: (args: any) =>
    calendar.createEvent(
      args.title,
      args.startTime,
      args.durationMinutes,
      args.description,
      args.location,
      args.attendees,
    ),
};

export { setGatewayForTools };

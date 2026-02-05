import { google, gmail_v1 } from "googleapis";
import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline";
import { logger } from "../utils/logger";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

export class GmailTool {
  private gmail: gmail_v1.Gmail;

  constructor() {
    this.gmail = google.gmail("v1");
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
        "Gmail not configured. Please:\n" +
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
  // --- Send Email ---
  async sendEmail(
    to: string,
    subject: string,
    body: string,
    cc?: string,
  ): Promise<string> {
    try {
      const auth = await this.getAuth();

      const messageParts = [
        `To: ${to}`,
        ...(cc ? [`Cc: ${cc}`] : []),
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ];

      const message = messageParts.join("\n");
      const raw = Buffer.from(message)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const result = await this.gmail.users.messages.send({
        auth,
        userId: "me",
        requestBody: { raw },
      });

      return (
        `✅ Email sent successfully!\n` +
        `Message ID: ${result.data.id}\n` +
        `To: ${to}\n` +
        `Subject: ${subject}`
      );
    } catch (error) {
      return `Error sending email: ${error}`;
    }
  }

  // --- Read Emails ---
  async readEmails(maxResults: number = 5, query?: string): Promise<string> {
    try {
      const auth = await this.getAuth();

      const results = await this.gmail.users.messages.list({
        auth,
        userId: "me",
        maxResults,
        q: query || "",
      });

      const messages = results.data.messages || [];

      if (messages.length === 0) {
        return query
          ? `No emails found matching: ${query}`
          : "No emails found.";
      }

      let output = query
        ? `📧 Emails matching: ${query} (showing ${messages.length}):\n\n`
        : `📧 Recent emails (showing ${messages.length}):\n\n`;

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const message = await this.gmail.users.messages.get({
          auth,
          userId: "me",
          id: msg.id!,
          format: "full",
        });

        const headers = message.data.payload?.headers || [];
        const subject =
          headers.find((h) => h.name?.toLowerCase() === "subject")?.value ||
          "No Subject";
        const from =
          headers.find((h) => h.name?.toLowerCase() === "from")?.value ||
          "Unknown";
        const date =
          headers.find((h) => h.name?.toLowerCase() === "date")?.value ||
          "Unknown";
        const snippet = message.data.snippet || "";

        output += `${i + 1}. From: ${from}\n`;
        output += `   Subject: ${subject}\n`;
        output += `   Date: ${date}\n`;
        output += `   Preview: ${snippet.substring(0, 100)}...\n\n`;
      }

      return output.trim();
    } catch (error) {
      return `Error reading emails: ${error}`;
    }
  }

  // --- Search Emails ---
  async searchEmails(query: string, maxResults: number = 10): Promise<string> {
    return this.readEmails(maxResults, query);
  }
}

// Tool definitions for Claude API
export const SEND_EMAIL_TOOL = {
  name: "send_email",
  description:
    "Send an email via Gmail. Can send to one or multiple recipients, with optional CC.",
  input_schema: {
    type: "object",
    properties: {
      to: {
        type: "string",
        description: "Recipient email address (e.g., 'john@example.com')",
      },
      subject: {
        type: "string",
        description: "Email subject line",
      },
      body: {
        type: "string",
        description: "Email body text/content",
      },
      cc: {
        type: "string",
        description: "Optional CC recipients (comma-separated)",
      },
    },
    required: ["to", "subject", "body"],
  },
};

export const READ_EMAILS_TOOL = {
  name: "read_emails",
  description:
    "Read recent emails from Gmail inbox. Can retrieve up to 20 recent emails.",
  input_schema: {
    type: "object",
    properties: {
      max_results: {
        type: "integer",
        description: "Number of emails to retrieve (1-20, default: 5)",
        default: 5,
      },
      query: {
        type: "string",
        description:
          "Optional search query to filter emails (e.g., 'from:john@example.com', 'subject:meeting')",
      },
    },
    required: [],
  },
};

export const SEARCH_EMAILS_TOOL = {
  name: "search_emails",
  description:
    "Search for specific emails in Gmail using search queries. Supports Gmail search operators like 'from:', 'to:', 'subject:', 'has:attachment', date ranges, etc.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Gmail search query (e.g., 'from:john@example.com', 'subject:invoice', 'has:attachment')",
      },
      max_results: {
        type: "integer",
        description: "Maximum number of results to return (1-20, default: 10)",
        default: 10,
      },
    },
    required: ["query"],
  },
};

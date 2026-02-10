import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  WAMessage,
  proto,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as fs from "fs";
import * as path from "path";
import {
  ChannelAdapter,
  NormalizedMessage,
  ChannelResponse,
  ChannelConfig,
} from "./base";
import { logger } from "../utils/logger";
import { directory } from "../memory/directory";

// Quiet logger for Baileys
const QUIET_BAILEYS_LOGGER = {
  level: "silent" as const,
  fatal: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  child: () => QUIET_BAILEYS_LOGGER,
};

async function safeSaveCreds(
  authDir: string,
  saveCreds: () => Promise<void> | void,
) {
  const tempPath = path.join(authDir, "creds.json.tmp");
  const finalPath = path.join(authDir, "creds.json");
  try {
    await saveCreds();
    if (fs.existsSync(tempPath)) {
      fs.renameSync(tempPath, finalPath);
    }
  } catch (err) {
    logger.warn("WhatsApp creds save error:", err);
  }
}

export interface WhatsAppConfig extends ChannelConfig {
  authDir?: string;
  qrTimeout?: number;
  triggerWords?: string[];
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  selfChatMode?: boolean;
  sendReadReceipts?: boolean;
  debugIds?: boolean;
  ackReaction?: {
    emoji?: string;
    direct?: boolean;
    group?: "always" | "mentions" | "never";
  };
  groupPolicy?: "allowlist" | "open" | "disabled";
  groupAllowFrom?: string[];
  groupActivation?: "mention" | "always";
  testMode?: boolean; // ⭐ NEW: Enable test mode to bypass Claude API
}

export class WhatsAppAdapter extends ChannelAdapter {
  private sock?: WASocket;
  private messageHandler?: (message: NormalizedMessage) => Promise<string>;
  private authDir: string;
  private qrTimeout: number;
  private pausedUsers: Set<string> = new Set();
  private triggerWords: string[];
  private dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  private selfChatMode: boolean;
  private sendReadReceipts: boolean;
  private debugIds: boolean;
  private ackReaction?: WhatsAppConfig["ackReaction"];
  private groupPolicy: "allowlist" | "open" | "disabled";
  private groupAllowFrom?: string[];
  private groupActivation: "mention" | "always";
  private pairingPath: string;
  private pairedAllowFrom: Set<string> = new Set();
  private pendingPairings: Map<string, { code: string; createdAt: number }> =
    new Map();
  private recentOutgoingIds: Map<string, number> = new Map();
  private credsSaveQueue: Promise<void> = Promise.resolve();
  private testMode: boolean; // ⭐ NEW

  constructor(config: WhatsAppConfig) {
    super("whatsapp", config);
    this.authDir = config.authDir || path.join(process.cwd(), ".whatsapp-auth");
    this.qrTimeout = config.qrTimeout || 60;
    this.triggerWords = config.triggerWords || ["noni", "hey noni", "hi noni"];
    this.dmPolicy = config.dmPolicy || "pairing";
    this.selfChatMode = Boolean(config.selfChatMode);
    this.sendReadReceipts =
      config.sendReadReceipts === undefined ? true : config.sendReadReceipts;
    this.debugIds = Boolean(config.debugIds);
    this.ackReaction = config.ackReaction;
    this.groupPolicy =
      config.groupPolicy || (config.groups?.enabled ? "allowlist" : "disabled");
    this.groupAllowFrom = config.groupAllowFrom;
    this.groupActivation =
      config.groupActivation ||
      (config.groups?.requireMention === false ? "always" : "mention");
    this.pairingPath = path.join(this.authDir, "pairing.json");
    this.testMode = Boolean(config.testMode); // ⭐ NEW

    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }

    this.loadPairingState();
  }

  async initialize(): Promise<void> {
    logger.info("Initializing WhatsApp channel adapter...");

    if (this.testMode) {
      logger.warn(
        "🧪 WhatsApp TEST MODE ENABLED - Will return mock responses without calling Claude API",
      );
    }

    this.sock = await this.createSocket();

    this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type && type !== "notify") {
        return;
      }

      for (const msg of messages) {
        const isOutgoing = Boolean(msg.key.fromMe);
        if (isOutgoing && !this.shouldProcessSelfMessage(msg)) {
          continue;
        }

        await this.handleMessage(msg);
      }
    });

    logger.success("WhatsApp adapter initialized");
  }

  listen(
    handler: (message: NormalizedMessage) => Promise<string>,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.messageHandler = handler;
      logger.success("WhatsApp bot is now listening for messages");
      resolve();
    });
  }

  async sendMessage(
    userId: string,
    response: ChannelResponse,
  ): Promise<string> {
    if (!this.sock) {
      throw new Error("WhatsApp socket not initialized");
    }

    try {
      const jid = this.normalizeJid(userId);
      // Add [Noni] prefix to the response text
      const prefixedText = `[Noni (AI Agent)] : ${response.text}`;
      const chunks = this.splitMessage(prefixedText);

      let lastMessageId = "";
      for (const chunk of chunks) {
        const sent = await this.sock.sendMessage(jid, { text: chunk });
        lastMessageId = sent?.key.id || "";
        if (lastMessageId) {
          this.trackOutgoingMessage(lastMessageId);
        }
      }

      return lastMessageId;
    } catch (error) {
      logger.error(`Failed to send WhatsApp message to ${userId}:`, error);
      throw error;
    }
  }

  async sendTypingIndicator(userId: string, groupId?: string): Promise<void> {
    if (!this.sock) return;

    try {
      const jid = this.normalizeJid(groupId || userId);
      await this.sock.sendPresenceUpdate("composing", jid);

      setTimeout(async () => {
        await this.sock?.sendPresenceUpdate("paused", jid);
      }, 3000);
    } catch (error) {
      logger.warn("Failed to send WhatsApp typing indicator:", error);
    }
  }

  shutdown(): Promise<void> {
    return new Promise((resolve) => {
      logger.info("Shutting down WhatsApp adapter...");
      this.sock?.end(undefined);
      logger.success("WhatsApp adapter stopped");
      resolve();
    });
  }

  private handleConnectionUpdate(update: any) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const QRCode = require("qrcode-terminal");
      QRCode.generate(qr, { small: true });
      logger.info("WhatsApp QR Code generated. Scan with your phone.");
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      logger.warn("WhatsApp connection closed. Reconnecting:", shouldReconnect);

      if (shouldReconnect) {
        setTimeout(() => this.initialize(), 5000);
      }
    } else if (connection === "open") {
      logger.success("WhatsApp connection established");
    }
  }

  private generateTestResponse(messageText: string): string {
    const lowerText = messageText.toLowerCase();

    if (
      lowerText.includes("hello") ||
      lowerText.includes("hi") ||
      lowerText.includes("hey")
    ) {
      return "🧪 TEST MODE: Hello! This is a test response. Claude API was not called.";
    }

    if (lowerText.includes("weather")) {
      return "🧪 TEST MODE: The weather is sunny and 72°F. (This is mock data - no API call was made)";
    }

    if (lowerText.includes("reminder")) {
      return "🧪 TEST MODE: I've set a reminder for you. (No actual reminder was created - this is test mode)";
    }

    if (lowerText.includes("test")) {
      return "🧪 TEST MODE ACTIVE ✅\n\nYour message was received and processed without calling the Claude API. This saves you money during testing!\n\nTo disable test mode, set WHATSAPP_TEST_MODE=false in your .env file.";
    }

    return `🧪 TEST MODE: Received your message: "${messageText.substring(0, 50)}${messageText.length > 50 ? "..." : ""}"\n\nNo Claude API call was made. This is a mock response for testing.`;
  }

  private async handleMessage(msg: WAMessage): Promise<void> {
    try {
      if (msg.key.fromMe && !this.selfChatMode) {
        return;
      }
      const messageType = Object.keys(msg.message || {})[0];
      // ⭐ CORE FIX: Always capture the exact remoteJid from the incoming message key.
      // const remoteJid = msg.key.remoteJid || "";
      const remoteJid =
        (msg.key as any).remoteJidAlt || msg.key.remoteJid || "";
      const isGroup = remoteJid.endsWith("@g.us");

      if (remoteJid === "status@broadcast") {
        return;
      }

      const { messageText, attachments, contextInfo } =
        this.extractMessageContent(msg);

      const senderJid = this.getSenderJid(msg, isGroup);
      if (!senderJid) {
        return;
      }

      const senderE164 = this.jidToE164(senderJid);
      const selfJid = this.sock?.user?.id;
      const selfE164 = selfJid ? this.jidToE164(selfJid) : undefined;
      const isSelf = Boolean(selfE164 && senderE164 === selfE164);

      const lowerText = messageText.toLowerCase().trim();

      // Handle pause/stop commands
      if (lowerText === "noni stop" || lowerText === "noni pause") {
        this.pausedUsers.add(remoteJid);
        await this.sendMessage(remoteJid, {
          text: "⏸️ Paused. Say 'noni start' to resume.",
        });
        return;
      }

      // Handle start/resume commands
      if (
        lowerText === "noni start" ||
        lowerText === "/start" ||
        lowerText === "noni resume"
      ) {
        this.pausedUsers.delete(remoteJid);
        await this.sendMessage(remoteJid, {
          text: this.testMode
            ? "🧪 TEST MODE: Back online (mock response)"
            : "✅ Back online. What do you need?",
        });
        return;
      }

      if (this.pausedUsers.has(remoteJid)) {
        return;
      }

      // Pairing system
      if (this.dmPolicy === "pairing" && !isGroup) {
        if (lowerText.startsWith("pair ")) {
          await this.handlePairCommand(
            remoteJid,
            senderE164,
            lowerText.replace("pair ", ""),
          );
          return;
        }

        if (this.pendingPairings.has(senderE164)) {
          const pending = this.pendingPairings.get(senderE164)!;
          if (lowerText === pending.code.toLowerCase()) {
            this.pairedAllowFrom.add(senderE164);
            this.savePairingState();
            this.pendingPairings.delete(senderE164);
            await this.sendMessage(remoteJid, {
              text: "✅ Successfully paired! You can now chat with me.",
            });
            logger.success(`WhatsApp user ${senderE164} successfully paired`);
            return;
          }
        }
      }

      const allowFrom = this.resolveAllowFrom(selfE164);

      if (this.dmPolicy === "disabled" && !isGroup) {
        return;
      }

      if (this.dmPolicy === "pairing" && !isGroup && !isSelf) {
        if (!this.isPhoneAllowed(senderE164, allowFrom)) {
          await this.sendMessage(remoteJid, {
            text: "🔐 You need to pair with this bot first.\n\nAsk the bot owner for a pairing code, then send:\npair YOUR_CODE",
          });
          return;
        }
      }

      if (this.dmPolicy === "allowlist" && !isGroup && !isSelf) {
        if (!this.isPhoneAllowed(senderE164, allowFrom)) {
          return;
        }
      }

      if (isGroup) {
        if (this.groupPolicy === "disabled") {
          return;
        }

        const groupAllowFrom = this.resolveGroupAllowFrom(allowFrom);
        if (this.groupPolicy === "allowlist" && !isSelf) {
          if (!this.isPhoneAllowed(senderE164, groupAllowFrom)) {
            return;
          }
        }

        if (this.groupActivation === "mention") {
          const isMentioned = this.isBotMentioned(
            messageText,
            contextInfo,
            selfJid,
            selfE164,
            isSelf,
          );
          if (!isMentioned) {
            return;
          }
        }
      }

      if (this.debugIds) {
        logger.info(
          `[WhatsApp Debug] remoteJid: ${remoteJid}, senderJid: ${senderJid}, senderE164: ${senderE164}, isSelf: ${isSelf}`,
        );
      }

      if (this.sendReadReceipts) {
        try {
          await this.sock?.readMessages([msg.key]);
        } catch {}
      }

      if (this.ackReaction) {
        const shouldReact = isGroup
          ? this.ackReaction.group === "always" ||
            (this.ackReaction.group === "mentions" &&
              this.isBotMentioned(
                messageText,
                contextInfo,
                selfJid,
                selfE164,
                isSelf,
              ))
          : this.ackReaction.direct !== false;

        if (shouldReact && this.ackReaction.emoji) {
          try {
            await this.sock?.sendMessage(remoteJid, {
              react: {
                text: this.ackReaction.emoji,
                key: msg.key,
              },
            });
          } catch {}
        }
      }

      logger.info(
        `Received WhatsApp message from ${senderE164}: ${messageText.substring(0, 50)}...`,
      );

      await this.sendTypingIndicator(
        remoteJid,
        isGroup ? remoteJid : undefined,
      );

      const normalizedMessage: NormalizedMessage = {
        channel: "whatsapp",
        channelMessageId: msg.key.id || "",
        userId: senderE164,
        username: senderE164,
        content: messageText,
        timestamp: new Date((msg.messageTimestamp as number) * 1000),
        isGroup: isGroup,
        groupId: isGroup ? remoteJid : undefined,
        attachments,
        metadata: {
          senderJid,
          senderE164,
          selfE164,
          isSelf,
          remoteJid,
        },
      };

      try {
        if (!this.messageHandler) {
          throw new Error("Message handler not initialized");
        }

        if (this.testMode) {
          // In test mode, send mock response directly
          const response = this.generateTestResponse(messageText);
          const prefixedResponse = `[Noni (AI Agent)] :  ${response}`;

          const sent = await this.sock!.sendMessage(
            remoteJid,
            {
              text: prefixedResponse,
            },
            {
              quoted: msg,
            },
          );

          if (sent?.key.id) {
            this.trackOutgoingMessage(sent.key.id);
          }

          logger.success(
            `Successfully processed WhatsApp message for ${senderE164} (TEST MODE)`,
          );
        } else {
          // In gateway mode, just forward the message
          // Response will come back async via gateway's channel.send
          await this.messageHandler(normalizedMessage);

          logger.success(`Message forwarded to gateway for ${senderE164}`);
        }
      } catch (error) {
        logger.error(
          `Error handling WhatsApp message for ${senderE164}`,
          error,
        );
        await this.sock!.sendMessage(
          remoteJid,
          {
            text: "[Noni (AI Agent)] : ❌ Sorry, I encountered an error processing your message.",
          },
          {
            quoted: msg,
          },
        );
      }
      //   if (!this.messageHandler) {
      //     throw new Error("Message handler not initialized");
      //   }

      //   let response: string;
      //   if (this.testMode) {
      //     response = this.generateTestResponse(messageText);
      //   } else {
      //     response = await this.messageHandler(normalizedMessage);
      //   }

      //   // Add [Noni] prefix to all responses
      //   const prefixedResponse = `[Noni (AI Agent)] :  ${response}`;

      //   const sent = await this.sock!.sendMessage(
      //     remoteJid,
      //     {
      //       text: prefixedResponse,
      //     },
      //     {
      //       quoted: msg,
      //     },
      //   );

      //   if (sent?.key.id) {
      //     this.trackOutgoingMessage(sent.key.id);
      //   }

      //   logger.success(
      //     `Successfully processed WhatsApp message for ${senderE164}`,
      //   );
      // } catch (error) {
      //   logger.error(
      //     `Error handling WhatsApp message for ${senderE164}`,
      //     error,
      //   );
      //   await this.sock!.sendMessage(
      //     remoteJid,
      //     {
      //       text: "[Noni (AI Agent)] : ❌ Sorry, I encountered an error processing your message.",
      //     },
      //     {
      //       quoted: msg,
      //     },
      //   );
      // }
    } catch (error) {
      logger.error("Uncaught error in handleMessage:", error);
    }
  }

  private async handlePairCommand(
    remoteJid: string,
    senderE164: string,
    code: string,
  ): Promise<void> {
    code = code.trim().toLowerCase();
    if (code.length < 6) {
      await this.sendMessage(remoteJid, {
        text: "❌ Invalid pairing code. The code must be at least 6 characters.",
      });
      return;
    }

    this.pendingPairings.set(senderE164, { code, createdAt: Date.now() });
    await this.sendMessage(remoteJid, {
      text: `🔑 Pairing code received. Please confirm by sending:\n${code}`,
    });
    logger.info(`Pairing initiated for ${senderE164} with code ${code}`);

    setTimeout(
      () => {
        if (this.pendingPairings.has(senderE164)) {
          this.pendingPairings.delete(senderE164);
          logger.info(`Pairing code expired for ${senderE164}`);
        }
      },
      5 * 60 * 1000,
    );
  }

  private loadPairingState() {
    try {
      if (fs.existsSync(this.pairingPath)) {
        const data = fs.readFileSync(this.pairingPath, "utf-8");
        const json = JSON.parse(data);
        if (Array.isArray(json.paired)) {
          this.pairedAllowFrom = new Set(json.paired);
          logger.info(`Loaded ${this.pairedAllowFrom.size} paired users`);
        }
      }
    } catch (error) {
      logger.warn("Could not load pairing state:", error);
    }
  }

  private savePairingState() {
    try {
      const data = { paired: Array.from(this.pairedAllowFrom) };
      fs.writeFileSync(
        this.pairingPath,
        JSON.stringify(data, null, 2),
        "utf-8",
      );
      logger.info("Pairing state saved");
    } catch (error) {
      logger.warn("Could not save pairing state:", error);
    }
  }

  // private normalizeJid(userId: string): string {
  //   if (userId.includes("@")) {
  //     return userId;
  //   }
  //   return `${userId}@s.whatsapp.net`;
  // }
  private normalizeJid(userId: string): string {
    // If it's already a full WhatsApp JID or LID, return as is
    if (
      userId.includes("@s.whatsapp.net") ||
      userId.includes("@g.us") ||
      userId.includes("@lid")
    ) {
      return userId;
    }

    // Otherwise, treat it as a raw phone number
    const digits = userId.replace(/\D/g, "");
    return `${digits}@s.whatsapp.net`;
  }
  private extractMessageContent(msg: WAMessage): {
    messageText: string;
    attachments?: NormalizedMessage["attachments"];
    contextInfo?: proto.IContextInfo;
  } {
    const m = msg.message;
    if (!m) {
      return { messageText: "" };
    }

    const contextInfo =
      m.extendedTextMessage?.contextInfo ||
      m.imageMessage?.contextInfo ||
      m.videoMessage?.contextInfo ||
      m.documentMessage?.contextInfo ||
      m.audioMessage?.contextInfo ||
      m.stickerMessage?.contextInfo ||
      undefined;

    if (m.conversation) {
      return { messageText: m.conversation, contextInfo };
    }
    if (m.extendedTextMessage?.text) {
      return { messageText: m.extendedTextMessage.text, contextInfo };
    }

    const attachments = this.extractAttachments(m);
    if (m.imageMessage?.caption) {
      return { messageText: m.imageMessage.caption, attachments, contextInfo };
    }
    if (m.videoMessage?.caption) {
      return { messageText: m.videoMessage.caption, attachments, contextInfo };
    }

    if (attachments && attachments.length > 0) {
      const placeholder = this.mediaPlaceholder(attachments[0].type);
      return { messageText: placeholder, attachments, contextInfo };
    }

    return { messageText: "", contextInfo };
  }

  private extractAttachments(
    m: proto.IMessage,
  ): NormalizedMessage["attachments"] {
    const attachments: NormalizedMessage["attachments"] = [];
    if (m.imageMessage) {
      attachments.push({
        type: "image",
        mimeType: m.imageMessage.mimetype || undefined,
      });
    }
    if (m.videoMessage) {
      attachments.push({
        type: "video",
        mimeType: m.videoMessage.mimetype || undefined,
      });
    }
    if (m.audioMessage) {
      attachments.push({
        type: "audio",
        mimeType: m.audioMessage.mimetype || undefined,
      });
    }
    if (m.documentMessage) {
      attachments.push({
        type: "document",
        mimeType: m.documentMessage.mimetype || undefined,
        filename: m.documentMessage.fileName || undefined,
      });
    }
    return attachments.length > 0 ? attachments : undefined;
  }

  private mediaPlaceholder(
    type: "image" | "video" | "audio" | "document",
  ): string {
    return `<media:${type}>`;
  }

  private getSenderJid(msg: WAMessage, isGroup: boolean): string {
    if (isGroup) {
      return msg.key.participant || "";
    }
    return msg.key.remoteJid || "";
  }

  private jidToE164(jid: string): string {
    const bare = jid.split("@")[0] || jid;
    if (!bare) return "";
    return bare.startsWith("+") ? bare : `+${bare}`;
  }

  private normalizePhone(value: string): string {
    return value.replace(/[^\d+]/g, "");
  }

  private isPhoneAllowed(senderE164: string, allowFrom?: string[]): boolean {
    if (!allowFrom || allowFrom.length === 0) {
      return false;
    }
    if (allowFrom.includes("*")) return true;
    const sender = this.normalizePhone(senderE164);
    return allowFrom.some((entry) => {
      const normalized = this.normalizePhone(entry);
      return normalized === sender || normalized === sender.replace(/^\+/, "");
    });
  }

  private trackOutgoingMessage(messageId: string) {
    this.recentOutgoingIds.set(messageId, Date.now());
    if (this.recentOutgoingIds.size > 200) {
      for (const [id, ts] of this.recentOutgoingIds.entries()) {
        if (Date.now() - ts > 5 * 60 * 1000) {
          this.recentOutgoingIds.delete(id);
        }
      }
    }
  }

  // Inside WhatsAppAdapter class in whatsapp.ts

  private shouldProcessSelfMessage(msg: WAMessage): boolean {
    // If self-chat is explicitly disabled, never process messages from ourselves
    if (!this.selfChatMode) {
      return false;
    }

    const selfJid = this.sock?.user?.id;
    const selfE164 = selfJid ? this.jidToE164(selfJid) : undefined;
    const allowFrom = this.resolveAllowFrom(selfE164);

    // Final check: only process if the specific self-chat mode logic is met
    const isSelfChat = this.isSelfChatMode(selfE164!, allowFrom);
    if (!isSelfChat) return false;

    const id = msg.key.id || "";
    if (id && this.recentOutgoingIds.has(id)) {
      return false;
    }
    return true;
  }

  private toWhatsappJid(number: string): string {
    const withoutPrefix = number.replace(/^whatsapp:/, "").trim();
    if (withoutPrefix.includes("@")) {
      return withoutPrefix;
    }
    const e164 = this.normalizeE164(withoutPrefix);
    const digits = e164.replace(/\D/g, "");
    return `${digits}@s.whatsapp.net`;
  }

  private normalizeE164(value: string): string {
    const withoutPrefix = value.replace(/^whatsapp:/, "").trim();
    const digits = withoutPrefix.replace(/[^\d+]/g, "");
    if (digits.startsWith("+")) {
      return `+${digits.slice(1)}`;
    }
    return `+${digits}`;
  }

  private isSelfChatMode(selfE164: string, allowFrom?: string[]): boolean {
    if (!selfE164 || !allowFrom || allowFrom.length === 0) {
      return false;
    }
    const normalizedSelf = this.normalizeE164(selfE164);
    return allowFrom.some((n) => {
      if (n === "*") return false;
      try {
        return this.normalizeE164(String(n)) === normalizedSelf;
      } catch {
        return false;
      }
    });
  }

  private resolveAllowFrom(selfE164?: string): string[] {
    const combined = Array.from(
      new Set([...(this.config.allowFrom ?? []), ...this.pairedAllowFrom]),
    ).filter(Boolean);
    if (combined.length > 0) {
      return combined;
    }
    return selfE164 ? [selfE164] : [];
  }

  private resolveGroupAllowFrom(allowFrom: string[]): string[] | undefined {
    if (this.groupAllowFrom && this.groupAllowFrom.length > 0) {
      return this.groupAllowFrom;
    }
    return allowFrom.length > 0 ? allowFrom : undefined;
  }

  private isBotMentioned(
    body: string,
    contextInfo: proto.IContextInfo | undefined,
    selfJid: string | undefined,
    selfE164: string | undefined,
    isSelfChat: boolean,
  ): boolean {
    const mentioned = contextInfo?.mentionedJid ?? [];
    if (mentioned.length > 0 && !isSelfChat) {
      if (selfJid && mentioned.includes(selfJid)) return true;
      if (selfE164) {
        const normalized = mentioned.map((jid) => this.jidToE164(jid));
        if (normalized.includes(selfE164)) return true;
      }
      return false;
    }

    const cleaned = body.replace(/[\u200e\u200f\u202a-\u202e]/g, "");
    const hasTrigger = this.triggerWords.some((trigger) =>
      cleaned.toLowerCase().includes(trigger),
    );
    if (hasTrigger) return true;

    if (selfE164) {
      const digits = selfE164.replace(/\D/g, "");
      if (digits) {
        const bodyDigits = cleaned.replace(/[^\d]/g, "");
        if (bodyDigits.includes(digits)) {
          return true;
        }
      }
    }
    return false;
  }

  private enqueueSaveCreds(saveCreds: () => Promise<void> | void) {
    this.credsSaveQueue = this.credsSaveQueue
      .then(() => safeSaveCreds(this.authDir, saveCreds))
      .catch((err) => {
        logger.warn("WhatsApp creds save queue error:", err);
      });
  }

  private async createSocket(): Promise<WASocket> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, QUIET_BAILEYS_LOGGER),
      },
      version,
      logger: QUIET_BAILEYS_LOGGER,
      printQRInTerminal: false,
      qrTimeout: this.qrTimeout * 1000,
      browser: ["agent-noni", "cli", "1.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    sock.ev.on("connection.update", (update) => {
      this.handleConnectionUpdate(update);
    });
    sock.ev.on("creds.update", () => this.enqueueSaveCreds(saveCreds));

    return sock;
  }
}

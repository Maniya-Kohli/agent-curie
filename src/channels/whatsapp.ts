import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  WAMessage,
  proto,
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

export interface WhatsAppConfig extends ChannelConfig {
  authDir?: string;
  qrTimeout?: number;
  triggerWords?: string[]; // Add configurable trigger words
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  selfChatMode?: boolean;
  sendReadReceipts?: boolean;
  ackReaction?: {
    emoji?: string;
    direct?: boolean;
    group?: "always" | "mentions" | "never";
  };
  groupPolicy?: "allowlist" | "open" | "disabled";
  groupAllowFrom?: string[];
  groupActivation?: "mention" | "always";
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
  private ackReaction?: WhatsAppConfig["ackReaction"];
  private groupPolicy: "allowlist" | "open" | "disabled";
  private groupAllowFrom?: string[];
  private groupActivation: "mention" | "always";
  private pairingPath: string;
  private pairedAllowFrom: Set<string> = new Set();
  private pendingPairings: Map<
    string,
    { code: string; createdAt: number }
  > = new Map();
  private recentOutgoingIds: Map<string, number> = new Map();

  constructor(config: WhatsAppConfig) {
    super("whatsapp", config);
    this.authDir = config.authDir || path.join(process.cwd(), ".whatsapp-auth");
    this.qrTimeout = config.qrTimeout || 60;
    this.triggerWords = config.triggerWords || ["noni", "hey noni", "hi noni"];
    this.dmPolicy = config.dmPolicy || "pairing";
    this.selfChatMode = Boolean(config.selfChatMode);
    this.sendReadReceipts =
      config.sendReadReceipts === undefined ? true : config.sendReadReceipts;
    this.ackReaction = config.ackReaction;
    this.groupPolicy =
      config.groupPolicy ||
      (config.groups?.enabled ? "allowlist" : "disabled");
    this.groupAllowFrom = config.groupAllowFrom;
    this.groupActivation =
      config.groupActivation ||
      (config.groups?.requireMention === false ? "always" : "mention");
    this.pairingPath = path.join(this.authDir, "pairing.json");

    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }

    this.loadPairingState();
  }

  async initialize(): Promise<void> {
    logger.info("Initializing WhatsApp channel adapter...");

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      qrTimeout: this.qrTimeout * 1000,
    });

    this.sock.ev.on("connection.update", (update) => {
      this.handleConnectionUpdate(update);
    });

    this.sock.ev.on("creds.update", saveCreds);

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
      const chunks = this.splitMessage(response.text);

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
        this.initialize();
      }
    } else if (connection === "open") {
      logger.success("WhatsApp connection established");
    }
  }

  private async handleMessage(msg: WAMessage): Promise<void> {
    try {
      const messageType = Object.keys(msg.message || {})[0];
      const remoteJid = msg.key.remoteJid || "";
      const isGroup = remoteJid.endsWith("@g.us");

      // Skip status updates completely
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
          text: "Paused. Say 'noni start' to resume.",
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
          text: "Back online. What do you need?",
        });
        return;
      }

      // Don't respond if user has paused
      if (this.pausedUsers.has(remoteJid)) {
        return;
      }

      if (!messageText) {
        return;
      }

      // For groups: Check both trigger word and mention
      if (isGroup) {
        if (this.groupPolicy === "disabled") {
          return;
        }

        if (
          this.groupPolicy === "allowlist" &&
          !this.isGroupAllowed(remoteJid)
        ) {
          return;
        }

        if (
          this.groupAllowFrom &&
          !this.isPhoneAllowed(senderE164, this.groupAllowFrom)
        ) {
          return;
        }

        const isMentioned = this.isMentioned(contextInfo);
        const hasTrigger = this.triggerWords.some((trigger) =>
          lowerText.includes(trigger),
        );
        if (this.groupActivation === "mention" && !isMentioned && !hasTrigger) {
          return;
        }
      } else {
        if (!this.isDirectAllowed(senderE164, isSelf)) {
          return;
        }

        const approvalCommand = this.extractPairingApproval(lowerText);
        if (approvalCommand && this.isOwner(senderE164, selfE164)) {
          await this.approvePairing(approvalCommand.code, remoteJid);
          return;
        }

        if (this.dmPolicy === "pairing" && !this.isKnownSender(senderE164)) {
          await this.sendPairingRequest(senderE164, remoteJid);
          return;
        }
      }

      await this.maybeSendAckReaction(msg, isGroup, contextInfo);

      if (this.sendReadReceipts && !this.selfChatMode) {
        await this.sock?.readMessages([msg.key]);
      }

      logger.info(
        `Received WhatsApp message from ${senderE164}: ${messageText.substring(0, 50)}...`,
      );

      await this.sendTypingIndicator(remoteJid);

      const cleanedMessage = this.stripTriggerWords(messageText);
      const contentWithReply = this.appendQuotedReply(
        cleanedMessage || messageText,
        contextInfo,
      );

      const normalizedMessage: NormalizedMessage = {
        channel: "whatsapp",
        channelMessageId: msg.key.id || "",
        userId: remoteJid,
        username: msg.pushName || undefined,
        content: contentWithReply,
        attachments,
        timestamp: new Date((msg.messageTimestamp as number) * 1000),
        isGroup,
        groupId: isGroup ? remoteJid : undefined,
        replyTo: contextInfo?.stanzaId ?? undefined,
        metadata: {
          messageType,
          participant: msg.key.participant,
          sender: senderE164,
          replyToBody: this.extractQuotedBody(contextInfo?.quotedMessage),
          replyToSender: contextInfo?.participant
            ? this.jidToE164(contextInfo.participant)
            : undefined,
        },
      };

      if (!this.messageHandler) {
        throw new Error("Message handler not initialized");
      }

      const response = await this.messageHandler(normalizedMessage);

      // Add signature for non-owner recipients
      const isOwner = directory.isOwner(`whatsapp:${remoteJid}`);
      const signedResponse = isOwner
        ? response
        : `${response}\n\n— Noni (Maniya's AI Assistant)`;

      await this.sendMessage(remoteJid, { text: signedResponse });

      logger.success(`Successfully processed WhatsApp message for ${remoteJid}`);
    } catch (error) {
      logger.error("Error handling WhatsApp message:", error);
    }
  }

  private loadPairingState() {
    if (!fs.existsSync(this.pairingPath)) return;
    try {
      const raw = fs.readFileSync(this.pairingPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.allowFrom)) {
        for (const entry of parsed.allowFrom) {
          if (typeof entry === "string") {
            this.pairedAllowFrom.add(entry);
          }
        }
      }
      if (parsed.pending && typeof parsed.pending === "object") {
        for (const [sender, data] of Object.entries(parsed.pending)) {
          if (
            data &&
            typeof (data as any).code === "string" &&
            typeof (data as any).createdAt === "number"
          ) {
            this.pendingPairings.set(sender, {
              code: (data as any).code,
              createdAt: (data as any).createdAt,
            });
          }
        }
      }
    } catch (error) {
      logger.warn("Failed to load WhatsApp pairing state:", error);
    }
  }

  private savePairingState() {
    const payload = {
      allowFrom: Array.from(this.pairedAllowFrom),
      pending: Object.fromEntries(this.pendingPairings),
    };
    try {
      fs.writeFileSync(this.pairingPath, JSON.stringify(payload, null, 2));
    } catch (error) {
      logger.warn("Failed to save WhatsApp pairing state:", error);
    }
  }

  private isOwner(senderE164: string, selfE164?: string): boolean {
    if (selfE164 && senderE164 === selfE164) return true;
    if (!this.config.allowFrom || this.config.allowFrom.length === 0) {
      return false;
    }
    return this.isPhoneAllowed(senderE164, this.config.allowFrom);
  }

  private isKnownSender(senderE164: string): boolean {
    if (this.isPhoneAllowed(senderE164, this.config.allowFrom)) return true;
    return this.isPhoneAllowed(senderE164, Array.from(this.pairedAllowFrom));
  }

  private isDirectAllowed(senderE164: string, isSelf: boolean): boolean {
    if (this.selfChatMode && isSelf) return true;

    if (this.dmPolicy === "disabled") {
      return false;
    }

    if (this.dmPolicy === "open") {
      return this.isPhoneAllowed(senderE164, this.config.allowFrom, true);
    }

    if (this.dmPolicy === "allowlist") {
      return this.isKnownSender(senderE164);
    }

    return true;
  }

  private extractPairingApproval(
    lowerText: string,
  ): { code: string } | null {
    const match = lowerText.match(/^(?:\/?pair|\/?pairing approve)\s+(\w+)/i);
    if (!match) return null;
    return { code: match[1].toUpperCase() };
  }

  private async approvePairing(code: string, replyJid: string) {
    const entry = Array.from(this.pendingPairings.entries()).find(
      ([, value]) => value.code.toUpperCase() === code.toUpperCase(),
    );
    if (!entry) {
      await this.sendMessage(replyJid, {
        text: `No pending pairing found for code ${code}.`,
      });
      return;
    }

    const [senderE164] = entry;
    this.pendingPairings.delete(senderE164);
    this.pairedAllowFrom.add(senderE164);
    this.savePairingState();

    const requesterJid = this.e164ToJid(senderE164);
    if (requesterJid) {
      await this.sendMessage(requesterJid, {
        text: "Pairing approved. You can now chat with Noni.",
      });
    }

    await this.sendMessage(replyJid, {
      text: `Approved pairing for ${senderE164}.`,
    });
  }

  private async sendPairingRequest(senderE164: string, replyJid: string) {
    const existing = this.pendingPairings.get(senderE164);
    if (existing && Date.now() - existing.createdAt < 60 * 60 * 1000) {
      return;
    }

    if (this.pendingPairings.size >= 3) {
      return;
    }

    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    this.pendingPairings.set(senderE164, { code, createdAt: Date.now() });
    this.savePairingState();

    await this.sendMessage(replyJid, {
      text: `Pairing required. Ask the owner to approve code: ${code}`,
    });
  }

  private stripTriggerWords(messageText: string): string {
    let cleanedMessage = messageText;
    for (const trigger of this.triggerWords) {
      const regex = new RegExp(trigger, "gi");
      cleanedMessage = cleanedMessage.replace(regex, "").trim();
    }
    return cleanedMessage;
  }

  private appendQuotedReply(
    body: string,
    contextInfo?: proto.IContextInfo,
  ): string {
    if (!contextInfo?.quotedMessage) return body;
    const replyToId = contextInfo.stanzaId || "unknown";
    const replySender = contextInfo.participant
      ? this.jidToE164(contextInfo.participant)
      : "unknown";
    const quotedBody =
      this.extractQuotedBody(contextInfo.quotedMessage) || "<empty>";
    return `${body}\n\n[Replying to ${replySender} id:${replyToId}]\n${quotedBody}\n[/Replying]`;
  }

  private extractQuotedBody(
    quoted?: proto.IMessage | null,
  ): string | undefined {
    if (!quoted) return undefined;
    if (quoted.conversation) return quoted.conversation;
    if (quoted.extendedTextMessage?.text) {
      return quoted.extendedTextMessage.text;
    }
    if (quoted.imageMessage) return "<media:image>";
    if (quoted.videoMessage) return "<media:video>";
    if (quoted.audioMessage) return "<media:audio>";
    if (quoted.documentMessage) return "<media:document>";
    if (quoted.stickerMessage) return "<media:sticker>";
    return undefined;
  }

  private isMentioned(contextInfo?: proto.IContextInfo): boolean {
    if (!contextInfo?.mentionedJid?.length) return false;
    const botJid = this.sock?.user?.id;
    return Boolean(botJid && contextInfo.mentionedJid.includes(botJid));
  }

  private async maybeSendAckReaction(
    msg: WAMessage,
    isGroup: boolean,
    contextInfo?: proto.IContextInfo,
  ) {
    if (!this.sock) return;
    if (!this.ackReaction?.emoji) return;

    const emoji = this.ackReaction.emoji;
    const direct = this.ackReaction.direct ?? true;
    const groupMode = this.ackReaction.group ?? "mentions";

    if (!isGroup && !direct) return;

    if (isGroup) {
      if (groupMode === "never") return;
      if (groupMode === "mentions") {
        if (this.groupActivation === "always") {
          // allow reaction for always-on groups
        } else if (!this.isMentioned(contextInfo)) {
          return;
        }
      }
    }

    try {
      await this.sock.sendMessage(msg.key.remoteJid || "", {
        react: {
          text: emoji,
          key: msg.key,
        },
      });
    } catch (error) {
      logger.warn("Failed to send WhatsApp ack reaction:", error);
    }
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

  private e164ToJid(e164: string): string {
    if (!e164) return "";
    const digits = e164.replace(/^\+/, "");
    return this.normalizeJid(digits);
  }

  private normalizePhone(value: string): string {
    return value.replace(/[^\d+]/g, "");
  }

  private isPhoneAllowed(
    senderE164: string,
    allowFrom?: string[],
    requireStarForOpen: boolean = false,
  ): boolean {
    if (!allowFrom || allowFrom.length === 0) {
      return !requireStarForOpen;
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

  private shouldProcessSelfMessage(msg: WAMessage): boolean {
    if (!this.selfChatMode) return false;
    const id = msg.key.id || "";
    if (id && this.recentOutgoingIds.has(id)) {
      return false;
    }
    return true;
  }

  private normalizeJid(jid: string): string {
    if (!jid.includes("@")) {
      return `${jid}@s.whatsapp.net`;
    }
    return jid;
  }
}

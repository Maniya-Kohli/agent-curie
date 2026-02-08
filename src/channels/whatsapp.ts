// // import makeWASocket, {
// //   DisconnectReason,
// //   useMultiFileAuthState,
// //   WASocket,
// //   WAMessage,
// //   proto,
// // } from "@whiskeysockets/baileys";
// // import { Boom } from "@hapi/boom";
// // import * as fs from "fs";
// // import * as path from "path";
// // import {
// //   ChannelAdapter,
// //   NormalizedMessage,
// //   ChannelResponse,
// //   ChannelConfig,
// // } from "./base";
// // import { logger } from "../utils/logger";
// // import { directory } from "../memory/directory";

// // export interface WhatsAppConfig extends ChannelConfig {
// //   authDir?: string;
// //   qrTimeout?: number;
// //   triggerWords?: string[]; // Add configurable trigger words
// //   dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
// //   selfChatMode?: boolean;
// //   sendReadReceipts?: boolean;
// //   ackReaction?: {
// //     emoji?: string;
// //     direct?: boolean;
// //     group?: "always" | "mentions" | "never";
// //   };
// //   groupPolicy?: "allowlist" | "open" | "disabled";
// //   groupAllowFrom?: string[];
// //   groupActivation?: "mention" | "always";
// // }

// // export class WhatsAppAdapter extends ChannelAdapter {
// //   private sock?: WASocket;
// //   private messageHandler?: (message: NormalizedMessage) => Promise<string>;
// //   private authDir: string;
// //   private qrTimeout: number;
// //   private pausedUsers: Set<string> = new Set();
// //   private triggerWords: string[];
// //   private dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
// //   private selfChatMode: boolean;
// //   private sendReadReceipts: boolean;
// //   private ackReaction?: WhatsAppConfig["ackReaction"];
// //   private groupPolicy: "allowlist" | "open" | "disabled";
// //   private groupAllowFrom?: string[];
// //   private groupActivation: "mention" | "always";
// //   private pairingPath: string;
// //   private pairedAllowFrom: Set<string> = new Set();
// //   private pendingPairings: Map<string, { code: string; createdAt: number }> =
// //     new Map();
// //   private recentOutgoingIds: Map<string, number> = new Map();

// //   constructor(config: WhatsAppConfig) {
// //     super("whatsapp", config);
// //     this.authDir = config.authDir || path.join(process.cwd(), ".whatsapp-auth");
// //     this.qrTimeout = config.qrTimeout || 60;
// //     this.triggerWords = config.triggerWords || ["noni", "hey noni", "hi noni"];
// //     this.dmPolicy = config.dmPolicy || "pairing";
// //     this.selfChatMode = Boolean(config.selfChatMode);
// //     this.sendReadReceipts =
// //       config.sendReadReceipts === undefined ? true : config.sendReadReceipts;
// //     this.ackReaction = config.ackReaction;
// //     this.groupPolicy =
// //       config.groupPolicy || (config.groups?.enabled ? "allowlist" : "disabled");
// //     this.groupAllowFrom = config.groupAllowFrom;
// //     this.groupActivation =
// //       config.groupActivation ||
// //       (config.groups?.requireMention === false ? "always" : "mention");
// //     this.pairingPath = path.join(this.authDir, "pairing.json");

// //     if (!fs.existsSync(this.authDir)) {
// //       fs.mkdirSync(this.authDir, { recursive: true });
// //     }

// //     this.loadPairingState();
// //   }

// //   async initialize(): Promise<void> {
// //     logger.info("Initializing WhatsApp channel adapter...");

// //     const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

// //     this.sock = makeWASocket({
// //       auth: state,
// //       printQRInTerminal: true,
// //       qrTimeout: this.qrTimeout * 1000,
// //     });

// //     this.sock.ev.on("connection.update", (update) => {
// //       this.handleConnectionUpdate(update);
// //     });

// //     this.sock.ev.on("creds.update", saveCreds);

// //     this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
// //       if (type && type !== "notify") {
// //         return;
// //       }

// //       for (const msg of messages) {
// //         const isOutgoing = Boolean(msg.key.fromMe);
// //         if (isOutgoing && !this.shouldProcessSelfMessage(msg)) {
// //           continue;
// //         }

// //         await this.handleMessage(msg);
// //       }
// //     });

// //     logger.success("WhatsApp adapter initialized");
// //   }

// //   listen(
// //     handler: (message: NormalizedMessage) => Promise<string>,
// //   ): Promise<void> {
// //     return new Promise((resolve) => {
// //       this.messageHandler = handler;
// //       logger.success("WhatsApp bot is now listening for messages");
// //       resolve();
// //     });
// //   }

// //   async sendMessage(
// //     userId: string,
// //     response: ChannelResponse,
// //   ): Promise<string> {
// //     if (!this.sock) {
// //       throw new Error("WhatsApp socket not initialized");
// //     }

// //     try {
// //       const jid = this.normalizeJid(userId);
// //       const chunks = this.splitMessage(response.text);

// //       let lastMessageId = "";
// //       for (const chunk of chunks) {
// //         const sent = await this.sock.sendMessage(jid, { text: chunk });
// //         lastMessageId = sent?.key.id || "";
// //         if (lastMessageId) {
// //           this.trackOutgoingMessage(lastMessageId);
// //         }
// //       }

// //       return lastMessageId;
// //     } catch (error) {
// //       logger.error(`Failed to send WhatsApp message to ${userId}:`, error);
// //       throw error;
// //     }
// //   }

// //   async sendTypingIndicator(userId: string, groupId?: string): Promise<void> {
// //     if (!this.sock) return;

// //     try {
// //       const jid = this.normalizeJid(groupId || userId);
// //       await this.sock.sendPresenceUpdate("composing", jid);

// //       setTimeout(async () => {
// //         await this.sock?.sendPresenceUpdate("paused", jid);
// //       }, 3000);
// //     } catch (error) {
// //       logger.warn("Failed to send WhatsApp typing indicator:", error);
// //     }
// //   }

// //   shutdown(): Promise<void> {
// //     return new Promise((resolve) => {
// //       logger.info("Shutting down WhatsApp adapter...");
// //       this.sock?.end(undefined);
// //       logger.success("WhatsApp adapter stopped");
// //       resolve();
// //     });
// //   }

// //   private handleConnectionUpdate(update: any) {
// //     const { connection, lastDisconnect, qr } = update;

// //     if (qr) {
// //       const QRCode = require("qrcode-terminal");
// //       QRCode.generate(qr, { small: true });
// //       logger.info("WhatsApp QR Code generated. Scan with your phone.");
// //     }

// //     if (connection === "close") {
// //       const shouldReconnect =
// //         (lastDisconnect?.error as Boom)?.output?.statusCode !==
// //         DisconnectReason.loggedOut;

// //       logger.warn("WhatsApp connection closed. Reconnecting:", shouldReconnect);

// //       if (shouldReconnect) {
// //         this.initialize();
// //       }
// //     } else if (connection === "open") {
// //       logger.success("WhatsApp connection established");
// //     }
// //   }

// //   private async handleMessage(msg: WAMessage): Promise<void> {
// //     try {
// //       const messageType = Object.keys(msg.message || {})[0];
// //       const remoteJid = msg.key.remoteJid || "";
// //       const isGroup = remoteJid.endsWith("@g.us");

// //       // Skip status updates completely
// //       if (remoteJid === "status@broadcast") {
// //         return;
// //       }

// //       const { messageText, attachments, contextInfo } =
// //         this.extractMessageContent(msg);

// //       const senderJid = this.getSenderJid(msg, isGroup);
// //       if (!senderJid) {
// //         return;
// //       }
// //       const senderE164 = this.jidToE164(senderJid);
// //       const selfJid = this.sock?.user?.id;
// //       const selfE164 = selfJid ? this.jidToE164(selfJid) : undefined;
// //       const isSelf = Boolean(selfE164 && senderE164 === selfE164);

// //       const lowerText = messageText.toLowerCase().trim();

// //       // Handle pause/stop commands
// //       if (lowerText === "noni stop" || lowerText === "noni pause") {
// //         this.pausedUsers.add(remoteJid);
// //         await this.sendMessage(remoteJid, {
// //           text: "Paused. Say 'noni start' to resume.",
// //         });
// //         return;
// //       }

// //       // Handle start/resume commands
// //       if (
// //         lowerText === "noni start" ||
// //         lowerText === "/start" ||
// //         lowerText === "noni resume"
// //       ) {
// //         this.pausedUsers.delete(remoteJid);
// //         await this.sendMessage(remoteJid, {
// //           text: "Back online. What do you need?",
// //         });
// //         return;
// //       }

// //       // Don't respond if user has paused
// //       if (this.pausedUsers.has(remoteJid)) {
// //         return;
// //       }

// //       if (!messageText) {
// //         return;
// //       }

// //       // For groups: Check both trigger word and mention
// //       if (isGroup) {
// //         if (this.groupPolicy === "disabled") {
// //           return;
// //         }

// //         if (
// //           this.groupPolicy === "allowlist" &&
// //           !this.isGroupAllowed(remoteJid)
// //         ) {
// //           return;
// //         }

// //         if (
// //           this.groupAllowFrom &&
// //           !this.isPhoneAllowed(senderE164, this.groupAllowFrom)
// //         ) {
// //           return;
// //         }

// //         const isMentioned = this.isMentioned(contextInfo);
// //         const hasTrigger = this.triggerWords.some((trigger) =>
// //           lowerText.includes(trigger),
// //         );
// //         if (this.groupActivation === "mention" && !isMentioned && !hasTrigger) {
// //           return;
// //         }
// //       } else {
// //         if (!this.isDirectAllowed(senderE164, isSelf)) {
// //           return;
// //         }

// //         const approvalCommand = this.extractPairingApproval(lowerText);
// //         if (approvalCommand && this.isOwner(senderE164, selfE164)) {
// //           await this.approvePairing(approvalCommand.code, remoteJid);
// //           return;
// //         }

// //         if (this.dmPolicy === "pairing" && !this.isKnownSender(senderE164)) {
// //           await this.sendPairingRequest(senderE164, remoteJid);
// //           return;
// //         }
// //       }

// //       await this.maybeSendAckReaction(msg, isGroup, contextInfo);

// //       if (this.sendReadReceipts && !this.selfChatMode) {
// //         await this.sock?.readMessages([msg.key]);
// //       }

// //       logger.info(
// //         `Received WhatsApp message from ${senderE164}: ${messageText.substring(0, 50)}...`,
// //       );

// //       await this.sendTypingIndicator(remoteJid);

// //       const cleanedMessage = this.stripTriggerWords(messageText);
// //       const contentWithReply = this.appendQuotedReply(
// //         cleanedMessage || messageText,
// //         contextInfo,
// //       );

// //       const normalizedMessage: NormalizedMessage = {
// //         channel: "whatsapp",
// //         channelMessageId: msg.key.id || "",
// //         userId: remoteJid,
// //         username: msg.pushName || undefined,
// //         content: contentWithReply,
// //         attachments,
// //         timestamp: new Date((msg.messageTimestamp as number) * 1000),
// //         isGroup,
// //         groupId: isGroup ? remoteJid : undefined,
// //         replyTo: contextInfo?.stanzaId ?? undefined,
// //         metadata: {
// //           messageType,
// //           participant: msg.key.participant,
// //           sender: senderE164,
// //           replyToBody: this.extractQuotedBody(contextInfo?.quotedMessage),
// //           replyToSender: contextInfo?.participant
// //             ? this.jidToE164(contextInfo.participant)
// //             : undefined,
// //         },
// //       };

// //       if (!this.messageHandler) {
// //         throw new Error("Message handler not initialized");
// //       }

// //       const response = await this.messageHandler(normalizedMessage);

// //       // Add signature for non-owner recipients
// //       const isOwner = directory.isOwner(`whatsapp:${remoteJid}`);
// //       const signedResponse = isOwner
// //         ? response
// //         : `${response}\n\n— Noni (Maniya's AI Assistant)`;

// //       await this.sendMessage(remoteJid, { text: signedResponse });

// //       logger.success(
// //         `Successfully processed WhatsApp message for ${remoteJid}`,
// //       );
// //     } catch (error) {
// //       logger.error("Error handling WhatsApp message:", error);
// //     }
// //   }

// //   private loadPairingState() {
// //     if (!fs.existsSync(this.pairingPath)) return;
// //     try {
// //       const raw = fs.readFileSync(this.pairingPath, "utf8");
// //       const parsed = JSON.parse(raw);
// //       if (Array.isArray(parsed.allowFrom)) {
// //         for (const entry of parsed.allowFrom) {
// //           if (typeof entry === "string") {
// //             this.pairedAllowFrom.add(entry);
// //           }
// //         }
// //       }
// //       if (parsed.pending && typeof parsed.pending === "object") {
// //         for (const [sender, data] of Object.entries(parsed.pending)) {
// //           if (
// //             data &&
// //             typeof (data as any).code === "string" &&
// //             typeof (data as any).createdAt === "number"
// //           ) {
// //             this.pendingPairings.set(sender, {
// //               code: (data as any).code,
// //               createdAt: (data as any).createdAt,
// //             });
// //           }
// //         }
// //       }
// //     } catch (error) {
// //       logger.warn("Failed to load WhatsApp pairing state:", error);
// //     }
// //   }

// //   private savePairingState() {
// //     const payload = {
// //       allowFrom: Array.from(this.pairedAllowFrom),
// //       pending: Object.fromEntries(this.pendingPairings),
// //     };
// //     try {
// //       fs.writeFileSync(this.pairingPath, JSON.stringify(payload, null, 2));
// //     } catch (error) {
// //       logger.warn("Failed to save WhatsApp pairing state:", error);
// //     }
// //   }

// //   private isOwner(senderE164: string, selfE164?: string): boolean {
// //     if (selfE164 && senderE164 === selfE164) return true;
// //     if (!this.config.allowFrom || this.config.allowFrom.length === 0) {
// //       return false;
// //     }
// //     return this.isPhoneAllowed(senderE164, this.config.allowFrom);
// //   }

// //   private isKnownSender(senderE164: string): boolean {
// //     if (this.isPhoneAllowed(senderE164, this.config.allowFrom)) return true;
// //     return this.isPhoneAllowed(senderE164, Array.from(this.pairedAllowFrom));
// //   }

// //   private isDirectAllowed(senderE164: string, isSelf: boolean): boolean {
// //     if (this.selfChatMode && isSelf) return true;

// //     if (this.dmPolicy === "disabled") {
// //       return false;
// //     }

// //     if (this.dmPolicy === "open") {
// //       return this.isPhoneAllowed(senderE164, this.config.allowFrom, true);
// //     }

// //     if (this.dmPolicy === "allowlist") {
// //       return this.isKnownSender(senderE164);
// //     }

// //     return true;
// //   }

// //   private extractPairingApproval(lowerText: string): { code: string } | null {
// //     const match = lowerText.match(/^(?:\/?pair|\/?pairing approve)\s+(\w+)/i);
// //     if (!match) return null;
// //     return { code: match[1].toUpperCase() };
// //   }

// //   private async approvePairing(code: string, replyJid: string) {
// //     const entry = Array.from(this.pendingPairings.entries()).find(
// //       ([, value]) => value.code.toUpperCase() === code.toUpperCase(),
// //     );
// //     if (!entry) {
// //       await this.sendMessage(replyJid, {
// //         text: `No pending pairing found for code ${code}.`,
// //       });
// //       return;
// //     }

// //     const [senderE164] = entry;
// //     this.pendingPairings.delete(senderE164);
// //     this.pairedAllowFrom.add(senderE164);
// //     this.savePairingState();

// //     const requesterJid = this.e164ToJid(senderE164);
// //     if (requesterJid) {
// //       await this.sendMessage(requesterJid, {
// //         text: "Pairing approved. You can now chat with Noni.",
// //       });
// //     }

// //     await this.sendMessage(replyJid, {
// //       text: `Approved pairing for ${senderE164}.`,
// //     });
// //   }

// //   private async sendPairingRequest(senderE164: string, replyJid: string) {
// //     const existing = this.pendingPairings.get(senderE164);
// //     if (existing && Date.now() - existing.createdAt < 60 * 60 * 1000) {
// //       return;
// //     }

// //     if (this.pendingPairings.size >= 3) {
// //       return;
// //     }

// //     const code = Math.random().toString(36).slice(2, 8).toUpperCase();
// //     this.pendingPairings.set(senderE164, { code, createdAt: Date.now() });
// //     this.savePairingState();

// //     await this.sendMessage(replyJid, {
// //       text: `Pairing required. Ask the owner to approve code: ${code}`,
// //     });
// //   }

// //   private stripTriggerWords(messageText: string): string {
// //     let cleanedMessage = messageText;
// //     for (const trigger of this.triggerWords) {
// //       const regex = new RegExp(trigger, "gi");
// //       cleanedMessage = cleanedMessage.replace(regex, "").trim();
// //     }
// //     return cleanedMessage;
// //   }

// //   private appendQuotedReply(
// //     body: string,
// //     contextInfo?: proto.IContextInfo,
// //   ): string {
// //     if (!contextInfo?.quotedMessage) return body;
// //     const replyToId = contextInfo.stanzaId || "unknown";
// //     const replySender = contextInfo.participant
// //       ? this.jidToE164(contextInfo.participant)
// //       : "unknown";
// //     const quotedBody =
// //       this.extractQuotedBody(contextInfo.quotedMessage) || "<empty>";
// //     return `${body}\n\n[Replying to ${replySender} id:${replyToId}]\n${quotedBody}\n[/Replying]`;
// //   }

// //   private extractQuotedBody(
// //     quoted?: proto.IMessage | null,
// //   ): string | undefined {
// //     if (!quoted) return undefined;
// //     if (quoted.conversation) return quoted.conversation;
// //     if (quoted.extendedTextMessage?.text) {
// //       return quoted.extendedTextMessage.text;
// //     }
// //     if (quoted.imageMessage) return "<media:image>";
// //     if (quoted.videoMessage) return "<media:video>";
// //     if (quoted.audioMessage) return "<media:audio>";
// //     if (quoted.documentMessage) return "<media:document>";
// //     if (quoted.stickerMessage) return "<media:sticker>";
// //     return undefined;
// //   }

// //   private isMentioned(contextInfo?: proto.IContextInfo): boolean {
// //     if (!contextInfo?.mentionedJid?.length) return false;
// //     const botJid = this.sock?.user?.id;
// //     return Boolean(botJid && contextInfo.mentionedJid.includes(botJid));
// //   }

// //   private async maybeSendAckReaction(
// //     msg: WAMessage,
// //     isGroup: boolean,
// //     contextInfo?: proto.IContextInfo,
// //   ) {
// //     if (!this.sock) return;
// //     if (!this.ackReaction?.emoji) return;

// //     const emoji = this.ackReaction.emoji;
// //     const direct = this.ackReaction.direct ?? true;
// //     const groupMode = this.ackReaction.group ?? "mentions";

// //     if (!isGroup && !direct) return;

// //     if (isGroup) {
// //       if (groupMode === "never") return;
// //       if (groupMode === "mentions") {
// //         if (this.groupActivation === "always") {
// //           // allow reaction for always-on groups
// //         } else if (!this.isMentioned(contextInfo)) {
// //           return;
// //         }
// //       }
// //     }

// //     try {
// //       await this.sock.sendMessage(msg.key.remoteJid || "", {
// //         react: {
// //           text: emoji,
// //           key: msg.key,
// //         },
// //       });
// //     } catch (error) {
// //       logger.warn("Failed to send WhatsApp ack reaction:", error);
// //     }
// //   }

// //   private extractMessageContent(msg: WAMessage): {
// //     messageText: string;
// //     attachments?: NormalizedMessage["attachments"];
// //     contextInfo?: proto.IContextInfo;
// //   } {
// //     const m = msg.message;
// //     if (!m) {
// //       return { messageText: "" };
// //     }

// //     const contextInfo =
// //       m.extendedTextMessage?.contextInfo ||
// //       m.imageMessage?.contextInfo ||
// //       m.videoMessage?.contextInfo ||
// //       m.documentMessage?.contextInfo ||
// //       m.audioMessage?.contextInfo ||
// //       m.stickerMessage?.contextInfo ||
// //       undefined;

// //     if (m.conversation) {
// //       return { messageText: m.conversation, contextInfo };
// //     }
// //     if (m.extendedTextMessage?.text) {
// //       return { messageText: m.extendedTextMessage.text, contextInfo };
// //     }

// //     const attachments = this.extractAttachments(m);
// //     if (m.imageMessage?.caption) {
// //       return { messageText: m.imageMessage.caption, attachments, contextInfo };
// //     }
// //     if (m.videoMessage?.caption) {
// //       return { messageText: m.videoMessage.caption, attachments, contextInfo };
// //     }

// //     if (attachments && attachments.length > 0) {
// //       const placeholder = this.mediaPlaceholder(attachments[0].type);
// //       return { messageText: placeholder, attachments, contextInfo };
// //     }

// //     return { messageText: "", contextInfo };
// //   }

// //   private extractAttachments(
// //     m: proto.IMessage,
// //   ): NormalizedMessage["attachments"] {
// //     const attachments: NormalizedMessage["attachments"] = [];
// //     if (m.imageMessage) {
// //       attachments.push({
// //         type: "image",
// //         mimeType: m.imageMessage.mimetype || undefined,
// //       });
// //     }
// //     if (m.videoMessage) {
// //       attachments.push({
// //         type: "video",
// //         mimeType: m.videoMessage.mimetype || undefined,
// //       });
// //     }
// //     if (m.audioMessage) {
// //       attachments.push({
// //         type: "audio",
// //         mimeType: m.audioMessage.mimetype || undefined,
// //       });
// //     }
// //     if (m.documentMessage) {
// //       attachments.push({
// //         type: "document",
// //         mimeType: m.documentMessage.mimetype || undefined,
// //         filename: m.documentMessage.fileName || undefined,
// //       });
// //     }
// //     return attachments.length > 0 ? attachments : undefined;
// //   }

// //   private mediaPlaceholder(
// //     type: "image" | "video" | "audio" | "document",
// //   ): string {
// //     return `<media:${type}>`;
// //   }

// //   private getSenderJid(msg: WAMessage, isGroup: boolean): string {
// //     if (isGroup) {
// //       return msg.key.participant || "";
// //     }
// //     return msg.key.remoteJid || "";
// //   }

// //   private jidToE164(jid: string): string {
// //     const bare = jid.split("@")[0] || jid;
// //     if (!bare) return "";
// //     return bare.startsWith("+") ? bare : `+${bare}`;
// //   }

// //   private e164ToJid(e164: string): string {
// //     if (!e164) return "";
// //     const digits = e164.replace(/^\+/, "");
// //     return this.normalizeJid(digits);
// //   }

// //   private normalizePhone(value: string): string {
// //     return value.replace(/[^\d+]/g, "");
// //   }

// //   private isPhoneAllowed(
// //     senderE164: string,
// //     allowFrom?: string[],
// //     requireStarForOpen: boolean = false,
// //   ): boolean {
// //     if (!allowFrom || allowFrom.length === 0) {
// //       return !requireStarForOpen;
// //     }
// //     if (allowFrom.includes("*")) return true;
// //     const sender = this.normalizePhone(senderE164);
// //     return allowFrom.some((entry) => {
// //       const normalized = this.normalizePhone(entry);
// //       return normalized === sender || normalized === sender.replace(/^\+/, "");
// //     });
// //   }

// //   private trackOutgoingMessage(messageId: string) {
// //     this.recentOutgoingIds.set(messageId, Date.now());
// //     if (this.recentOutgoingIds.size > 200) {
// //       for (const [id, ts] of this.recentOutgoingIds.entries()) {
// //         if (Date.now() - ts > 5 * 60 * 1000) {
// //           this.recentOutgoingIds.delete(id);
// //         }
// //       }
// //     }
// //   }

// //   private shouldProcessSelfMessage(msg: WAMessage): boolean {
// //     if (!this.selfChatMode) return false;
// //     const id = msg.key.id || "";
// //     if (id && this.recentOutgoingIds.has(id)) {
// //       return false;
// //     }
// //     return true;
// //   }

// //   private normalizeJid(jid: string): string {
// //     if (!jid.includes("@")) {
// //       return `${jid}@s.whatsapp.net`;
// //     }
// //     return jid;
// //   }
// // }

// import makeWASocket, {
//   DisconnectReason,
//   fetchLatestBaileysVersion,
//   makeCacheableSignalKeyStore,
//   useMultiFileAuthState,
//   WASocket,
//   WAMessage,
//   proto,
// } from "@whiskeysockets/baileys";
// import { Boom } from "@hapi/boom";
// import * as fs from "fs";
// import * as path from "path";
// import {
//   ChannelAdapter,
//   NormalizedMessage,
//   ChannelResponse,
//   ChannelConfig,
// } from "./base";
// import { logger } from "../utils/logger";

// type BaileysLogger = {
//   level: string;
//   child: () => BaileysLogger;
//   trace: (...args: any[]) => void;
//   debug: (...args: any[]) => void;
//   info: (...args: any[]) => void;
//   warn: (...args: any[]) => void;
//   error: (...args: any[]) => void;
// };

// const QUIET_BAILEYS_LOGGER: BaileysLogger = {
//   level: "silent",
//   child: () => QUIET_BAILEYS_LOGGER,
//   trace: () => undefined,
//   debug: () => undefined,
//   info: () => undefined,
//   warn: (msg: string, err?: any) => logger.warn(msg, err),
//   error: (msg: string, err?: any) => logger.error(msg, err),
// };

// const CREDS_FILE = "creds.json";
// const CREDS_BACKUP_FILE = "creds.json.bak";

// function readCredsJsonRaw(filePath: string): string | null {
//   try {
//     if (!fs.existsSync(filePath)) {
//       return null;
//     }
//     const stats = fs.statSync(filePath);
//     if (!stats.isFile() || stats.size <= 1) {
//       return null;
//     }
//     return fs.readFileSync(filePath, "utf-8");
//   } catch {
//     return null;
//   }
// }

// async function safeSaveCreds(
//   authDir: string,
//   saveCreds: () => Promise<void> | void,
// ): Promise<void> {
//   try {
//     const credsPath = path.join(authDir, CREDS_FILE);
//     const backupPath = path.join(authDir, CREDS_BACKUP_FILE);
//     const raw = readCredsJsonRaw(credsPath);
//     if (raw) {
//       try {
//         JSON.parse(raw);
//         fs.copyFileSync(credsPath, backupPath);
//       } catch {
//         // Keep existing backup if creds are corrupted.
//       }
//     }
//   } catch {
//     // Ignore backup failures.
//   }

//   try {
//     await Promise.resolve(saveCreds());
//   } catch (err) {
//     logger.warn("Failed saving WhatsApp creds:", err);
//   }
// }

// export interface WhatsAppConfig extends ChannelConfig {
//   authDir?: string;
//   qrTimeout?: number;
//   triggerWords?: string[]; // Add configurable trigger words
//   dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
//   selfChatMode?: boolean;
//   sendReadReceipts?: boolean;
//   debugIds?: boolean;
//   ackReaction?: {
//     emoji?: string;
//     direct?: boolean;
//     group?: "always" | "mentions" | "never";
//   };
//   groupPolicy?: "allowlist" | "open" | "disabled";
//   groupAllowFrom?: string[];
//   groupActivation?: "mention" | "always";
// }

// export class WhatsAppAdapter extends ChannelAdapter {
//   private sock?: WASocket;
//   private messageHandler?: (message: NormalizedMessage) => Promise<string>;
//   private authDir: string;
//   private qrTimeout: number;
//   private pausedUsers: Set<string> = new Set();
//   private triggerWords: string[];
//   private dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
//   private selfChatMode: boolean;
//   private sendReadReceipts: boolean;
//   private ackReaction?: WhatsAppConfig["ackReaction"];
//   private groupPolicy: "allowlist" | "open" | "disabled";
//   private groupAllowFrom?: string[];
//   private groupActivation: "mention" | "always";
//   private debugIds: boolean;
//   private pairingPath: string;
//   private pairedAllowFrom: Set<string> = new Set();
//   private pendingPairings: Map<string, { code: string; createdAt: number }> =
//     new Map();
//   private recentOutgoingIds: Map<string, number> = new Map();
//   private credsSaveQueue: Promise<void> = Promise.resolve();

//   constructor(config: WhatsAppConfig) {
//     super("whatsapp", config);
//     this.authDir = config.authDir || path.join(process.cwd(), ".whatsapp-auth");
//     this.qrTimeout = config.qrTimeout || 60;
//     this.triggerWords = config.triggerWords || ["noni", "hey noni", "hi noni"];
//     this.dmPolicy = config.dmPolicy || "pairing";
//     this.selfChatMode = Boolean(config.selfChatMode);
//     this.sendReadReceipts =
//       config.sendReadReceipts === undefined ? true : config.sendReadReceipts;
//     this.debugIds = Boolean(config.debugIds);
//     this.ackReaction = config.ackReaction;
//     this.groupPolicy =
//       config.groupPolicy || (config.groups?.enabled ? "open" : "disabled");
//     this.groupAllowFrom = config.groupAllowFrom;
//     this.groupActivation =
//       config.groupActivation ||
//       (config.groups?.requireMention === false ? "always" : "mention");
//     this.pairingPath = path.join(this.authDir, "pairing.json");

//     if (!fs.existsSync(this.authDir)) {
//       fs.mkdirSync(this.authDir, { recursive: true });
//     }

//     this.loadPairingState();
//   }

//   async initialize(): Promise<void> {
//     logger.info("Initializing WhatsApp channel adapter...");

//     this.sock = await this.createSocket();

//     this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
//       if (type && type !== "notify") {
//         return;
//       }

//       for (const msg of messages) {
//         const isOutgoing = Boolean(msg.key.fromMe);
//         if (isOutgoing && !this.shouldProcessSelfMessage(msg)) {
//           continue;
//         }

//         await this.handleMessage(msg);
//       }
//     });

//     logger.success("WhatsApp adapter initialized");
//   }

//   listen(
//     handler: (message: NormalizedMessage) => Promise<string>,
//   ): Promise<void> {
//     return new Promise((resolve) => {
//       this.messageHandler = handler;
//       logger.success("WhatsApp bot is now listening for messages");
//       resolve();
//     });
//   }

//   async sendMessage(
//     userId: string,
//     response: ChannelResponse,
//   ): Promise<string> {
//     if (!this.sock) {
//       throw new Error("WhatsApp socket not initialized");
//     }

//     try {
//       const jid = this.toWhatsappJid(userId);
//       const chunks = this.splitMessage(response.text);

//       let lastMessageId = "";
//       for (const chunk of chunks) {
//         const sent = await this.sock.sendMessage(jid, { text: chunk });
//         lastMessageId = sent?.key.id || "";
//         if (lastMessageId) {
//           this.trackOutgoingMessage(lastMessageId);
//         }
//       }

//       return lastMessageId;
//     } catch (error) {
//       logger.error(`Failed to send WhatsApp message to ${userId}:`, error);
//       throw error;
//     }
//   }

//   async sendTypingIndicator(userId: string, groupId?: string): Promise<void> {
//     if (!this.sock) return;

//     try {
//       const jid = this.toWhatsappJid(groupId || userId);
//       await this.sock.sendPresenceUpdate("composing", jid);

//       setTimeout(async () => {
//         await this.sock?.sendPresenceUpdate("paused", jid);
//       }, 3000);
//     } catch (error) {
//       logger.warn("Failed to send WhatsApp typing indicator:", error);
//     }
//   }

//   shutdown(): Promise<void> {
//     return new Promise((resolve) => {
//       logger.info("Shutting down WhatsApp adapter...");
//       this.sock?.end(undefined);
//       logger.success("WhatsApp adapter stopped");
//       resolve();
//     });
//   }

//   private handleConnectionUpdate(update: any) {
//     const { connection, lastDisconnect, qr } = update;

//     if (qr) {
//       const QRCode = require("qrcode-terminal");
//       QRCode.generate(qr, { small: true });
//       logger.info("WhatsApp QR Code generated. Scan with your phone.");
//     }

//     if (connection === "close") {
//       const shouldReconnect =
//         (lastDisconnect?.error as Boom)?.output?.statusCode !==
//         DisconnectReason.loggedOut;

//       logger.warn("WhatsApp connection closed. Reconnecting:", shouldReconnect);

//       if (shouldReconnect) {
//         this.initialize();
//       }
//     } else if (connection === "open") {
//       logger.success("WhatsApp connection established");
//     }
//   }

//   private async handleMessage(msg: WAMessage): Promise<void> {
//     try {
//       const messageType = Object.keys(msg.message || {})[0];
//       const remoteJid = msg.key.remoteJid || "";
//       const isGroup = remoteJid.endsWith("@g.us");

//       // Skip status updates completely
//       if (remoteJid === "status@broadcast") {
//         return;
//       }

//       const { messageText, attachments, contextInfo } =
//         this.extractMessageContent(msg);

//       const senderJid = this.getSenderJid(msg, isGroup);
//       if (!senderJid) {
//         return;
//       }
//       const senderE164 = this.jidToE164(senderJid);
//       const selfJid = this.sock?.user?.id;
//       const replyJid = remoteJid;
//       if (this.debugIds) {
//         logger.info(
//           `WhatsApp ids: remoteJid=${remoteJid} replyJid=${replyJid} senderJid=${senderJid} selfJid=${selfJid ?? "unknown"}`,
//         );
//       }
//       const selfE164 = selfJid ? this.jidToE164(selfJid) : undefined;
//       const allowFrom = this.resolveAllowFrom(selfE164);
//       const groupAllowFrom = this.resolveGroupAllowFrom(allowFrom);
//       const isSelf = Boolean(selfE164 && senderE164 === selfE164);
//       const isSelfChat =
//         this.selfChatMode ||
//         (selfE164 ? this.isSelfChatMode(selfE164, allowFrom) : false);

//       const lowerText = messageText.toLowerCase().trim();

//       // Handle pause/stop commands
//       if (lowerText === "noni stop" || lowerText === "noni pause") {
//         this.pausedUsers.add(remoteJid);
//         await this.sendMessage(remoteJid, {
//           text: "Paused. Say 'noni start' to resume.",
//         });
//         return;
//       }

//       // Handle start/resume commands
//       if (
//         lowerText === "noni start" ||
//         lowerText === "/start" ||
//         lowerText === "noni resume"
//       ) {
//         this.pausedUsers.delete(remoteJid);
//         await this.sendMessage(remoteJid, {
//           text: "Back online. What do you need?",
//         });
//         return;
//       }

//       // Don't respond if user has paused
//       if (this.pausedUsers.has(remoteJid)) {
//         return;
//       }

//       if (!messageText) {
//         return;
//       }

//       // For groups: Check both trigger word and mention
//       if (isGroup) {
//         if (this.groupPolicy === "disabled") {
//           return;
//         }

//         if (this.groupPolicy === "allowlist") {
//           if (!groupAllowFrom || groupAllowFrom.length === 0) {
//             return;
//           }
//           if (!this.isPhoneAllowed(senderE164, groupAllowFrom)) {
//             return;
//           }
//         }

//         if (this.groupActivation === "mention") {
//           const isMentioned = this.isBotMentioned(
//             messageText,
//             contextInfo,
//             selfJid,
//             selfE164,
//             isSelfChat,
//           );
//           if (!isMentioned) {
//             return;
//           }
//         }
//       } else {
//         if (msg.key.fromMe && !isSelf) {
//           return;
//         }
//         if (this.dmPolicy === "disabled") {
//           return;
//         }
//         if (this.dmPolicy !== "open" && !isSelf) {
//           if (!this.isPhoneAllowed(senderE164, allowFrom)) {
//             if (this.dmPolicy === "pairing") {
//               await this.sendPairingRequest(senderE164, remoteJid);
//             }
//             return;
//           }
//         }

//         const approvalCommand = this.extractPairingApproval(lowerText);
//         if (approvalCommand && this.isOwner(senderE164, selfE164)) {
//           await this.approvePairing(approvalCommand.code, remoteJid);
//           return;
//         }
//       }

//       await this.maybeSendAckReaction(msg, isGroup, contextInfo);

//       if (this.sendReadReceipts && !isSelfChat) {
//         await this.sock?.readMessages([msg.key]);
//       }

//       logger.info(
//         `Received WhatsApp message from ${senderE164}: ${messageText.substring(0, 50)}...`,
//       );

//       await this.sendTypingIndicator(remoteJid);

//       const cleanedMessage = this.stripTriggerWords(messageText);
//       const contentWithReply = this.appendQuotedReply(
//         cleanedMessage || messageText,
//         contextInfo,
//       );

//       const conversationId = !isGroup && senderE164 ? senderE164 : remoteJid;
//       const normalizedMessage: NormalizedMessage = {
//         channel: "whatsapp",
//         channelMessageId: msg.key.id || "",
//         userId: conversationId,
//         username: msg.pushName || undefined,
//         content: contentWithReply,
//         attachments,
//         timestamp: new Date((msg.messageTimestamp as number) * 1000),
//         isGroup,
//         groupId: isGroup ? remoteJid : undefined,
//         replyTo: contextInfo?.stanzaId ?? undefined,
//         metadata: {
//           messageType,
//           participant: msg.key.participant,
//           sender: senderE164,
//           replyToBody: this.extractQuotedBody(contextInfo?.quotedMessage),
//           replyToSender: contextInfo?.participant
//             ? this.jidToE164(contextInfo.participant)
//             : undefined,
//         },
//       };

//       if (!this.messageHandler) {
//         throw new Error("Message handler not initialized");
//       }

//       const response = await this.messageHandler(normalizedMessage);
//       const signedResponse = `${response}\n\n— Noni (Maniya's AI Agent)`;

//       await this.sendMessage(replyJid, { text: signedResponse });

//       logger.success(
//         `Successfully processed WhatsApp message for ${remoteJid}`,
//       );
//     } catch (error) {
//       logger.error("Error handling WhatsApp message:", error);
//     }
//   }

//   private loadPairingState() {
//     if (!fs.existsSync(this.pairingPath)) return;
//     try {
//       const raw = fs.readFileSync(this.pairingPath, "utf8");
//       const parsed = JSON.parse(raw);
//       if (Array.isArray(parsed.allowFrom)) {
//         for (const entry of parsed.allowFrom) {
//           if (typeof entry === "string") {
//             this.pairedAllowFrom.add(entry);
//           }
//         }
//       }
//       if (parsed.pending && typeof parsed.pending === "object") {
//         for (const [sender, data] of Object.entries(parsed.pending)) {
//           if (
//             data &&
//             typeof (data as any).code === "string" &&
//             typeof (data as any).createdAt === "number"
//           ) {
//             this.pendingPairings.set(sender, {
//               code: (data as any).code,
//               createdAt: (data as any).createdAt,
//             });
//           }
//         }
//       }
//     } catch (error) {
//       logger.warn("Failed to load WhatsApp pairing state:", error);
//     }
//   }

//   private savePairingState() {
//     const payload = {
//       allowFrom: Array.from(this.pairedAllowFrom),
//       pending: Object.fromEntries(this.pendingPairings),
//     };
//     try {
//       fs.writeFileSync(this.pairingPath, JSON.stringify(payload, null, 2));
//     } catch (error) {
//       logger.warn("Failed to save WhatsApp pairing state:", error);
//     }
//   }

//   private isOwner(senderE164: string, selfE164?: string): boolean {
//     if (selfE164 && senderE164 === selfE164) return true;
//     if (!this.config.allowFrom || this.config.allowFrom.length === 0) {
//       return false;
//     }
//     return this.isPhoneAllowed(senderE164, this.config.allowFrom);
//   }

//   private extractPairingApproval(lowerText: string): { code: string } | null {
//     const match = lowerText.match(/^(?:\/?pair|\/?pairing approve)\s+(\w+)/i);
//     if (!match) return null;
//     return { code: match[1].toUpperCase() };
//   }

//   private async approvePairing(code: string, replyJid: string) {
//     const entry = Array.from(this.pendingPairings.entries()).find(
//       ([, value]) => value.code.toUpperCase() === code.toUpperCase(),
//     );
//     if (!entry) {
//       await this.sendMessage(replyJid, {
//         text: `No pending pairing found for code ${code}.`,
//       });
//       return;
//     }

//     const [senderE164] = entry;
//     this.pendingPairings.delete(senderE164);
//     this.pairedAllowFrom.add(senderE164);
//     this.savePairingState();

//     const requesterJid = this.e164ToJid(senderE164);
//     if (requesterJid) {
//       await this.sendMessage(requesterJid, {
//         text: "Pairing approved. You can now chat with Noni.",
//       });
//     }

//     await this.sendMessage(replyJid, {
//       text: `Approved pairing for ${senderE164}.`,
//     });
//   }

//   private async sendPairingRequest(senderE164: string, replyJid: string) {
//     const existing = this.pendingPairings.get(senderE164);
//     if (existing && Date.now() - existing.createdAt < 60 * 60 * 1000) {
//       return;
//     }

//     if (this.pendingPairings.size >= 3) {
//       return;
//     }

//     const code = Math.random().toString(36).slice(2, 8).toUpperCase();
//     this.pendingPairings.set(senderE164, { code, createdAt: Date.now() });
//     this.savePairingState();

//     await this.sendMessage(replyJid, {
//       text: `Pairing required. Ask the owner to approve code: ${code}`,
//     });
//   }

//   private stripTriggerWords(messageText: string): string {
//     let cleanedMessage = messageText;
//     for (const trigger of this.triggerWords) {
//       const regex = new RegExp(trigger, "gi");
//       cleanedMessage = cleanedMessage.replace(regex, "").trim();
//     }
//     return cleanedMessage;
//   }

//   private appendQuotedReply(
//     body: string,
//     contextInfo?: proto.IContextInfo,
//   ): string {
//     if (!contextInfo?.quotedMessage) return body;
//     const replyToId = contextInfo.stanzaId || "unknown";
//     const replySender = contextInfo.participant
//       ? this.jidToE164(contextInfo.participant)
//       : "unknown";
//     const quotedBody =
//       this.extractQuotedBody(contextInfo.quotedMessage) || "<empty>";
//     return `${body}\n\n[Replying to ${replySender} id:${replyToId}]\n${quotedBody}\n[/Replying]`;
//   }

//   private extractQuotedBody(
//     quoted?: proto.IMessage | null,
//   ): string | undefined {
//     if (!quoted) return undefined;
//     if (quoted.conversation) return quoted.conversation;
//     if (quoted.extendedTextMessage?.text) {
//       return quoted.extendedTextMessage.text;
//     }
//     if (quoted.imageMessage) return "<media:image>";
//     if (quoted.videoMessage) return "<media:video>";
//     if (quoted.audioMessage) return "<media:audio>";
//     if (quoted.documentMessage) return "<media:document>";
//     if (quoted.stickerMessage) return "<media:sticker>";
//     return undefined;
//   }

//   private isMentioned(contextInfo?: proto.IContextInfo): boolean {
//     if (!contextInfo?.mentionedJid?.length) return false;
//     const botJid = this.sock?.user?.id;
//     return Boolean(botJid && contextInfo.mentionedJid.includes(botJid));
//   }

//   private async maybeSendAckReaction(
//     msg: WAMessage,
//     isGroup: boolean,
//     contextInfo?: proto.IContextInfo,
//   ) {
//     if (!this.sock) return;
//     if (!this.ackReaction?.emoji) return;

//     const emoji = this.ackReaction.emoji;
//     const direct = this.ackReaction.direct ?? true;
//     const groupMode = this.ackReaction.group ?? "mentions";

//     if (!isGroup && !direct) return;

//     if (isGroup) {
//       if (groupMode === "never") return;
//       if (groupMode === "mentions") {
//         if (this.groupActivation === "always") {
//           // allow reaction for always-on groups
//         } else if (!this.isMentioned(contextInfo)) {
//           return;
//         }
//       }
//     }

//     try {
//       await this.sock.sendMessage(msg.key.remoteJid || "", {
//         react: {
//           text: emoji,
//           key: msg.key,
//         },
//       });
//     } catch (error) {
//       logger.warn("Failed to send WhatsApp ack reaction:", error);
//     }
//   }

//   private extractMessageContent(msg: WAMessage): {
//     messageText: string;
//     attachments?: NormalizedMessage["attachments"];
//     contextInfo?: proto.IContextInfo;
//   } {
//     const m = msg.message;
//     if (!m) {
//       return { messageText: "" };
//     }

//     const contextInfo =
//       m.extendedTextMessage?.contextInfo ||
//       m.imageMessage?.contextInfo ||
//       m.videoMessage?.contextInfo ||
//       m.documentMessage?.contextInfo ||
//       m.audioMessage?.contextInfo ||
//       m.stickerMessage?.contextInfo ||
//       undefined;

//     if (m.conversation) {
//       return { messageText: m.conversation, contextInfo };
//     }
//     if (m.extendedTextMessage?.text) {
//       return { messageText: m.extendedTextMessage.text, contextInfo };
//     }

//     const attachments = this.extractAttachments(m);
//     if (m.imageMessage?.caption) {
//       return { messageText: m.imageMessage.caption, attachments, contextInfo };
//     }
//     if (m.videoMessage?.caption) {
//       return { messageText: m.videoMessage.caption, attachments, contextInfo };
//     }

//     if (attachments && attachments.length > 0) {
//       const placeholder = this.mediaPlaceholder(attachments[0].type);
//       return { messageText: placeholder, attachments, contextInfo };
//     }

//     return { messageText: "", contextInfo };
//   }

//   private extractAttachments(
//     m: proto.IMessage,
//   ): NormalizedMessage["attachments"] {
//     const attachments: NormalizedMessage["attachments"] = [];
//     if (m.imageMessage) {
//       attachments.push({
//         type: "image",
//         mimeType: m.imageMessage.mimetype || undefined,
//       });
//     }
//     if (m.videoMessage) {
//       attachments.push({
//         type: "video",
//         mimeType: m.videoMessage.mimetype || undefined,
//       });
//     }
//     if (m.audioMessage) {
//       attachments.push({
//         type: "audio",
//         mimeType: m.audioMessage.mimetype || undefined,
//       });
//     }
//     if (m.documentMessage) {
//       attachments.push({
//         type: "document",
//         mimeType: m.documentMessage.mimetype || undefined,
//         filename: m.documentMessage.fileName || undefined,
//       });
//     }
//     return attachments.length > 0 ? attachments : undefined;
//   }

//   private mediaPlaceholder(
//     type: "image" | "video" | "audio" | "document",
//   ): string {
//     return `<media:${type}>`;
//   }

//   private getSenderJid(msg: WAMessage, isGroup: boolean): string {
//     if (isGroup) {
//       return msg.key.participant || "";
//     }
//     return msg.key.remoteJid || "";
//   }

//   private jidToE164(jid: string): string {
//     const bare = jid.split("@")[0] || jid;
//     if (!bare) return "";
//     return bare.startsWith("+") ? bare : `+${bare}`;
//   }

//   private e164ToJid(e164: string): string {
//     if (!e164) return "";
//     const digits = e164.replace(/^\+/, "");
//     return this.toWhatsappJid(digits);
//   }

//   private normalizePhone(value: string): string {
//     return value.replace(/[^\d+]/g, "");
//   }

//   private isPhoneAllowed(senderE164: string, allowFrom?: string[]): boolean {
//     if (!allowFrom || allowFrom.length === 0) {
//       return false;
//     }
//     if (allowFrom.includes("*")) return true;
//     const sender = this.normalizePhone(senderE164);
//     return allowFrom.some((entry) => {
//       const normalized = this.normalizePhone(entry);
//       return normalized === sender || normalized === sender.replace(/^\+/, "");
//     });
//   }

//   private trackOutgoingMessage(messageId: string) {
//     this.recentOutgoingIds.set(messageId, Date.now());
//     if (this.recentOutgoingIds.size > 200) {
//       for (const [id, ts] of this.recentOutgoingIds.entries()) {
//         if (Date.now() - ts > 5 * 60 * 1000) {
//           this.recentOutgoingIds.delete(id);
//         }
//       }
//     }
//   }

//   private shouldProcessSelfMessage(msg: WAMessage): boolean {
//     const selfJid = this.sock?.user?.id;
//     const selfE164 = selfJid ? this.jidToE164(selfJid) : undefined;
//     const allowFrom = this.resolveAllowFrom(selfE164);
//     const isSelfChat =
//       this.selfChatMode ||
//       (selfE164 ? this.isSelfChatMode(selfE164, allowFrom) : false);
//     if (!isSelfChat) return false;
//     const id = msg.key.id || "";
//     if (id && this.recentOutgoingIds.has(id)) {
//       return false;
//     }
//     return true;
//   }

//   private toWhatsappJid(number: string): string {
//     const withoutPrefix = number.replace(/^whatsapp:/, "").trim();
//     if (withoutPrefix.includes("@")) {
//       return withoutPrefix;
//     }
//     const e164 = this.normalizeE164(withoutPrefix);
//     const digits = e164.replace(/\D/g, "");
//     return `${digits}@s.whatsapp.net`;
//   }

//   private normalizeE164(value: string): string {
//     const withoutPrefix = value.replace(/^whatsapp:/, "").trim();
//     const digits = withoutPrefix.replace(/[^\d+]/g, "");
//     if (digits.startsWith("+")) {
//       return `+${digits.slice(1)}`;
//     }
//     return `+${digits}`;
//   }

//   private isSelfChatMode(selfE164: string, allowFrom?: string[]): boolean {
//     if (!selfE164 || !allowFrom || allowFrom.length === 0) {
//       return false;
//     }
//     const normalizedSelf = this.normalizeE164(selfE164);
//     return allowFrom.some((n) => {
//       if (n === "*") return false;
//       try {
//         return this.normalizeE164(String(n)) === normalizedSelf;
//       } catch {
//         return false;
//       }
//     });
//   }

//   private resolveAllowFrom(selfE164?: string): string[] {
//     const combined = Array.from(
//       new Set([...(this.config.allowFrom ?? []), ...this.pairedAllowFrom]),
//     ).filter(Boolean);
//     if (combined.length > 0) {
//       return combined;
//     }
//     return selfE164 ? [selfE164] : [];
//   }

//   private resolveGroupAllowFrom(allowFrom: string[]): string[] | undefined {
//     if (this.groupAllowFrom && this.groupAllowFrom.length > 0) {
//       return this.groupAllowFrom;
//     }
//     return allowFrom.length > 0 ? allowFrom : undefined;
//   }

//   private isBotMentioned(
//     body: string,
//     contextInfo: proto.IContextInfo | undefined,
//     selfJid: string | undefined,
//     selfE164: string | undefined,
//     isSelfChat: boolean,
//   ): boolean {
//     const mentioned = contextInfo?.mentionedJid ?? [];
//     if (mentioned.length > 0 && !isSelfChat) {
//       if (selfJid && mentioned.includes(selfJid)) return true;
//       if (selfE164) {
//         const normalized = mentioned.map((jid) => this.jidToE164(jid));
//         if (normalized.includes(selfE164)) return true;
//       }
//       // Explicitly mentioned someone else.
//       return false;
//     }

//     const cleaned = body.replace(/[\u200e\u200f\u202a-\u202e]/g, "");
//     const hasTrigger = this.triggerWords.some((trigger) =>
//       cleaned.toLowerCase().includes(trigger),
//     );
//     if (hasTrigger) return true;

//     if (selfE164) {
//       const digits = selfE164.replace(/\D/g, "");
//       if (digits) {
//         const bodyDigits = cleaned.replace(/[^\d]/g, "");
//         if (bodyDigits.includes(digits)) {
//           return true;
//         }
//       }
//     }
//     return false;
//   }

//   private enqueueSaveCreds(saveCreds: () => Promise<void> | void) {
//     this.credsSaveQueue = this.credsSaveQueue
//       .then(() => safeSaveCreds(this.authDir, saveCreds))
//       .catch((err) => {
//         logger.warn("WhatsApp creds save queue error:", err);
//       });
//   }

//   private async createSocket(): Promise<WASocket> {
//     const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
//     const { version } = await fetchLatestBaileysVersion();
//     const sock = makeWASocket({
//       auth: {
//         creds: state.creds,
//         keys: makeCacheableSignalKeyStore(state.keys, QUIET_BAILEYS_LOGGER),
//       },
//       version,
//       logger: QUIET_BAILEYS_LOGGER,
//       printQRInTerminal: false,
//       qrTimeout: this.qrTimeout * 1000,
//       browser: ["agent-noni", "cli", "1.0.0"],
//       syncFullHistory: false,
//       markOnlineOnConnect: false,
//     });

//     sock.ev.on("connection.update", (update) => {
//       this.handleConnectionUpdate(update);
//     });
//     sock.ev.on("creds.update", () => this.enqueueSaveCreds(saveCreds));

//     return sock;
//   }
// }
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

        let response: string;
        if (this.testMode) {
          response = this.generateTestResponse(messageText);
        } else {
          response = await this.messageHandler(normalizedMessage);
        }

        // Add [Noni] prefix to all responses
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
          `Successfully processed WhatsApp message for ${senderE164}`,
        );
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

// // src/channels/whatsapp.ts

// import makeWASocket, {
//   DisconnectReason,
//   useMultiFileAuthState,
//   WASocket,
//   WAMessage,
//   proto,
//   downloadMediaMessage,
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
// import { directory } from "../memory/directory";

// export interface WhatsAppConfig extends ChannelConfig {
//   authDir?: string;
//   qrTimeout?: number;
// }

// export class WhatsAppAdapter extends ChannelAdapter {
//   private sock?: WASocket;
//   private messageHandler?: (message: NormalizedMessage) => Promise<string>;
//   private authDir: string;
//   private qrTimeout: number;
//   private pausedUsers: Set<string> = new Set();

//   constructor(config: WhatsAppConfig) {
//     super("whatsapp", config);
//     this.authDir = config.authDir || path.join(process.cwd(), ".whatsapp-auth");
//     this.qrTimeout = config.qrTimeout || 60;

//     if (!fs.existsSync(this.authDir)) {
//       fs.mkdirSync(this.authDir, { recursive: true });
//     }
//   }

//   async initialize(): Promise<void> {
//     logger.info("Initializing WhatsApp channel adapter...");

//     const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

//     this.sock = makeWASocket({
//       auth: state,
//       printQRInTerminal: true,
//       qrTimeout: this.qrTimeout * 1000,
//     });

//     this.sock.ev.on("connection.update", (update) => {
//       this.handleConnectionUpdate(update);
//     });

//     this.sock.ev.on("creds.update", saveCreds);

//     this.sock.ev.on("messages.upsert", async ({ messages }) => {
//       console.log("[DEBUG] Messages received:", messages.length);

//       for (const msg of messages) {
//         console.log("[DEBUG] Message details:", {
//           fromMe: msg.key.fromMe,
//           remoteJid: msg.key.remoteJid,
//           messageType: Object.keys(msg.message || {})[0],
//         });

//         if (msg.key.fromMe) {
//           console.log("[DEBUG] Skipping outgoing message");
//           continue;
//         }

//         console.log("[DEBUG] Processing incoming message");
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
//       const jid = this.normalizeJid(userId);
//       const chunks = this.splitMessage(response.text);

//       let lastMessageId = "";
//       for (const chunk of chunks) {
//         const sent = await this.sock.sendMessage(jid, { text: chunk });
//         lastMessageId = sent?.key.id || "";
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
//       const jid = this.normalizeJid(groupId || userId);
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
//     console.log("[DEBUG] handleMessage called");
//     try {
//       const messageType = Object.keys(msg.message || {})[0];
//       const userId = msg.key.remoteJid || "";
//       const isGroup = userId.endsWith("@g.us");

//       let messageText = "";
//       if (msg.message?.conversation) {
//         messageText = msg.message.conversation;
//       } else if (msg.message?.extendedTextMessage) {
//         messageText = msg.message.extendedTextMessage.text || "";
//       } else if (msg.message?.imageMessage?.caption) {
//         messageText = msg.message.imageMessage.caption;
//       }

//       const lowerText = messageText.toLowerCase().trim();

//       if (lowerText === "noni stop" || lowerText === "noni pause") {
//         this.pausedUsers.add(userId);
//         await this.sendMessage(userId, {
//           text: "Paused. Say 'noni start' to resume.",
//         });
//         return;
//       }

//       if (
//         lowerText === "noni start" ||
//         lowerText === "/start" ||
//         lowerText === "noni resume"
//       ) {
//         this.pausedUsers.delete(userId);
//         await this.sendMessage(userId, {
//           text: "Back online. What do you need?",
//         });
//         return;
//       }

//       if (this.pausedUsers.has(userId)) {
//         return;
//       }

//       console.log("[DEBUG] Auth check - userId:", userId.split("@")[0]);
//       console.log("[DEBUG] Auth check - allowFrom:", this.config.allowFrom);

//       if (!this.isUserAllowed(userId.split("@")[0])) {
//         console.log("[DEBUG] User not allowed");
//         return;
//       }

//       console.log("[DEBUG] User authorized");

//       if (isGroup) {
//         if (!this.isGroupAllowed(userId)) {
//           console.log("[DEBUG] Group not allowed");
//           return;
//         }

//         if (this.config.groups?.requireMention) {
//           const mentionedJids =
//             msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
//           const botJid = this.sock?.user?.id;
//           if (!botJid || !mentionedJids.includes(botJid)) {
//             console.log("[DEBUG] Bot not mentioned");
//             return;
//           }
//         }
//       }

//       console.log("[DEBUG] Message text:", messageText);

//       if (!messageText) {
//         console.log("[DEBUG] No text content");
//         return;
//       }

//       logger.info(
//         `Received WhatsApp message from ${userId}: ${messageText.substring(0, 50)}...`,
//       );

//       await this.sendTypingIndicator(userId);

//       const normalizedMessage: NormalizedMessage = {
//         channel: "whatsapp",
//         channelMessageId: msg.key.id || "",
//         userId: userId,
//         username: msg.pushName || undefined,
//         content: messageText,
//         timestamp: new Date((msg.messageTimestamp as number) * 1000),
//         isGroup: isGroup,
//         groupId: isGroup ? userId : undefined,
//         metadata: {
//           messageType: messageType,
//           participant: msg.key.participant,
//         },
//       };

//       if (!this.messageHandler) {
//         throw new Error("Message handler not initialized");
//       }

//       console.log("[DEBUG] Calling message handler");
//       const response = await this.messageHandler(normalizedMessage);
//       console.log("[DEBUG] Got response:", response.substring(0, 50));

//       // Add signature for non-owner recipients
//       const isSelf = directory.isOwner(`whatsapp:${userId}`);
//       const signedResponse = isSelf
//         ? response
//         : `${response}\n\n— Noni (Maniya's AI Assistant)`;

//       await this.sendMessage(userId, { text: signedResponse });

//       logger.success(`Successfully processed WhatsApp message for ${userId}`);
//     } catch (error) {
//       console.log("[DEBUG] Error in handleMessage:", error);
//       logger.error("Error handling WhatsApp message:", error);
//     }
//   }

//   private normalizeJid(jid: string): string {
//     if (!jid.includes("@")) {
//       return `${jid}@s.whatsapp.net`;
//     }
//     return jid;
//   }
// }

// src/channels/whatsapp.ts

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  WAMessage,
  proto,
  downloadMediaMessage,
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
}

export class WhatsAppAdapter extends ChannelAdapter {
  private sock?: WASocket;
  private messageHandler?: (message: NormalizedMessage) => Promise<string>;
  private authDir: string;
  private qrTimeout: number;
  private pausedUsers: Set<string> = new Set();
  private triggerWords: string[];

  constructor(config: WhatsAppConfig) {
    super("whatsapp", config);
    this.authDir = config.authDir || path.join(process.cwd(), ".whatsapp-auth");
    this.qrTimeout = config.qrTimeout || 60;
    this.triggerWords = config.triggerWords || ["noni", "hey noni", "hi noni"];

    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
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

    this.sock.ev.on("messages.upsert", async ({ messages }) => {
      console.log("[DEBUG] Messages received:", messages.length);

      for (const msg of messages) {
        console.log("[DEBUG] Message details:", {
          fromMe: msg.key.fromMe,
          remoteJid: msg.key.remoteJid,
          messageType: Object.keys(msg.message || {})[0],
        });

        if (msg.key.fromMe) {
          console.log("[DEBUG] Skipping outgoing message");
          continue;
        }

        console.log("[DEBUG] Processing incoming message");
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
    console.log("[DEBUG] handleMessage called");
    try {
      const messageType = Object.keys(msg.message || {})[0];
      const userId = msg.key.remoteJid || "";
      const isGroup = userId.endsWith("@g.us");

      // Skip status updates completely
      if (userId === "status@broadcast") {
        console.log("[DEBUG] Skipping status update");
        return;
      }

      let messageText = "";
      if (msg.message?.conversation) {
        messageText = msg.message.conversation;
      } else if (msg.message?.extendedTextMessage) {
        messageText = msg.message.extendedTextMessage.text || "";
      } else if (msg.message?.imageMessage?.caption) {
        messageText = msg.message.imageMessage.caption;
      }

      const lowerText = messageText.toLowerCase().trim();

      // Handle pause/stop commands
      if (lowerText === "noni stop" || lowerText === "noni pause") {
        this.pausedUsers.add(userId);
        await this.sendMessage(userId, {
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
        this.pausedUsers.delete(userId);
        await this.sendMessage(userId, {
          text: "Back online. What do you need?",
        });
        return;
      }

      // Don't respond if user has paused
      if (this.pausedUsers.has(userId)) {
        console.log("[DEBUG] User has paused bot");
        return;
      }

      // Check if message contains trigger word
      const hasTrigger = this.triggerWords.some((trigger) =>
        lowerText.includes(trigger),
      );

      // For DMs: Only respond if trigger word is present
      if (!isGroup && !hasTrigger) {
        console.log("[DEBUG] No trigger word found in DM, ignoring message");
        return;
      }

      // For groups: Check both trigger word and mention
      if (isGroup) {
        // Check for mention
        const mentionedJids =
          msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const botJid = this.sock?.user?.id;
        const isMentioned = botJid && mentionedJids.includes(botJid);

        // Require either trigger word OR mention in groups
        if (!hasTrigger && !isMentioned) {
          console.log("[DEBUG] No trigger word or mention in group, ignoring");
          return;
        }

        // Check if group is allowed
        if (!this.isGroupAllowed(userId)) {
          console.log("[DEBUG] Group not allowed");
          return;
        }
      }

      console.log("[DEBUG] Auth check - userId:", userId.split("@")[0]);
      console.log("[DEBUG] Auth check - allowFrom:", this.config.allowFrom);

      // Check if user is allowed
      if (!this.isUserAllowed(userId.split("@")[0])) {
        console.log("[DEBUG] User not allowed");
        return;
      }

      console.log("[DEBUG] User authorized");

      if (!messageText) {
        console.log("[DEBUG] No text content");
        return;
      }

      logger.info(
        `Received WhatsApp message from ${userId}: ${messageText.substring(0, 50)}...`,
      );

      await this.sendTypingIndicator(userId);

      // Remove trigger words from message before processing
      let cleanedMessage = messageText;
      for (const trigger of this.triggerWords) {
        const regex = new RegExp(trigger, "gi");
        cleanedMessage = cleanedMessage.replace(regex, "").trim();
      }

      const normalizedMessage: NormalizedMessage = {
        channel: "whatsapp",
        channelMessageId: msg.key.id || "",
        userId: userId,
        username: msg.pushName || undefined,
        content: cleanedMessage || messageText, // Use cleaned message
        timestamp: new Date((msg.messageTimestamp as number) * 1000),
        isGroup: isGroup,
        groupId: isGroup ? userId : undefined,
        metadata: {
          messageType: messageType,
          participant: msg.key.participant,
        },
      };

      if (!this.messageHandler) {
        throw new Error("Message handler not initialized");
      }

      console.log("[DEBUG] Calling message handler");
      const response = await this.messageHandler(normalizedMessage);
      console.log("[DEBUG] Got response:", response.substring(0, 50));

      // Add signature for non-owner recipients
      const isSelf = directory.isOwner(`whatsapp:${userId}`);
      const signedResponse = isSelf
        ? response
        : `${response}\n\n— Noni (Maniya's AI Assistant)`;

      await this.sendMessage(userId, { text: signedResponse });

      logger.success(`Successfully processed WhatsApp message for ${userId}`);
    } catch (error) {
      console.log("[DEBUG] Error in handleMessage:", error);
      logger.error("Error handling WhatsApp message:", error);
    }
  }

  private normalizeJid(jid: string): string {
    if (!jid.includes("@")) {
      return `${jid}@s.whatsapp.net`;
    }
    return jid;
  }
}

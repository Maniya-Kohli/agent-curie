// src/channels/telegram.ts

import { Telegraf, Context } from "telegraf";
import sharp from "sharp";
import axios from "axios";
import {
  ChannelAdapter,
  NormalizedMessage,
  ChannelResponse,
  ChannelConfig,
} from "./base";
import { logger } from "../utils/logger";
import {
  setCurrentUserId,
  cacheIncomingImage,
  setCurrentChatId,
} from "../tools/core/imageOps";

export interface TelegramConfig extends ChannelConfig {
  botToken: string;
  webhookUrl?: string;
}

export class TelegramAdapter extends ChannelAdapter {
  private bot: Telegraf;
  private messageHandler?: (message: NormalizedMessage) => Promise<string>;

  constructor(config: TelegramConfig) {
    super("telegram", config);

    if (!config.botToken) {
      throw new Error("Telegram bot token is required");
    }

    this.bot = new Telegraf(config.botToken);
  }

  initialize(): Promise<void> {
    return new Promise((resolve) => {
      logger.info("Initializing Telegram channel adapter...");

      this.bot.start((ctx) => this.handleStartCommand(ctx));
      this.bot.command("clear", (ctx) => this.handleClearCommand(ctx));
      this.bot.command("stats", (ctx) => this.handleStatsCommand(ctx));
      this.bot.on("text", (ctx) => this.handleTextMessage(ctx));
      this.bot.on("photo", (ctx) => this.handleMediaMessage(ctx, "photo"));
      this.bot.on("document", (ctx) =>
        this.handleMediaMessage(ctx, "document"),
      );
      this.bot.on("video", (ctx) => this.handleMediaMessage(ctx, "video"));
      this.bot.on("voice", (ctx) => this.handleMediaMessage(ctx, "voice"));
      this.bot.on("audio", (ctx) => this.handleMediaMessage(ctx, "audio"));

      logger.success("Telegram adapter initialized");
      resolve();
    });
  }

  listen(
    handler: (message: NormalizedMessage) => Promise<string>,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.messageHandler = handler;
      this.bot.launch().then(() => {
        logger.success("Telegram bot is now listening for messages");

        process.once("SIGINT", () => this.bot.stop("SIGINT"));
        process.once("SIGTERM", () => this.bot.stop("SIGTERM"));

        resolve();
      });
    });
  }

  // Replace the entire handleMediaMessage method with this:
  private async handleMediaMessage(
    ctx: Context,
    kind: "photo" | "document" | "video" | "voice" | "audio",
  ): Promise<void> {
    if (!ctx.message || !ctx.from || !ctx.chat) return;

    const userId = ctx.from.id.toString();

    setCurrentUserId(`telegram:${userId}`);

    // CRITICAL FIX: Store chatId so sendImage knows where to send
    // Telegram sendImage expects plain numeric chat ID
    setCurrentChatId(ctx.chat.id.toString());

    const messageId = (ctx.message as any).message_id;
    const messageDate = (ctx.message as any).date;
    const chatType = ctx.chat.type;
    const chatId = ctx.chat.id;

    if (!this.isUserAllowed(userId)) {
      await ctx.reply("❌ You are not authorized to use this bot.");
      return;
    }

    const isGroup = chatType === "group" || chatType === "supergroup";
    const caption = (ctx.message as any).caption as string | undefined;

    if (isGroup) {
      const groupId = chatId.toString();
      if (!this.isGroupAllowed(groupId)) return;

      if (this.config.groups?.requireMention) {
        const botUsername = this.bot.botInfo?.username;
        const textToCheck = caption ?? "";
        if (botUsername && !textToCheck.includes(`@${botUsername}`)) {
          return;
        }
      }
    }

    await this.sendTypingIndicator(
      userId,
      isGroup ? chatId.toString() : undefined,
    );

    // Extract attachment info
    const m: any = ctx.message;
    let attachment: any = { kind };
    let fileId: string | undefined;

    if (kind === "photo") {
      const photos = m.photo || [];
      const best = photos[photos.length - 1];
      fileId = best?.file_id;
      attachment = {
        kind,
        fileId: best?.file_id,
        fileUniqueId: best?.file_unique_id,
        width: best?.width,
        height: best?.height,
        caption,
      };
    } else if (kind === "document") {
      fileId = m.document?.file_id;
      attachment = {
        kind,
        fileId: m.document?.file_id,
        fileUniqueId: m.document?.file_unique_id,
        fileName: m.document?.file_name,
        mimeType: m.document?.mime_type,
        fileSize: m.document?.file_size,
        caption,
      };
    } else if (kind === "video") {
      fileId = m.video?.file_id;
      attachment = {
        kind,
        fileId: m.video?.file_id,
        fileUniqueId: m.video?.file_unique_id,
        width: m.video?.width,
        height: m.video?.height,
        duration: m.video?.duration,
        mimeType: m.video?.mime_type,
        fileSize: m.video?.file_size,
        caption,
      };
    } else if (kind === "voice") {
      fileId = m.voice?.file_id;
      attachment = {
        kind,
        fileId: m.voice?.file_id,
        fileUniqueId: m.voice?.file_unique_id,
        duration: m.voice?.duration,
        mimeType: m.voice?.mime_type,
        fileSize: m.voice?.file_size,
        caption,
      };
    } else if (kind === "audio") {
      fileId = m.audio?.file_id;
      attachment = {
        kind,
        fileId: m.audio?.file_id,
        fileUniqueId: m.audio?.file_unique_id,
        duration: m.audio?.duration,
        performer: m.audio?.performer,
        title: m.audio?.title,
        fileName: m.audio?.file_name,
        mimeType: m.audio?.mime_type,
        fileSize: m.audio?.file_size,
        caption,
      };
    }

    // Download and encode media for vision-capable types (photos and image documents)
    let base64Data: string | undefined;
    let mediaType: string | undefined;

    if (fileId) {
      try {
        const shouldProcessAsImage =
          kind === "photo" ||
          (kind === "document" && attachment.mimeType?.startsWith("image/"));

        if (shouldProcessAsImage) {
          logger.info(`Downloading ${kind} from Telegram...`);

          // Get file link from Telegram
          const fileLink = await this.bot.telegram.getFileLink(fileId);

          // Download the file
          const response = await axios.get(fileLink.href, {
            responseType: "arraybuffer",
            timeout: 30000, // 30 second timeout
          });

          const buffer = Buffer.from(response.data);

          // Resize and compress image using Sharp
          const processedBuffer = await sharp(buffer)
            .resize(1568, 1568, {
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: 85 })
            .toBuffer();

          // Convert to base64
          base64Data = processedBuffer.toString("base64");
          mediaType = "image/jpeg";

          // ✅ Cache the last inbound image for save_image tool usage
          cacheIncomingImage(`telegram:${userId}`, base64Data, mediaType, {
            caption,
            timestamp: new Date(messageDate * 1000).toISOString(),
            chatId: chatId.toString(),
            channel: "telegram",
          });

          attachment.base64Data = base64Data;
          attachment.mediaType = mediaType;
          attachment.processed = true;

          logger.success(
            `Image processed: ${(base64Data.length / 1024).toFixed(2)} KB`,
          );
        } else {
          logger.info(
            `Skipping media processing for ${kind} (not an image type)`,
          );
        }
      } catch (error) {
        logger.error(`Failed to download/process ${kind}:`, error);
        // Continue without media data - will just send caption
      }
    }

    const normalizedMessage: NormalizedMessage = {
      channel: "telegram",
      channelMessageId: messageId.toString(),
      userId,
      username: ctx.from.username,
      content: caption ?? `[${kind}]`,
      timestamp: new Date(messageDate * 1000),
      isGroup,
      groupId: isGroup ? chatId.toString() : undefined,
      metadata: {
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        chatType,
        attachment,
      },
    };

    try {
      if (!this.messageHandler)
        throw new Error("Message handler not initialized");

      await this.messageHandler(normalizedMessage);

      logger.success(
        `Successfully processed ${kind} message for user ${userId}${base64Data ? " (with image data)" : ""}`,
      );
    } catch (error) {
      logger.error(`Error handling ${kind} message for ${userId}`, error);
      await ctx.reply(
        "❌ Sorry, I encountered an error processing your message.",
      );
    }
  }

  async sendMessage(
    userId: string,
    response: ChannelResponse,
  ): Promise<string> {
    const chatId = parseInt(userId);
    const chunks = this.splitMessage(response.text);

    let lastMessageId = "";
    for (const chunk of chunks) {
      const options: any = {
        parse_mode: "Markdown" as const,
      };

      if (response.replyTo) {
        options.reply_parameters = {
          message_id: parseInt(response.replyTo),
        };
      }

      const sent = await this.bot.telegram.sendMessage(chatId, chunk, options);
      lastMessageId = sent.message_id.toString();
    }

    return lastMessageId;
  }

  async sendTypingIndicator(userId: string, groupId?: string): Promise<void> {
    const chatId = parseInt(groupId || userId);
    await this.bot.telegram.sendChatAction(chatId, "typing");
  }

  shutdown(): Promise<void> {
    return new Promise((resolve) => {
      logger.info("Shutting down Telegram adapter...");
      this.bot.stop();
      logger.success("Telegram adapter stopped");
      resolve();
    });
  }

  private async handleStartCommand(ctx: Context): Promise<void> {
    if (!ctx.from || !ctx.chat) return;

    const userId = ctx.from.id.toString();

    logger.info(
      `Start command triggered by ${ctx.from.first_name} (${userId})`,
    );

    if (!this.isUserAllowed(userId)) {
      await ctx.reply("❌ You are not authorized to use this bot.");
      return;
    }

    const welcome = `👋 Hello ${ctx.from.first_name}!

I'm Curie, an AI agent powered by Claude. I can help you with:

🌤️ **Weather** - "What's the weather in Tokyo?"
🔍 **Web Search** - "Search for latest AI news"
🧮 **Calculations** - "Calculate 15% tip on $87.50"
📁 **Files** - "Write a Python script to hello.py"
📧 **Gmail** - "Check my recent emails"
📅 **Calendar** - "What's on my schedule today?"

Available commands:
/start - Show this message
/clear - Clear conversation history
/stats - Show bot statistics`;

    await ctx.reply(welcome, { parse_mode: "Markdown" });
  }

  private async handleClearCommand(ctx: Context): Promise<void> {
    if (!ctx.from) return;

    const userId = ctx.from.id.toString();
    if (!this.isUserAllowed(userId)) return;

    logger.warn(`Clear command for user: ${userId}`);
    await ctx.reply("✅ Conversation history will be cleared!");
  }

  private async handleStatsCommand(ctx: Context): Promise<void> {
    if (!ctx.from) return;

    const userId = ctx.from.id.toString();
    if (!this.isUserAllowed(userId)) return;

    logger.info(`Stats requested by ${userId}`);
    await ctx.reply("📊 Fetching statistics...");
  }

  // In telegram.ts - add this helper method
  private async downloadMedia(fileId: string): Promise<Buffer> {
    try {
      const fileLink = await this.bot.telegram.getFileLink(fileId);
      const response = await fetch(fileLink.href);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      logger.error("Failed to download media:", error);
      throw error;
    }
  }

  private async handleTextMessage(ctx: Context): Promise<void> {
    if (!ctx.message || !ctx.from || !ctx.chat) return;
    if (!("text" in ctx.message) || !ctx.message.text) return;

    const userId = ctx.from.id.toString();
    const messageText = ctx.message.text;
    const messageId = ctx.message.message_id;
    const messageDate = ctx.message.date;
    const chatType = ctx.chat.type;
    const chatId = ctx.chat.id;

    if (!this.isUserAllowed(userId)) {
      await ctx.reply("❌ You are not authorized to use this bot.");
      return;
    }

    const isGroup = chatType === "group" || chatType === "supergroup";
    if (isGroup) {
      const groupId = chatId.toString();
      if (!this.isGroupAllowed(groupId)) {
        return;
      }

      if (this.config.groups?.requireMention) {
        const botUsername = this.bot.botInfo?.username;
        if (botUsername && !messageText.includes(`@${botUsername}`)) {
          return;
        }
      }
    }

    logger.info(
      `Received message from ${ctx.from.first_name} (${userId}): ${messageText.substring(0, 50)}...`,
    );

    await this.sendTypingIndicator(
      userId,
      isGroup ? chatId.toString() : undefined,
    );

    const normalizedMessage: NormalizedMessage = {
      channel: "telegram",
      channelMessageId: messageId.toString(),
      userId: userId,
      username: ctx.from.username,
      content: messageText,
      timestamp: new Date(messageDate * 1000),
      isGroup: isGroup,
      groupId: isGroup ? chatId.toString() : undefined,
      metadata: {
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        chatType: chatType,
      },
    };

    try {
      if (!this.messageHandler) {
        throw new Error("Message handler not initialized");
      }

      // const response = await this.messageHandler(normalizedMessage);

      // await this.sendMessage(userId, {
      //   text: response,
      //   replyTo: messageId.toString(),
      // });
      await this.messageHandler(normalizedMessage);

      logger.success(`Successfully processed message for user ${userId}`);
    } catch (error) {
      logger.error(`Error handling message for ${userId}`, error);
      await ctx.reply(
        "❌ Sorry, I encountered an error processing your message.",
      );
    }
  }

  /**
   * Send an image to a Telegram user
   */
  async sendImage(
    userId: string,
    base64Data: string,
    caption?: string,
  ): Promise<string> {
    try {
      const chatId = parseInt(userId);
      const buffer = Buffer.from(base64Data, "base64");

      const options: any = {};
      if (caption) {
        options.caption = caption;
      }

      const sent = await this.bot.telegram.sendPhoto(
        chatId,
        {
          source: buffer,
        },
        options,
      );

      logger.success(`Image sent to ${userId}`);
      return sent.message_id.toString();
    } catch (error: any) {
      logger.error(`Failed to send image to ${userId}:`, error);
      throw new Error(`Failed to send image: ${error.message}`);
    }
  }

  /**
   * Send a document (any file) to a Telegram user
   */
  async sendDocument(
    userId: string,
    base64Data: string,
    fileName: string,
    caption?: string,
  ): Promise<string> {
    try {
      const chatId = parseInt(userId);
      const buffer = Buffer.from(base64Data, "base64");

      const options: any = {};
      if (caption) {
        options.caption = caption;
      }

      const sent = await this.bot.telegram.sendDocument(
        chatId,
        {
          source: buffer,
          filename: fileName,
        },
        options,
      );

      logger.success(`Document sent to ${userId}: ${fileName}`);
      return sent.message_id.toString();
    } catch (error: any) {
      logger.error(`Failed to send document to ${userId}:`, error);
      throw new Error(`Failed to send document: ${error.message}`);
    }
  }
}

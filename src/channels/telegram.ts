// src/channels/telegram.ts

import { Telegraf, Context } from "telegraf";
import {
  ChannelAdapter,
  NormalizedMessage,
  ChannelResponse,
  ChannelConfig,
} from "./base";
import { logger } from "../utils/logger";

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

I'm Noni, an AI agent powered by Claude. I can help you with:

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
}

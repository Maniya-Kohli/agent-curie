// src/channels/discord.ts

import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  DMChannel,
  ChannelType,
  Partials,
} from "discord.js";
import {
  ChannelAdapter,
  NormalizedMessage,
  ChannelResponse,
  ChannelConfig,
} from "./base";
import { logger } from "../utils/logger";

export interface DiscordConfig extends ChannelConfig {
  token: string;
  guildAllowList?: string[];
  dmPolicy?: "pairing" | "open" | "closed";
}

export class DiscordAdapter extends ChannelAdapter {
  private client: Client;
  private messageHandler?: (message: NormalizedMessage) => Promise<string>;
  private botId?: string;

  constructor(config: DiscordConfig) {
    super("discord", config);

    if (!config.token) {
      throw new Error("Discord bot token is required");
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel], // ← Add this
    });
  }

  initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info("Initializing Discord channel adapter...");

      this.client.once("ready", () => {
        this.botId = this.client.user?.id;
        logger.success(`Discord bot logged in as ${this.client.user?.tag}`);
        resolve();
      });

      this.client.on("messageCreate", (message: Message) => {
        this.handleMessage(message).catch((error) => {
          logger.error("Error in Discord message handler:", error);
        });
      });

      const discordConfig = this.config as DiscordConfig;
      this.client.login(discordConfig.token).catch(reject);

      logger.success("Discord adapter initialized");
    });
  }

  listen(
    handler: (message: NormalizedMessage) => Promise<string>,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.messageHandler = handler;
      logger.success("Discord bot is now listening for messages");
      resolve();
    });
  }

  async sendMessage(
    userId: string,
    response: ChannelResponse,
  ): Promise<string> {
    try {
      const target = this.parseTarget(userId);
      const chunks = this.splitMessage(response.text, 2000);

      let lastMessageId = "";

      if (target.type === "user") {
        const user = await this.client.users.fetch(target.id);
        for (const chunk of chunks) {
          const sent = await user.send(chunk);
          lastMessageId = sent.id;
        }
      } else if (target.type === "channel") {
        const channel = await this.client.channels.fetch(target.id);
        if (
          channel &&
          (channel.type === ChannelType.GuildText ||
            channel.type === ChannelType.DM)
        ) {
          const textChannel = channel as TextChannel | DMChannel;
          for (const chunk of chunks) {
            const sent = await textChannel.send(chunk);
            lastMessageId = sent.id;
          }
        }
      }

      return lastMessageId;
    } catch (error) {
      logger.error(`Failed to send Discord message to ${userId}:`, error);
      throw error;
    }
  }

  async sendTypingIndicator(userId: string, groupId?: string): Promise<void> {
    try {
      const targetId = groupId || userId;
      const target = this.parseTarget(targetId);

      if (target.type === "user") {
        const user = await this.client.users.fetch(target.id);
        const dmChannel = await user.createDM();
        await dmChannel.sendTyping();
      } else if (target.type === "channel") {
        const channel = await this.client.channels.fetch(target.id);
        if (
          channel &&
          (channel.type === ChannelType.GuildText ||
            channel.type === ChannelType.DM)
        ) {
          const textChannel = channel as TextChannel | DMChannel;
          await textChannel.sendTyping();
        }
      }
    } catch (error) {
      logger.error(`Failed to send Discord typing indicator:`, error);
    }
  }

  shutdown(): Promise<void> {
    return new Promise((resolve) => {
      logger.info("Shutting down Discord adapter...");
      this.client.destroy();
      logger.success("Discord adapter stopped");
      resolve();
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    console.log("[DEBUG] Message received:", {
      content: message.content,
      author: message.author.tag,
      authorId: message.author.id,
      botId: this.botId,
      isBot: message.author.bot,
      guild: message.guild?.name || "DM",
    });
    if (message.author.id === this.botId || message.author.bot) {
      return;
    }

    const userId = message.author.id;
    const messageText = message.content;

    const isDM = !message.guild;
    const isGuild = Boolean(message.guild);

    if (isDM) {
      const dmPolicy = (this.config as DiscordConfig).dmPolicy || "pairing";

      if (dmPolicy === "closed") {
        return;
      }

      if (dmPolicy === "pairing" && !this.isUserAllowed(userId)) {
        await message.reply(
          "🔐 You need to be authorized to DM this bot. Please contact the bot owner.",
        );
        return;
      }
    }

    if (isGuild) {
      if (!this.config.groups?.enabled) {
        return;
      }

      const guildId = message.guild!.id;
      const guildAllowList = (this.config as DiscordConfig).guildAllowList;

      if (guildAllowList && guildAllowList.length > 0) {
        if (
          !guildAllowList.includes(guildId) &&
          !guildAllowList.includes("*")
        ) {
          return;
        }
      }

      if (this.config.groups?.requireMention) {
        if (!message.mentions.has(this.botId!)) {
          return;
        }
      }
    }

    if (!isDM && !this.isUserAllowed(userId)) {
      return;
    }

    logger.info(
      `Received Discord message from ${message.author.tag} (${userId}): ${messageText.substring(0, 50)}...`,
    );

    await this.sendTypingIndicator(
      userId,
      isGuild ? message.channel.id : undefined,
    );

    const normalizedMessage: NormalizedMessage = {
      channel: "discord",
      channelMessageId: message.id,
      userId: userId,
      username: message.author.username,
      content: messageText,
      timestamp: message.createdAt,
      isGroup: isGuild,
      groupId: isGuild ? message.channel.id : undefined,
      metadata: {
        tag: message.author.tag,
        discriminator: message.author.discriminator,
        guildId: message.guild?.id,
        guildName: message.guild?.name,
        channelId: message.channel.id,
      },
    };

    try {
      if (!this.messageHandler) {
        throw new Error("Message handler not initialized");
      }

      const response = await this.messageHandler(normalizedMessage);
      await message.reply(response);

      logger.success(
        `Successfully processed Discord message for user ${userId}`,
      );
    } catch (error) {
      logger.error(`Error handling Discord message for ${userId}:`, error);
      await message.reply(
        "❌ Sorry, I encountered an error processing your message.",
      );
    }
  }

  private parseTarget(target: string): {
    type: "user" | "channel";
    id: string;
  } {
    if (target.startsWith("user:")) {
      return { type: "user", id: target.substring(5) };
    }
    if (target.startsWith("channel:")) {
      return { type: "channel", id: target.substring(8) };
    }

    return { type: "user", id: target };
  }
}

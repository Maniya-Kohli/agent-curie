// src/channels/discord.ts

import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  DMChannel,
  ChannelType,
  Partials,
  Attachment,
} from "discord.js";
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
  getCurrentChatId,
} from "../tools/core/imageOps";

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
      partials: [Partials.Channel],
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
  async sendImage(
    targetId: string,
    base64Data: string,
    caption?: string,
    mediaType?: string,
  ): Promise<string> {
    try {
      const target = this.parseTarget(targetId);

      const buffer = Buffer.from(base64Data, "base64");
      const filename =
        mediaType === "image/png"
          ? "image.png"
          : mediaType === "image/webp"
            ? "image.webp"
            : "image.jpg";

      const content = caption ? `${caption}` : undefined;

      if (target.type === "user") {
        const user = await this.client.users.fetch(target.id);
        const sent = await user.send({
          content,
          files: [{ attachment: buffer, name: filename }],
        });
        return sent.id;
      }

      // channel target
      const channel = await this.client.channels.fetch(target.id);
      if (
        channel &&
        (channel.type === ChannelType.GuildText ||
          channel.type === ChannelType.DM)
      ) {
        const textChannel = channel as TextChannel | DMChannel;
        const sent = await textChannel.send({
          content,
          files: [{ attachment: buffer, name: filename }],
        });
        return sent.id;
      }

      throw new Error(`Invalid Discord target channel: ${target.id}`);
    } catch (error) {
      logger.error(`Failed to send Discord image to ${targetId}:`, error);
      throw error;
    }
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

  /**
   * Process Discord attachments (images, videos, etc.)
   */
  private async processAttachments(
    attachments: Map<string, Attachment>,
    userId: string,
    timestamp: Date,
  ): Promise<{
    base64Data?: string;
    mediaType?: string;
    attachmentMeta?: any;
  }> {
    if (attachments.size === 0) {
      return {};
    }

    const attachment = Array.from(attachments.values())[0];
    const contentType = attachment.contentType?.toLowerCase() || "";

    // Only process images
    if (!contentType.startsWith("image/")) {
      return {
        attachmentMeta: {
          type: contentType.startsWith("video/") ? "video" : "document",
          url: attachment.url,
          filename: attachment.name,
          size: attachment.size,
        },
      };
    }

    try {
      logger.info(`Downloading image from Discord: ${attachment.name}`);

      // Download the image
      const response = await axios.get(attachment.url, {
        responseType: "arraybuffer",
        timeout: 30000,
      });

      const buffer = Buffer.from(response.data);

      // Process with Sharp (resize and compress)
      const processedBuffer = await sharp(buffer)
        .resize(1568, 1568, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();

      const base64Data = processedBuffer.toString("base64");
      const mediaType = "image/jpeg";

      // Cache for save_image tool
      cacheIncomingImage(`discord:${userId}`, base64Data, mediaType, {
        timestamp: timestamp.toISOString(),
        chatId: getCurrentChatId() ?? undefined,
        channel: "discord",
      });

      logger.success(
        `Image processed: ${(base64Data.length / 1024).toFixed(2)} KB`,
      );

      return {
        base64Data,
        mediaType,
        attachmentMeta: {
          type: "image",
          url: attachment.url,
          filename: attachment.name,
          size: attachment.size,
          processed: true,
        },
      };
    } catch (error) {
      logger.error("Failed to process Discord image:", error);
      return {
        attachmentMeta: {
          type: "image",
          url: attachment.url,
          filename: attachment.name,
          size: attachment.size,
          error: "Failed to download/process",
        },
      };
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    console.log("[DEBUG] Message received:", {
      content: message.content,
      author: message.author.tag,
      authorId: message.author.id,
      botId: this.botId,
      isBot: message.author.bot,
      guild: message.guild?.name || "DM",
      attachments: message.attachments.size,
    });

    if (message.author.id === this.botId || message.author.bot) {
      return;
    }

    const userId = message.author.id;
    const messageText = message.content;

    const isDM = !message.guild;
    const isGuild = Boolean(message.guild);

    // Set current user for imageOps
    setCurrentUserId(`discord:${userId}`);

    // CRITICAL FIX: Store chatId in the format sendImage expects
    // Discord sendImage needs "channel:<id>" for channels or "user:<id>" for DMs
    const chatIdForSending = isDM
      ? `user:${userId}`
      : `channel:${message.channel.id}`;
    setCurrentChatId(chatIdForSending);

    if (isDM) {
      const dmPolicy = (this.config as DiscordConfig).dmPolicy || "pairing";

      if (dmPolicy === "closed") {
        return;
      }

      if (dmPolicy === "pairing" && !this.isUserAllowed(userId)) {
        await message.reply(
          "🔒 You need to be authorized to DM this bot. Please contact the bot owner.",
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
      `Received Discord message from ${message.author.tag} (${userId}): ${messageText.substring(0, 50)}... [${message.attachments.size} attachments]`,
    );

    await this.sendTypingIndicator(
      userId,
      isGuild ? message.channel.id : undefined,
    );

    // Process attachments if present
    const { base64Data, mediaType, attachmentMeta } =
      await this.processAttachments(
        message.attachments,
        userId,
        message.createdAt,
      );

    const normalizedMessage: NormalizedMessage = {
      channel: "discord",
      channelMessageId: message.id,
      userId: userId,
      username: message.author.username,
      content: messageText || (attachmentMeta ? "[image]" : ""),
      timestamp: message.createdAt,
      isGroup: isGuild,
      groupId: isGuild ? message.channel.id : undefined,
      metadata: {
        tag: message.author.tag,
        discriminator: message.author.discriminator,
        guildId: message.guild?.id,
        guildName: message.guild?.name,
        channelId: message.channel.id,
        attachment: attachmentMeta
          ? {
              ...attachmentMeta,
              base64Data,
              mediaType,
            }
          : undefined,
      },
    };

    try {
      if (!this.messageHandler) {
        throw new Error("Message handler not initialized");
      }

      await this.messageHandler(normalizedMessage);

      logger.success(
        `Message forwarded to gateway for user ${userId}${base64Data ? " (with image data)" : ""}`,
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

// src/channels/gateway.ts

import { ChannelAdapter, NormalizedMessage } from "./base";
import { TelegramAdapter, TelegramConfig } from "./telegram";
import { DiscordAdapter, DiscordConfig } from "./discord";
import { WhatsAppAdapter, WhatsAppConfig } from "./whatsapp";
import { logger } from "../utils/logger";

/**
 * Central gateway that manages all channel adapters
 * Provides a unified interface for the agent orchestrator
 */
export class ChannelGateway {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private messageHandler?: (message: NormalizedMessage) => Promise<string>;

  /**
   * Register a channel adapter
   */
  registerChannel(adapter: ChannelAdapter): void {
    const metadata = adapter.getMetadata();
    logger.info(`Registering channel: ${metadata.channel}`);
    this.adapters.set(metadata.channel, adapter);
  }

  /**
   * Initialize all registered channels
   */
  async initializeAll(): Promise<void> {
    logger.info(`Initializing ${this.adapters.size} channel adapters...`);

    const initPromises = Array.from(this.adapters.values()).map(
      async (adapter) => {
        try {
          await adapter.initialize();
        } catch (error) {
          const metadata = adapter.getMetadata();
          logger.error(`Failed to initialize ${metadata.channel}:`, error);
          throw error;
        }
      },
    );

    await Promise.all(initPromises);
    logger.success("All channels initialized successfully");
  }

  /**
   * Start listening on all channels
   * The handler will receive normalized messages from any channel
   */
  async startListening(
    handler: (message: NormalizedMessage) => Promise<string>,
  ): Promise<void> {
    this.messageHandler = handler;

    logger.info("Starting message listeners on all channels...");

    const listenPromises = Array.from(this.adapters.values()).map(
      async (adapter) => {
        try {
          await adapter.listen(handler);
        } catch (error) {
          const metadata = adapter.getMetadata();
          logger.error(`Failed to start ${metadata.channel} listener:`, error);
          throw error;
        }
      },
    );

    await Promise.all(listenPromises);
    logger.success("All channel listeners active");
  }

  /**
   * Send a message through a specific channel
   */
  async sendMessage(
    channel: string,
    userId: string,
    text: string,
  ): Promise<void> {
    const adapter = this.adapters.get(channel);

    if (!adapter) {
      throw new Error(`Channel '${channel}' not registered`);
    }

    await adapter.sendMessage(userId, { text });
  }

  /**
   * Send typing indicator through a specific channel
   */
  async sendTyping(
    channel: string,
    userId: string,
    groupId?: string,
  ): Promise<void> {
    const adapter = this.adapters.get(channel);

    if (!adapter) {
      logger.warn(`Cannot send typing on unknown channel: ${channel}`);
      return;
    }

    await adapter.sendTypingIndicator(userId, groupId);
  }

  /**
   * Shutdown all channels gracefully
   */
  async shutdownAll(): Promise<void> {
    logger.info("Shutting down all channel adapters...");

    const shutdownPromises = Array.from(this.adapters.values()).map(
      async (adapter) => {
        try {
          await adapter.shutdown();
        } catch (error) {
          const metadata = adapter.getMetadata();
          logger.error(`Error shutting down ${metadata.channel}:`, error);
        }
      },
    );

    await Promise.all(shutdownPromises);
    logger.success("All channels shut down");
  }

  /**
   * Get status of all channels
   */
  getStatus() {
    return Array.from(this.adapters.values()).map((adapter) =>
      adapter.getMetadata(),
    );
  }

  /**
   * Helper to create adapters from config
   */
  static createFromConfig(config: {
    telegram?: TelegramConfig;
    discord?: DiscordConfig;
    whatsapp?: WhatsAppConfig;
  }): ChannelGateway {
    const gateway = new ChannelGateway();

    // Initialize Telegram if configured
    if (config.telegram?.enabled && config.telegram.botToken) {
      logger.info("Creating Telegram adapter from config");
      gateway.registerChannel(new TelegramAdapter(config.telegram));
    }

    // Initialize Discord if configured
    if (config.discord?.enabled && config.discord.token) {
      logger.info("Creating Discord adapter from config");
      gateway.registerChannel(new DiscordAdapter(config.discord));
    }

    // Initialize WhatsApp if configured
    if (config.whatsapp?.enabled) {
      logger.info("Creating WhatsApp adapter from config");
      gateway.registerChannel(new WhatsAppAdapter(config.whatsapp));
    }

    return gateway;
  }
}

// src/channels/base.ts

/**
 * Normalized message format that all channels must convert to
 * This is the common interface between channels and the agent core
 */
export interface NormalizedMessage {
  // Channel information
  channel: string; // e.g., "telegram", "discord", "whatsapp"
  channelMessageId: string; // Platform-specific message ID

  // User information
  userId: string; // Platform-specific user ID
  username?: string; // Optional username

  // Message content
  content: string; // Text content
  attachments?: MessageAttachment[]; // Media attachments

  // Metadata
  timestamp: Date;
  isGroup?: boolean; // Is this from a group chat?
  groupId?: string; // Group/channel ID if applicable
  replyTo?: string; // ID of message being replied to
  metadata?: Record<string, any>; // Platform-specific extras
}

export interface MessageAttachment {
  type: "image" | "video" | "audio" | "document";
  url?: string; // Download URL
  data?: Buffer; // Binary data
  mimeType?: string;
  filename?: string;
  size?: number;
}

/**
 * Response format that channels must handle
 */
export interface ChannelResponse {
  text: string;
  attachments?: MessageAttachment[];
  replyTo?: string; // Message ID to reply to
  metadata?: Record<string, any>;
}

/**
 * Channel configuration interface
 */
export interface ChannelConfig {
  enabled: boolean;
  token?: string; // Bot token or API key
  allowFrom?: string[]; // Allowlist of user IDs
  groups?: {
    enabled: boolean;
    requireMention?: boolean;
    allowList?: string[]; // Specific groups allowed
  };
  [key: string]: any; // Channel-specific config
}

/**
 * Abstract base class for all channel adapters
 * Each messaging platform implements this interface
 */
export abstract class ChannelAdapter {
  protected config: ChannelConfig;
  protected channelName: string;

  constructor(channelName: string, config: ChannelConfig) {
    this.channelName = channelName;
    this.config = config;
  }

  /**
   * Initialize the channel connection
   * Called once during bot startup
   */
  abstract initialize(): Promise<void>;

  /**
   * Start listening for incoming messages
   * The handler receives normalized messages
   */
  abstract listen(
    handler: (message: NormalizedMessage) => Promise<string>,
  ): Promise<void>;

  /**
   * Send a message through this channel
   * Returns the platform-specific message ID
   */
  abstract sendMessage(
    userId: string,
    response: ChannelResponse,
  ): Promise<string>;

  /**
   * Send a typing/activity indicator
   */
  abstract sendTypingIndicator(userId: string, groupId?: string): Promise<void>;

  /**
   * Shutdown the channel connection gracefully
   */
  abstract shutdown(): Promise<void>;

  /**
   * Check if a user is allowed to interact with the bot
   */
  protected isUserAllowed(userId: string): boolean {
    if (!this.config.allowFrom || this.config.allowFrom.length === 0) {
      return true; // No allowlist means everyone is allowed
    }
    return (
      this.config.allowFrom.includes(userId) ||
      this.config.allowFrom.includes("*")
    );
  }

  /**
   * Check if a group is allowed
   */
  protected isGroupAllowed(groupId: string): boolean {
    if (!this.config.groups?.enabled) {
      return false;
    }

    if (
      !this.config.groups.allowList ||
      this.config.groups.allowList.length === 0
    ) {
      return true; // No group allowlist means all groups allowed
    }

    return (
      this.config.groups.allowList.includes(groupId) ||
      this.config.groups.allowList.includes("*")
    );
  }

  /**
   * Split long messages into chunks (4096 char limit for most platforms)
   */
  protected splitMessage(text: string, maxLength: number = 4096): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    let currentChunk = "";

    // Split by paragraphs first
    const paragraphs = text.split("\n\n");

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length + 2 <= maxLength) {
        currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }

        // If single paragraph is too long, split by sentences
        if (paragraph.length > maxLength) {
          const sentences = paragraph.match(/.{1,4000}/g) || [];
          chunks.push(...sentences);
          currentChunk = "";
        } else {
          currentChunk = paragraph;
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Get channel metadata for logging
   */
  getMetadata() {
    return {
      channel: this.channelName,
      enabled: this.config.enabled,
      hasAllowlist: Boolean(this.config.allowFrom?.length),
      groupsEnabled: this.config.groups?.enabled || false,
    };
  }
}

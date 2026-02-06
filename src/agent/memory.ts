// import { MessageParam } from "@anthropic-ai/sdk/resources";

// interface InternalMessage {
//   role: "user" | "assistant";
//   content: string;
//   timestamp: string;
// }

// export class ConversationMemory {
//   private conversations: Map<string, InternalMessage[]> = new Map();
//   private userMetadata: Map<string, Record<string, any>> = new Map();
//   private maxMessages: number;

//   constructor(maxMessagesPerUser: number = 50) {
//     this.maxMessages = maxMessagesPerUser;
//   }

//   /**
//    * Adds a message to the conversation history and trims old messages if necessary.
//    */
//   addMessage(
//     userId: string,
//     role: "user" | "assistant",
//     content: string,
//   ): void {
//     if (!this.conversations.has(userId)) {
//       this.conversations.set(userId, []);
//     }

//     const history = this.conversations.get(userId)!;
//     history.push({
//       role,
//       content,
//       timestamp: new Date().toISOString(),
//     });

//     if (history.length > this.maxMessages) {
//       this.conversations.set(userId, history.slice(-this.maxMessages));
//     }
//   }

//   /**
//    * Retrieves conversation history formatted for the Anthropic API.
//    */
//   getMessagesForLLm(userId: string, lastN: number = 20): MessageParam[] {
//     const history = this.conversations.get(userId) || [];
//     return history.slice(-lastN).map((msg) => ({
//       role: msg.role,
//       content: msg.content,
//     }));
//   }
//   /**
//    * Retrieves memory statistics for all users.
//    * Matches the logic from your Python memory.py.
//    */
//   getStats() {
//     let totalMessages = 0;
//     this.conversations.forEach((msgs) => {
//       totalMessages += msgs.length;
//     });

//     return {
//       totalUsers: this.conversations.size,
//       totalMessages: totalMessages,
//       users: Array.from(this.conversations.keys()),
//     };
//   }

//   /**
//    * Stores user-specific metadata.
//    */
//   setUserMetadata(userId: string, key: string, value: any): void {
//     if (!this.userMetadata.has(userId)) {
//       this.userMetadata.set(userId, {});
//     }
//     this.userMetadata.get(userId)![key] = value;
//   }

//   /**
//    * Retrieves user-specific metadata with an optional default value.
//    */
//   getUserMetadata(userId: string, key: string, defaultValue?: any): any {
//     const metadata = this.userMetadata.get(userId);
//     return metadata && key in metadata ? metadata[key] : defaultValue;
//   }

//   /**
//    * Clears history for a specific user.
//    */
//   clearConversation(userId: string): void {
//     this.conversations.delete(userId);
//   }
// }

// export const memory = new ConversationMemory();
// src/agent/memory.ts

import { MessageParam } from "@anthropic-ai/sdk/resources";
import { rawDb } from "../db";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";

interface InternalMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export class ConversationMemory {
  private conversations: Map<string, InternalMessage[]> = new Map();
  private userMetadata: Map<string, Record<string, any>> = new Map();
  private maxMessages: number;

  constructor(maxMessagesPerUser: number = 50) {
    this.maxMessages = maxMessagesPerUser;
  }

  /**
   * Adds a message to both in-memory cache AND SQLite.
   */
  addMessage(
    userId: string,
    role: "user" | "assistant",
    content: string,
    channel?: string,
    metadata?: Record<string, any>,
  ): void {
    const timestamp = new Date().toISOString();

    // In-memory cache
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, []);
    }

    const history = this.conversations.get(userId)!;
    history.push({ role, content, timestamp });

    if (history.length > this.maxMessages) {
      this.conversations.set(userId, history.slice(-this.maxMessages));
    }

    // Persist to SQLite
    try {
      rawDb
        .prepare(
          `INSERT INTO conversation_logs (id, user_id, channel, role, content, timestamp, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          uuidv4(),
          userId,
          channel || null,
          role,
          content,
          timestamp,
          metadata ? JSON.stringify(metadata) : null,
        );
    } catch (error) {
      logger.warn("Failed to persist message to SQLite:", error);
    }
  }

  /**
   * Retrieves conversation history formatted for the Anthropic API.
   * Loads from in-memory cache first, falls back to SQLite.
   */
  getMessagesForLLm(userId: string, lastN: number = 20): MessageParam[] {
    // Try in-memory first
    const cached = this.conversations.get(userId);
    if (cached && cached.length > 0) {
      return cached.slice(-lastN).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));
    }

    // Fall back to SQLite (e.g., after restart)
    return this.loadFromDb(userId, lastN);
  }

  /**
   * Load conversation history from SQLite into memory cache.
   * Called on startup or when a user's cache is empty.
   */
  loadFromDb(userId: string, lastN: number = 20): MessageParam[] {
    try {
      const rows = rawDb
        .prepare(
          `SELECT role, content, timestamp 
           FROM conversation_logs 
           WHERE user_id = ? 
           ORDER BY timestamp DESC 
           LIMIT ?`,
        )
        .all(userId, lastN) as {
        role: string;
        content: string;
        timestamp: string;
      }[];

      // Reverse to chronological order
      const messages = rows.reverse();

      // Populate in-memory cache
      this.conversations.set(
        userId,
        messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          timestamp: m.timestamp,
        })),
      );

      return messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    } catch (error) {
      logger.warn(`Failed to load conversations from DB for ${userId}:`, error);
      return [];
    }
  }

  /**
   * Retrieves memory statistics for all users.
   */
  getStats() {
    let totalMessages = 0;
    this.conversations.forEach((msgs) => {
      totalMessages += msgs.length;
    });

    // Also count SQLite totals
    let dbTotal = 0;
    try {
      const row = rawDb
        .prepare("SELECT COUNT(*) as count FROM conversation_logs")
        .get() as { count: number };
      dbTotal = row.count;
    } catch {
      // Table might not exist yet
    }

    return {
      totalUsers: this.conversations.size,
      totalMessagesInMemory: totalMessages,
      totalMessagesInDb: dbTotal,
      users: Array.from(this.conversations.keys()),
    };
  }

  /**
   * Stores user-specific metadata.
   */
  setUserMetadata(userId: string, key: string, value: any): void {
    if (!this.userMetadata.has(userId)) {
      this.userMetadata.set(userId, {});
    }
    this.userMetadata.get(userId)![key] = value;
  }

  /**
   * Retrieves user-specific metadata with an optional default value.
   */
  getUserMetadata(userId: string, key: string, defaultValue?: any): any {
    const metadata = this.userMetadata.get(userId);
    return metadata && key in metadata ? metadata[key] : defaultValue;
  }

  /**
   * Clears history for a specific user (both in-memory and SQLite).
   */
  clearConversation(userId: string): void {
    this.conversations.delete(userId);
    try {
      rawDb
        .prepare("DELETE FROM conversation_logs WHERE user_id = ?")
        .run(userId);
    } catch (error) {
      logger.warn("Failed to clear DB conversations:", error);
    }
  }
}

export const memory = new ConversationMemory();

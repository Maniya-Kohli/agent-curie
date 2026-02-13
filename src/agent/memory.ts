// src/agent/memory.ts

import { rawDb } from "../db";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";

interface InternalMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// Use a flexible type for messages passed to LLM providers
interface LLMMessageParam {
  role: "user" | "assistant";
  content: string;
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
   * Retrieves conversation history formatted for LLM consumption.
   * Loads from in-memory cache first, falls back to SQLite.
   */
  getMessagesForLLm(userId: string, lastN: number = 20): LLMMessageParam[] {
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
   */
  loadFromDb(userId: string, lastN: number = 20): LLMMessageParam[] {
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

      const messages = rows.reverse();

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

  getStats() {
    let totalMessages = 0;
    this.conversations.forEach((msgs) => {
      totalMessages += msgs.length;
    });

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

  setUserMetadata(userId: string, key: string, value: any): void {
    if (!this.userMetadata.has(userId)) {
      this.userMetadata.set(userId, {});
    }
    this.userMetadata.get(userId)![key] = value;
  }

  getUserMetadata(userId: string, key: string, defaultValue?: any): any {
    const metadata = this.userMetadata.get(userId);
    return metadata && key in metadata ? metadata[key] : defaultValue;
  }

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

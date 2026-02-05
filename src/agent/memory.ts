import { MessageParam } from "@anthropic-ai/sdk/resources";

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
   * Adds a message to the conversation history and trims old messages if necessary.
   */
  addMessage(
    userId: string,
    role: "user" | "assistant",
    content: string,
  ): void {
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, []);
    }

    const history = this.conversations.get(userId)!;
    history.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });

    if (history.length > this.maxMessages) {
      this.conversations.set(userId, history.slice(-this.maxMessages));
    }
  }

  /**
   * Retrieves conversation history formatted for the Anthropic API.
   */
  getMessagesForLLm(userId: string, lastN: number = 20): MessageParam[] {
    const history = this.conversations.get(userId) || [];
    return history.slice(-lastN).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }
  /**
   * Retrieves memory statistics for all users.
   * Matches the logic from your Python memory.py.
   */
  getStats() {
    let totalMessages = 0;
    this.conversations.forEach((msgs) => {
      totalMessages += msgs.length;
    });

    return {
      totalUsers: this.conversations.size,
      totalMessages: totalMessages,
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
   * Clears history for a specific user.
   */
  clearConversation(userId: string): void {
    this.conversations.delete(userId);
  }
}

export const memory = new ConversationMemory();

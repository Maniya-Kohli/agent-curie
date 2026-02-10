// src/agent/heartbeat.ts

import { LLMInterface } from "./llm";
import { memory } from "./memory";
import { TOOL_DEFINITIONS, TOOL_FUNCTIONS } from "../tools";
import { ContextManager } from "../memory/contextManager";
import { ChannelGateway } from "../channels/gateway";
import { memoryFiles } from "../memory/memoryFiles";
import { rawDb } from "../db";
import { logger } from "../utils/logger";
import { MessageParam } from "@anthropic-ai/sdk/resources";

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
// const HEARTBEAT_INTERVAL_MS = 1 * 60 * 1000; // 1 minute

const OWNER_USER_ID =
  process.env.OWNER_USER_ID || "whatsapp:14154908789@s.whatsapp.net";
const ACK_TOKEN = "HEARTBEAT_OK";
const ACK_MAX_CHARS = 300;

export class HeartbeatService {
  private llm: LLMInterface;
  private contextManager = new ContextManager();
  private gateway?: ChannelGateway;
  private heartbeatTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(apiKey: string) {
    this.llm = new LLMInterface(apiKey);
  }

  setGateway(gateway: ChannelGateway): void {
    this.gateway = gateway;
  }

  /**
   * Start heartbeat loop
   */
  start(): void {
    if (this.heartbeatTimer) {
      logger.warn("Heartbeat already running");
      return;
    }

    logger.info(`💓 Heartbeat service started (interval: 30 minutes)`);

    // Run immediately on start, then every 30 minutes
    this.tick();
    this.heartbeatTimer = setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop heartbeat loop
   */
  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
      logger.info("Heartbeat service stopped");
    }
  }

  /**
   * Single heartbeat execution
   */
  private async tick(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Heartbeat already in progress, skipping");
      return;
    }

    this.isRunning = true;

    try {
      logger.info("💓 Heartbeat tick starting...");

      // Check if HEARTBEAT.md exists and is non-empty
      const heartbeatContent = memoryFiles.read("HEARTBEAT.md");
      if (this.isEffectivelyEmpty(heartbeatContent)) {
        logger.info("HEARTBEAT.md is empty or missing - skipping heartbeat");
        this.isRunning = false;
        return;
      }

      // Build heartbeat prompt
      const prompt = this.buildHeartbeatPrompt(heartbeatContent);

      // Get recent context (last 30 minutes of activity)
      const recentActivity = this.getRecentActivity();

      // Assemble full context
      const systemPrompt = await this.contextManager.assembleContext(
        OWNER_USER_ID,
        "Maniya",
      );

      // Add heartbeat-specific instructions
      const heartbeatSystemPrompt = `${systemPrompt}

## Heartbeat Mode

You are running in **heartbeat mode** - a periodic autonomous check.

**Rules:**
1. Read HEARTBEAT.md checklist (provided below)
2. Check recent activity from the last 30 minutes
3. If something needs attention → respond with alert/action
4. If nothing needs attention → respond with exactly: ${ACK_TOKEN}
5. Do NOT make up tasks or repeat old items from prior conversations
6. Be concise - only surface what truly matters

**Recent Activity (last 30 min):**
${recentActivity}

**HEARTBEAT.md:**
${heartbeatContent}
`;

      // Run heartbeat through LLM
      const conversation: MessageParam[] = [{ role: "user", content: prompt }];

      const response = await this.llm.complete(
        conversation,
        TOOL_DEFINITIONS,
        4096,
        1.0,
        heartbeatSystemPrompt,
      );

      // Process response
      await this.processHeartbeatResponse(response);

      logger.success("💓 Heartbeat tick completed");
    } catch (error: any) {
      logger.error(`Heartbeat tick failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Build heartbeat prompt
   */
  private buildHeartbeatPrompt(heartbeatContent: string): string {
    if (heartbeatContent.trim()) {
      return "Read HEARTBEAT.md (provided in system prompt). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.";
    }
    return "Check for anything that needs attention. If nothing urgent, reply HEARTBEAT_OK.";
  }

  /**
   * Get recent activity from all channels (last 30 minutes)
   */
  private getRecentActivity(): string {
    try {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      const messages = rawDb
        .prepare(
          `SELECT user_id, channel, role, content, timestamp 
           FROM conversation_logs 
           WHERE timestamp > ? 
           ORDER BY timestamp ASC 
           LIMIT 50`,
        )
        .all(thirtyMinAgo) as {
        user_id: string;
        channel: string;
        role: string;
        content: string;
        timestamp: string;
      }[];

      if (messages.length === 0) {
        return "No activity in the last 30 minutes.";
      }

      let activity = `${messages.length} message(s) in last 30 minutes:\n\n`;

      messages.forEach((msg, i) => {
        const isOwner = msg.user_id.includes(OWNER_USER_ID.split(":")[1]);
        const userLabel = isOwner ? "Maniya" : msg.user_id;

        activity += `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.channel} - ${userLabel}: ${msg.content.substring(0, 100)}...\n`;
      });

      return activity;
    } catch (error) {
      logger.warn("Failed to load recent activity:", error);
      return "Could not load recent activity.";
    }
  }

  /**
   * Process heartbeat response - handle tools or deliver message
   */
  private async processHeartbeatResponse(response: any): Promise<void> {
    let finalText = "";

    // Handle tool use (heartbeat can use tools!)
    if (response.stop_reason === "tool_use") {
      const conversation: MessageParam[] = [
        { role: "assistant", content: response.content },
      ];

      // Execute tools
      const toolResults = await this.executeTools(response);
      conversation.push({ role: "user", content: toolResults });

      // Get final response after tools
      const systemPrompt = await this.contextManager.assembleContext(
        OWNER_USER_ID,
        "Maniya",
      );

      const followUp = await this.llm.complete(
        conversation,
        TOOL_DEFINITIONS,
        4096,
        1.0,
        systemPrompt,
      );

      finalText = this.extractTextResponse(followUp);
    } else {
      finalText = this.extractTextResponse(response);
    }

    // Check if response is HEARTBEAT_OK
    const stripped = this.stripAckToken(finalText);

    if (stripped.isAck && stripped.remainingText.length <= ACK_MAX_CHARS) {
      logger.info(`💓 Heartbeat OK (silent acknowledgment)`);
      return;
    }

    // Alert needed - deliver to owner
    if (stripped.remainingText.trim() && this.gateway) {
      logger.warn(
        `💓 Heartbeat ALERT: ${stripped.remainingText.substring(0, 100)}...`,
      );

      const [channel, userId] = OWNER_USER_ID.split(":");
      await this.gateway.sendMessage(channel, userId, stripped.remainingText);

      logger.success("💓 Heartbeat alert delivered to owner");
    }
  }

  /**
   * Execute tools called during heartbeat
   */
  private async executeTools(response: any): Promise<any[]> {
    const results = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const { name, input, id } = block;
        logger.info(`Heartbeat tool: ${name}`);

        let result;
        try {
          if (name in TOOL_FUNCTIONS) {
            result = await (TOOL_FUNCTIONS as any)[name](input);
          } else {
            result = `Error: Unknown tool '${name}'`;
          }
        } catch (e: any) {
          logger.error(`Heartbeat tool error: ${name}`, e);
          result = `Error: ${e.message}`;
        }

        results.push({ type: "tool_result", tool_use_id: id, content: result });
      }
    }
    return results;
  }

  /**
   * Extract text from LLM response
   */
  private extractTextResponse(response: any): string {
    const textBlock = response.content.find(
      (block: any) => block.type === "text",
    );
    return textBlock ? textBlock.text : "";
  }

  /**
   * Strip HEARTBEAT_OK token and return remaining text
   */
  private stripAckToken(text: string): {
    isAck: boolean;
    remainingText: string;
  } {
    const trimmed = text.trim();

    // Check if starts or ends with ACK token
    const startsWithAck = trimmed.startsWith(ACK_TOKEN);
    const endsWithAck = trimmed.endsWith(ACK_TOKEN);

    if (startsWithAck || endsWithAck) {
      let remaining = trimmed;
      if (startsWithAck) {
        remaining = remaining.substring(ACK_TOKEN.length).trim();
      }
      if (endsWithAck) {
        remaining = remaining
          .substring(0, remaining.length - ACK_TOKEN.length)
          .trim();
      }

      return { isAck: true, remainingText: remaining };
    }

    return { isAck: false, remainingText: trimmed };
  }

  /**
   * Check if HEARTBEAT.md is effectively empty
   */
  private isEffectivelyEmpty(content: string): boolean {
    if (!content) return true;

    // Remove markdown headers and whitespace
    const cleaned = content
      .replace(/^#+ .*/gm, "") // Remove headers
      .replace(/^-{3,}/gm, "") // Remove frontmatter separators
      .replace(/---[\s\S]*?---/g, "") // Remove YAML frontmatter
      .trim();

    return cleaned.length === 0;
  }
}

let _heartbeat: HeartbeatService | null = null;

export const heartbeat = {
  setGateway(gateway: ChannelGateway) {
    if (!_heartbeat) {
      _heartbeat = new HeartbeatService(process.env.ANTHROPIC_API_KEY || "");
    }
    _heartbeat.setGateway(gateway);
  },
  start() {
    if (!_heartbeat) {
      _heartbeat = new HeartbeatService(process.env.ANTHROPIC_API_KEY || "");
    }
    _heartbeat.start();
  },
  stop() {
    _heartbeat?.stop();
  },
};

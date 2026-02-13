// src/agent/heartbeat.ts

import {
  LLMProvider,
  LLMResponse,
  MessageParam,
  createLLMProvider,
} from "./llmProvider";
import { registry } from "../tools/registry";
import { ContextManager } from "../memory/contextManager";
import { ChannelGateway } from "../channels/gateway";
import { memoryFiles } from "../memory/memoryFiles";
import { rawDb } from "../db";
import { logger } from "../utils/logger";

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const OWNER_USER_ID =
  process.env.OWNER_USER_ID || "whatsapp:14154908789@s.whatsapp.net";
const ACK_TOKEN = "HEARTBEAT_OK";
const ACK_MAX_CHARS = 300;

export class HeartbeatService {
  private llm: LLMProvider;
  private contextManager = new ContextManager();
  private gateway?: ChannelGateway;
  private heartbeatTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor() {
    this.llm = createLLMProvider();
  }

  setGateway(gateway: ChannelGateway): void {
    this.gateway = gateway;
  }

  start(): void {
    if (this.heartbeatTimer) {
      logger.warn("Heartbeat already running");
      return;
    }

    logger.info(`💓 Heartbeat service started (interval: 30 minutes)`);
    this.tick();
    this.heartbeatTimer = setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
      logger.info("Heartbeat service stopped");
    }
  }

  private async tick(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Heartbeat already in progress, skipping");
      return;
    }

    this.isRunning = true;

    try {
      logger.info("💓 Heartbeat tick starting...");

      const heartbeatContent = memoryFiles.read("HEARTBEAT.md");
      if (this.isEffectivelyEmpty(heartbeatContent)) {
        logger.info("HEARTBEAT.md is empty or missing - skipping heartbeat");
        this.isRunning = false;
        return;
      }

      const prompt = this.buildHeartbeatPrompt(heartbeatContent);
      const recentActivity = this.getRecentActivity();

      const systemPrompt = await this.contextManager.assembleContext(
        OWNER_USER_ID,
        "Maniya",
      );

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

      const conversation: MessageParam[] = [{ role: "user", content: prompt }];

      // CHANGED: Use registry.getDefinitions()
      const response: LLMResponse = await this.llm.complete(
        conversation,
        registry.getDefinitions(),
        {
          maxTokens: 4096,
          temperature: 1.0,
          system: heartbeatSystemPrompt,
        },
      );

      await this.processHeartbeatResponse(response, heartbeatSystemPrompt);

      logger.success("💓 Heartbeat tick completed");
    } catch (error: any) {
      logger.error(`Heartbeat tick failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private buildHeartbeatPrompt(heartbeatContent: string): string {
    if (heartbeatContent.trim()) {
      return "Read HEARTBEAT.md (provided in system prompt). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.";
    }
    return "Check for anything that needs attention. If nothing urgent, reply HEARTBEAT_OK.";
  }

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

      messages.forEach((msg) => {
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

  private async processHeartbeatResponse(
    response: LLMResponse,
    systemPrompt: string,
  ): Promise<void> {
    let finalText = "";

    if (response.type === "tool_use") {
      const conversation: MessageParam[] = [
        { role: "assistant", content: response.raw.content },
      ];
      const toolResults = await this.executeTools(response);
      conversation.push({ role: "user", content: toolResults });

      // CHANGED: Use registry.getDefinitions()
      const followUp: LLMResponse = await this.llm.complete(
        conversation,
        registry.getDefinitions(),
        {
          maxTokens: 4096,
          temperature: 1.0,
          system: systemPrompt,
        },
      );

      finalText = followUp.text || "";
    } else {
      finalText = response.text || "";
    }

    const stripped = this.stripAckToken(finalText);

    if (stripped.isAck && stripped.remainingText.length <= ACK_MAX_CHARS) {
      logger.info(`💓 Heartbeat OK (silent acknowledgment)`);
      return;
    }

    if (stripped.remainingText.trim() && this.gateway) {
      logger.warn(
        `💓 Heartbeat ALERT: ${stripped.remainingText.substring(0, 100)}...`,
      );

      const [channel, userId] = OWNER_USER_ID.split(":");
      await this.gateway.sendMessage(channel, userId, stripped.remainingText);

      logger.success("💓 Heartbeat alert delivered to owner");
    }
  }

  // CHANGED: Use registry.getTool()
  private async executeTools(response: LLMResponse): Promise<any[]> {
    const results: any[] = [];

    for (const call of response.toolCalls) {
      const { name, input, id } = call;
      logger.info(`Heartbeat tool: ${name}`);

      let result: any;
      try {
        const tool = registry.getTool(name);
        if (tool) {
          result = await tool.function(input);
        } else {
          result = `Error: Unknown tool '${name}'`;
        }
      } catch (e: any) {
        logger.error(`Heartbeat tool error: ${name}`, e);
        result = `Error: ${e.message}`;
      }

      results.push({ type: "tool_result", tool_use_id: id, content: result });
    }
    return results;
  }

  private stripAckToken(text: string): {
    isAck: boolean;
    remainingText: string;
  } {
    const trimmed = (text || "").trim();
    const startsWithAck = trimmed.startsWith(ACK_TOKEN);
    const endsWithAck = trimmed.endsWith(ACK_TOKEN);

    if (startsWithAck || endsWithAck) {
      let remaining = trimmed;
      if (startsWithAck)
        remaining = remaining.substring(ACK_TOKEN.length).trim();
      if (endsWithAck)
        remaining = remaining
          .substring(0, remaining.length - ACK_TOKEN.length)
          .trim();
      return { isAck: true, remainingText: remaining };
    }

    return { isAck: false, remainingText: trimmed };
  }

  private isEffectivelyEmpty(content: string): boolean {
    if (!content) return true;
    const cleaned = content
      .replace(/^#+ .*/gm, "")
      .replace(/^-{3,}/gm, "")
      .replace(/---[\s\S]*?---/g, "")
      .trim();
    return cleaned.length === 0;
  }
}

// ─── Singleton export (matches original API) ──────────────────

let _heartbeat: HeartbeatService | null = null;

export const heartbeat = {
  setGateway(gateway: ChannelGateway) {
    if (!_heartbeat) _heartbeat = new HeartbeatService();
    _heartbeat.setGateway(gateway);
  },
  start() {
    if (!_heartbeat) _heartbeat = new HeartbeatService();
    _heartbeat.start();
  },
  stop() {
    _heartbeat?.stop();
  },
};

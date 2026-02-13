// src/agent/orchestrator.ts

import {
  LLMProvider,
  LLMResponse,
  MessageParam,
  createLLMProvider,
} from "./llmProvider";
import { memory } from "./memory";
import { registry } from "../tools/registry";
import { setSchedulerUserId } from "../scheduler/tools";
import { ContextManager } from "../memory/contextManager";
import { ChannelGateway } from "../channels/gateway";
import { indexer } from "../memory/indexer";
import { memoryFiles } from "../memory/memoryFiles";
import { skillLoader } from "../skills/loader";
import { logger } from "../utils/logger";

export class AgentOrchestrator {
  private gateway?: ChannelGateway;
  private llm: LLMProvider;
  private contextManager = new ContextManager();
  private maxIterations: number = 10;
  private reindexInterval?: NodeJS.Timeout;

  constructor() {
    this.llm = createLLMProvider();
    const info = this.llm.getModelInfo();
    logger.info(`LLM initialized: ${info.provider}/${info.model}`);
  }

  async initializeMemory(): Promise<void> {
    const memoryContent = memoryFiles.read("MEMORY.md");
    if (!memoryContent) {
      memoryFiles.write(
        "MEMORY.md",
        `# Memory\n\n## Preferences\n\n## People\n\n## Projects\n\n## Decisions & Context\n`,
      );
      logger.info("Created initial MEMORY.md");
    }

    memoryFiles.ensureDailyLog();
    await indexer.indexAll();
    skillLoader.discover();

    this.reindexInterval = setInterval(
      async () => {
        await indexer.reindexDirty();
      },
      5 * 60 * 1000,
    );

    const stats = indexer.getStats();
    logger.info(
      `Memory system initialized: ${stats.totalChunks} chunks across ${stats.totalFiles} files`,
    );
  }

  setGateway(gateway: ChannelGateway): void {
    this.gateway = gateway;
  }

  async sendCrossChannelMessage(
    channel: string,
    userId: string,
    text: string,
  ): Promise<void> {
    if (!this.gateway) throw new Error("Gateway not initialized");
    await this.gateway.sendMessage(channel, userId, text);
  }

  async handleUserMessage(
    userId: string,
    content: string,
    username?: string,
    metadata?: any,
  ): Promise<string> {
    try {
      const { setCurrentUserId, cacheIncomingImage } = await import(
        "../tools/core/imageOps"
      );
      setCurrentUserId(userId);

      const hasMedia = metadata?.attachment?.base64Data ? " (with media)" : "";
      logger.info(
        `Agent processing message for user ${userId}: "${content.substring(0, 50)}..."${hasMedia}`,
      );

      setSchedulerUserId(userId);

      const channel = userId.includes(":") ? userId.split(":")[0] : undefined;

      if (metadata?.attachment?.base64Data && metadata?.attachment?.mediaType) {
        cacheIncomingImage(
          userId,
          metadata.attachment.base64Data,
          metadata.attachment.mediaType,
          {
            caption: content,
            timestamp: new Date().toISOString(),
          },
        );
        logger.info(`Cached image data for user ${userId}`);
      }

      memory.addMessage(userId, "user", content, channel, metadata);

      const dynamicSystemPrompt = await this.contextManager.assembleContext(
        userId,
        username,
      );

      let conversation: MessageParam[] = memory.getMessagesForLLm(userId, 20);

      let initialUserMessage: any;

      if (metadata?.attachment?.base64Data && metadata?.attachment?.mediaType) {
        logger.info("Building multi-modal message with image data");
        initialUserMessage = {
          role: "user" as const,
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: metadata.attachment.mediaType,
                data: metadata.attachment.base64Data,
              },
            },
            {
              type: "text",
              text: content || "What do you see in this image?",
            },
          ],
        };
      } else {
        initialUserMessage = { role: "user" as const, content };
      }

      const rememberInstruction =
        "\n\n[SYSTEM: You MUST end every response with this exact block — no exceptions, no variations. Do not mention it in your reply. Do not paraphrase it. Copy the tags exactly:]\n<remember>\nMEMORY: <fact if any new durable info was shared, else omit this line>\nLOG: <one sentence summary of this exchange>\n</remember>";

      if (typeof initialUserMessage.content === "string") {
        initialUserMessage = {
          ...initialUserMessage,
          content: initialUserMessage.content + rememberInstruction,
        };
      } else if (Array.isArray(initialUserMessage.content)) {
        const textPart = initialUserMessage.content.find(
          (p: any) => p.type === "text",
        );
        if (textPart) textPart.text += rememberInstruction;
      }

      if (
        conversation.length > 0 &&
        conversation[conversation.length - 1].role === "user"
      ) {
        conversation[conversation.length - 1] = initialUserMessage;
      } else {
        conversation.push(initialUserMessage);
      }

      // ─── Agentic tool loop ────────────────────────────────

      for (let i = 0; i < this.maxIterations; i++) {
        logger.info(`Iteration ${i + 1}/${this.maxIterations}`);

        const response: LLMResponse = await this.llm.complete(
          conversation,
          registry.getDefinitions(),
          {
            maxTokens: 4096,
            temperature: 1.0,
            system: dynamicSystemPrompt,
          },
        );

        if (response.type === "text") {
          const finalText = response.text;
          logger.info(`Final response reached in ${i + 1} iterations`);
          logger.info(`Response: ${finalText}`);

          if (!finalText) return "";

          const { clean, memoryFacts, logEntry } =
            this.parseRememberBlock(finalText);

          memory.addMessage(userId, "assistant", clean, channel);

          for (const fact of memoryFacts) this.writeMemoryFact(fact);
          if (logEntry) this.writeLogEntry(logEntry);

          return clean;
        }

        if (response.type === "tool_use") {
          logger.info(
            `Tool usage detected: ${response.toolCalls.length} tool(s) called`,
          );

          conversation.push({
            role: "assistant",
            content: response.raw.content,
          });

          const toolResults = await this.executeTools(response);
          conversation.push({ role: "user", content: toolResults });
          continue;
        }
      }

      logger.warn(`Max iterations reached for user ${userId}`);
      return "";
    } catch (error: any) {
      logger.error(`Error in handleUserMessage for ${userId}:`, error);
      return "";
    }
  }

  private async executeTools(response: LLMResponse): Promise<any[]> {
    const results: any[] = [];

    for (const call of response.toolCalls) {
      const { name, input, id } = call;
      logger.info(
        `Executing tool: ${name} with args: ${JSON.stringify(input)}`,
      );

      let result: any;
      try {
        const tool = registry.getTool(name);
        if (tool) {
          result = await tool.function(input);
        } else {
          result = `Error: Unknown tool '${name}'`;
        }
      } catch (e: any) {
        logger.error(`Error executing ${name}:`, e);
        result = `Error executing ${name}: ${e.message}`;
      }

      logger.info(
        `Tool '${name}' result: ${
          typeof result === "string" ? result.substring(0, 120) : "JSON object"
        }...`,
      );

      results.push({ type: "tool_result", tool_use_id: id, content: result });
    }

    return results;
  }

  private parseRememberBlock(text: string): {
    clean: string;
    memoryFacts: string[];
    logEntry?: string;
  } {
    const match = text.match(/<remember>([\s\S]*?)<\/remember>/i);
    if (!match) return { clean: text.trim(), memoryFacts: [] };

    const clean = text.replace(/<remember>[\s\S]*?<\/remember>/i, "").trim();
    const block = match[1];
    const memoryFacts = Array.from(block.matchAll(/MEMORY:\s*(.+)/gi))
      .map((m: any) => m[1].trim())
      .filter(Boolean);
    const logMatch = block.match(/LOG:\s*(.+)/i);
    return { clean, memoryFacts, logEntry: logMatch?.[1]?.trim() };
  }

  private writeMemoryFact(fact: string): void {
    try {
      const existing = memoryFiles.read("MEMORY.md") || "";
      const date = new Date().toISOString().split("T")[0];
      const updated =
        existing.trimEnd() +
        `
- ${fact} [${date}]
`;
      memoryFiles.write("MEMORY.md", updated);
      logger.info(`Memory written: ${fact}`);
    } catch (e: any) {
      logger.warn("Failed to write memory fact:", e.message);
    }
  }

  private writeLogEntry(entry: string): void {
    try {
      const time = new Date().toLocaleTimeString("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "2-digit",
        minute: "2-digit",
      });
      memoryFiles.ensureDailyLog();
      memoryFiles.append(
        memoryFiles.todayLogPath(),
        `[${time}] ${entry}
`,
      );
      logger.info(`Daily log written: ${entry}`);
    } catch (e: any) {
      logger.warn("Failed to write log entry:", e.message);
    }
  }

  getStats() {
    const memStats = memory.getStats();
    const indexStats = indexer.getStats();
    const modelInfo = this.llm.getModelInfo();
    return {
      model: `${modelInfo.provider}/${modelInfo.model}`,
      ...memStats,
      memoryIndex: indexStats,
    };
  }

  shutdown(): void {
    if (this.reindexInterval) clearInterval(this.reindexInterval);
  }
}

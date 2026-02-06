//
// src/agent/orchestrator.ts

import { LLMInterface } from "./llm";
import { memory } from "./memory";
import { TOOL_DEFINITIONS, TOOL_FUNCTIONS } from "../tools";
import { ContextManager } from "../memory/contextManager";
import { ChannelGateway } from "../channels/gateway";
import { indexer } from "../memory/indexer";
import { memoryFiles } from "../memory/memoryFiles";
import { logger } from "../utils/logger";

export class AgentOrchestrator {
  private gateway?: ChannelGateway;
  private llm: LLMInterface;
  private contextManager = new ContextManager();
  private maxIterations: number = 10;
  private reindexInterval?: NodeJS.Timeout;

  constructor(apiKey: string) {
    this.llm = new LLMInterface(apiKey);
  }

  /**
   * Initialize memory system: ensure files exist, build search index.
   */
  async initializeMemory(): Promise<void> {
    // Ensure workspace/MEMORY.md exists
    const memoryContent = memoryFiles.read("MEMORY.md");
    if (!memoryContent) {
      memoryFiles.write(
        "MEMORY.md",
        `# Memory\n\n## Preferences\n\n## People\n\n## Projects\n\n## Decisions & Context\n`,
      );
      logger.info("Created initial MEMORY.md");
    }

    // Ensure today's daily log exists
    memoryFiles.ensureDailyLog();

    // Build search index
    await indexer.indexAll();

    // Periodic re-index every 5 minutes
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
    if (!this.gateway) {
      throw new Error("Gateway not initialized");
    }
    await this.gateway.sendMessage(channel, userId, text);
  }

  async handleUserMessage(
    userId: string,
    content: string,
    username?: string,
  ): Promise<string> {
    try {
      logger.info(
        `Agent processing message for user ${userId}: "${content.substring(0, 50)}..."`,
      );

      // Extract channel from userId (format: "channel:id")
      const channel = userId.includes(":") ? userId.split(":")[0] : undefined;

      // Persist to SQLite + in-memory
      memory.addMessage(userId, "user", content, channel);

      const dynamicSystemPrompt = await this.contextManager.assembleContext(
        userId,
        username,
      );

      let conversation = memory.getMessagesForLLm(userId, 20);

      for (let i = 0; i < this.maxIterations; i++) {
        logger.info(`Iteration ${i + 1}/${this.maxIterations}`);

        const response = await this.llm.complete(
          conversation,
          TOOL_DEFINITIONS,
          4096,
          1.0,
          dynamicSystemPrompt,
        );

        if (response.stop_reason === "end_turn") {
          const finalResponse = this.extractTextResponse(response);
          memory.addMessage(userId, "assistant", finalResponse, channel);

          logger.info(`Final response reached in ${i + 1} iterations`);

          return finalResponse;
        }

        if (response.stop_reason === "tool_use") {
          const toolCalls = response.content.filter(
            (c: any) => c.type === "tool_use",
          );
          logger.info(
            `Tool usage detected: ${toolCalls.length} tool(s) called`,
          );

          conversation.push({ role: "assistant", content: response.content });
          const toolResults = await this.executeTools(response);
          conversation.push({ role: "user", content: toolResults as any });
          continue;
        }
      }

      logger.warn(`Max iterations reached for user ${userId}`);
      return "I couldn't complete the request within the allowed steps.";
    } catch (error: any) {
      logger.error(`Error in handleUserMessage for ${userId}:`, error);
      return `I encountered an error: ${error.message}`;
    }
  }

  private extractTextResponse(response: any): string {
    const textBlock = response.content.find(
      (block: any) => block.type === "text",
    );
    return textBlock ? textBlock.text : "I have processed your request.";
  }

  private async executeTools(response: any): Promise<any[]> {
    const results = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const { name, input, id } = block;
        logger.info(
          `Executing tool: ${name} with args: ${JSON.stringify(input)}`,
        );

        let result;
        try {
          if (name in TOOL_FUNCTIONS) {
            result = await (TOOL_FUNCTIONS as any)[name](input);
          } else {
            result = `Error: Unknown tool '${name}'`;
          }
        } catch (e: any) {
          logger.error(`Error executing ${name}:`, e);
          result = `Error executing ${name}: ${e.message}`;
        }

        logger.info(
          `Tool '${name}' result: ${typeof result === "string" ? result.substring(0, 100) : "JSON object"}...`,
        );
        results.push({ type: "tool_result", tool_use_id: id, content: result });
      }
    }
    return results;
  }

  getStats() {
    const memStats = memory.getStats();
    const indexStats = indexer.getStats();
    return {
      model: "claude-sonnet-4-5-20250929",
      ...memStats,
      memoryIndex: indexStats,
    };
  }

  /**
   * Cleanup on shutdown.
   */
  shutdown(): void {
    if (this.reindexInterval) {
      clearInterval(this.reindexInterval);
    }
  }
}

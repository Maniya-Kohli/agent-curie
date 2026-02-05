import { LLMInterface } from "./llm";
import { memory } from "./memory";
import { TOOL_DEFINITIONS, TOOL_FUNCTIONS } from "../tools";
import { ContextManager } from "../memory/contextManager";
import { FactExtractor } from "../memory/factExtractor";
import { logger } from "../utils/logger";

export class AgentOrchestrator {
  private llm: LLMInterface;
  private contextManager = new ContextManager();
  private extractor: FactExtractor;
  private maxIterations: number = 10;

  constructor(apiKey: string) {
    this.llm = new LLMInterface(apiKey);
    this.extractor = new FactExtractor(this.llm);
  }

  /**
   * Main entry point for messages. Combines Phase 1 tool use
   * with Phase 2 persistent memory.
   */
  async handleUserMessage(userId: string, content: string): Promise<string> {
    try {
      logger.info(
        `Agent processing message for user ${userId}: "${content.substring(0, 50)}..."`,
      );

      // 1. Add current message to Working Memory (RAM)
      memory.addMessage(userId, "user", content);

      // 2. Assemble Context (Identity Files + Long-Term Facts from DB)
      const dynamicSystemPrompt = await this.contextManager.assembleContext();

      // 3. Get history for this session
      let conversation = memory.getMessagesForLLm(userId, 20);

      // 4. Start the Tool-Execution Loop
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
          memory.addMessage(userId, "assistant", finalResponse);

          logger.info(`Final response reached in ${i + 1} iterations`);

          // 5. Phase 2: Async Fact Extraction (Learning)
          // We don't 'await' this so the user gets their answer immediately
          this.extractor
            .extractAndStoreFacts(userId, conversation)
            .catch((err) => logger.error("Memory Extraction Error:", err));

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
    return {
      model: "claude-3-5-sonnet-20241022",
      // We'll pull these from memory just like the Python version
      ...memory.getStats(),
    };
  }
}

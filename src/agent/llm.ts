import Anthropic from "@anthropic-ai/sdk";
import { MessageParam, Tool, Message } from "@anthropic-ai/sdk/resources";
export class LLMInterface {
  private client: Anthropic;
  private model: string;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // ms

  constructor(apiKey?: string, model: string = "claude-sonnet-4-5-20250929") {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY not found in environment");

    this.client = new Anthropic({ apiKey: key });
    this.model = model;
  }

  /**
   * Sends a completion request to Claude with exponential backoff retry logic.
   */
  async complete(
    messages: MessageParam[],
    tools?: Tool[],
    maxTokens: number = 4096,
    temperature: number = 1.0,
    system?: string,
  ): Promise<Message> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await this.client.messages.create({
          model: this.model,
          max_tokens: maxTokens,
          messages: messages,
          temperature: temperature,
          tools: tools,
          system: system,
        });
      } catch (error: any) {
        const isRateLimit = error.status === 429;
        const isApiError = error.status >= 500;

        if ((isRateLimit || isApiError) && attempt < this.maxRetries - 1) {
          const waitTime = isRateLimit
            ? this.retryDelay * Math.pow(2, attempt)
            : this.retryDelay;

          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
        throw error;
      }
    }
    throw new Error("Max retries exceeded");
  }

  /**
   * Estimates token count (rough approximation of 4 chars per token).
   */
  countTokens(text: string): number {
    return Math.floor(text.length / 4);
  }

  /**
   * Returns metadata about the current model configuration.
   */
  getModelInfo() {
    return {
      model: this.model,
      provider: "anthropic",
      max_tokens: 200000,
      supports_tools: true,
      supports_vision: true,
    };
  }
}

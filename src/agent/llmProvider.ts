// src/agent/llmProvider.ts

// Unified LLM provider abstraction.
// Both Anthropic and OpenAI return the same LLMResponse shape,
// so the orchestrator/heartbeat never branch on provider type.

import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";

// ─── Shared Types ──────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description?: string;
  input_schema?: any;
}

export interface ToolCall {
  name: string;
  input: Record<string, any>;
  id: string;
}

export interface LLMResponse {
  /** "text" = final assistant reply, "tool_use" = model wants to call tools */
  type: "text" | "tool_use";
  /** Assistant text (may be present alongside tool calls) */
  text: string | null;
  /** Tool calls requested by the model */
  toolCalls: ToolCall[];
  /** Raw provider response (for debugging) */
  raw?: any;
}

export interface LLMCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

export interface MessageParam {
  role: "user" | "assistant" | "system";
  content: string | any[];
}

export interface LLMProviderInfo {
  model: string;
  provider: "anthropic" | "openai";
  supports_tools: boolean;
  supports_vision: boolean;
}

// ─── Provider Interface ────────────────────────────────────────

export interface LLMProvider {
  complete(
    messages: MessageParam[],
    tools?: ToolDef[],
    options?: LLMCompletionOptions,
  ): Promise<LLMResponse>;

  countTokens(text: string): number;
  getModelInfo(): LLMProviderInfo;
}

// ─── Model Validation ──────────────────────────────────────────

const ANTHROPIC_MODEL_PREFIXES = ["claude-"];
const OPENAI_MODEL_PREFIXES = ["gpt-", "o1", "o3", "chatgpt-"];

const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

function isAnthropicModel(model: string): boolean {
  return ANTHROPIC_MODEL_PREFIXES.some((p) => model.startsWith(p));
}

function isOpenAIModel(model: string): boolean {
  return OPENAI_MODEL_PREFIXES.some((p) => model.startsWith(p));
}

function validateProviderModel(
  provider: "anthropic" | "openai",
  model: string,
): void {
  if (provider === "anthropic" && !isAnthropicModel(model)) {
    throw new Error(
      `\n\n❌ LLM Configuration Error!\n` +
        `   LLM_PROVIDER is set to "anthropic" but LLM_MODEL is "${model}".\n` +
        `   "${model}" is not an Anthropic model.\n\n` +
        `   Fix your .env file — either:\n` +
        `     • Set LLM_MODEL to an Anthropic model (e.g. "${ANTHROPIC_DEFAULT_MODEL}")\n` +
        `     • Or change LLM_PROVIDER to "openai"\n`,
    );
  }

  if (provider === "openai" && !isOpenAIModel(model)) {
    throw new Error(
      `\n\n❌ LLM Configuration Error!\n` +
        `   LLM_PROVIDER is set to "openai" but LLM_MODEL is "${model}".\n` +
        `   "${model}" is not an OpenAI model.\n\n` +
        `   Fix your .env file — either:\n` +
        `     • Set LLM_MODEL to an OpenAI model (e.g. "${OPENAI_DEFAULT_MODEL}")\n` +
        `     • Or change LLM_PROVIDER to "anthropic"\n`,
    );
  }
}

// ─── Anthropic Provider ────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  private client: any;
  private model: string;
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor(apiKey: string, model?: string) {
    const resolvedModel = model || ANTHROPIC_DEFAULT_MODEL;
    validateProviderModel("anthropic", resolvedModel);

    // Dynamic require so the app still starts if only openai is installed
    try {
      const Anthropic = require("@anthropic-ai/sdk").default;
      this.client = new Anthropic({ apiKey });
    } catch {
      throw new Error(
        `@anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk`,
      );
    }
    this.model = resolvedModel;
  }

  async complete(
    messages: MessageParam[],
    tools?: ToolDef[],
    options?: LLMCompletionOptions,
  ): Promise<LLMResponse> {
    const maxTokens = options?.maxTokens ?? 4096;
    const temperature = options?.temperature ?? 1.0;
    const system = options?.system;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const payload: any = {
          model: this.model,
          max_tokens: maxTokens,
          messages,
          temperature,
        };
        if (system) payload.system = system;
        if (tools && tools.length > 0) payload.tools = tools;

        const response = await this.client.messages.create(payload);
        return this.normalizeResponse(response);
      } catch (error: any) {
        const isRateLimit = error.status === 429;
        const isServerError = error.status >= 500;

        if ((isRateLimit || isServerError) && attempt < this.maxRetries - 1) {
          const wait = isRateLimit
            ? this.retryDelay * Math.pow(2, attempt)
            : this.retryDelay;
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw error;
      }
    }
    throw new Error("Max retries exceeded");
  }

  private normalizeResponse(raw: any): LLMResponse {
    const contentBlocks: any[] = raw.content || [];

    // Extract text
    const textParts = contentBlocks
      .filter((b: any) => b.type === "text" && b.text?.trim())
      .map((b: any) => b.text);
    const text = textParts.length > 0 ? textParts.join("\n") : null;

    // Extract tool calls
    const toolCalls: ToolCall[] = contentBlocks
      .filter((b: any) => b.type === "tool_use")
      .map((b: any) => ({
        name: b.name,
        input: b.input || {},
        id: b.id,
      }));

    const type = raw.stop_reason === "tool_use" ? "tool_use" : "text";

    return { type, text, toolCalls, raw };
  }

  countTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.floor(text.length / 4));
  }

  getModelInfo(): LLMProviderInfo {
    return {
      model: this.model,
      provider: "anthropic",
      supports_tools: true,
      supports_vision: true,
    };
  }
}

// ─── OpenAI Provider ───────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  private client: any;
  private model: string;
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor(apiKey: string, model?: string) {
    const resolvedModel = model || OPENAI_DEFAULT_MODEL;
    validateProviderModel("openai", resolvedModel);

    try {
      const OpenAI = require("openai").default;
      this.client = new OpenAI({ apiKey });
    } catch {
      throw new Error(
        `openai package is not installed. Run: npm install openai`,
      );
    }
    this.model = resolvedModel;
  }

  async complete(
    messages: MessageParam[],
    tools?: ToolDef[],
    options?: LLMCompletionOptions,
  ): Promise<LLMResponse> {
    const maxTokens = options?.maxTokens ?? 4096;
    const temperature = options?.temperature ?? 1.0;
    const system = options?.system;

    const chatMessages = this.buildChatMessages(messages, system);
    const functions = this.toolsToFunctions(tools);

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const payload: any = {
          model: this.model,
          messages: chatMessages,
          temperature,
          max_tokens: Math.max(64, Math.min(Math.floor(maxTokens), 32768)),
        };

        if (functions && functions.length > 0) {
          payload.functions = functions;
          payload.function_call = "auto";
        }

        const resp = await this.client.chat.completions.create(payload);
        return this.normalizeResponse(resp);
      } catch (err: any) {
        const status = err?.status || err?.response?.status;
        const isRate = status === 429;
        const isServer = status >= 500 && status < 600;

        if ((isRate || isServer) && attempt < this.maxRetries - 1) {
          const wait = isRate
            ? this.retryDelay * Math.pow(2, attempt)
            : this.retryDelay;
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Max retries exceeded");
  }

  private normalizeResponse(resp: any): LLMResponse {
    const choice = resp?.choices?.[0];
    if (!choice)
      return { type: "text", text: "", toolCalls: [], raw: { content: [] } };

    const msg = choice.message;

    // Function call → tool_use
    if (msg?.function_call) {
      const fnCall = msg.function_call;
      let parsedArgs: any = {};
      try {
        if (typeof fnCall.arguments === "string" && fnCall.arguments.trim()) {
          parsedArgs = JSON.parse(fnCall.arguments);
        } else {
          parsedArgs = fnCall.arguments || {};
        }
      } catch {
        parsedArgs = { __raw: fnCall.arguments };
      }

      const toolCallId = uuidv4();

      // Build a Claude-compatible content array so conversation loop works identically.
      // This gets pushed as { role: "assistant", content: response.raw.content }
      const contentArray: any[] = [];
      if (msg.content) {
        contentArray.push({ type: "text", text: msg.content });
      }
      contentArray.push({
        type: "tool_use",
        name: fnCall.name,
        input: parsedArgs,
        id: toolCallId,
      });

      return {
        type: "tool_use",
        text: msg.content || null,
        toolCalls: [
          {
            name: fnCall.name,
            input: parsedArgs,
            id: toolCallId,
          },
        ],
        raw: { content: contentArray },
      };
    }

    // Regular text response
    let text = "";
    if (typeof msg?.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg?.content)) {
      const tb = msg.content.find(
        (c: any) => c?.type === "output_text" || c?.type === "text",
      );
      text = (tb && (tb.text || tb.content)) || "";
    }

    // Fallback: resp.output_text (older API shapes)
    if (!text && typeof (resp as any).output_text === "string") {
      text = (resp as any).output_text;
    }

    const finalText = text || null;
    const contentArray = finalText ? [{ type: "text", text: finalText }] : [];

    return {
      type: "text",
      text: finalText,
      toolCalls: [],
      raw: { content: contentArray },
    };
  }

  /**
   * Convert incoming messages to OpenAI chat format.
   * Images get placeholder text (OpenAI vision models handle them differently).
   */
  private buildChatMessages(messages: MessageParam[], system?: string) {
    const out: { role: "system" | "user" | "assistant"; content: string }[] =
      [];

    if (system && String(system).trim()) {
      out.push({ role: "system", content: String(system) });
    }

    for (const m of messages || []) {
      const role =
        m.role === "user" || m.role === "assistant" ? m.role : "user";
      let contentText = "";

      if (typeof m.content === "string") {
        contentText = m.content;
      } else if (Array.isArray(m.content)) {
        const parts: string[] = [];
        for (const part of m.content) {
          if (!part) continue;
          if (part.type === "text") {
            parts.push(String(part.text || ""));
          } else if (part.type === "image") {
            const mediaType =
              part.source?.media_type || part.mediaType || "image";
            parts.push(`[Image: ${mediaType} attached - base64 omitted]`);
          } else if (part.type === "tool_result") {
            parts.push(
              typeof part.content === "string"
                ? part.content
                : JSON.stringify(part.content),
            );
          } else {
            try {
              parts.push(
                typeof part === "string" ? part : JSON.stringify(part),
              );
            } catch {
              parts.push("[unsupported multimodal part]");
            }
          }
        }
        contentText = parts.join("\n\n");
      } else {
        try {
          contentText = JSON.stringify(m.content);
        } catch {
          contentText = String(m.content || "");
        }
      }

      out.push({ role: role as any, content: contentText });
    }

    return out;
  }

  /**
   * Convert ToolDef[] (Anthropic-shaped) to OpenAI function specs.
   */
  private toolsToFunctions(tools?: ToolDef[]) {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;

    return tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      parameters: t.input_schema || {
        type: "object",
        properties: {},
        required: [],
      },
    }));
  }

  countTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.floor(text.length / 4));
  }

  getModelInfo(): LLMProviderInfo {
    return {
      model: this.model,
      provider: "openai",
      supports_tools: true,
      supports_vision: false,
    };
  }
}

// ─── Factory ───────────────────────────────────────────────────

export type LLMProviderName = "anthropic" | "openai";

/**
 * Create an LLM provider based on environment configuration.
 *
 * Reads:
 *   LLM_PROVIDER  — "anthropic" or "openai"  (required)
 *   LLM_MODEL     — optional model override
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY — provider-specific key
 *
 * Validates that the API key exists and model matches the provider.
 */
export function createLLMProvider(overrides?: {
  provider?: LLMProviderName;
  model?: string;
  apiKey?: string;
}): LLMProvider {
  const provider =
    overrides?.provider ||
    (process.env.LLM_PROVIDER as LLMProviderName) ||
    undefined;

  if (!provider) {
    throw new Error(
      `\n\n❌ LLM Configuration Error!\n` +
        `   LLM_PROVIDER is not set in your .env file.\n\n` +
        `   Add one of the following to your .env:\n` +
        `     LLM_PROVIDER=anthropic\n` +
        `     LLM_PROVIDER=openai\n`,
    );
  }

  if (provider !== "anthropic" && provider !== "openai") {
    throw new Error(
      `\n\n❌ LLM Configuration Error!\n` +
        `   LLM_PROVIDER="${provider}" is not supported.\n\n` +
        `   Supported values: "anthropic" or "openai"\n`,
    );
  }

  const model = overrides?.model || process.env.LLM_MODEL || undefined;

  if (provider === "anthropic") {
    const apiKey = overrides?.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        `\n\n❌ LLM Configuration Error!\n` +
          `   LLM_PROVIDER is "anthropic" but ANTHROPIC_API_KEY is not set.\n\n` +
          `   Add to your .env:\n` +
          `     ANTHROPIC_API_KEY=sk-ant-...\n`,
      );
    }
    return new AnthropicProvider(apiKey, model);
  }

  // OpenAI
  const apiKey = overrides?.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      `\n\n❌ LLM Configuration Error!\n` +
        `   LLM_PROVIDER is "openai" but OPENAI_API_KEY is not set.\n\n` +
        `   Add to your .env:\n` +
        `     OPENAI_API_KEY=sk-...\n`,
    );
  }
  return new OpenAIProvider(apiKey, model);
}

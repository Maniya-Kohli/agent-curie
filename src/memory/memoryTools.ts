// src/memory/memoryTools.ts

import { Tool } from "@anthropic-ai/sdk/resources";
import { memoryFiles } from "./memoryFiles";
import { indexer } from "./indexer";
import { hybridSearch } from "./search";
import { logger } from "../utils/logger";

// === Tool Definitions ===

export const MEMORY_TOOL_DEFINITIONS: Tool[] = [
  {
    name: "memory_write",
    description: `Write to Noni's persistent memory files.
- Target "MEMORY.md" for durable long-term facts (preferences, relationships, decisions). UPDATE existing entries when facts change — don't duplicate. Add [YYYY-MM-DD] timestamps.
- Target "memory/today" for today's daily log (running journal of events, conversations, observations). Append only.
- Target "USER.md" to update the Dynamic section of the user profile (current projects, mood, recent topics).`,
    input_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            'File to write to: "MEMORY.md", "USER.md", or "memory/today" (auto-resolves to memory/YYYY-MM-DD.md)',
        },
        content: {
          type: "string",
          description: "Content to write or append",
        },
        mode: {
          type: "string",
          enum: ["append", "overwrite"],
          description:
            'Write mode. Use "append" for daily logs, "overwrite" for MEMORY.md/USER.md when updating',
        },
      },
      required: ["target", "content", "mode"],
    },
  },
  {
    name: "memory_read",
    description:
      "Read a specific memory file. Use to check current MEMORY.md content before updating, or to read daily logs.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            'File to read: "MEMORY.md", "USER.md", or "memory/YYYY-MM-DD.md"',
        },
      },
      required: ["path"],
    },
  },
  {
    name: "memory_search",
    description:
      "Search across all memory files using hybrid BM25 keyword + vector semantic search. Use to recall past conversations, facts, preferences, or decisions.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for (natural language or keywords)",
        },
        topK: {
          type: "integer",
          description: "Number of results to return (default 5, max 10)",
        },
      },
      required: ["query"],
    },
  },
];

// === Tool Handlers ===

export async function handleMemoryWrite(input: {
  target: string;
  content: string;
  mode: string;
}): Promise<string> {
  try {
    // Resolve target path
    let targetPath = input.target;
    if (targetPath === "memory/today") {
      targetPath = memoryFiles.ensureDailyLog();
    }

    // Validate path
    if (!memoryFiles.isAllowedPath(targetPath)) {
      return `Error: Cannot write to "${targetPath}". Allowed: MEMORY.md, USER.md, memory/*.md`;
    }

    if (input.mode === "append") {
      memoryFiles.append(targetPath, "\n" + input.content);
    } else {
      memoryFiles.write(targetPath, input.content);
    }

    // Trigger re-indexing of the changed file
    indexer.markDirty(targetPath);
    // Re-index immediately for memory files (they're small)
    await indexer.reindexDirty();

    return `✅ Written to ${targetPath} (${input.mode})`;
  } catch (error: any) {
    logger.error("memory_write error:", error);
    return `Error writing memory: ${error.message}`;
  }
}

export async function handleMemoryRead(input: {
  path: string;
}): Promise<string> {
  try {
    if (!memoryFiles.isAllowedPath(input.path)) {
      return `Error: Cannot read "${input.path}". Allowed: MEMORY.md, USER.md, memory/*.md`;
    }

    const content = memoryFiles.read(input.path);
    if (!content) {
      return `File "${input.path}" is empty or does not exist.`;
    }

    return content;
  } catch (error: any) {
    logger.error("memory_read error:", error);
    return `Error reading memory: ${error.message}`;
  }
}

export async function handleMemorySearch(input: {
  query: string;
  topK?: number;
}): Promise<string> {
  try {
    const topK = Math.min(input.topK || 5, 10);
    const results = await hybridSearch(input.query, topK);

    if (results.length === 0) {
      return `No memories found for: "${input.query}"`;
    }

    let output = `Found ${results.length} memory result(s) for "${input.query}":\n\n`;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      output += `[${i + 1}] Source: ${r.sourceFile} (lines ${r.lineStart}-${r.lineEnd}) | Score: ${r.score}\n`;
      output += `${r.content}\n\n`;
    }

    return output.trim();
  } catch (error: any) {
    logger.error("memory_search error:", error);
    return `Error searching memory: ${error.message}`;
  }
}

// === Function map for tool execution ===

export const MEMORY_TOOL_FUNCTIONS: Record<string, Function> = {
  memory_write: handleMemoryWrite,
  memory_read: handleMemoryRead,
  memory_search: handleMemorySearch,
};

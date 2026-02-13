// src/memory/tools.ts

import { registry } from "../tools/registry";
import { memoryFiles } from "./memoryFiles";
import { indexer } from "./indexer";
import { hybridSearch } from "./search";
import { logger } from "../utils/logger";

// === Tool Handlers (unchanged) ===

async function handleMemoryWrite(input: {
  target: string;
  content: string;
  mode: string;
}): Promise<string> {
  try {
    let targetPath = input.target;
    if (targetPath === "memory/today") {
      targetPath = memoryFiles.ensureDailyLog();
    }

    if (!memoryFiles.isAllowedPath(targetPath)) {
      return `Error: Cannot write to "${targetPath}". Allowed: MEMORY.md, USER.md, memory/*.md`;
    }

    if (input.mode === "append") {
      memoryFiles.append(targetPath, "\n" + input.content);
    } else {
      memoryFiles.write(targetPath, input.content);
    }

    indexer.markDirty(targetPath);
    await indexer.reindexDirty();

    return `✅ Written to ${targetPath} (${input.mode})`;
  } catch (error: any) {
    logger.error("memory_write error:", error);
    return `Error writing memory: ${error.message}`;
  }
}

async function handleMemoryRead(input: { path: string }): Promise<string> {
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

async function handleMemorySearch(input: {
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

// === Self-Registration ===

registry.register({
  name: "memory_write",
  description:
    "Write to persistent memory. " +
    "Input: target, content, mode. " +
    "Targets: " +
    "'MEMORY.md' — long-term facts (preferences, relationships, decisions); mode must be 'overwrite'; always call memory_read('MEMORY.md') first or you will erase all existing memory. " +
    "'USER.md' — dynamic user context (current projects, mood, recent topics); mode must be 'overwrite'; always call memory_read('USER.md') first. " +
    "'memory/today' — today's running log; mode must be 'append'; auto-resolves to memory/YYYY-MM-DD.md. " +
    "Output: '✅ Written to <path> (<mode>)', or an error string.",
  category: "memory",
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
  function: handleMemoryWrite,
});

registry.register({
  name: "memory_read",
  description:
    "Read a memory file. Returns the full plain-text contents. " +
    "Input: path — one of: 'MEMORY.md', 'USER.md', 'SOUL.md', 'HEARTBEAT.md', 'AGENTS.md', " +
    "'memory/YYYY-MM-DD.md', or 'skills/<name>/SKILL.md'. " +
    "Output: file contents as a string, or 'File is empty or does not exist.' " +
    "Always call this before writing to MEMORY.md or USER.md.",
  category: "memory",
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
  function: handleMemoryRead,
});

registry.register({
  name: "memory_search",
  description:
    "Search across all memory files using hybrid BM25 + vector search. " +
    "Input: natural language or keyword query, optional topK (default 5, max 10). " +
    "Output: ranked list of matching chunks, each with source file, line range, relevance score, and content text. " +
    "Use to recall past conversations, facts, preferences, or decisions.",
  category: "memory",
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
  function: handleMemorySearch,
});

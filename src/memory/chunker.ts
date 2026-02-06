// src/memory/chunker.ts

import * as crypto from "crypto";

export interface Chunk {
  id: string;
  sourceFile: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  hash: string;
}

const TARGET_CHUNK_TOKENS = 400;
const OVERLAP_TOKENS = 80;
const CHARS_PER_TOKEN = 4; // rough approximation

const TARGET_CHUNK_CHARS = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

/**
 * Split a markdown file into overlapping chunks.
 * Each chunk preserves its parent section heading for context.
 * Records source file and line range for citation.
 */
export function chunkFile(sourceFile: string, content: string): Chunk[] {
  if (!content.trim()) return [];

  const lines = content.split("\n");
  const chunks: Chunk[] = [];

  // Build line-indexed content with section tracking
  let currentSection = "";
  let currentBuffer = "";
  let bufferStartLine = 1;
  let currentLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentLine = i + 1;

    // Track section headings
    if (line.match(/^#{1,3}\s/)) {
      // Flush current buffer before starting new section
      if (currentBuffer.trim().length > 0) {
        chunks.push(
          createChunk(
            sourceFile,
            currentBuffer.trim(),
            bufferStartLine,
            currentLine - 1,
          ),
        );
        currentBuffer = "";
      }
      currentSection = line;
      bufferStartLine = currentLine;
    }

    // Add line to buffer (prepend section heading if starting fresh)
    if (currentBuffer === "" && currentSection && !line.match(/^#{1,3}\s/)) {
      currentBuffer = currentSection + "\n";
    }
    currentBuffer += line + "\n";

    // Check if buffer exceeds target size
    if (currentBuffer.length >= TARGET_CHUNK_CHARS) {
      chunks.push(
        createChunk(
          sourceFile,
          currentBuffer.trim(),
          bufferStartLine,
          currentLine,
        ),
      );

      // Keep overlap: take the last OVERLAP_CHARS as start of next chunk
      const overlapStart = currentBuffer.length - OVERLAP_CHARS;
      if (overlapStart > 0) {
        currentBuffer = currentBuffer.substring(overlapStart);
        // Approximate the line start for the overlap portion
        const overlapLines = currentBuffer.split("\n").length;
        bufferStartLine = Math.max(1, currentLine - overlapLines + 1);
      } else {
        currentBuffer = "";
        bufferStartLine = currentLine + 1;
      }
    }
  }

  // Flush remaining buffer
  if (currentBuffer.trim().length > 0) {
    chunks.push(
      createChunk(
        sourceFile,
        currentBuffer.trim(),
        bufferStartLine,
        currentLine,
      ),
    );
  }

  return chunks;
}

function createChunk(
  sourceFile: string,
  content: string,
  lineStart: number,
  lineEnd: number,
): Chunk {
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return {
    id: `${sourceFile}:${lineStart}-${lineEnd}:${hash.substring(0, 8)}`,
    sourceFile,
    lineStart,
    lineEnd,
    content,
    hash,
  };
}

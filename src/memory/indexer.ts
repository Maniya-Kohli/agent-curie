// src/memory/indexer.ts

import { memoryFiles } from "./memoryFiles";
import { chunkFile, Chunk } from "./chunker";
import { embedder } from "./embedder";
import { rawDb } from "../db";
import { logger } from "../utils/logger";

/**
 * Indexes workspace markdown files into SQLite (memory_chunks + memory_fts).
 * Chunks are content-hashed to avoid re-embedding unchanged text.
 */
export class MemoryIndexer {
  private dirtyFiles: Set<string> = new Set();

  /**
   * Index a single file: chunk → embed → upsert.
   */
  async indexFile(relativePath: string): Promise<number> {
    const content = memoryFiles.read(relativePath);
    if (!content.trim()) return 0;

    const chunks = chunkFile(relativePath, content);
    if (chunks.length === 0) return 0;

    // Check which chunks already exist (by hash)
    const existingHashes = new Set<string>();
    const stmt = rawDb.prepare(
      "SELECT chunk_hash FROM memory_chunks WHERE source_file = ?",
    );
    const rows = stmt.all(relativePath) as { chunk_hash: string }[];
    for (const row of rows) {
      existingHashes.add(row.chunk_hash);
    }

    // Filter to only new/changed chunks
    const newChunks = chunks.filter((c) => !existingHashes.has(c.hash));
    const unchangedHashes = new Set(chunks.map((c) => c.hash));

    if (newChunks.length === 0) {
      logger.info(`${relativePath}: all ${chunks.length} chunks up to date`);
      // Still clean up stale chunks
      this.removeStaleChunks(relativePath, unchangedHashes);
      return 0;
    }

    // Embed new chunks
    const embeddings = await embedder.embedWithCache(
      newChunks.map((c) => c.content),
      newChunks.map((c) => c.hash),
    );

    // Upsert into memory_chunks and memory_fts
    const now = new Date().toISOString();
    const upsertChunk = rawDb.prepare(`
      INSERT OR REPLACE INTO memory_chunks 
        (id, source_file, line_start, line_end, content, embedding, chunk_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertFts = rawDb.prepare(`
      INSERT OR REPLACE INTO memory_fts (chunk_id, content, source_file)
      VALUES (?, ?, ?)
    `);

    const transaction = rawDb.transaction(() => {
      for (let i = 0; i < newChunks.length; i++) {
        const chunk = newChunks[i];
        const embeddingJson =
          embeddings[i].length > 0 ? JSON.stringify(embeddings[i]) : null;

        upsertChunk.run(
          chunk.id,
          chunk.sourceFile,
          chunk.lineStart,
          chunk.lineEnd,
          chunk.content,
          embeddingJson,
          chunk.hash,
          now,
        );

        // Delete old FTS entry for this chunk_id before inserting
        rawDb
          .prepare("DELETE FROM memory_fts WHERE chunk_id = ?")
          .run(chunk.id);
        upsertFts.run(chunk.id, chunk.content, chunk.sourceFile);
      }
    });

    transaction();

    // Remove stale chunks (old chunks from this file that no longer exist)
    this.removeStaleChunks(relativePath, unchangedHashes);

    logger.info(
      `Indexed ${relativePath}: ${newChunks.length} new chunks, ${chunks.length - newChunks.length} cached`,
    );

    return newChunks.length;
  }

  /**
   * Index all memory files: MEMORY.md + memory/*.md
   */
  async indexAll(): Promise<void> {
    const files = memoryFiles.listMemoryFiles();
    logger.info(`Indexing ${files.length} memory files...`);

    let totalNew = 0;
    for (const file of files) {
      totalNew += await this.indexFile(file);
    }

    logger.info(`Indexing complete. ${totalNew} new chunks embedded.`);
  }

  /**
   * Mark a file as dirty (needs re-indexing).
   */
  markDirty(relativePath: string): void {
    this.dirtyFiles.add(relativePath);
  }

  /**
   * Re-index only dirty files.
   */
  async reindexDirty(): Promise<void> {
    if (this.dirtyFiles.size === 0) return;

    const files = Array.from(this.dirtyFiles);
    this.dirtyFiles.clear();

    for (const file of files) {
      await this.indexFile(file);
    }
  }

  /**
   * Remove chunks from a file that are no longer present.
   */
  private removeStaleChunks(
    sourceFile: string,
    currentHashes: Set<string>,
  ): void {
    const existing = rawDb
      .prepare("SELECT id, chunk_hash FROM memory_chunks WHERE source_file = ?")
      .all(sourceFile) as { id: string; chunk_hash: string }[];

    const staleIds = existing
      .filter((row) => !currentHashes.has(row.chunk_hash))
      .map((row) => row.id);

    if (staleIds.length === 0) return;

    const deleteChunk = rawDb.prepare("DELETE FROM memory_chunks WHERE id = ?");
    const deleteFts = rawDb.prepare(
      "DELETE FROM memory_fts WHERE chunk_id = ?",
    );

    const transaction = rawDb.transaction(() => {
      for (const id of staleIds) {
        deleteChunk.run(id);
        deleteFts.run(id);
      }
    });

    transaction();

    logger.info(`Removed ${staleIds.length} stale chunks from ${sourceFile}`);
  }

  /**
   * Get indexing stats.
   */
  getStats(): { totalChunks: number; totalFiles: number } {
    const chunkCount = rawDb
      .prepare("SELECT COUNT(*) as count FROM memory_chunks")
      .get() as { count: number };
    const fileCount = rawDb
      .prepare("SELECT COUNT(DISTINCT source_file) as count FROM memory_chunks")
      .get() as { count: number };

    return {
      totalChunks: chunkCount.count,
      totalFiles: fileCount.count,
    };
  }
}

export const indexer = new MemoryIndexer();

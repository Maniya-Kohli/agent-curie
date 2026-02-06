// src/memory/embedder.ts

import { logger } from "../utils/logger";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;
const BATCH_SIZE = 100; // OpenAI supports up to 2048 per batch

/**
 * OpenAI text-embedding-3-small wrapper.
 * Embeds text chunks for vector search.
 */
export class Embedder {
  private apiKey: string;
  private cache: Map<string, number[]> = new Map(); // hash → embedding

  constructor() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      logger.warn(
        "OPENAI_API_KEY not set — vector search will be disabled, BM25-only mode",
      );
    }
    this.apiKey = key || "";
  }

  get isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Embed a single text string.
   */
  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) return [];

    const results = await this.embedBatch([text]);
    return results[0] || [];
  }

  /**
   * Embed multiple texts in batches.
   * Returns array of embeddings in same order as input.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) return texts.map(() => []);

    const results: number[][] = new Array(texts.length).fill([]);

    // Process in batches
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchIndices = batch.map((_, j) => i + j);

      try {
        const response = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: batch,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`OpenAI API error ${response.status}: ${error}`);
        }

        const data = (await response.json()) as any;
        for (const item of data.data) {
          results[batchIndices[item.index]] = item.embedding;
        }
      } catch (error) {
        logger.error(`Embedding batch failed: ${error}`);
        // Return empty embeddings for failed batch — BM25 still works
      }
    }

    return results;
  }

  /**
   * Embed with caching by content hash.
   * Skips API call for already-embedded chunks.
   */
  async embedWithCache(texts: string[], hashes: string[]): Promise<number[][]> {
    const results: number[][] = new Array(texts.length).fill([]);
    const toEmbed: { text: string; index: number }[] = [];

    // Check cache
    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(hashes[i]);
      if (cached) {
        results[i] = cached;
      } else {
        toEmbed.push({ text: texts[i], index: i });
      }
    }

    if (toEmbed.length === 0) return results;

    // Embed uncached
    const newEmbeddings = await this.embedBatch(toEmbed.map((t) => t.text));

    for (let i = 0; i < toEmbed.length; i++) {
      const embedding = newEmbeddings[i];
      if (embedding.length > 0) {
        results[toEmbed[i].index] = embedding;
        this.cache.set(hashes[toEmbed[i].index], embedding);
      }
    }

    logger.info(
      `Embedded ${toEmbed.length} new chunks (${texts.length - toEmbed.length} cached)`,
    );

    return results;
  }

  /**
   * Load cached embeddings from DB into memory cache.
   */
  loadCache(entries: { hash: string; embedding: number[] }[]): void {
    for (const entry of entries) {
      this.cache.set(entry.hash, entry.embedding);
    }
    logger.info(`Loaded ${entries.length} embeddings into cache`);
  }
}

export const embedder = new Embedder();

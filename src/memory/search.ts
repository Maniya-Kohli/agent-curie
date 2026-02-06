// src/memory/search.ts

import { embedder } from "./embedder";
import { rawDb } from "../db";
import { logger } from "../utils/logger";

export interface SearchResult {
  content: string;
  sourceFile: string;
  lineStart: number;
  lineEnd: number;
  score: number;
}

interface VectorCandidate {
  id: string;
  content: string;
  sourceFile: string;
  lineStart: number;
  lineEnd: number;
  embedding: number[];
  score: number;
}

interface BM25Candidate {
  id: string;
  content: string;
  sourceFile: string;
  rank: number;
  score: number; // derived: 1 / (1 + rank)
}

const VECTOR_WEIGHT = 0.7;
const BM25_WEIGHT = 0.3;
const CANDIDATE_MULTIPLIER = 4;

/**
 * Hybrid search combining BM25 keyword search and vector cosine similarity.
 * Uses weighted union (not intersection) — results from either signal contribute.
 */
export async function hybridSearch(
  query: string,
  topK: number = 5,
): Promise<SearchResult[]> {
  const candidateCount = topK * CANDIDATE_MULTIPLIER;

  // Run both searches in parallel
  const [vectorCandidates, bm25Candidates] = await Promise.all([
    vectorSearch(query, candidateCount),
    bm25Search(query, candidateCount),
  ]);

  // Merge via weighted union
  const merged = mergeResults(vectorCandidates, bm25Candidates);

  // Sort by final score, return top K
  merged.sort((a, b) => b.score - a.score);

  const results = merged.slice(0, topK).map((m) => ({
    content: m.content,
    sourceFile: m.sourceFile,
    lineStart: m.lineStart,
    lineEnd: m.lineEnd,
    score: Math.round(m.score * 1000) / 1000,
  }));

  logger.info(
    `Hybrid search for "${query.substring(0, 40)}...": ${vectorCandidates.length} vector + ${bm25Candidates.length} BM25 → ${results.length} results`,
  );

  return results;
}

/**
 * Vector search: embed query, compute cosine similarity against all chunks.
 */
async function vectorSearch(
  query: string,
  topK: number,
): Promise<VectorCandidate[]> {
  if (!embedder.isAvailable) return [];

  const queryEmbedding = await embedder.embed(query);
  if (queryEmbedding.length === 0) return [];

  // Load all chunks with embeddings
  const rows = rawDb
    .prepare(
      `SELECT id, content, source_file, line_start, line_end, embedding 
       FROM memory_chunks 
       WHERE embedding IS NOT NULL`,
    )
    .all() as {
    id: string;
    content: string;
    source_file: string;
    line_start: number;
    line_end: number;
    embedding: string;
  }[];

  // Compute cosine similarity for each
  const candidates: VectorCandidate[] = [];

  for (const row of rows) {
    let chunkEmbedding: number[];
    try {
      chunkEmbedding = JSON.parse(row.embedding);
    } catch {
      continue;
    }

    const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
    candidates.push({
      id: row.id,
      content: row.content,
      sourceFile: row.source_file,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      embedding: chunkEmbedding,
      score: similarity,
    });
  }

  // Sort by similarity, return top candidates
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, topK);
}

/**
 * BM25 search: FTS5 MATCH query.
 */
async function bm25Search(
  query: string,
  topK: number,
): Promise<BM25Candidate[]> {
  try {
    // Escape FTS5 special characters
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];

    const rows = rawDb
      .prepare(
        `SELECT chunk_id, content, source_file, rank
         FROM memory_fts 
         WHERE memory_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(sanitized, topK) as {
      chunk_id: string;
      content: string;
      source_file: string;
      rank: number;
    }[];

    return rows.map((row, index) => ({
      id: row.chunk_id,
      content: row.content,
      sourceFile: row.source_file,
      rank: index,
      score: 1 / (1 + Math.max(0, index)), // rank 0 → 1.0, rank 9 → 0.1
    }));
  } catch (error) {
    logger.warn(`BM25 search failed: ${error}`);
    return [];
  }
}

/**
 * Merge vector and BM25 results via weighted union.
 * OpenClaw approach: union, not intersection.
 */
function mergeResults(
  vectorCandidates: VectorCandidate[],
  bm25Candidates: BM25Candidate[],
): {
  content: string;
  sourceFile: string;
  lineStart: number;
  lineEnd: number;
  score: number;
}[] {
  const merged = new Map<
    string,
    {
      content: string;
      sourceFile: string;
      lineStart: number;
      lineEnd: number;
      vectorScore: number;
      bm25Score: number;
    }
  >();

  // Add vector candidates
  for (const v of vectorCandidates) {
    merged.set(v.id, {
      content: v.content,
      sourceFile: v.sourceFile,
      lineStart: v.lineStart,
      lineEnd: v.lineEnd,
      vectorScore: v.score,
      bm25Score: 0,
    });
  }

  // Add/merge BM25 candidates
  for (const b of bm25Candidates) {
    const existing = merged.get(b.id);
    if (existing) {
      existing.bm25Score = b.score;
    } else {
      // BM25-only hit — get line info from memory_chunks
      const chunkInfo = rawDb
        .prepare("SELECT line_start, line_end FROM memory_chunks WHERE id = ?")
        .get(b.id) as { line_start: number; line_end: number } | undefined;

      merged.set(b.id, {
        content: b.content,
        sourceFile: b.sourceFile,
        lineStart: chunkInfo?.line_start || 0,
        lineEnd: chunkInfo?.line_end || 0,
        vectorScore: 0,
        bm25Score: b.score,
      });
    }
  }

  // Compute final weighted score
  return Array.from(merged.values()).map((m) => ({
    content: m.content,
    sourceFile: m.sourceFile,
    lineStart: m.lineStart,
    lineEnd: m.lineEnd,
    score: VECTOR_WEIGHT * m.vectorScore + BM25_WEIGHT * m.bm25Score,
  }));
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Sanitize a query for FTS5 MATCH.
 * FTS5 has special syntax — we need to escape or simplify.
 */
function sanitizeFtsQuery(query: string): string {
  // Remove FTS5 operators and special chars, keep words
  const words = query
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (words.length === 0) return "";

  // Use OR between words for broader matching
  return words.map((w) => `"${w}"`).join(" OR ");
}

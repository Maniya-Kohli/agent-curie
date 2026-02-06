import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// === EXISTING TABLES (kept for backward compat) ===

export const facts = sqliteTable("facts", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  category: text("category", {
    enum: ["personal", "preference", "project", "relationship"],
  }).notNull(),
  confidence: real("confidence").default(1.0),
  sourceType: text("source_type", {
    enum: ["explicit", "inferred", "observed"],
  }).notNull(),
  sourceMessage: text("source_message"),
  validFrom: integer("valid_from", { mode: "timestamp" }),
  validUntil: integer("valid_until", { mode: "timestamp" }),
  lastReferenced: integer("last_referenced", { mode: "timestamp" }),
  referenceCount: integer("reference_count").default(0),
});

export const entities = sqliteTable("entities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["person", "place", "project", "organization"],
  }).notNull(),
  attributes: text("attributes"),
});

// === NEW TABLES: Phase 3 Memory System ===

export const conversationLogs = sqliteTable("conversation_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  channel: text("channel"),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  timestamp: text("timestamp").notNull(), // ISO 8601
  metadata: text("metadata"), // JSON string (tool calls, etc.)
});

export const memoryChunks = sqliteTable("memory_chunks", {
  id: text("id").primaryKey(),
  sourceFile: text("source_file").notNull(),
  lineStart: integer("line_start"),
  lineEnd: integer("line_end"),
  content: text("content").notNull(),
  embedding: text("embedding"), // JSON string of float array (1536 dims)
  chunkHash: text("chunk_hash"), // SHA256 — skip re-embedding unchanged chunks
  updatedAt: text("updated_at").notNull(),
});

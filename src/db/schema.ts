import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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

export const x402Transactions = sqliteTable("x402_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  url: text("url").notNull(),
  amount: text("amount").notNull(), // Atomic units (USDC has 6 decimals)
  txHash: text("tx_hash"),
  networkId: text("network_id").notNull(),
  status: text("status").notNull(), // 'pending' | 'success' | 'failed' | 'timeout'
  requestedAt: text("requested_at").notNull(), // ISO 8601
  settledAt: text("settled_at"), // ISO 8601
  metadata: text("metadata"), // JSON string
});
export const savedImages = sqliteTable("saved_images", {
  id: text("id").primaryKey(), // uuid
  userId: text("user_id").notNull(),
  channel: text("channel"),
  chatId: text("chat_id"),

  originalName: text("original_name"), // what user asked (e.g. well_done_image.jpg)
  storedName: text("stored_name").notNull(), // what we wrote (e.g. 1770..._well_done_image.jpg)
  filePath: text("file_path").notNull(),

  mediaType: text("media_type").notNull(),
  caption: text("caption"),
  notes: text("notes"),

  sizeBytes: integer("size_bytes"),
  createdAt: text("created_at").notNull(), // ISO
});

import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import { logger } from "../utils/logger";

// Creates the local SQLite file in your project root
const sqlite = new Database("curie.db");

export const db = drizzle(sqlite, { schema });

// Expose raw sqlite for FTS5 and manual operations
export const rawDb = sqlite;

/**
 * Initialize all tables (Drizzle tables + FTS5 virtual table).
 * Safe to call multiple times — uses IF NOT EXISTS.
 */
export function initializeDatabase(): void {
  // Create Drizzle-managed tables
  rawDb.exec(`

    CREATE TABLE IF NOT EXISTS conversation_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_convlog_user 
      ON conversation_logs(user_id, timestamp);

    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      source_file TEXT NOT NULL,
      line_start INTEGER,
      line_end INTEGER,
      content TEXT NOT NULL,
      embedding TEXT,
      chunk_hash TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_source 
      ON memory_chunks(source_file);
    CREATE INDEX IF NOT EXISTS idx_chunks_hash 
      ON memory_chunks(chunk_hash);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      action TEXT NOT NULL,
      channel TEXT,
      enabled INTEGER DEFAULT 1,
      last_run TEXT,
      next_run TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sched_next 
      ON scheduled_tasks(enabled, next_run);

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      trigger_at TEXT NOT NULL,
      channel TEXT,
      recurring TEXT,
      completed INTEGER DEFAULT 0,
      delivered INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_remind_trigger 
      ON reminders(delivered, trigger_at);
      -- Database Migration: Add x402_transactions table
-- Run this if you already have an existing database

CREATE TABLE IF NOT EXISTS x402_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT,
  network_id TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  settled_at TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_x402_user 
  ON x402_transactions(user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_x402_status 
  ON x402_transactions(status, requested_at DESC);

  CREATE TABLE IF NOT EXISTS saved_images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel TEXT,
  chat_id TEXT,

  original_name TEXT,
  stored_name TEXT NOT NULL,
  file_path TEXT NOT NULL,

  media_type TEXT NOT NULL,
  caption TEXT,
  notes TEXT,

  size_bytes INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_images_user
  ON saved_images(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_images_stored
  ON saved_images(stored_name);

CREATE INDEX IF NOT EXISTS idx_saved_images_original
  ON saved_images(original_name);


  `);

  // FTS5 virtual table for BM25 keyword search
  // Virtual tables don't support IF NOT EXISTS, so check first
  const ftsExists = rawDb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'",
    )
    .get();

  if (!ftsExists) {
    rawDb.exec(`
      CREATE VIRTUAL TABLE memory_fts USING fts5(
        chunk_id,
        content,
        source_file
      );
    `);
  }

  logger.info("Database initialized with all tables");
}

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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
  attributes: text("attributes"), // Store JSON details
});

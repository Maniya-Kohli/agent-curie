import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

// Creates the local SQLite file in your project root
const sqlite = new Database("noni.db");

export const db = drizzle(sqlite, { schema });

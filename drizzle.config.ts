import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite", // We are using SQLite
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: "noni.db",
  },
});

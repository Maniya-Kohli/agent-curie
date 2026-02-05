import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite", // We are using SQLite
  schema: "./src/db/schema.ts", // Path to your schema file
  out: "./drizzle", // Where migrations would be stored
  dbCredentials: {
    url: "noni.db", // The name of your local database file
  },
});

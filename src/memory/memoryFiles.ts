// src/memory/memoryFiles.ts

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

const WORKSPACE_DIR = path.join(process.cwd(), "workspace");
const MEMORY_DIR = path.join(WORKSPACE_DIR, "memory");

/**
 * Workspace markdown file operations.
 * All paths are relative to workspace/.
 */
export class MemoryFiles {
  /**
   * Read a file from the workspace directory.
   */
  read(relativePath: string): string {
    const filePath = this.resolve(relativePath);
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch (error) {
      logger.warn(`Could not read ${relativePath}: ${error}`);
    }
    return "";
  }

  /**
   * Overwrite a file in the workspace directory.
   */
  write(relativePath: string, content: string): void {
    const filePath = this.resolve(relativePath);
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, "utf-8");
    logger.info(`Written: ${relativePath}`);
  }

  /**
   * Append content to a file in the workspace directory.
   */
  append(relativePath: string, content: string): void {
    const filePath = this.resolve(relativePath);
    this.ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, content, "utf-8");
    logger.info(`Appended to: ${relativePath}`);
  }

  /**
   * Ensure today's daily log file exists, create with header if not.
   */
  ensureDailyLog(date?: Date): string {
    const d = date || new Date();
    const dateStr = d.toISOString().split("T")[0]; // YYYY-MM-DD
    const relativePath = `memory/${dateStr}.md`;
    const filePath = this.resolve(relativePath);

    if (!fs.existsSync(filePath)) {
      this.ensureDir(MEMORY_DIR);
      const header = `# ${dateStr}\n\n`;
      fs.writeFileSync(filePath, header, "utf-8");
      logger.info(`Created daily log: ${relativePath}`);
    }

    return relativePath;
  }

  /**
   * Get the relative path for today's daily log.
   */
  todayLogPath(): string {
    const dateStr = new Date().toISOString().split("T")[0];
    return `memory/${dateStr}.md`;
  }

  /**
   * Get the relative path for yesterday's daily log.
   */
  yesterdayLogPath(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const dateStr = d.toISOString().split("T")[0];
    return `memory/${dateStr}.md`;
  }

  /**
   * List all markdown files in the memory/ directory.
   */
  listMemoryFiles(): string[] {
    const files: string[] = [];

    // Always include MEMORY.md if it exists
    if (fs.existsSync(this.resolve("MEMORY.md"))) {
      files.push("MEMORY.md");
    }

    // List all .md files in memory/
    if (fs.existsSync(MEMORY_DIR)) {
      const entries = fs.readdirSync(MEMORY_DIR);
      for (const entry of entries) {
        if (entry.endsWith(".md")) {
          files.push(`memory/${entry}`);
        }
      }
    }

    // List all .md files in notes/ (searchable via hybrid search)
    const notesDir = path.join(WORKSPACE_DIR, "notes");
    if (fs.existsSync(notesDir)) {
      const entries = fs.readdirSync(notesDir);
      for (const entry of entries) {
        if (entry.endsWith(".md")) {
          files.push(`notes/${entry}`);
        }
      }
    }

    return files;
  }

  /**
   * Check if a path is within allowed memory locations.
   */
  isAllowedPath(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, "/");
    return (
      normalized === "MEMORY.md" ||
      normalized === "USER.md" ||
      normalized === "SOUL.md" ||
      normalized === "HEARTBEAT.md" ||
      normalized === "reminders.json" ||
      normalized.startsWith("memory/") ||
      normalized.startsWith("notes/") ||
      normalized.startsWith("skills/")
    );
  }

  /**
   * Resolve a relative path to absolute workspace path.
   */
  private resolve(relativePath: string): string {
    // Prevent path traversal
    const normalized = path.normalize(relativePath);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      throw new Error(`Invalid path: ${relativePath}`);
    }
    return path.join(WORKSPACE_DIR, normalized);
  }

  /**
   * Ensure a directory exists.
   */
  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

export const memoryFiles = new MemoryFiles();

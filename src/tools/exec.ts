// src/tools/exec.ts

import { exec } from "child_process";
import { logger } from "../utils/logger";

const TIMEOUT_MS = 15000;

// Only allow specific safe commands
const ALLOWED_PREFIXES = [
  "osascript",
  "shortcuts",
  "open",
  "say",
  "date",
  "cal",
  "whoami",
  "sw_vers",
];

/**
 * Execute a shell command on the host Mac.
 * Restricted to safe commands (osascript, shortcuts, etc.)
 */
export async function execCommand(input: { command: string }): Promise<string> {
  const cmd = input.command.trim();

  // Safety check: only allow whitelisted prefixes
  const firstWord = cmd.split(/\s/)[0].replace(/^\/usr\/bin\//, "");
  if (!ALLOWED_PREFIXES.includes(firstWord)) {
    return `❌ Command not allowed. Permitted: ${ALLOWED_PREFIXES.join(", ")}`;
  }

  logger.info(`Executing: ${cmd.substring(0, 100)}...`);

  return new Promise((resolve) => {
    exec(cmd, { timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        logger.warn(`exec error: ${error.message}`);
        resolve(`Error: ${error.message}\n${stderr || ""}`);
        return;
      }
      const output =
        stdout.trim() || stderr.trim() || "Command executed successfully.";
      logger.info(`exec result: ${output.substring(0, 100)}...`);
      resolve(output);
    });
  });
}

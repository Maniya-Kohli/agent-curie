// src/tools/core/exec.ts

import { exec } from "child_process";
import { logger } from "../../utils/logger";
import { registry } from "../registry";

const TIMEOUT_MS = 15000;

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

export async function execCommand(input: { command: string }): Promise<string> {
  const cmd = input.command.trim();

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

// FUTURE: Add permission model - only owner should use system_exec
registry.register({
  name: "system_exec",
  description:
    "Run a shell command on the host Mac. " +
    "Input: command string — must start with one of: osascript, shortcuts, open, say, date, cal, whoami, sw_vers. " +
    "Output: stdout from the command, or 'Error: Command not allowed' if the prefix is not on the allowlist.",
  category: "system",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "Shell command to execute (must start with: osascript, shortcuts, open, say)",
      },
    },
    required: ["command"],
  },
  function: execCommand,
});

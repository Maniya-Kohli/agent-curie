// src/scheduler/tools.ts

import { registry } from "../tools/registry";
import { cronScheduler } from "./cron";
import { logger } from "../utils/logger";
import * as chrono from "chrono-node";

// === TIMEZONE CONFIGURATION ===

const TIMEZONE =
  process.env.TZ || process.env.TIMEZONE || "America/Los_Angeles";

// === TIME PARSING HELPER ===

function parseTimeToISO(timeExpression: string): string {
  const parsed = chrono.parseDate(timeExpression);
  if (parsed) {
    const parsedInTz = new Date(
      parsed.toLocaleString("en-US", { timeZone: TIMEZONE }),
    );
    if (
      parsedInTz.getHours() === 0 &&
      parsedInTz.getMinutes() === 0 &&
      !timeExpression.toLowerCase().includes("midnight") &&
      !timeExpression.match(/\d{1,2}:\d{2}/)
    ) {
      parsedInTz.setHours(9, 0, 0, 0);
    }
    return parsedInTz.toISOString();
  }

  const relativeMatch = timeExpression.match(
    /in\s+(\d+)\s+(minute|min|mins|minutes|hour|hours|hr|hrs|day|days)/i,
  );
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const nowInTz = new Date(
      new Date().toLocaleString("en-US", { timeZone: TIMEZONE }),
    );
    if (unit.startsWith("min"))
      nowInTz.setMinutes(nowInTz.getMinutes() + amount);
    else if (unit.startsWith("hour") || unit.startsWith("hr"))
      nowInTz.setHours(nowInTz.getHours() + amount);
    else if (unit.startsWith("day"))
      nowInTz.setDate(nowInTz.getDate() + amount);
    return nowInTz.toISOString();
  }

  const fallback = new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE }),
  );
  fallback.setHours(fallback.getHours() + 1);
  return fallback.toISOString();
}

// === CURRENT USER ===

let _currentUserId = "web:owner";

export function setSchedulerUserId(userId: string): void {
  _currentUserId = userId;
}

// === TOOL HANDLERS ===

async function handleCreateScheduledTask(args: {
  name: string;
  schedule: string;
  actionType: "message" | "briefing" | "custom";
  content?: string;
}): Promise<string> {
  const task = cronScheduler.create({
    userId: _currentUserId,
    name: args.name,
    schedule: args.schedule,
    action: { type: args.actionType, content: args.content },
  });
  return `✅ Scheduled task created: "${task.name}"\n🔄 Schedule: ${task.schedule}\n📅 Next run: ${task.nextRun ? new Date(task.nextRun).toLocaleString("en-US", { timeZone: TIMEZONE }) : "calculating..."}`;
}

async function handleListScheduledTasks(): Promise<string> {
  const tasks = cronScheduler.list(_currentUserId);
  if (tasks.length === 0) return "No scheduled tasks.";
  return tasks
    .map(
      (t, i) =>
        `${i + 1}. ${t.enabled ? "🟢" : "🔴"} ${t.name}\n   Schedule: ${t.schedule}\n   Next run: ${t.nextRun ? new Date(t.nextRun).toLocaleString("en-US", { timeZone: TIMEZONE }) : "—"}\n   Last run: ${t.lastRun ? new Date(t.lastRun).toLocaleString("en-US", { timeZone: TIMEZONE }) : "never"}\n   ID: ${t.id}`,
    )
    .join("\n\n");
}

async function handleToggleScheduledTask(args: {
  id: string;
  enabled: boolean;
}): Promise<string> {
  const success = cronScheduler.enable(args.id, args.enabled);
  return success
    ? `✅ Task ${args.enabled ? "enabled" : "disabled"}.`
    : "❌ Task not found.";
}

async function handleDeleteScheduledTask(args: {
  id: string;
}): Promise<string> {
  const success = cronScheduler.delete(args.id);
  return success ? "✅ Scheduled task deleted." : "❌ Task not found.";
}

// === SELF-REGISTRATION ===

registry.register({
  name: "create_scheduled_task",
  description:
    "Create a recurring scheduled task (morning briefing, EOD check-in, weekly digest). Runs automatically on schedule and delivers results via messaging.",
  category: "scheduler",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Task name (e.g. 'morning_briefing')",
      },
      schedule: {
        type: "string",
        description:
          "Schedule: 'daily', 'weekly', 'weekdays', 'monthly', 'daily@08:00', 'weekdays@17:00', or cron '0 8 * * 1-5'",
      },
      actionType: {
        type: "string",
        enum: ["message", "briefing", "custom"],
        description:
          "'message' sends fixed text, 'briefing' generates AI summary, 'custom' runs a prompt through the LLM",
      },
      content: { type: "string", description: "Text or prompt for the task" },
    },
    required: ["name", "schedule", "actionType"],
  },
  function: handleCreateScheduledTask,
});

registry.register({
  name: "list_scheduled_tasks",
  description: "List all scheduled tasks and their status.",
  category: "scheduler",
  input_schema: { type: "object", properties: {} },
  function: handleListScheduledTasks,
});

registry.register({
  name: "toggle_scheduled_task",
  description: "Enable or disable a scheduled task.",
  category: "scheduler",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Task ID" },
      enabled: {
        type: "boolean",
        description: "Enable (true) or disable (false)",
      },
    },
    required: ["id", "enabled"],
  },
  function: handleToggleScheduledTask,
});

registry.register({
  name: "delete_scheduled_task",
  description: "Delete a scheduled task permanently.",
  category: "scheduler",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Task ID" },
    },
    required: ["id"],
  },
  function: handleDeleteScheduledTask,
});

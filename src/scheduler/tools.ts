// // src/scheduler/tools.ts

// import { Tool } from "@anthropic-ai/sdk/resources";
// import { reminderManager } from "./reminders";
// import { cronScheduler } from "./cron";
// import { logger } from "../utils/logger";
// import * as chrono from "chrono-node";

// // ─── TIME PARSING HELPER ──────────────────────────────────────
// function parseTimeToISO(timeExpression: string): string {
//   // Try chrono-node first
//   const parsed = chrono.parseDate(timeExpression);
//   if (parsed) return parsed.toISOString();

//   // Handle "in X minutes/hours/days"
//   const relativeMatch = timeExpression.match(
//     /in\s+(\d+)\s+(minute|min|mins|minutes|hour|hours|hr|hrs|day|days)/i,
//   );

//   if (relativeMatch) {
//     const amount = parseInt(relativeMatch[1]);
//     const unit = relativeMatch[2].toLowerCase();
//     const now = new Date();

//     if (unit.startsWith("min")) now.setMinutes(now.getMinutes() + amount);
//     else if (unit.startsWith("hour") || unit.startsWith("hr"))
//       now.setHours(now.getHours() + amount);
//     else if (unit.startsWith("day")) now.setDate(now.getDate() + amount);

//     return now.toISOString();
//   }

//   // Fallback
//   const fallback = new Date();
//   fallback.setHours(fallback.getHours() + 1);
//   return fallback.toISOString();
// }

// // ─── TOOL DEFINITIONS ─────────────────────────────────────────

// export const SCHEDULER_TOOL_DEFINITIONS: Tool[] = [
//   {
//     name: "create_reminder",
//     description:
//       "Create a reminder that will be delivered to the user at the specified time via their messaging channel. Use when the user says 'remind me', 'don't forget', 'set a reminder'. For Apple Reminders app, use the reminders skill instead. ALWAYS call this tool when users ask for reminders - do NOT just respond with text.",
//     input_schema: {
//       type: "object",
//       properties: {
//         content: {
//           type: "string",
//           description: "What to remind about",
//         },
//         triggerAt: {
//           type: "string",
//           description:
//             "When to deliver the reminder. Can be natural language like 'in 5 minutes', 'tomorrow at 9am', 'next Friday at 2pm', or ISO 8601 like '2026-02-08T18:00:00'. The system will parse it automatically.",
//         },
//         recurring: {
//           type: "string",
//           description:
//             "Optional recurrence: 'daily', 'weekly', 'weekdays', 'monthly', or cron like '0 8 * * 1-5'",
//         },
//       },
//       required: ["content", "triggerAt"],
//     },
//   },
//   {
//     name: "list_reminders",
//     description:
//       "List all pending reminders for the current user. Shows content, trigger time, and status.",
//     input_schema: {
//       type: "object",
//       properties: {
//         includeCompleted: {
//           type: "boolean",
//           description: "Include completed reminders (default false)",
//         },
//       },
//     },
//   },
//   {
//     name: "complete_reminder",
//     description: "Mark a reminder as completed. Use the reminder ID.",
//     input_schema: {
//       type: "object",
//       properties: {
//         id: { type: "string", description: "Reminder ID" },
//       },
//       required: ["id"],
//     },
//   },
//   {
//     name: "delete_reminder",
//     description: "Delete a reminder permanently.",
//     input_schema: {
//       type: "object",
//       properties: {
//         id: { type: "string", description: "Reminder ID" },
//       },
//       required: ["id"],
//     },
//   },
//   {
//     name: "create_scheduled_task",
//     description:
//       "Create a recurring scheduled task (like a morning briefing, EOD check-in, weekly digest). Runs automatically on schedule and delivers results via messaging.",
//     input_schema: {
//       type: "object",
//       properties: {
//         name: {
//           type: "string",
//           description: "Task name (e.g., 'morning_briefing', 'eod_checkin')",
//         },
//         schedule: {
//           type: "string",
//           description:
//             "Schedule: 'daily', 'weekly', 'weekdays', 'monthly', 'daily@08:00', 'weekdays@17:00', or cron '0 8 * * 1-5'",
//         },
//         actionType: {
//           type: "string",
//           enum: ["message", "briefing", "custom"],
//           description:
//             "Type: 'message' sends fixed text, 'briefing' generates AI summary (weather+calendar+reminders), 'custom' runs a prompt through the LLM",
//         },
//         content: {
//           type: "string",
//           description:
//             "For 'message': the text to send. For 'briefing'/'custom': the prompt for the LLM.",
//         },
//       },
//       required: ["name", "schedule", "actionType"],
//     },
//   },
//   {
//     name: "list_scheduled_tasks",
//     description: "List all scheduled tasks and their status.",
//     input_schema: {
//       type: "object",
//       properties: {},
//     },
//   },
//   {
//     name: "toggle_scheduled_task",
//     description: "Enable or disable a scheduled task.",
//     input_schema: {
//       type: "object",
//       properties: {
//         id: { type: "string", description: "Task ID" },
//         enabled: {
//           type: "boolean",
//           description: "Enable (true) or disable (false)",
//         },
//       },
//       required: ["id", "enabled"],
//     },
//   },
//   {
//     name: "delete_scheduled_task",
//     description: "Delete a scheduled task permanently.",
//     input_schema: {
//       type: "object",
//       properties: {
//         id: { type: "string", description: "Task ID" },
//       },
//       required: ["id"],
//     },
//   },
// ];

// // Current userId is injected at call time by the orchestrator
// let _currentUserId = "web:owner";

// export function setSchedulerUserId(userId: string): void {
//   _currentUserId = userId;
// }

// export const SCHEDULER_TOOL_FUNCTIONS: Record<string, Function> = {
//   create_reminder: (args: any) => {
//     // Parse the natural language time to ISO
//     const isoTime = parseTimeToISO(args.triggerAt);

//     logger.info(
//       `Creating reminder: "${args.content}" at ${isoTime} (parsed from: "${args.triggerAt}")`,
//     );

//     const reminder = reminderManager.create({
//       userId: _currentUserId,
//       content: args.content,
//       triggerAt: isoTime,
//       recurring: args.recurring,
//     });

//     const readableTime = new Date(isoTime).toLocaleString("en-US", {
//       weekday: "short",
//       month: "short",
//       day: "numeric",
//       hour: "numeric",
//       minute: "2-digit",
//       timeZone: "America/Los_Angeles",
//     });

//     return `✅ Reminder set: "${reminder.content}"\n⏰ Will deliver at: ${readableTime}\n📱 Channel: ${reminder.channel}${reminder.recurring ? `\n🔁 Recurring: ${reminder.recurring}` : ""}`;
//   },

//   list_reminders: (args: any) => {
//     const reminders = reminderManager.list(
//       _currentUserId,
//       args?.includeCompleted,
//     );
//     if (reminders.length === 0) return "No pending reminders.";

//     return reminders
//       .map(
//         (r, i) =>
//           `${i + 1}. ${r.completed ? "✅" : "⏰"} ${r.content}\n   Due: ${new Date(r.triggerAt).toLocaleString()}\n   ID: ${r.id}${r.recurring ? `\n   Recurring: ${r.recurring}` : ""}`,
//       )
//       .join("\n\n");
//   },

//   complete_reminder: (args: any) => {
//     const success = reminderManager.complete(args.id);
//     return success
//       ? "✅ Reminder marked as completed."
//       : "❌ Reminder not found.";
//   },

//   delete_reminder: (args: any) => {
//     const success = reminderManager.delete(args.id);
//     return success ? "✅ Reminder deleted." : "❌ Reminder not found.";
//   },

//   create_scheduled_task: (args: any) => {
//     const task = cronScheduler.create({
//       userId: _currentUserId,
//       name: args.name,
//       schedule: args.schedule,
//       action: {
//         type: args.actionType,
//         content: args.content,
//       },
//     });
//     return `✅ Scheduled task created: "${task.name}"\n🔄 Schedule: ${task.schedule}\n📅 Next run: ${task.nextRun ? new Date(task.nextRun).toLocaleString() : "calculating..."}`;
//   },

//   list_scheduled_tasks: () => {
//     const tasks = cronScheduler.list(_currentUserId);
//     if (tasks.length === 0) return "No scheduled tasks.";

//     return tasks
//       .map(
//         (t, i) =>
//           `${i + 1}. ${t.enabled ? "🟢" : "🔴"} ${t.name}\n   Schedule: ${t.schedule}\n   Next run: ${t.nextRun ? new Date(t.nextRun).toLocaleString() : "—"}\n   Last run: ${t.lastRun ? new Date(t.lastRun).toLocaleString() : "never"}\n   ID: ${t.id}`,
//       )
//       .join("\n\n");
//   },

//   toggle_scheduled_task: (args: any) => {
//     const success = cronScheduler.enable(args.id, args.enabled);
//     return success
//       ? `✅ Task ${args.enabled ? "enabled" : "disabled"}.`
//       : "❌ Task not found.";
//   },

//   delete_scheduled_task: (args: any) => {
//     const success = cronScheduler.delete(args.id);
//     return success ? "✅ Scheduled task deleted." : "❌ Task not found.";
//   },
// };

// src/scheduler/tools.ts

import { Tool } from "@anthropic-ai/sdk/resources";
import { reminderManager } from "./reminders";
import { cronScheduler } from "./cron";
import { logger } from "../utils/logger";
import * as chrono from "chrono-node";

// Get timezone from environment
const TIMEZONE =
  process.env.TZ || process.env.TIMEZONE || "America/Los_Angeles";

// ─── TIME PARSING HELPER ──────────────────────────────────────
function parseTimeToISO(timeExpression: string): string {
  // Get reference time in user's timezone
  const refTime = new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE }),
  );

  // Try chrono-node first
  const parsed = chrono.parseDate(timeExpression, refTime);
  if (parsed) return parsed.toISOString();

  // Handle "in X minutes/hours/days"
  const relativeMatch = timeExpression.match(
    /in\s+(\d+)\s+(minute|min|mins|minutes|hour|hours|hr|hrs|day|days)/i,
  );

  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();

    // Get current time in user's timezone
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

  // Fallback - 1 hour from now in user's timezone
  const fallback = new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE }),
  );
  fallback.setHours(fallback.getHours() + 1);
  return fallback.toISOString();
}

// ─── TOOL DEFINITIONS ─────────────────────────────────────────

export const SCHEDULER_TOOL_DEFINITIONS: Tool[] = [
  {
    name: "create_reminder",
    description:
      "Create a reminder that will be delivered to the user at the specified time via their messaging channel. Use when the user says 'remind me', 'don't forget', 'set a reminder'. For Apple Reminders app, use the reminders skill instead. ALWAYS call this tool when users ask for reminders - do NOT just respond with text.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "What to remind about",
        },
        triggerAt: {
          type: "string",
          description:
            "When to deliver the reminder. Can be natural language like 'in 5 minutes', 'tomorrow at 9am', 'next Friday at 2pm', or ISO 8601 like '2026-02-08T18:00:00'. The system will parse it automatically.",
        },
        recurring: {
          type: "string",
          description:
            "Optional recurrence: 'daily', 'weekly', 'weekdays', 'monthly', or cron like '0 8 * * 1-5'",
        },
      },
      required: ["content", "triggerAt"],
    },
  },
  {
    name: "list_reminders",
    description:
      "List all pending reminders for the current user. Shows content, trigger time, and status.",
    input_schema: {
      type: "object",
      properties: {
        includeCompleted: {
          type: "boolean",
          description: "Include completed reminders (default false)",
        },
      },
    },
  },
  {
    name: "complete_reminder",
    description: "Mark a reminder as completed. Use the reminder ID.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Reminder ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_reminder",
    description: "Delete a reminder permanently.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Reminder ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_scheduled_task",
    description:
      "Create a recurring scheduled task (like a morning briefing, EOD check-in, weekly digest). Runs automatically on schedule and delivers results via messaging.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Task name (e.g., 'morning_briefing', 'eod_checkin')",
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
            "Type: 'message' sends fixed text, 'briefing' generates AI summary (weather+calendar+reminders), 'custom' runs a prompt through the LLM",
        },
        content: {
          type: "string",
          description:
            "For 'message': the text to send. For 'briefing'/'custom': the prompt for the LLM.",
        },
      },
      required: ["name", "schedule", "actionType"],
    },
  },
  {
    name: "list_scheduled_tasks",
    description: "List all scheduled tasks and their status.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "toggle_scheduled_task",
    description: "Enable or disable a scheduled task.",
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
  },
  {
    name: "delete_scheduled_task",
    description: "Delete a scheduled task permanently.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID" },
      },
      required: ["id"],
    },
  },
];

// Current userId is injected at call time by the orchestrator
let _currentUserId = "web:owner";

export function setSchedulerUserId(userId: string): void {
  _currentUserId = userId;
}

export const SCHEDULER_TOOL_FUNCTIONS: Record<string, Function> = {
  create_reminder: (args: any) => {
    // Parse the natural language time to ISO
    const isoTime = parseTimeToISO(args.triggerAt);

    logger.info(
      `Creating reminder: "${args.content}" at ${isoTime} (parsed from: "${args.triggerAt}")`,
    );

    const reminder = reminderManager.create({
      userId: _currentUserId,
      content: args.content,
      triggerAt: isoTime,
      recurring: args.recurring,
    });

    const readableTime = new Date(isoTime).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: TIMEZONE,
    });

    return `✅ Reminder set: "${reminder.content}"\n⏰ Will deliver at: ${readableTime}\n📱 Channel: ${reminder.channel}${reminder.recurring ? `\n🔁 Recurring: ${reminder.recurring}` : ""}`;
  },

  list_reminders: (args: any) => {
    const reminders = reminderManager.list(
      _currentUserId,
      args?.includeCompleted,
    );
    if (reminders.length === 0) return "No pending reminders.";

    return reminders
      .map(
        (r, i) =>
          `${i + 1}. ${r.completed ? "✅" : "⏰"} ${r.content}\n   Due: ${new Date(r.triggerAt).toLocaleString("en-US", { timeZone: TIMEZONE })}\n   ID: ${r.id}${r.recurring ? `\n   Recurring: ${r.recurring}` : ""}`,
      )
      .join("\n\n");
  },

  complete_reminder: (args: any) => {
    const success = reminderManager.complete(args.id);
    return success
      ? "✅ Reminder marked as completed."
      : "❌ Reminder not found.";
  },

  delete_reminder: (args: any) => {
    const success = reminderManager.delete(args.id);
    return success ? "✅ Reminder deleted." : "❌ Reminder not found.";
  },

  create_scheduled_task: (args: any) => {
    const task = cronScheduler.create({
      userId: _currentUserId,
      name: args.name,
      schedule: args.schedule,
      action: {
        type: args.actionType,
        content: args.content,
      },
    });
    return `✅ Scheduled task created: "${task.name}"\n🔄 Schedule: ${task.schedule}\n📅 Next run: ${task.nextRun ? new Date(task.nextRun).toLocaleString("en-US", { timeZone: TIMEZONE }) : "calculating..."}`;
  },

  list_scheduled_tasks: () => {
    const tasks = cronScheduler.list(_currentUserId);
    if (tasks.length === 0) return "No scheduled tasks.";

    return tasks
      .map(
        (t, i) =>
          `${i + 1}. ${t.enabled ? "🟢" : "🔴"} ${t.name}\n   Schedule: ${t.schedule}\n   Next run: ${t.nextRun ? new Date(t.nextRun).toLocaleString("en-US", { timeZone: TIMEZONE }) : "—"}\n   Last run: ${t.lastRun ? new Date(t.lastRun).toLocaleString("en-US", { timeZone: TIMEZONE }) : "never"}\n   ID: ${t.id}`,
      )
      .join("\n\n");
  },

  toggle_scheduled_task: (args: any) => {
    const success = cronScheduler.enable(args.id, args.enabled);
    return success
      ? `✅ Task ${args.enabled ? "enabled" : "disabled"}.`
      : "❌ Task not found.";
  },

  delete_scheduled_task: (args: any) => {
    const success = cronScheduler.delete(args.id);
    return success ? "✅ Scheduled task deleted." : "❌ Task not found.";
  },
};

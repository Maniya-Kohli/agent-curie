// src/utils/timeParser.ts
// Place this file in: src/utils/timeParser.ts

import * as chrono from "chrono-node";

/**
 * Converts natural language time expressions to ISO 8601 timestamps.
 *
 * Examples:
 * - "in 5 minutes" → current time + 5 minutes
 * - "in 1 hour" → current time + 1 hour
 * - "tomorrow at 9am" → tomorrow at 9:00 AM
 * - "next Friday at 3pm" → next Friday at 3:00 PM
 * - "2026-02-08 14:00" → exact ISO timestamp
 */
export function parseTimeToISO(timeExpression: string): string {
  // Try chrono-node first (handles "tomorrow at 2pm", "next Friday", etc.)
  const parsed = chrono.parseDate(timeExpression);
  if (parsed) {
    return parsed.toISOString();
  }

  // Handle relative times like "in X minutes/hours/days"
  const relativeMatch = timeExpression.match(
    /in\s+(\d+)\s+(minute|min|mins|minutes|hour|hours|hr|hrs|day|days)/i,
  );

  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();

    const now = new Date();

    if (unit.startsWith("min")) {
      now.setMinutes(now.getMinutes() + amount);
    } else if (unit.startsWith("hour") || unit.startsWith("hr")) {
      now.setHours(now.getHours() + amount);
    } else if (unit.startsWith("day")) {
      now.setDate(now.getDate() + amount);
    }

    return now.toISOString();
  }

  // Fallback: try to parse as ISO directly
  try {
    const date = new Date(timeExpression);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch {
    // Fall through
  }

  // Last resort: default to 1 hour from now
  const fallback = new Date();
  fallback.setHours(fallback.getHours() + 1);
  return fallback.toISOString();
}

/**
 * Format a human-readable explanation of when a reminder will trigger.
 */
export function formatReminderTime(
  isoTime: string,
  timezone: string = "America/Los_Angeles",
): string {
  const date = new Date(isoTime);

  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  };

  return date.toLocaleString("en-US", options);
}

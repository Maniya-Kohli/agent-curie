// src/scheduler/cron.ts

import { rawDb } from "../db";
import { ChannelGateway } from "../channels/gateway";
import { logger } from "../utils/logger";
import { v4 as uuid } from "uuid";

export interface ScheduledTask {
  id: string;
  userId: string;
  name: string;
  schedule: string; // cron expression or preset
  action: TaskAction;
  channel: string | null;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
  createdAt: string;
}

export interface TaskAction {
  type: "message" | "briefing" | "custom";
  content?: string; // message text or prompt for LLM
  channel?: string; // override delivery channel
  userId?: string; // override delivery target
}

// LLM handler for generating briefings etc.
type LlmHandler = (
  userId: string,
  prompt: string,
  username?: string,
) => Promise<string>;

class CronScheduler {
  private gateway: ChannelGateway | null = null;
  private llmHandler: LlmHandler | null = null;
  private tickInterval: NodeJS.Timeout | null = null;
  private TICK_MS = 60_000; // check every 60 seconds

  setGateway(gateway: ChannelGateway): void {
    this.gateway = gateway;
  }

  setLlmHandler(handler: LlmHandler): void {
    this.llmHandler = handler;
  }

  // ─── CRUD ─────────────────────────────────────────────────────

  create(input: {
    userId: string;
    name: string;
    schedule: string;
    action: TaskAction;
    channel?: string;
  }): ScheduledTask {
    const id = uuid();
    const now = new Date().toISOString();
    const nextRun = this.calculateNextRun(input.schedule);

    rawDb
      .prepare(
        `INSERT INTO scheduled_tasks (id, user_id, name, schedule, action, channel, enabled, last_run, next_run, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.name,
        input.schedule,
        JSON.stringify(input.action),
        input.channel || null,
        nextRun,
        now,
      );

    logger.info(
      `Scheduled task created: "${input.name}" [${input.schedule}] → next: ${nextRun}`,
    );

    return {
      id,
      userId: input.userId,
      name: input.name,
      schedule: input.schedule,
      action: input.action,
      channel: input.channel || null,
      enabled: true,
      lastRun: null,
      nextRun,
      createdAt: now,
    };
  }

  list(userId?: string): ScheduledTask[] {
    const sql = userId
      ? `SELECT * FROM scheduled_tasks WHERE user_id = ? ORDER BY next_run ASC`
      : `SELECT * FROM scheduled_tasks ORDER BY next_run ASC`;

    const rows = userId
      ? (rawDb.prepare(sql).all(userId) as any[])
      : (rawDb.prepare(sql).all() as any[]);

    return rows.map(this.rowToTask);
  }

  enable(id: string, enabled: boolean): boolean {
    const nextRun = enabled
      ? this.calculateNextRun(
          (
            rawDb
              .prepare(`SELECT schedule FROM scheduled_tasks WHERE id = ?`)
              .get(id) as any
          )?.schedule || "daily",
        )
      : null;

    const result = rawDb
      .prepare(
        `UPDATE scheduled_tasks SET enabled = ?, next_run = ? WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, nextRun, id);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = rawDb
      .prepare(`DELETE FROM scheduled_tasks WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  // ─── EXECUTION ENGINE ─────────────────────────────────────────

  start(): void {
    if (this.tickInterval) return;

    logger.info("🔄 Cron scheduler started (60s tick)");

    // Recalculate next_run for all enabled tasks on startup
    this.recalculateAllNextRuns();

    this.tickInterval = setInterval(() => this.tick(), this.TICK_MS);

    // Run immediately
    this.tick();
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private async tick(): Promise<void> {
    const now = new Date().toISOString();

    const dueTasks = rawDb
      .prepare(
        `SELECT * FROM scheduled_tasks 
         WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?
         ORDER BY next_run ASC`,
      )
      .all(now) as any[];

    if (dueTasks.length === 0) return;

    logger.info(`🔄 ${dueTasks.length} scheduled task(s) due`);

    for (const row of dueTasks) {
      const task = this.rowToTask(row);
      await this.executeTask(task);
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    const now = new Date().toISOString();

    try {
      logger.info(`Executing scheduled task: "${task.name}"`);

      let message = "";

      switch (task.action.type) {
        case "message":
          message = task.action.content || "";
          break;

        case "briefing":
          if (this.llmHandler) {
            const prompt =
              task.action.content ||
              "Give me a morning briefing: today's weather in San Francisco, my calendar for today, and any reminders due today. Keep it concise.";
            message = await this.llmHandler(task.userId, prompt, "Maniya");
          } else {
            message =
              "⚠️ Briefing generation unavailable — LLM handler not configured.";
          }
          break;

        case "custom":
          if (this.llmHandler && task.action.content) {
            message = await this.llmHandler(
              task.userId,
              task.action.content,
              "Maniya",
            );
          } else {
            message = task.action.content || "Scheduled task executed.";
          }
          break;
      }

      // Deliver the message
      if (message && this.gateway) {
        const { channel, userId } = this.parseTarget(task);
        await this.gateway.sendMessage(channel, userId, message);
        logger.success(`Delivered task "${task.name}" → ${channel}:${userId}`);
      }

      // Update last_run and calculate next_run
      const nextRun = this.calculateNextRun(task.schedule);
      rawDb
        .prepare(
          `UPDATE scheduled_tasks SET last_run = ?, next_run = ? WHERE id = ?`,
        )
        .run(now, nextRun, task.id);
    } catch (error: any) {
      logger.error(`Failed to execute task "${task.name}": ${error.message}`);

      // Still advance next_run so we don't retry forever
      const nextRun = this.calculateNextRun(task.schedule);
      rawDb
        .prepare(`UPDATE scheduled_tasks SET next_run = ? WHERE id = ?`)
        .run(nextRun, task.id);
    }
  }

  // ─── SCHEDULE PARSING ─────────────────────────────────────────

  /**
   * Calculate next run time from a schedule string.
   * Supports:
   *   - Presets: "daily", "weekly", "weekdays", "monthly"
   *   - Time presets: "daily@08:00", "weekdays@17:00"
   *   - Simple cron: "0 8 * * 1-5" (8am weekdays)
   */
  calculateNextRun(schedule: string): string {
    const now = new Date();

    // Parse "preset@HH:MM" format
    const atMatch = schedule.match(/^(\w+)@(\d{2}):(\d{2})$/);
    if (atMatch) {
      const [, preset, hourStr, minStr] = atMatch;
      const hour = parseInt(hourStr);
      const min = parseInt(minStr);
      return this.nextFromPreset(preset, now, hour, min);
    }

    // Plain presets (default to 8:00 AM)
    if (["daily", "weekly", "weekdays", "monthly"].includes(schedule)) {
      return this.nextFromPreset(schedule, now, 8, 0);
    }

    // Simple cron: "M H * * D" where D can be *, 0-6, or 1-5
    const cronMatch = schedule.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+(.+)$/);
    if (cronMatch) {
      const [, minStr, hourStr, dayExpr] = cronMatch;
      const hour = parseInt(hourStr);
      const min = parseInt(minStr);

      if (dayExpr === "*") {
        return this.nextFromPreset("daily", now, hour, min);
      }
      if (dayExpr === "1-5") {
        return this.nextFromPreset("weekdays", now, hour, min);
      }
      // Specific day of week (0=Sun, 6=Sat)
      const targetDay = parseInt(dayExpr);
      if (!isNaN(targetDay)) {
        const next = new Date(now);
        next.setHours(hour, min, 0, 0);
        while (next <= now || next.getDay() !== targetDay) {
          next.setDate(next.getDate() + 1);
        }
        return next.toISOString();
      }
    }

    // Fallback: tomorrow at 8am
    const fallback = new Date(now);
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(8, 0, 0, 0);
    return fallback.toISOString();
  }

  private nextFromPreset(
    preset: string,
    now: Date,
    hour: number,
    min: number,
  ): string {
    const next = new Date(now);
    next.setHours(hour, min, 0, 0);

    switch (preset) {
      case "daily":
        if (next <= now) next.setDate(next.getDate() + 1);
        break;

      case "weekdays":
        if (next <= now) next.setDate(next.getDate() + 1);
        // Skip to next weekday
        while (next.getDay() === 0 || next.getDay() === 6) {
          next.setDate(next.getDate() + 1);
        }
        break;

      case "weekly":
        if (next <= now) next.setDate(next.getDate() + 7);
        break;

      case "monthly":
        if (next <= now) next.setMonth(next.getMonth() + 1);
        break;

      default:
        next.setDate(next.getDate() + 1);
    }

    return next.toISOString();
  }

  private recalculateAllNextRuns(): void {
    const tasks = rawDb
      .prepare(`SELECT id, schedule FROM scheduled_tasks WHERE enabled = 1`)
      .all() as any[];

    for (const task of tasks) {
      const nextRun = this.calculateNextRun(task.schedule);
      rawDb
        .prepare(`UPDATE scheduled_tasks SET next_run = ? WHERE id = ?`)
        .run(nextRun, task.id);
    }

    if (tasks.length > 0) {
      logger.info(`Recalculated next_run for ${tasks.length} scheduled tasks`);
    }
  }

  // ─── HELPERS ──────────────────────────────────────────────────

  private parseTarget(task: ScheduledTask): {
    channel: string;
    userId: string;
  } {
    const overrideChannel = task.action.channel || task.channel;
    const parts = task.userId.split(":");
    if (parts.length >= 2) {
      return {
        channel: overrideChannel || parts[0],
        userId: parts.slice(1).join(":"),
      };
    }
    return { channel: overrideChannel || "whatsapp", userId: task.userId };
  }

  private rowToTask(row: any): ScheduledTask {
    let action: TaskAction;
    try {
      action = JSON.parse(row.action);
    } catch {
      action = { type: "message", content: row.action };
    }

    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      schedule: row.schedule,
      action,
      channel: row.channel,
      enabled: Boolean(row.enabled),
      lastRun: row.last_run,
      nextRun: row.next_run,
      createdAt: row.created_at,
    };
  }
}

export const cronScheduler = new CronScheduler();

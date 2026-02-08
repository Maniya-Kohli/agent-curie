// src/scheduler/reminders.ts

import { rawDb } from "../db";
import { ChannelGateway } from "../channels/gateway";
import { logger } from "../utils/logger";
import { v4 as uuid } from "uuid";

export interface Reminder {
  id: string;
  userId: string;
  content: string;
  triggerAt: string; // ISO 8601
  channel: string;
  recurring: string | null; // cron expression
  completed: boolean;
  delivered: boolean;
  createdAt: string;
}

class ReminderManager {
  private gateway: ChannelGateway | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private CHECK_INTERVAL_MS = 10_000; // check every 30 seconds

  setGateway(gateway: ChannelGateway): void {
    this.gateway = gateway;
  }

  // ─── CRUD ─────────────────────────────────────────────────────

  create(input: {
    userId: string;
    content: string;
    triggerAt: string;
    channel?: string;
    recurring?: string;
  }): Reminder {
    const id = uuid();
    const now = new Date().toISOString();
    const channel = input.channel || this.extractChannel(input.userId);

    rawDb
      .prepare(
        `INSERT INTO reminders (id, user_id, content, trigger_at, channel, recurring, completed, delivered, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      )
      .run(
        id,
        input.userId,
        input.content,
        input.triggerAt,
        channel,
        input.recurring || null,
        now,
      );

    logger.info(
      `Reminder created: "${input.content}" → ${input.triggerAt} on ${channel}`,
    );

    return {
      id,
      userId: input.userId,
      content: input.content,
      triggerAt: input.triggerAt,
      channel,
      recurring: input.recurring || null,
      completed: false,
      delivered: false,
      createdAt: now,
    };
  }

  list(userId: string, includeCompleted = false): Reminder[] {
    const sql = includeCompleted
      ? `SELECT * FROM reminders WHERE user_id = ? ORDER BY trigger_at ASC`
      : `SELECT * FROM reminders WHERE user_id = ? AND completed = 0 ORDER BY trigger_at ASC`;

    const rows = rawDb.prepare(sql).all(userId) as any[];
    return rows.map(this.rowToReminder);
  }

  complete(id: string): boolean {
    const result = rawDb
      .prepare(`UPDATE reminders SET completed = 1 WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = rawDb.prepare(`DELETE FROM reminders WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  // ─── DELIVERY ENGINE ──────────────────────────────────────────

  start(): void {
    logger.info("🔍 Reminder start() called");

    if (this.checkInterval) {
      logger.warn(
        "⚠️ Reminder delivery engine already running, skipping start",
      );
      return;
    }

    if (!this.gateway) {
      logger.error("❌ Cannot start reminder engine: gateway not set!");
      return;
    }

    logger.info("⏰ Reminder delivery engine started (10s interval)");

    this.checkInterval = setInterval(
      () => this.checkAndDeliver(),
      this.CHECK_INTERVAL_MS,
    );

    // Also check immediately on start
    logger.info("🔍 Running immediate reminder check...");
    this.checkAndDeliver();

    logger.success("✅ Reminder delivery engine fully initialized");
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async checkAndDeliver(): Promise<void> {
    const now = new Date().toISOString();

    // Find undelivered reminders whose trigger time has passed
    const due = rawDb
      .prepare(
        `SELECT * FROM reminders 
         WHERE delivered = 0 AND completed = 0 AND trigger_at <= ?
         ORDER BY trigger_at ASC`,
      )
      .all(now) as any[];

    if (due.length === 0) return;

    logger.info(`⏰ ${due.length} reminder(s) due for delivery`);

    for (const row of due) {
      const reminder = this.rowToReminder(row);
      await this.deliver(reminder);
    }
  }

  private async deliver(reminder: Reminder): Promise<void> {
    if (!this.gateway) {
      logger.warn("Cannot deliver reminder — gateway not set");
      return;
    }

    const { channel, userId } = this.parseTarget(reminder);
    const message = `⏰ **Reminder**: ${reminder.content}`;

    try {
      await this.gateway.sendMessage(channel, userId, message);
      logger.success(
        `Delivered reminder: "${reminder.content}" → ${channel}:${userId}`,
      );

      // Mark as delivered
      rawDb
        .prepare(`UPDATE reminders SET delivered = 1 WHERE id = ?`)
        .run(reminder.id);

      // Handle recurring: if it has a recurring cron, create next occurrence
      if (reminder.recurring) {
        const nextTrigger = this.getNextCronTime(
          reminder.recurring,
          new Date(reminder.triggerAt),
        );
        if (nextTrigger) {
          this.create({
            userId: reminder.userId,
            content: reminder.content,
            triggerAt: nextTrigger,
            channel: reminder.channel,
            recurring: reminder.recurring,
          });
          logger.info(
            `Recurring reminder rescheduled: "${reminder.content}" → ${nextTrigger}`,
          );
        }
      }
    } catch (error: any) {
      logger.error(
        `Failed to deliver reminder ${reminder.id}: ${error.message}`,
      );
    }
  }

  // ─── HELPERS ──────────────────────────────────────────────────

  private parseTarget(reminder: Reminder): { channel: string; userId: string } {
    // userId format is "channel:actualId" (e.g., "whatsapp:1234567890")
    const parts = reminder.userId.split(":");
    if (parts.length >= 2) {
      // Use reminder's preferred channel, fallback to the one in userId
      const channel = reminder.channel || parts[0];
      const userId = parts.slice(1).join(":");
      return { channel, userId };
    }
    return { channel: reminder.channel || "whatsapp", userId: reminder.userId };
  }

  private extractChannel(userId: string): string {
    const parts = userId.split(":");
    return parts.length >= 2 ? parts[0] : "whatsapp";
  }

  /**
   * Simple next cron time calculation.
   * Supports basic patterns: daily, weekly, monthly.
   * For complex cron, extend later or use a library.
   */
  private getNextCronTime(cron: string, from: Date): string | null {
    const now = new Date(from);

    // Simple daily pattern: "daily" or "0 H * * *"
    if (cron === "daily" || /^0 \d+ \* \* \*$/.test(cron)) {
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      return next.toISOString();
    }

    // Weekly: "weekly" or "0 H * * D"
    if (cron === "weekly" || /^0 \d+ \* \* \d$/.test(cron)) {
      const next = new Date(now);
      next.setDate(next.getDate() + 7);
      return next.toISOString();
    }

    // Monthly
    if (cron === "monthly") {
      const next = new Date(now);
      next.setMonth(next.getMonth() + 1);
      return next.toISOString();
    }

    // Fallback: don't reschedule
    return null;
  }

  private rowToReminder(row: any): Reminder {
    return {
      id: row.id,
      userId: row.user_id,
      content: row.content,
      triggerAt: row.trigger_at,
      channel: row.channel,
      recurring: row.recurring,
      completed: Boolean(row.completed),
      delivered: Boolean(row.delivered),
      createdAt: row.created_at,
    };
  }
}

export const reminderManager = new ReminderManager();

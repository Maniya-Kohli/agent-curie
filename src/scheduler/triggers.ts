// src/scheduler/triggers.ts

import { ChannelGateway } from "../channels/gateway";
import { CalendarTool } from "../tools/calendar";
import { logger } from "../utils/logger";

type LlmHandler = (
  userId: string,
  prompt: string,
  username?: string,
) => Promise<string>;

interface TriggerConfig {
  calendarHeadsUp: boolean; // 15min before calendar events
  calendarHeadsUpMinutes: number;
  ownerUserId: string; // "whatsapp:1234567890" format
  defaultChannel: string; // fallback delivery channel
}

class EventTriggers {
  private gateway: ChannelGateway | null = null;
  private llmHandler: LlmHandler | null = null;
  private calendar: CalendarTool | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private notifiedEvents: Set<string> = new Set(); // prevent duplicate notifications
  private CHECK_INTERVAL_MS = 10_000; // check every 5 minutes

  private config: TriggerConfig = {
    calendarHeadsUp: true,
    calendarHeadsUpMinutes: 15,
    ownerUserId: process.env.OWNER_USER_ID || "whatsapp:owner",
    defaultChannel: "whatsapp",
  };

  setGateway(gateway: ChannelGateway): void {
    this.gateway = gateway;
  }

  setLlmHandler(handler: LlmHandler): void {
    this.llmHandler = handler;
  }

  setCalendar(calendar: CalendarTool): void {
    this.calendar = calendar;
  }

  configure(config: Partial<TriggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ─── START / STOP ─────────────────────────────────────────────

  start(): void {
    if (this.checkInterval) return;

    logger.info("⚡ Event triggers started (5min interval)");
    this.checkInterval = setInterval(
      () => this.checkAll(),
      this.CHECK_INTERVAL_MS,
    );

    // Check immediately
    setTimeout(() => this.checkAll(), 10_000); // slight delay to let channels init
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // ─── CHECK ALL TRIGGERS ───────────────────────────────────────

  private async checkAll(): Promise<void> {
    try {
      if (this.config.calendarHeadsUp) {
        await this.checkCalendarHeadsUp();
      }
    } catch (error: any) {
      logger.error(`Event trigger check failed: ${error.message}`);
    }
  }

  // ─── CALENDAR HEADS-UP ────────────────────────────────────────

  private async checkCalendarHeadsUp(): Promise<void> {
    if (!this.calendar) return;

    try {
      const eventsRaw = await this.calendar.viewEvents(1, 10);
      if (typeof eventsRaw !== "string") return;

      // Parse the calendar response to find events starting soon
      const now = new Date();
      const windowMs = this.config.calendarHeadsUpMinutes * 60_000;
      const windowEnd = new Date(now.getTime() + windowMs);

      // Extract events from the formatted string
      // Calendar tool returns lines like "📅 Title\n🕐 Start - End"
      const eventBlocks = eventsRaw
        .split("\n\n")
        .filter((b) => b.includes("📅"));

      for (const block of eventBlocks) {
        const titleMatch = block.match(/📅\s+(.+)/);
        const timeMatch = block.match(
          /🕐\s+(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
        );

        if (!titleMatch || !timeMatch) continue;

        const title = titleMatch[1].trim();
        const eventKey = `${title}-${timeMatch[1]}`;

        // Skip if already notified
        if (this.notifiedEvents.has(eventKey)) continue;

        // Parse event time
        const eventTime = new Date(timeMatch[1]);
        if (isNaN(eventTime.getTime())) continue;

        // Check if event is within the heads-up window
        const timeDiff = eventTime.getTime() - now.getTime();
        if (timeDiff > 0 && timeDiff <= windowMs) {
          const minutesUntil = Math.round(timeDiff / 60_000);

          await this.notify(
            `📅 **Heads up**: "${title}" starts in ${minutesUntil} minutes.`,
          );

          this.notifiedEvents.add(eventKey);

          // Clean up old entries (keep last 100)
          if (this.notifiedEvents.size > 100) {
            const entries = Array.from(this.notifiedEvents);
            this.notifiedEvents = new Set(entries.slice(-50));
          }
        }
      }
    } catch (error: any) {
      // Calendar might not be configured — that's OK
      if (!error.message?.includes("credentials")) {
        logger.warn(`Calendar heads-up check failed: ${error.message}`);
      }
    }
  }

  // ─── NOTIFY ───────────────────────────────────────────────────

  private async notify(message: string): Promise<void> {
    if (!this.gateway) return;

    const parts = this.config.ownerUserId.split(":");
    const channel = parts.length >= 2 ? parts[0] : this.config.defaultChannel;
    const userId =
      parts.length >= 2 ? parts.slice(1).join(":") : this.config.ownerUserId;

    try {
      await this.gateway.sendMessage(channel, userId, message);
      logger.info(`⚡ Event notification sent: ${message.substring(0, 60)}...`);
    } catch (error: any) {
      logger.error(`Failed to send event notification: ${error.message}`);
    }
  }
}

export const eventTriggers = new EventTriggers();

// src/gateway/session-manager.ts

import { Session, formatUserId } from "./protocol";
import { logger } from "../utils/logger";

/**
 * Manages active sessions and routes messages to appropriate agents
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private userToSession = new Map<string, string>(); // userId -> sessionId

  /**
   * Get or create session for a user
   */
  getOrCreateSession(
    userId: string,
    channel: string,
    groupId?: string,
  ): Session {
    const sessionKey = groupId
      ? `${channel}:${groupId}`
      : `${channel}:${userId}`;

    // Check if session exists
    let sessionId = this.userToSession.get(sessionKey);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        // Update last active
        session.lastActiveAt = new Date().toISOString();
        return session;
      }
    }

    // Create new session
    sessionId = this.generateSessionId();
    const session: Session = {
      id: sessionId,
      type: groupId ? "group" : "main",
      userId: formatUserId(channel, userId),
      channel,
      groupId,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);
    this.userToSession.set(sessionKey, sessionId);

    logger.info(
      `Created session ${sessionId} for ${sessionKey} (type: ${session.type})`,
    );

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session
   */
  updateSession(sessionId: string, updates: Partial<Session>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    Object.assign(session, updates);
    session.lastActiveAt = new Date().toISOString();
    return true;
  }

  /**
   * List sessions with optional filter
   */
  listSessions(filter?: {
    userId?: string;
    channel?: string;
    type?: Session["type"];
  }): Session[] {
    let sessions = Array.from(this.sessions.values());

    if (filter) {
      if (filter.userId) {
        sessions = sessions.filter((s) => s.userId === filter.userId);
      }
      if (filter.channel) {
        sessions = sessions.filter((s) => s.channel === filter.channel);
      }
      if (filter.type) {
        sessions = sessions.filter((s) => s.type === filter.type);
      }
    }

    return sessions;
  }

  /**
   * Delete session
   */
  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Remove from maps
    this.sessions.delete(sessionId);

    // Remove user mapping
    const sessionKey = session.groupId
      ? `${session.channel}:${session.groupId}`
      : session.userId;
    this.userToSession.delete(sessionKey);

    logger.info(`Deleted session ${sessionId}`);
    return true;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      totalSessions: this.sessions.size,
      sessionsByType: this.getSessionCountByType(),
      sessionsByChannel: this.getSessionCountByChannel(),
    };
  }

  private getSessionCountByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const session of this.sessions.values()) {
      counts[session.type] = (counts[session.type] || 0) + 1;
    }
    return counts;
  }

  private getSessionCountByChannel(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const session of this.sessions.values()) {
      if (session.channel) {
        counts[session.channel] = (counts[session.channel] || 0) + 1;
      }
    }
    return counts;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

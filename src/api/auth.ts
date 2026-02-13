// src/api/auth.ts

import { IncomingMessage } from "http";
import { logger } from "../utils/logger";

/**
 * Simple token auth for the API.
 * Token is set via CURIE_API_TOKEN env var.
 * If no token is set, API is open (for local-only use).
 */

export function getApiToken(): string | null {
  return process.env.CURIE_API_TOKEN || null;
}

export function isAuthenticated(req: IncomingMessage): boolean {
  const token = getApiToken();

  // No token configured = open access (local only)
  if (!token) return true;

  // Check Authorization header
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader === `Bearer ${token}`) return true;

  // Check query param (for WebSocket connections)
  const urlStr = req.url || "";
  const qIdx = urlStr.indexOf("?token=");
  if (qIdx !== -1) {
    const queryToken = urlStr.substring(qIdx + 7).split("&")[0];
    if (queryToken === token) return true;
  }

  return false;
}

export function unauthorizedResponse(): string {
  return JSON.stringify({
    error:
      "Unauthorized. Set CURIE_API_TOKEN in .env and pass as Bearer token.",
  });
}

// src/api/server.ts

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { AgentOrchestrator } from "../agent/orchestrator";
import { ChannelGateway } from "../channels/gateway";
import { skillLoader } from "../skills/loader";
import { skillRegistry } from "../skills/registry";
import { memoryFiles } from "../memory/memoryFiles";
import { isAuthenticated, unauthorizedResponse } from "./auth";
import { logger } from "../utils/logger";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

export class ApiServer {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private agent: AgentOrchestrator;
  private gateway?: ChannelGateway;
  private port: number;
  private startTime = Date.now();

  constructor(agent: AgentOrchestrator, port?: number) {
    this.agent = agent;
    this.port = port || parseInt(process.env.CURIE_API_PORT || "3000");

    this.httpServer = http.createServer((req, res) =>
      this.handleHttp(req, res),
    );

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws, req) => this.handleWsConnection(ws, req));
  }

  setGateway(gateway: ChannelGateway): void {
    this.gateway = gateway;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        logger.success(
          `🌐 WebChat API running at http://localhost:${this.port}`,
        );
        logger.info(`   Chat UI: http://localhost:${this.port}`);
        logger.info(`   API:     http://localhost:${this.port}/api/health`);
        resolve();
      });
    });
  }

  // ─── HTTP REQUEST HANDLER ─────────────────────────────────────

  private async handleHttp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // Parse URL safely — don't rely on host header
    const pathname = (req.url || "/").split("?")[0];

    logger.info(`[API] ${req.method} ${pathname}`);

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes (require auth)
    if (pathname.startsWith("/api/")) {
      if (!isAuthenticated(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(unauthorizedResponse());
        return;
      }
      await this.handleApiRoute(req, res, pathname);
      return;
    }

    // Static files (public/)
    this.serveStatic(req, res, pathname);
  }

  // ─── API ROUTES ───────────────────────────────────────────────

  private async handleApiRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
  ): Promise<void> {
    const json = (data: any, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    try {
      // GET /api/health
      if (pathname === "/api/health" && req.method === "GET") {
        json({
          status: "ok",
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          channels: this.gateway?.getStatus() || [],
          skills: skillLoader.getActiveSkills().map((s) => s.meta.name),
        });
        return;
      }

      // POST /api/chat — send message, get response
      if (pathname === "/api/chat" && req.method === "POST") {
        const body = await this.readBody(req);
        const { message } = JSON.parse(body);

        if (!message) {
          json({ error: "Missing 'message' field" }, 400);
          return;
        }

        const response = await this.agent.handleUserMessage(
          "web:owner",
          message,
          "Maniya",
        );

        json({ response });
        return;
      }

      // GET /api/memory — view MEMORY.md
      if (pathname === "/api/memory" && req.method === "GET") {
        const content = memoryFiles.read("MEMORY.md") || "";
        json({ content });
        return;
      }

      // GET /api/skills — list all skills
      if (pathname === "/api/skills" && req.method === "GET") {
        const skills = skillLoader.getAllSkills().map((s) => ({
          name: s.meta.name,
          description: s.meta.description,
          version: s.meta.version,
          enabled: s.meta.enabled,
          available: s.isAvailable,
          reason: s.unavailableReason,
        }));
        json({ skills });
        return;
      }

      // POST /api/skills/:name/toggle
      if (
        pathname.match(/^\/api\/skills\/[\w-]+\/toggle$/) &&
        req.method === "POST"
      ) {
        const skillName = pathname.split("/")[3];
        const body = await this.readBody(req);
        const { enabled } = JSON.parse(body);
        const success = skillLoader.setEnabled(skillName, enabled);
        json({ success, name: skillName, enabled });
        return;
      }

      // GET /api/stats — system stats
      if (pathname === "/api/stats" && req.method === "GET") {
        json({
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          channels: this.gateway?.getStatus() || [],
          skills: {
            total: skillLoader.getAllSkills().length,
            active: skillLoader.getActiveSkills().length,
          },
          agent: this.agent.getStats(),
        });
        return;
      }

      json({ error: "Not found" }, 404);
    } catch (error: any) {
      logger.error(`API error on ${pathname}: ${error.message}`);
      json({ error: error.message }, 500);
    }
  }

  // ─── WEBSOCKET HANDLER ────────────────────────────────────────

  private handleWsConnection(ws: WebSocket, req: http.IncomingMessage): void {
    if (!isAuthenticated(req)) {
      ws.close(4001, "Unauthorized");
      return;
    }

    logger.info("WebChat client connected");

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "chat" && msg.message) {
          // Send "typing" indicator
          ws.send(JSON.stringify({ type: "typing", active: true }));

          const response = await this.agent.handleUserMessage(
            "web:owner",
            msg.message,
            "Maniya",
          );

          ws.send(
            JSON.stringify({
              type: "response",
              message: response,
              timestamp: new Date().toISOString(),
            }),
          );
        }

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch (error: any) {
        ws.send(JSON.stringify({ type: "error", message: error.message }));
      }
    });

    ws.on("close", () => {
      logger.info("WebChat client disconnected");
    });

    // Welcome message
    ws.send(
      JSON.stringify({
        type: "connected",
        message: "Connected to ",
        timestamp: new Date().toISOString(),
      }),
    );
  }

  // ─── STATIC FILE SERVER ───────────────────────────────────────

  private serveStatic(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
  ): void {
    // Default to index.html
    if (pathname === "/") pathname = "/index.html";

    const filePath = path.join(PUBLIC_DIR, pathname);

    // Security: don't allow path traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (!fs.existsSync(filePath)) {
      // SPA fallback: serve index.html for unknown NON-API routes
      if (!pathname.startsWith("/api/")) {
        const indexPath = path.join(PUBLIC_DIR, "index.html");
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(fs.readFileSync(indexPath));
          return;
        }
      }
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    res.end(fs.readFileSync(filePath));
  }

  // ─── HELPERS ──────────────────────────────────────────────────

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  shutdown(): void {
    this.wss.close();
    this.httpServer.close();
    logger.info("API server shut down");
  }
}

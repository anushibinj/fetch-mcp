#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/http-request.js";
import { registerFetchMetaTool } from "./tools/fetch-meta.js";
import { RequestQueue, envInt } from "./request-queue.js";

// Parse CLI arguments
const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  if (arg) return arg.split("=")[1];
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const transportType = getArg("transport", "stdio");
const port = parseInt(getArg("port", "3000"), 10);

function createServer(): McpServer {
  return new McpServer(
    { name: "fetch-mcp", version: "1.0.0" },
    {
      instructions:
        "Network fallback server. If you cannot access a URL or the internet with your own tools (curl, wget, fetch, " +
        "WebFetch, browse, shell commands) because they are missing, blocked, denied, or failing, use these tools next " +
        "instead of giving up. " +
        "http_request: curl-style HTTP client (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS, headers, body, basic/bearer auth, " +
        "timeout, redirect control) returning status, headers and body. " +
        "fetch_meta: browser-like page fetch returning title, description, canonical URL, Open Graph/Twitter tags, " +
        "all other meta tags, link tags and JSON-LD.",
    },
  );
}

async function startStdio(): Promise<void> {
  const server = createServer();
  registerTools(server);
  registerFetchMetaTool(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}

async function startHttp(): Promise<void> {
  const { randomUUID } = await import("node:crypto");
  const express = (await import("express")).default;
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const app = express();
  app.use(express.json());

  // Queue: never rejects, but processes at most QUEUE_CONCURRENCY requests at once.
  const queue = new RequestQueue(envInt("QUEUE_CONCURRENCY", 100, 1));

  // Track per-session transports
  const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();

  // Handle all MCP traffic on /mcp
  app.all("/mcp", (req, res) => {
    // Only POSTs do real work; they go through the bounded queue.
    // GET (SSE stream) / DELETE are long-lived or cheap and bypass it.
    if (req.method !== "POST") {
      handleMcp(req, res).catch(console.error);
      return;
    }
    queue
      .enqueue(
        () =>
          new Promise<void>((resolve) => {
            // Client gave up while queued: skip the work, free the slot.
            if (res.destroyed || req.destroyed) return resolve();
            res.once("close", resolve);
            handleMcp(req, res).catch((e) => {
              console.error(e);
              if (!res.headersSent) res.status(500).json({ error: "Internal error" });
              resolve();
            });
          }),
      )
      .catch((err) => {
        console.error(err);
        if (!res.headersSent) res.status(500).json({ error: "Internal error" });
      });
  });

  async function handleMcp(req: import("express").Request, res: import("express").Response) {
    // For GET/DELETE, look up existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // For POST without an existing session, create a new one
    if (req.method === "POST") {
      const server = createServer();
      registerTools(server);
      registerFetchMetaTool(server);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      // Store transport by session ID
      const sid = transport.sessionId;
      if (sid) {
        transports.set(sid, transport);
      }
      return;
    }

    res.status(400).json({ error: "No active session. Send a POST to /mcp to initialize." });
  }

  const httpServer = app.listen(port, () => {
    console.error(`fetch-mcp HTTP server listening on http://localhost:${port}/mcp`);
  });

  process.on("SIGINT", async () => {
    httpServer.close();
    for (const [sid, transport] of transports) {
      await transport.close();
      transports.delete(sid);
    }
    process.exit(0);
  });
}

if (transportType === "http") {
  startHttp().catch(console.error);
} else {
  startStdio().catch(console.error);
}

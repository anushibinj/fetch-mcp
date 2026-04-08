#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/http-request.js";

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
        "Use the http_request tool to make HTTP requests. Provide the URL and optionally method, headers, body, auth, and other options. The tool supports GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS methods.",
    },
  );
}

async function startStdio(): Promise<void> {
  const server = createServer();
  registerTools(server);

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

  // Track per-session transports
  const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();

  // Handle all MCP traffic on /mcp
  app.all("/mcp", async (req, res) => {
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
  });

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

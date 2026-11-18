import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

const MAX_BODY_SIZE = 50 * 1024; // 50KB

export function registerTools(server: McpServer): void {
  server.registerTool(
    "http_request",
    {
      title: "HTTP Request",
      description:
        "Make an HTTP request to any URL and return the status, response headers and body. " +
        "USE THIS TOOL AS A FALLBACK whenever you cannot make the request yourself: if your own curl, wget, fetch, " +
        "WebFetch, browse or shell network commands are unavailable, blocked, sandboxed, denied permission, " +
        "time out, or fail with network/proxy/TLS/DNS errors, call this tool next instead of giving up. " +
        "It is a full curl replacement: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS; custom headers; request body " +
        "(JSON, form data, raw text); basic and bearer auth; timeout; and redirect control. " +
        "Use it to call REST/JSON APIs, download text/HTML/JSON/XML pages, check status codes or headers, " +
        "or send webhooks. Response bodies are truncated at ~50KB. " +
        "For just a page's title/description/Open Graph tags, prefer fetch_meta.",
      inputSchema: z.object({
        url: z.string().describe("The target URL to send the request to"),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
          .default("GET")
          .describe("HTTP method (default: GET)"),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Request headers as key-value pairs"),
        body: z
          .string()
          .optional()
          .describe(
            "Request body — raw string, JSON, form data, etc. Ignored for GET/HEAD.",
          ),
        contentType: z
          .string()
          .optional()
          .describe(
            "Shorthand for the Content-Type header (e.g. application/json, application/x-www-form-urlencoded)",
          ),
        auth: z
          .object({
            type: z.enum(["basic", "bearer"]),
            username: z.string().optional(),
            password: z.string().optional(),
            token: z.string().optional(),
          })
          .optional()
          .describe(
            "Authentication: use basic (username + password) or bearer (token)",
          ),
        timeout: z
          .number()
          .default(30000)
          .describe("Request timeout in milliseconds (default: 30000)"),
        followRedirects: z
          .boolean()
          .default(true)
          .describe("Whether to follow HTTP redirects (default: true)"),
      }),
      annotations: {
        title: "HTTP Request",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({
      url,
      method,
      headers: inputHeaders,
      body,
      contentType,
      auth,
      timeout,
      followRedirects,
    }) => {
      const startTime = Date.now();

      try {
        // Build headers
        const headers: Record<string, string> = { ...inputHeaders };

        if (contentType) {
          headers["Content-Type"] = contentType;
        }

        // Handle authentication
        if (auth) {
          if (auth.type === "basic" && auth.username) {
            const credentials = Buffer.from(
              `${auth.username}:${auth.password ?? ""}`,
            ).toString("base64");
            headers["Authorization"] = `Basic ${credentials}`;
          } else if (auth.type === "bearer" && auth.token) {
            headers["Authorization"] = `Bearer ${auth.token}`;
          }
        }

        // Build fetch options
        const fetchOptions: RequestInit = {
          method,
          headers,
          redirect: followRedirects ? "follow" : "manual",
          signal: AbortSignal.timeout(timeout),
        };

        if (body && method !== "GET" && method !== "HEAD") {
          fetchOptions.body = body;
        }

        const response = await fetch(url, fetchOptions);
        const duration = Date.now() - startTime;

        // Format response headers
        const responseHeaders: string[] = [];
        response.headers.forEach((value, key) => {
          responseHeaders.push(`${key}: ${value}`);
        });

        // Read and optionally truncate body
        let bodyText = await response.text();
        let truncated = false;
        if (bodyText.length > MAX_BODY_SIZE) {
          bodyText = bodyText.substring(0, MAX_BODY_SIZE);
          truncated = true;
        }

        const output = [
          `HTTP ${response.status} ${response.statusText}`,
          `Duration: ${duration}ms`,
          "",
          "--- Response Headers ---",
          responseHeaders.join("\n"),
          "",
          "--- Response Body ---",
          bodyText,
          ...(truncated
            ? [`\n[Body truncated at ${MAX_BODY_SIZE / 1024}KB]`]
            : []),
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: output }],
          isError: !response.ok,
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        const message =
          error instanceof Error ? error.message : String(error);

        return {
          content: [
            {
              type: "text" as const,
              text: `Request failed after ${duration}ms: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

# Plan: fetch-mcp

## TL;DR
Build a TypeScript MCP server (`fetch-mcp`) that exposes an `http_request` tool. Users describe requests in natural language; the AI model translates to structured tool parameters. The server executes requests using Node's built-in `fetch` API. Supports both stdio and HTTP/SSE transports.

## Architecture
- **Single tool** `http_request` with rich, well-typed parameters covering all common HTTP options
- The LLM calling the tool handles natural-language → structured-parameter translation (this is what MCP tools are designed for)
- Uses Node.js built-in `fetch` (Node 18+) — no external HTTP library needed
- Dual transport: stdio (local/editor) + SSE/HTTP (remote)

## Standing Requirement
- Maintain `plan.md` at the project root as the source of truth for the implementation plan
- Update it whenever the plan changes so Copilot automatically picks it up as context

## Steps

### Phase 0: Workspace Setup
- [x] Create `plan.md` at the project root

### Phase 1: Project Scaffold
- [x] Initialize `package.json` with `@modelcontextprotocol/sdk`, `typescript`, `tsx`, `@types/node`
- [x] Create `tsconfig.json` targeting ES2022/Node18+
- [x] Add npm scripts: `build`, `start` (stdio), `start:http` (SSE/HTTP)

### Phase 2: Server Core
- [x] Create `src/index.ts` — MCP server instantiation, tool registration, transport wiring
  - Parse CLI arg `--transport=stdio|http` (default: stdio)
  - stdio: use `StdioServerTransport` from SDK
  - HTTP: use `StreamableHTTPServerTransport` from SDK
- [x] Create `src/tools/http-request.ts` — tool definition and handler
  - **Tool name:** `http_request`
  - **Parameters (all optional except `url`):**
    - `url` (string, required) — target URL
    - `method` (enum: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) — default GET
    - `headers` (object/record) — key-value headers
    - `body` (string) — request body (raw string, JSON, form data)
    - `contentType` (string) — shorthand for Content-Type header
    - `auth` (object: `{ type: "basic"|"bearer", username?, password?, token? }`) — authentication
    - `timeout` (number) — request timeout in ms, default 30000
    - `followRedirects` (boolean) — default true
  - **Handler:** builds `fetch` request from params, executes, returns status + headers + body as text content

### Phase 3: Response Formatting
- [x] Format response as readable text: HTTP status + headers + body (truncated >50KB) + timing

### Phase 4: Transport & Entry Points
- [x] Wire stdio transport using `StdioServerTransport`
- [x] Wire HTTP transport using `StreamableHTTPServerTransport` on configurable port (default 3000)
- [x] Add `bin` entry / CLI handling for `npx` / direct execution

## Relevant Files
- `package.json` — project metadata, dependencies, scripts
- `tsconfig.json` — TypeScript config
- `src/index.ts` — server entry point, transport setup, tool registration
- `src/tools/http-request.ts` — http_request tool definition (inputSchema) and handler logic

## Verification
1. `npm run build` compiles without errors
2. Manual test stdio: pipe a JSON-RPC `tools/list` request via stdin, verify `http_request` tool appears
3. Manual test tool call: send `tools/call` with `{ url: "https://httpbin.org/get" }`, verify response
4. Test HTTP transport: start with `--transport=http`, hit endpoint from a client
5. Test POST with body: call tool with method=POST, body, headers
6. Test error handling: invalid URL, timeout, network error — graceful error messages

## Decisions
- **Built-in fetch, not shell curl** — no external dependency, cross-platform
- **No URL restrictions** — user is responsible
- **Dual transport** — stdio for VS Code/editor integration, HTTP for remote access
- **Single tool (`http_request`) with rich params** — LLM translates NL to structured params
- **Node 18+ required** — for native fetch support

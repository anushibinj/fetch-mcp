# fetch-mcp

An MCP server that makes HTTP requests. Describe what you want in natural language — the AI translates it into the right method, headers, body, and auth parameters and executes it via Node's built-in `fetch`.

## Requirements

- Node.js 18+

## Installation

```bash
npm install
npm run build
```

## Usage

### stdio (local, for editors)

```bash
node dist/index.js
```

### HTTP / Streamable HTTP (remote)

```bash
node dist/index.js --transport=http
# optionally: --port=3000 (default)
```

The server listens at `http://localhost:3000/mcp`.

---

## Adding to an MCP client

### VS Code (GitHub Copilot)

**Per-workspace** — create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "fetch-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/fetch-mcp/dist/index.js"]
    }
  }
}
```

**Global** — add to User Settings (`Ctrl+Shift+P` → "Open User Settings JSON"):

```json
"mcp": {
  "servers": {
    "fetch-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/fetch-mcp/dist/index.js"]
    }
  }
}
```

### Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`):

```json
{
  "mcpServers": {
    "fetch-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/fetch-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop after saving.

---

## The `http_request` tool

The server exposes a single tool: **`http_request`**.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | ✅ | Target URL |
| `method` | string | | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` (default: `GET`) |
| `headers` | object | | Key-value request headers |
| `body` | string | | Request body — raw string, JSON, form data, etc. Ignored for GET/HEAD |
| `contentType` | string | | Shorthand for `Content-Type` header (e.g. `application/json`) |
| `auth` | object | | Authentication — see below |
| `timeout` | number | | Timeout in milliseconds (default: `30000`) |
| `followRedirects` | boolean | | Follow HTTP redirects (default: `true`) |

### `auth` object

```json
{ "type": "bearer", "token": "my-api-token" }
{ "type": "basic",  "username": "alice", "password": "secret" }
```

### Response format

The tool returns a plain-text block:

```
HTTP 200 OK
Duration: 312ms

--- Response Headers ---
content-type: application/json
...

--- Response Body ---
{ ... }
```

- Non-2xx responses are returned with `isError: true` so the model can self-correct
- Bodies larger than 50KB are automatically truncated

---

## Example prompts

Once connected to an MCP client, you can ask naturally:

- *"GET https://api.github.com/repos/nodejs/node"*
- *"POST to https://httpbin.org/post with JSON body `{"name": "test"}` and Content-Type application/json"*
- *"Fetch https://api.example.com/data with Bearer token abc123"*
- *"Send a DELETE request to https://api.example.com/items/42 with basic auth user:pass"*
- *"Hit https://httpbin.org/delay/2 with a 5 second timeout"*

## Development

```bash
npm run dev          # run with tsx (no build needed), stdio
npm run dev:http     # run with tsx, HTTP transport
npm run build        # compile TypeScript → dist/
npm start            # run compiled, stdio
npm run start:http   # run compiled, HTTP transport
```

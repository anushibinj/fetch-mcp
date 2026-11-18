# fetch-mcp

An MCP server that makes HTTP requests and fetches page metadata. Describe what you want in natural language — the AI translates it into the right method, headers, body, and auth parameters and executes it via Node's built-in `fetch`.

It provides two tools:

- **`http_request`** — make any HTTP request (all common methods, headers, body, auth, timeout, redirect control). A curl replacement.
- **`fetch_meta`** — fetch a page with an iPhone Safari user agent, follow redirects, and return its title, description, Open Graph / Twitter tags and all other meta tags

### Network fallback for agents

The tool descriptions tell an agent to reach for this server whenever its own `curl`, `wget`, `fetch`, WebFetch or browse tools are unavailable, blocked, denied, or failing (network, proxy, TLS or DNS errors), instead of giving up.

## Requirements

- Node.js 18+
- [pnpm](https://pnpm.io) (only for local development)

## Running from npm

No installation needed — run directly via `npx`:

```bash
npx -y @anushibinj/fetch-mcp
```

For HTTP / Streamable HTTP transport:

```bash
npx -y @anushibinj/fetch-mcp --transport=http
# optionally: --port=3000 (default)
```

The server listens at `http://localhost:3000/mcp`.

---

## Local Development

### Installation

```bash
pnpm install
pnpm build
```

### Usage

#### stdio

```bash
node dist/index.js
```

#### HTTP / Streamable HTTP (remote)

```bash
node dist/index.js --transport=http
# optionally: --port=3000 (default)
```

The server listens at `http://localhost:3000/mcp`.

---

## Running with Docker Compose

```bash
docker compose up --build
```

The server runs with the HTTP transport at `http://localhost:3000/mcp`. Set `PORT` to change the host port (e.g. `PORT=8080 docker compose up`).

## Adding to an MCP client

### VS Code (GitHub Copilot)

**Per-workspace** — create `.vscode/mcp.json` in your project:

Using npx (recommended):
```json
{
  "servers": {
    "fetch-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anushibinj/fetch-mcp"]
    }
  }
}
```

Using a local build:
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

Using npx (recommended):
```json
"mcp": {
  "servers": {
    "fetch-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anushibinj/fetch-mcp"]
    }
  }
}
```

Using a local build:
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

Using npx (recommended):
```json
{
  "mcpServers": {
    "fetch-mcp": {
      "command": "npx",
      "args": ["-y", "@anushibinj/fetch-mcp"]
    }
  }
}
```

Using a local build:
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

The server exposes two tools: **`http_request`** and **`fetch_meta`** (see [below](#the-fetch_meta-tool)).

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
- *"Get the Open Graph and Twitter card tags for https://github.com/nodejs/node"*
- *"What's the title and description of https://example.com?"*

## Development

```bash
pnpm dev            # run with tsx (no build needed), stdio
pnpm dev:http       # run with tsx, HTTP transport
pnpm build          # compile TypeScript → dist/
pnpm start          # run compiled, stdio
pnpm start:http     # run compiled, HTTP transport
```

---

## The `fetch_meta` tool

Fetches a page the way a phone browser would and returns all of its metadata.

- Sends an **iPhone Safari** user agent by default so most sites don't block the request
- Follows HTTP redirects **and** `<meta http-equiv="refresh">` redirects (up to 3 hops); the full chain is returned
- Returns the title, description, canonical URL, **every** `<meta>` tag (grouped into `openGraph` for `og:*`/`article:*`/`fb:*`, `twitter` for `twitter:*`, and `meta` for the rest), `<link>` tags (icons, canonical, alternate, manifest…) and JSON-LD blocks. Repeated tags (e.g. several `og:image`) become arrays.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | ✅ | Page URL |
| `userAgent` | string | | Override the default iPhone Safari user agent |
| `timeout` | number | | Timeout per hop in milliseconds (default: `20000`) |

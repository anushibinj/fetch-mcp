import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

// Mobile Safari on iPhone — most sites serve full HTML (with meta tags) to this.
export const SAFARI_IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const MAX_HTML_BYTES = 1024 * 1024; // only the <head> matters; cap download at 1MB
const MAX_META_REFRESH_HOPS = 3;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Parse the attributes of a single tag's inner text. Names are lower-cased. */
export function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue; // first occurrence wins, like browsers
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

type MetaEntry = { key: string; value: string };

export interface ExtractedMeta {
  title?: string;
  description?: string;
  canonical?: string;
  metaRefreshUrl?: string;
  openGraph: Record<string, string | string[]>;
  twitter: Record<string, string | string[]>;
  meta: Record<string, string | string[]>;
  links: { rel: string; href: string; type?: string; sizes?: string; title?: string }[];
  jsonLd: unknown[];
}

function add(target: Record<string, string | string[]>, key: string, value: string): void {
  const existing = target[key];
  if (existing === undefined) target[key] = value;
  else if (Array.isArray(existing)) existing.push(value);
  else target[key] = [existing, value];
}

export function extractMeta(html: string, baseUrl: string): ExtractedMeta {
  // Strip comments so commented-out tags are ignored; limit to <head> when present.
  let doc = html.replace(/<!--[\s\S]*?-->/g, "");
  const headEnd = doc.search(/<\/head\s*>/i);
  const head = headEnd !== -1 ? doc.slice(0, headEnd) : doc;

  const out: ExtractedMeta = {
    openGraph: {},
    twitter: {},
    meta: {},
    links: [],
    jsonLd: [],
  };

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
  if (titleMatch) out.title = decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim();

  const resolve = (href: string): string => {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return href;
    }
  };

  const entries: MetaEntry[] = [];
  for (const m of head.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1]);
    const key = (a.property ?? a.name ?? a["http-equiv"] ?? a.itemprop ?? "").trim();
    const value = a.content ?? a.value;
    if (!key || value === undefined) continue;
    entries.push({ key, value: value.trim() });
  }

  for (const { key, value } of entries) {
    const lower = key.toLowerCase();
    if (lower.startsWith("og:") || lower.startsWith("article:") || lower.startsWith("fb:")) {
      add(out.openGraph, lower, value);
    } else if (lower.startsWith("twitter:")) {
      add(out.twitter, lower, value);
    } else {
      add(out.meta, lower, value);
    }
    if (lower === "refresh") {
      const r = /url\s*=\s*['"]?([^'";]+)/i.exec(value);
      if (r) out.metaRefreshUrl = resolve(r[1].trim());
    }
  }

  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  out.description =
    first(out.meta["description"]) ??
    first(out.openGraph["og:description"]) ??
    first(out.twitter["twitter:description"]);

  for (const m of head.matchAll(/<link\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1]);
    if (!a.rel || !a.href) continue;
    const link = { rel: a.rel.toLowerCase(), href: resolve(a.href) } as ExtractedMeta["links"][number];
    if (a.type) link.type = a.type;
    if (a.sizes) link.sizes = a.sizes;
    if (a.title) link.title = a.title;
    out.links.push(link);
    if (link.rel.split(/\s+/).includes("canonical") && !out.canonical) out.canonical = link.href;
  }

  // JSON-LD can live in <head> or <body>; scan the whole document.
  for (const m of doc.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    try {
      out.jsonLd.push(JSON.parse(m[1].trim()));
    } catch {
      // ignore malformed JSON-LD
    }
  }

  return out;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const ct = response.headers.get("content-type") ?? "";
  const charset = /charset=["']?([\w-]+)/i.exec(ct)?.[1]?.toLowerCase();
  try {
    return new TextDecoder(charset ?? "utf-8").decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

export function registerFetchMetaTool(server: McpServer): void {
  server.registerTool(
    "fetch_meta",
    {
      title: "Fetch Page Metadata",
      description:
        "Fetch a web page like a browser (iPhone Safari user agent, follows HTTP redirects and <meta http-equiv=refresh> redirects) and return its metadata: title, description, canonical URL, ALL meta tags (grouped into Open Graph og:*, Twitter twitter:*, and other meta), <link> tags (icons, canonical, alternate, manifest, etc.) and JSON-LD structured data.",
      inputSchema: z.object({
        url: z.string().describe("The page URL to fetch metadata for"),
        userAgent: z
          .string()
          .optional()
          .describe("Override the default iPhone Safari user agent"),
        timeout: z
          .number()
          .default(20000)
          .describe("Request timeout in milliseconds per hop (default: 20000)"),
      }),
      annotations: {
        title: "Fetch Page Metadata",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, userAgent, timeout }) => {
      const startTime = Date.now();
      const headers = {
        "User-Agent": userAgent ?? SAFARI_IPHONE_UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      };

      try {
        const chain: string[] = [];
        let current = url;
        let response: Response | undefined;
        let extracted: ExtractedMeta | undefined;

        for (let hop = 0; hop <= MAX_META_REFRESH_HOPS; hop++) {
          chain.push(current);
          response = await fetch(current, {
            method: "GET",
            headers,
            redirect: "follow",
            signal: AbortSignal.timeout(timeout),
          });
          const finalUrl = response.url || current;
          if (finalUrl !== current) chain.push(finalUrl);

          const contentType = response.headers.get("content-type") ?? "";
          if (contentType && !/html|xml/i.test(contentType)) {
            await response.body?.cancel().catch(() => {});
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      url,
                      finalUrl,
                      status: response.status,
                      contentType,
                      note: "Response is not HTML; no meta tags to extract.",
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: !response.ok,
            };
          }

          const html = await readCapped(response, MAX_HTML_BYTES);
          extracted = extractMeta(html, finalUrl);
          current = finalUrl;

          // Follow <meta http-equiv="refresh"> client-side redirects.
          if (
            extracted.metaRefreshUrl &&
            extracted.metaRefreshUrl !== finalUrl &&
            !chain.includes(extracted.metaRefreshUrl) &&
            hop < MAX_META_REFRESH_HOPS
          ) {
            current = extracted.metaRefreshUrl;
            continue;
          }
          break;
        }

        const result = {
          url,
          finalUrl: current,
          redirectChain: chain.length > 1 ? chain : undefined,
          status: response!.status,
          durationMs: Date.now() - startTime,
          userAgent: headers["User-Agent"],
          title: extracted!.title,
          description: extracted!.description,
          canonical: extracted!.canonical,
          openGraph: extracted!.openGraph,
          twitter: extracted!.twitter,
          meta: extracted!.meta,
          links: extracted!.links,
          jsonLd: extracted!.jsonLd.length ? extracted!.jsonLd : undefined,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          isError: !response!.ok,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `fetch_meta failed after ${Date.now() - startTime}ms: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

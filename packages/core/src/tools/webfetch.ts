import { getOptionalStringField, readObject } from "./input.js";
import type { ToolRuntime } from "./types.js";

const defaultTimeoutMs = 30_000;
const maxTimeoutMs = 120_000;
const maxResponseBytes = 5 * 1024 * 1024;
const maxOutputBytes = 200_000;

export async function webfetchTool(input: unknown, runtime?: ToolRuntime): Promise<string> {
  const inputObject = readObject(input, ["url"], ["format", "timeout"]);
  const url = getOptionalStringField(inputObject, "url") ?? "";
  const format = getOptionalStringField(inputObject, "format") ?? "markdown";
  const timeoutMs = Math.min(readTimeoutMs(inputObject.timeout), maxTimeoutMs);

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("webfetch url must start with http:// or https://");
  }

  if (format !== "markdown" && format !== "text" && format !== "html") {
    throw new Error("webfetch format must be markdown, text, or html");
  }

  const response = await fetchWithTimeout(url, format, timeoutMs, runtime?.signal);
  const contentType = response.headers.get("content-type") ?? "unknown";
  const metadata = formatMetadata(response, contentType);

  if (isUnsupportedMedia(contentType)) {
    return [
      metadata,
      "",
      `Unsupported media response omitted. Use a browser or a dedicated media tool for ${contentType}.`,
    ].join("\n");
  }

  const text = await readLimitedResponse(response);
  const rendered = renderResponseBody(text, contentType, format);
  const truncated = truncateUtf8(rendered, maxOutputBytes);
  const truncation = truncated.truncated
    ? `\n[truncated ${truncated.omittedBytes} bytes from response body]`
    : "";

  return `${metadata}\n\n${truncated.text}${truncation}`.trim();
}

async function fetchWithTimeout(
  url: string,
  format: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: acceptHeader(format),
        "User-Agent": `magi/0.0.0 (${process.platform}; ${process.arch})`,
      },
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`webfetch timed out after ${timeoutMs / 1_000}s`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function readTimeoutMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value * 1_000;
  }

  return defaultTimeoutMs;
}

function acceptHeader(format: string): string {
  if (format === "html") return "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1";
  if (format === "text") return "text/plain,application/json;q=0.9,text/html;q=0.8,*/*;q=0.1";
  return "text/markdown,text/html;q=0.9,application/json;q=0.8,text/plain;q=0.8,*/*;q=0.1";
}

async function readLimitedResponse(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");

  if (contentLength && Number.parseInt(contentLength, 10) > maxResponseBytes) {
    throw new Error("webfetch response exceeds 5MB limit");
  }

  const text = await response.text();

  if (Buffer.byteLength(text, "utf8") > maxResponseBytes) {
    throw new Error("webfetch response exceeds 5MB limit");
  }

  return text;
}

function formatMetadata(response: Response, contentType: string): string {
  const lines = [
    `URL: ${response.url || "unknown"}`,
    `Status: ${response.status} ${response.statusText}`.trim(),
    `Content-Type: ${contentType}`,
  ];
  const contentLength = response.headers.get("content-length");

  return [...lines, ...(contentLength ? [`Content-Length: ${contentLength} bytes`] : [])].join(
    "\n",
  );
}

function isUnsupportedMedia(contentType: string): boolean {
  const normalized = contentType.toLowerCase();

  return (
    normalized.startsWith("image/") ||
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/") ||
    normalized.startsWith("font/") ||
    normalized.includes("application/octet-stream") ||
    normalized.includes("application/pdf")
  );
}

function renderResponseBody(text: string, contentType: string, format: string): string {
  const normalized = contentType.toLowerCase();

  if (format === "html") {
    return text;
  }

  if (normalized.includes("json")) {
    return formatJson(text);
  }

  if (normalized.includes("html") || looksLikeHtml(text)) {
    return htmlToText(text, format === "markdown");
  }

  return text.trim();
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text.trim();
  }
}

function looksLikeHtml(text: string): boolean {
  return /<\s*(?:!doctype\s+html|html|head|body|main|article|section|p|h[1-6])\b/i.test(text);
}

function truncateUtf8(
  value: string,
  maxBytes: number,
): { text: string; truncated: boolean; omittedBytes: number } {
  const totalBytes = Buffer.byteLength(value, "utf8");

  if (totalBytes <= maxBytes) {
    return { text: value, truncated: false, omittedBytes: 0 };
  }

  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    end += character.length;
  }

  return { text: value.slice(0, end), truncated: true, omittedBytes: totalBytes - bytes };
}

function htmlToText(value: string, markdown: boolean): string {
  const withoutScripts = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  const withMarkdown = markdown
    ? withoutScripts
        .replace(/<\s*h([1-6])\b[^>]*>([\s\S]*?)<\s*\/h\1\s*>/gi, (_, level, content) => {
          return `\n\n${"#".repeat(Number(level))} ${stripInlineHtml(content)}\n\n`;
        })
        .replace(
          /<\s*a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\s*\/a\s*>/gi,
          (_, href, content) => {
            return `[${stripInlineHtml(content)}](${decodeHtmlEntities(href)})`;
          },
        )
        .replace(/<\s*li\b[^>]*>([\s\S]*?)<\s*\/li\s*>/gi, (_, content) => {
          return `\n- ${stripInlineHtml(content)}`;
        })
    : withoutScripts;
  const withBreaks = withMarkdown
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*\/h([1-6])\s*>/gi, "\n\n");
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return markdown ? text : text.replace(/\n{2,}/g, "\n");
}

function stripInlineHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\n]+/g, " ")
      .trim(),
  );
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

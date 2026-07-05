import { getOptionalStringField, readObject } from "./input.js";

const defaultTimeoutMs = 30_000;
const maxTimeoutMs = 120_000;
const maxResponseBytes = 5 * 1024 * 1024;

export async function webfetchTool(input: unknown): Promise<string> {
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: acceptHeader(format),
        "User-Agent": `magi/0.0.0 (${process.platform}; ${process.arch})`,
      },
    });

    if (!response.ok) {
      throw new Error(`webfetch failed: ${response.status} ${response.statusText}`);
    }

    const text = await readLimitedResponse(response);

    if (format === "html") {
      return text;
    }

    return htmlToText(text, format === "markdown");
  } finally {
    clearTimeout(timeout);
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
  if (format === "text") return "text/plain,text/html;q=0.8,*/*;q=0.1";
  return "text/markdown,text/html;q=0.9,text/plain;q=0.8,*/*;q=0.1";
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

function htmlToText(value: string, markdown: boolean): string {
  const withoutScripts = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  const withBreaks = withoutScripts
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*\/h([1-6])\s*>/gi, "\n\n");
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return markdown ? text : text.replace(/\n{2,}/g, "\n");
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

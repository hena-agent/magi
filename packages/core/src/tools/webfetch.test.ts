import { afterEach, expect, it, vi } from "vitest";
import { webfetchTool } from "./webfetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("renders HTML as markdown with response metadata", async () => {
  stubFetch(
    response('<html><body><h1>Title</h1><p>Hello <a href="/docs">docs</a></p></body></html>', {
      contentType: "text/html; charset=utf-8",
      url: "https://example.com/page",
    }),
  );

  const output = await webfetchTool({ url: "https://example.com/page" });

  expect(output).toContain("URL: https://example.com/page");
  expect(output).toContain("Status: 200 OK");
  expect(output).toContain("Content-Type: text/html; charset=utf-8");
  expect(output).toContain("# Title");
  expect(output).toContain("Hello [docs](/docs)");
});

it("renders HTML as plain text when requested", async () => {
  stubFetch(response("<h1>Title</h1><p>First</p><p>Second</p>", { contentType: "text/html" }));

  const output = await webfetchTool({ url: "https://example.com", format: "text" });

  expect(output).toContain("Title");
  expect(output).toContain("First\nSecond");
  expect(output).not.toContain("# Title");
});

it("pretty-prints JSON responses", async () => {
  stubFetch(response('{"ok":true,"items":[1,2]}', { contentType: "application/json" }));

  const output = await webfetchTool({ url: "https://example.com/data" });

  expect(output).toContain('"ok": true');
  expect(output).toContain('"items": [');
});

it("omits unsupported media responses", async () => {
  stubFetch(response("binary", { contentType: "image/png", contentLength: "6" }));

  const output = await webfetchTool({ url: "https://example.com/image.png" });

  expect(output).toContain("Content-Type: image/png");
  expect(output).toContain("Content-Length: 6 bytes");
  expect(output).toContain("Unsupported media response omitted");
  expect(output).not.toContain("binary");
});

it("includes non-2xx responses as observations instead of throwing", async () => {
  stubFetch(
    response("not found", { contentType: "text/plain", status: 404, statusText: "Not Found" }),
  );

  const output = await webfetchTool({ url: "https://example.com/missing" });

  expect(output).toContain("Status: 404 Not Found");
  expect(output).toContain("not found");
});

it("truncates large rendered response bodies with metadata", async () => {
  stubFetch(response("a".repeat(200_010), { contentType: "text/plain" }));

  const output = await webfetchTool({ url: "https://example.com/large" });

  expect(output).toContain("[truncated 10 bytes from response body]");
  expect(output.length).toBeLessThan(200_200);
});

function stubFetch(responseValue: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => responseValue),
  );
}

function response(
  body: string,
  options: {
    contentType: string;
    url?: string;
    status?: number;
    statusText?: string;
    contentLength?: string;
  },
): Response {
  const value = new Response(body, {
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    headers: {
      "content-type": options.contentType,
      ...(options.contentLength === undefined ? {} : { "content-length": options.contentLength }),
    },
  });

  Object.defineProperty(value, "url", { value: options.url ?? "https://example.com" });

  return value;
}

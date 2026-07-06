import { dirname, relative } from "node:path";
import type { MessageConnection } from "vscode-jsonrpc/node";
import { toPosix } from "./path.js";

export type LspCallHierarchyDirection = "incoming" | "outgoing" | "both";

export async function formatCallHierarchy(
  input: {
    connection: MessageConnection;
    uri: string;
    position: { line: number; character: number };
    direction: LspCallHierarchyDirection;
  },
  withTimeout: <T>(promise: Promise<T>, label: string) => Promise<T>,
): Promise<string> {
  const items = await withTimeout(
    input.connection.sendRequest("textDocument/prepareCallHierarchy", {
      textDocument: { uri: input.uri },
      position: input.position,
    }),
    "prepare call hierarchy",
  );
  const hierarchyItems = Array.isArray(items) ? items : [];
  if (hierarchyItems.length === 0) {
    return "No call hierarchy items found.";
  }

  const sections = await Promise.all(
    hierarchyItems.map(async (item) => formatCallHierarchySection(input, item, withTimeout)),
  );

  return sections.join("\n\n");
}

export function formatSymbols(value: unknown): string {
  const symbols = Array.isArray(value) ? value : [];
  const lines = symbols.flatMap((symbol) => formatSymbol(symbol, 0));

  return lines.length === 0 ? "No document symbols found." : lines.join("\n");
}

export function formatLocations(value: unknown): string {
  const locations = Array.isArray(value) ? value : value ? [value] : [];
  const lines = locations.flatMap(formatLocation);

  return lines.length === 0 ? "No locations found." : lines.join("\n");
}

export function formatHover(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "No hover information found.";
  }

  const hover = value as Record<string, unknown>;
  return formatMarkup(hover.contents) || "No hover information found.";
}

async function formatCallHierarchySection(
  input: {
    connection: MessageConnection;
    direction: LspCallHierarchyDirection;
  },
  item: unknown,
  withTimeout: <T>(promise: Promise<T>, label: string) => Promise<T>,
): Promise<string> {
  const lines = [`Symbol: ${formatCallHierarchyItem(item)}`];

  if (input.direction === "incoming" || input.direction === "both") {
    lines.push(
      "Incoming:",
      formatIncomingCalls(
        await withTimeout(
          input.connection.sendRequest("callHierarchy/incomingCalls", { item }),
          "incoming call hierarchy",
        ),
      ),
    );
  }

  if (input.direction === "outgoing" || input.direction === "both") {
    lines.push(
      "Outgoing:",
      formatOutgoingCalls(
        await withTimeout(
          input.connection.sendRequest("callHierarchy/outgoingCalls", { item }),
          "outgoing call hierarchy",
        ),
      ),
    );
  }

  return lines.join("\n");
}

function formatIncomingCalls(value: unknown): string {
  const calls = Array.isArray(value) ? value : [];
  const lines = calls.flatMap((call) => {
    if (typeof call !== "object" || call === null || Array.isArray(call)) return [];
    const from = (call as Record<string, unknown>).from;
    return [`- ${formatCallHierarchyItem(from)}`];
  });

  return lines.length === 0 ? "No incoming calls found." : lines.join("\n");
}

function formatOutgoingCalls(value: unknown): string {
  const calls = Array.isArray(value) ? value : [];
  const lines = calls.flatMap((call) => {
    if (typeof call !== "object" || call === null || Array.isArray(call)) return [];
    const to = (call as Record<string, unknown>).to;
    return [`- ${formatCallHierarchyItem(to)}`];
  });

  return lines.length === 0 ? "No outgoing calls found." : lines.join("\n");
}

function formatCallHierarchyItem(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "(unknown)";

  const item = value as Record<string, unknown>;
  const name = typeof item.name === "string" ? item.name : "(anonymous)";
  const detail = typeof item.detail === "string" && item.detail.length > 0 ? ` ${item.detail}` : "";
  const uri = typeof item.uri === "string" ? formatUri(item.uri) : undefined;
  const range = readRange(item.selectionRange ?? item.range);
  const location = uri ? ` @ ${uri}${range ? `:${range}` : ""}` : "";

  return `${name}${detail}${location}`;
}

function formatSymbol(value: unknown, depth: number): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];

  const symbol = value as Record<string, unknown>;
  const name = typeof symbol.name === "string" ? symbol.name : "(anonymous)";
  const detail =
    typeof symbol.detail === "string" && symbol.detail.length > 0 ? ` ${symbol.detail}` : "";
  const range = readRange(symbol.selectionRange ?? symbol.range);
  const children = Array.isArray(symbol.children) ? symbol.children : [];

  return [
    `${"  ".repeat(depth)}- ${name}${detail}${range ? ` @ ${range}` : ""}`,
    ...children.flatMap((child) => formatSymbol(child, depth + 1)),
  ];
}

function formatLocation(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];

  const location = value as Record<string, unknown>;
  const uri = typeof location.uri === "string" ? location.uri : undefined;
  const range = readRange(location.range);

  if (!uri) return [];

  return [`${formatUri(uri)}${range ? `:${range}` : ""}`];
}

function formatMarkup(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(formatMarkup).filter(Boolean).join("\n\n");
  if (typeof value !== "object" || value === null) return "";

  const record = value as Record<string, unknown>;
  if (typeof record.value === "string") return record.value.trim();

  return "";
}

function readRange(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

  const start = (value as Record<string, unknown>).start;
  if (typeof start !== "object" || start === null || Array.isArray(start)) return undefined;

  const position = start as Record<string, unknown>;
  return typeof position.line === "number" && typeof position.character === "number"
    ? `${position.line + 1}:${position.character + 1}`
    : undefined;
}

function formatUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri;

  const filePath = new URL(uri).pathname;
  const relativePath = relative(process.cwd(), filePath);

  return toPosix(relativePath.startsWith("..") ? filePath : relativePath || dirname("/"));
}

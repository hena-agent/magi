import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import { getNumberField, getStringField, readObject } from "./input.js";
import { resolveWorkspacePath, toPosix } from "./path.js";
import type { ToolRuntime } from "./types.js";

export type LspToolName = "lsp_symbols" | "lsp_definition" | "lsp_references" | "lsp_hover";

type LspClient = {
  connection: MessageConnection;
  process: ReturnType<typeof spawn>;
};

const require = createRequire(import.meta.url);
const defaultTimeoutMs = 10_000;

export async function lspTool(
  toolName: LspToolName,
  input: unknown,
  runtime: ToolRuntime,
): Promise<string> {
  const inputObject = readLspInput(toolName, input);
  const filePath = resolveWorkspacePath(runtime.workspaceRoot, inputObject.filePath);
  const uri = pathToFileURL(filePath).toString();
  const text = readFileSync(filePath, "utf8");
  const client = startTypescriptLanguageServer(runtime.workspaceRoot);

  try {
    await withTimeout(initializeLsp(client.connection, runtime.workspaceRoot), "initialize LSP");
    client.connection.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: languageIdForFile(filePath), version: 1, text },
    });

    switch (toolName) {
      case "lsp_symbols":
        return formatSymbols(
          await withTimeout(
            client.connection.sendRequest("textDocument/documentSymbol", {
              textDocument: { uri },
            }),
            "document symbols",
          ),
        );
      case "lsp_definition":
        return formatLocations(
          await withTimeout(
            client.connection.sendRequest("textDocument/definition", {
              textDocument: { uri },
              position: toLspPosition(inputObject),
            }),
            "definition",
          ),
        );
      case "lsp_references":
        return formatLocations(
          await withTimeout(
            client.connection.sendRequest("textDocument/references", {
              textDocument: { uri },
              position: toLspPosition(inputObject),
              context: { includeDeclaration: true },
            }),
            "references",
          ),
        );
      case "lsp_hover":
        return formatHover(
          await withTimeout(
            client.connection.sendRequest("textDocument/hover", {
              textDocument: { uri },
              position: toLspPosition(inputObject),
            }),
            "hover",
          ),
        );
    }
  } finally {
    await stopTypescriptLanguageServer(client);
  }
}

function readLspInput(
  toolName: LspToolName,
  input: unknown,
): { filePath: string; line?: number; character?: number } {
  const inputObject = readObject(
    input,
    toolName === "lsp_symbols" ? ["filePath"] : ["filePath", "line", "character"],
  );
  const filePath = getStringField(inputObject, "filePath");

  if (toolName === "lsp_symbols") {
    return { filePath };
  }

  const line = getNumberField(inputObject, "line");
  const character = getNumberField(inputObject, "character");

  if (!Number.isInteger(line) || line < 1) {
    throw new Error("LSP line must be a positive 1-based integer.");
  }

  if (!Number.isInteger(character) || character < 1) {
    throw new Error("LSP character must be a positive 1-based integer.");
  }

  return { filePath, line, character };
}

function startTypescriptLanguageServer(workspaceRoot: string): LspClient {
  const serverPath = require.resolve("typescript-language-server/lib/cli.mjs");
  const childProcess = spawn(process.execPath, [serverPath, "--stdio"], {
    cwd: workspaceRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const connection = createMessageConnection(
    new StreamMessageReader(childProcess.stdout),
    new StreamMessageWriter(childProcess.stdin),
  );

  connection.listen();

  return { connection, process: childProcess };
}

async function initializeLsp(connection: MessageConnection, workspaceRoot: string): Promise<void> {
  const rootUri = pathToFileURL(`${workspaceRoot}/`).toString();

  await connection.sendRequest("initialize", {
    processId: process.pid,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: "workspace" }],
    capabilities: {
      textDocument: {
        definition: { dynamicRegistration: false },
        documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
        hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
        references: { dynamicRegistration: false },
      },
    },
  });
  connection.sendNotification("initialized", {});
}

async function stopTypescriptLanguageServer(client: LspClient): Promise<void> {
  try {
    await Promise.race([
      client.connection.sendRequest("shutdown"),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
    client.connection.sendNotification("exit");
  } finally {
    client.connection.dispose();
    if (!client.process.killed) {
      client.process.kill();
    }
  }
}

function toLspPosition(input: { line?: number; character?: number }): {
  line: number;
  character: number;
} {
  return { line: (input.line ?? 1) - 1, character: (input.character ?? 1) - 1 };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`LSP request timed out: ${label}`)),
          defaultTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function languageIdForFile(filePath: string): string {
  if (filePath.endsWith(".tsx")) return "typescriptreact";
  if (filePath.endsWith(".jsx")) return "javascriptreact";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
    return "javascript";
  }

  return "typescript";
}

function formatSymbols(value: unknown): string {
  const symbols = Array.isArray(value) ? value : [];
  const lines = symbols.flatMap((symbol) => formatSymbol(symbol, 0));

  return lines.length === 0 ? "No document symbols found." : lines.join("\n");
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

function formatLocations(value: unknown): string {
  const locations = Array.isArray(value) ? value : value ? [value] : [];
  const lines = locations.flatMap(formatLocation);

  return lines.length === 0 ? "No locations found." : lines.join("\n");
}

function formatLocation(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];

  const location = value as Record<string, unknown>;
  const uri = typeof location.uri === "string" ? location.uri : undefined;
  const range = readRange(location.range);

  if (!uri) return [];

  return [`${formatUri(uri)}${range ? `:${range}` : ""}`];
}

function formatHover(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "No hover information found.";
  }

  const hover = value as Record<string, unknown>;
  const contents = hover.contents;

  return formatMarkup(contents) || "No hover information found.";
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

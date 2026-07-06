import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import {
  formatCallHierarchy,
  formatHover,
  formatLocations,
  formatSymbols,
  type LspCallHierarchyDirection,
} from "./lsp-format.js";
import { getNumberField, getStringField, readObject } from "./input.js";
import { resolveWorkspacePath } from "./path.js";
import type { ToolRuntime } from "./types.js";

export type LspToolName =
  | "lsp_symbols"
  | "lsp_definition"
  | "lsp_references"
  | "lsp_hover"
  | "lsp_call_hierarchy";

type LspClient = {
  connection: MessageConnection;
  process: ReturnType<typeof spawn>;
};

type LspInput = {
  filePath: string;
  line?: number;
  character?: number;
  direction?: LspCallHierarchyDirection;
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

    return await executeLspRequest(toolName, client.connection, uri, inputObject);
  } finally {
    await stopTypescriptLanguageServer(client);
  }
}

async function executeLspRequest(
  toolName: LspToolName,
  connection: MessageConnection,
  uri: string,
  input: LspInput,
): Promise<string> {
  switch (toolName) {
    case "lsp_symbols":
      return formatSymbols(
        await withTimeout(
          connection.sendRequest("textDocument/documentSymbol", { textDocument: { uri } }),
          "document symbols",
        ),
      );
    case "lsp_definition":
      return formatLocations(
        await withTimeout(
          connection.sendRequest("textDocument/definition", {
            textDocument: { uri },
            position: toLspPosition(input),
          }),
          "definition",
        ),
      );
    case "lsp_references":
      return formatLocations(
        await withTimeout(
          connection.sendRequest("textDocument/references", {
            textDocument: { uri },
            position: toLspPosition(input),
            context: { includeDeclaration: true },
          }),
          "references",
        ),
      );
    case "lsp_hover":
      return formatHover(
        await withTimeout(
          connection.sendRequest("textDocument/hover", {
            textDocument: { uri },
            position: toLspPosition(input),
          }),
          "hover",
        ),
      );
    case "lsp_call_hierarchy":
      return await formatCallHierarchy(
        { connection, uri, position: toLspPosition(input), direction: input.direction ?? "both" },
        withTimeout,
      );
  }
}

function readLspInput(toolName: LspToolName, input: unknown): LspInput {
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
  const direction = readOptionalCallHierarchyDirection(inputObject);

  if (!Number.isInteger(line) || line < 1) {
    throw new Error("LSP line must be a positive 1-based integer.");
  }

  if (!Number.isInteger(character) || character < 1) {
    throw new Error("LSP character must be a positive 1-based integer.");
  }

  return { filePath, line, character, ...(direction === undefined ? {} : { direction }) };
}

function readOptionalCallHierarchyDirection(
  input: Record<string, unknown>,
): LspCallHierarchyDirection | undefined {
  const direction = input.direction;
  if (direction === undefined) return undefined;
  if (direction === "incoming" || direction === "outgoing" || direction === "both") {
    return direction;
  }

  throw new Error("LSP call hierarchy direction must be incoming, outgoing, or both.");
}

function startTypescriptLanguageServer(workspaceRoot: string): LspClient {
  const serverPath = require.resolve("typescript-language-server/lib/cli.mjs");
  const childProcess = spawn(process.execPath, [serverPath, "--stdio"], {
    cwd: workspaceRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  childProcess.stdin.on("error", () => undefined);
  childProcess.stdout.on("error", () => undefined);
  childProcess.stderr.on("error", () => undefined);
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
        callHierarchy: { dynamicRegistration: false },
      },
    },
  });
  connection.sendNotification("initialized", {});
}

async function stopTypescriptLanguageServer(client: LspClient): Promise<void> {
  try {
    const shutdown = client.connection.sendRequest("shutdown").catch(() => undefined);
    await Promise.race([shutdown, new Promise((resolve) => setTimeout(resolve, 500))]);
    await Promise.resolve(client.connection.sendNotification("exit")).catch(() => undefined);
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

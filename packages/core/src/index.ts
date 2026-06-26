import { createOpenAI } from "@ai-sdk/openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { LanguageModel } from "ai";

export { createSessionStore } from "./session.js";
export { createPrimaryModelAdapter } from "./model.js";
export { createToolCall, getToolPermission, runTool } from "./tools.js";
export { summarizeWorkspace } from "./summary.js";
export type { PrimaryModelAdapter } from "./model.js";
export type { Session, SessionEvent, SessionEventType, SessionStore } from "./session.js";
export type { ChangeSummary } from "./summary.js";
export type { ToolCall, ToolName, ToolPermission, ToolResult } from "./tools.js";

export type Task = {
  id: string;
  userRequirement: string;
  mode: "normal" | "magi";
  riskLevel: "low" | "medium" | "high";
  status: "active" | "blocked" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
};

export type OpenAIModelConfig = {
  model: string;
  apiKey?: string;
  baseUrl?: string;
};

export type McpClientConfig = {
  name: string;
  version: string;
};

export function createTask(userRequirement: string): Task {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    userRequirement,
    mode: "normal",
    riskLevel: "low",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createOpenAIModel(config: OpenAIModelConfig): LanguageModel {
  const provider = createOpenAI({
    ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
    ...(config.baseUrl === undefined ? {} : { baseURL: config.baseUrl }),
  });

  return provider(config.model);
}

export function createMcpClient(config: McpClientConfig): Client {
  return new Client({
    name: config.name,
    version: config.version,
  });
}

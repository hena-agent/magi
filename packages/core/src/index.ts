import { createOpenAI } from "@ai-sdk/openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { LanguageModel } from "ai";

export type { AgentAction, ExecutableAgentAction } from "./agent/actions.js";
export { agentActionToToolName, validateAgentAction } from "./agent/actions.js";
export type { CompactSessionContextResult } from "./agent/context-compaction.js";
export { compactSessionContext } from "./agent/context-compaction.js";
export { parseJsonObjectFromText } from "./agent/json.js";
export {
  MAGI_BUILD_PROMPT,
  MAGI_BUILD_SWITCH_REMINDER,
  MAGI_COMPACTION_PROMPT,
  MAGI_EXPLORE_PROMPT,
  MAGI_PLAN_MODE_PROMPT,
  MAGI_PLAN_REMINDER,
  MAGI_SUMMARY_PROMPT,
  MAGI_TITLE_PROMPT,
} from "./agent/prompts.js";
export type {
  AgentInfo,
  AgentMode,
  AgentPermissionConfig,
  AgentPermissionPolicy,
} from "./agent/registry.js";
export {
  builtinAgents,
  getAgent,
  getDefaultAgent,
  listAgents,
  listPrimaryAgents,
  mergeAgentPermission,
} from "./agent/registry.js";
export type {
  AgentRunContinuation,
  AgentRunContinuationReason,
  AgentRunEvent,
  AgentRunResult,
  AgentRunStep,
} from "./agent/runner.js";
export { getAgentRunContinuation, runEventDrivenAgent } from "./agent/runner.js";
export { buildAgentSessionContext, buildAgentSystemContext } from "./agent/session-context.js";
export type { AgentTurnEvent, AgentTurnResult, AgentTurnStep } from "./agent/turn.js";
export { runAgentTurn } from "./agent/turn.js";
export type { ApiAuth, AuthInfo, AuthStore, OAuthAuth, WellKnownAuth } from "./auth.js";
export {
  getAuth,
  getAuthFilePath,
  isOAuthAuth,
  loadAuthStore,
  OAUTH_DUMMY_KEY,
  removeAuth,
  setAuth,
} from "./auth.js";
export * from "./magi/index.js";
export type {
  ModelMessage,
  ModelStepResponse,
  ModelToolDefinition,
  PrimaryModelAdapter,
  SelectedModelProvider,
} from "./model.js";
export { createPrimaryModelAdapter } from "./model.js";
export type {
  EffectiveModelProvider,
  ModelProviderAuthConfig,
  ModelProviderSettings,
} from "./model-catalog.js";
export { builtinModelProviders, listEffectiveModelProviders } from "./model-catalog.js";
export type { ModelProviderSummary, ModelSelection } from "./model-selection.js";
export {
  getDefaultModelSelection,
  getEffectiveModelProviderSummaries,
  getLatestModelSelection,
  getModelProvider,
} from "./model-selection.js";
export type { ModelsDevCatalog, ModelsDevModel, ModelsDevProvider } from "./models-dev.js";
export { getModelsDevCachePath, loadModelsDevCatalog } from "./models-dev.js";
export {
  createOpenAICodexOAuthFetch,
  isOpenAICodexOAuthModel,
  loginOpenAICodexBrowser,
  loginOpenAICodexHeadless,
  OPENAI_CODEX_API_ENDPOINT,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_ISSUER,
  OPENAI_CODEX_OAUTH_PORT,
  refreshOpenAICodexAuth,
} from "./openai-codex-oauth.js";
export type { RevisionContext } from "./revision-context.js";
export {
  buildRevisionContext,
  extractFirstDiffBlock,
  getLatestProposedPatch,
} from "./revision-context.js";
export type { Session, SessionEvent, SessionEventType, SessionStore } from "./session.js";
export { createSessionStore } from "./session.js";
export type { SessionMaintenancePlan } from "./session-maintenance.js";
export { planSessionMaintenance } from "./session-maintenance.js";
export type { ChangeSummary } from "./summary.js";
export { summarizeWorkspace } from "./summary.js";
export type {
  ToolCall,
  ToolName,
  ToolPermission,
  ToolResult,
  ToolSettlement,
  ToolSettlementStatus,
} from "./tools.js";
export { createToolCall, createToolSettlement, getToolPermission, runTool } from "./tools.js";
export type { VerificationFailure, VerificationFailureContext } from "./verification-context.js";
export { getLatestVerificationFailures, truncateTail } from "./verification-context.js";

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

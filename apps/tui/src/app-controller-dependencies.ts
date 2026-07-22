import { type LoadConfigOptions, loadConfig, type MagiConfig } from "@magi/config";
import {
  createPrimaryModelAdapter,
  createSessionStore,
  type PrimaryModelAdapter,
  runTool,
  type SessionStore,
  type ToolCall,
  type ToolResult,
} from "@magi/core";

export type AppControllerDependencies = {
  loadConfig: (options?: LoadConfigOptions) => MagiConfig;
  createSessionStore: (input: {
    workspaceRoot: string;
    project?: string;
    directory?: string;
  }) => SessionStore;
  createPrimaryModelAdapter: (
    input: Parameters<typeof createPrimaryModelAdapter>[0],
  ) => PrimaryModelAdapter;
  runTool: (
    call: ToolCall,
    runtime: { workspaceRoot: string; signal?: AbortSignal },
  ) => Promise<ToolResult>;
};

export const defaultAppControllerDependencies: AppControllerDependencies = {
  loadConfig,
  createSessionStore,
  createPrimaryModelAdapter,
  runTool,
};

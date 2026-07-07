import { MAGI_PLAN_REMINDER } from "./prompts.js";
import type { AgentInfo } from "./registry.js";
import { getEditToolMode } from "./runner-native-tools.js";
import { truncateObservation } from "./runner-utils.js";

export const agentTurnSystemPrompt = [
  "You are MAGI running one local coding-agent turn.",
  "Respond only with JSON. Do not wrap the JSON in prose.",
  "Use the smallest useful action. Prefer read/glob/grep before proposing changes.",
  "If you have enough information, use finish or answer.",
  "Do not repeat the same action. If an action result is already available, use it or choose a different action.",
  "For models using apply_patch, provide an OpenCode-style *** Begin Patch envelope in patchText.",
  "For models using edit/write, use exact oldString/newString replacements or full file writes.",
].join("\n");

export const nativeToolSystemPrompt = [
  "Use the tools available to assist the user.",
  "Prefer specialized tools over shell for file operations.",
  "Use Glob to find files by name and Grep to search file contents.",
  "Use Read when you know the specific file path you need to inspect.",
  "Run independent tool calls in parallel when neither call needs the other's output.",
  "For local code questions, inspect directly with focused search/read before delegating to a subagent.",
  "Do not repeat substantially similar searches; if a search found a likely file or function, read it or answer from it.",
  "When you have enough information, respond concisely with the concrete finding or next plan.",
].join("\n");

export const maxStepsPrompt = [
  "CRITICAL - MAXIMUM STEPS REACHED",
  "This is the final text-only step.",
  "The maximum number of steps allowed for this task has been reached. Tools are disabled until next user input.",
  "Do NOT make tool calls. Respond with text only using the observations already available.",
  "Include what was accomplished, what remains, and what should happen next.",
].join("\n");

export function formatAgentTurnPrompt(input: {
  agent: AgentInfo;
  userMessage: string;
  model?: string;
  sessionContext?: string;
  systemContext?: string[];
  observations: string[];
  iteration: number;
  maxIterations: number;
  isLastStep: boolean;
}): string {
  return [
    `User request: ${input.userMessage}`,
    "",
    "Prior session context:",
    input.sessionContext === undefined || input.sessionContext.length === 0
      ? "(none)"
      : input.sessionContext,
    `Iteration: ${input.iteration}/${input.maxIterations}`,
    input.isLastStep
      ? "This is the final step. Tools/actions are disabled. You must respond with answer or finish only."
      : "Choose one available action.",
    "",
    "Available JSON actions:",
    JSON.stringify(getAvailableActions(input), null, 2),
    "",
    "Observations so far:",
    input.observations.length === 0 ? "(none)" : input.observations.join("\n\n"),
  ].join("\n");
}

export function buildAgentSystemPrompt(
  agent: AgentInfo,
  isLastStep: boolean,
  protocolPrompt = agentTurnSystemPrompt,
  systemContext: string[] = [],
): string {
  return [
    agent.prompt,
    agent.id === "plan" ? MAGI_PLAN_REMINDER : undefined,
    ...systemContext,
    protocolPrompt,
    isLastStep ? maxStepsPrompt : undefined,
  ]
    .filter((part) => part !== undefined && part.length > 0)
    .join("\n\n");
}

export function formatNativeToolPrompt(input: {
  agent: AgentInfo;
  userMessage: string;
  sessionContext?: string;
  observations: string[];
  iteration: number;
  maxIterations: number;
}): string {
  return [
    `User request: ${input.userMessage}`,
    "",
    "Prior session context:",
    input.sessionContext === undefined || input.sessionContext.length === 0
      ? "(none)"
      : input.sessionContext,
    `Iteration: ${input.iteration}/${input.maxIterations}`,
    "Observations so far:",
    input.observations.length === 0 ? "(none)" : input.observations.join("\n\n"),
  ].join("\n");
}

export function summarizeStoppedTurn(observations: string[]): string {
  if (observations.length === 0) {
    return "Agent reached the step limit before gathering observations. Try a narrower request or increase agent.maxIterations.";
  }

  return [
    "Agent reached the configured step limit before producing a final response.",
    "Useful observations gathered so far:",
    truncateObservation(observations.slice(-5).join("\n\n")),
    "Increase agent.maxIterations or ask a narrower follow-up if more work is needed.",
  ].join("\n\n");
}

function getAvailableActions(input: { agent: AgentInfo; model?: string; isLastStep: boolean }) {
  if (input.isLastStep) {
    return [
      { type: "answer", content: "Final answer using observations gathered so far." },
      { type: "finish", summary: "Final concise result using observations gathered so far." },
    ];
  }

  return [
    { type: "answer", content: "Direct answer for simple questions." },
    ...getExecutableActions(input.agent, input.model),
    { type: "finish", summary: "final concise result" },
  ];
}

function getExecutableActions(agent: AgentInfo, model: string | undefined) {
  return [
    { type: "read", path: "relative/path" },
    { type: "glob", pattern: "**/*.ts" },
    { type: "grep", pattern: "search regex", include: "optional glob" },
    {
      type: "todowrite",
      todos: [{ content: "specific task", status: "in_progress", priority: "high" }],
    },
    {
      type: "question",
      questions: [
        {
          question: "Clarifying question for the user",
          header: "Decision",
          options: [{ label: "Option", description: "What this means" }],
        },
      ],
    },
    { type: "skill", name: "skill-name" },
    { type: "lsp_symbols", filePath: "src/file.ts" },
    { type: "lsp_definition", filePath: "src/file.ts", line: 1, character: 1 },
    { type: "lsp_references", filePath: "src/file.ts", line: 1, character: 1 },
    { type: "lsp_hover", filePath: "src/file.ts", line: 1, character: 1 },
    {
      type: "lsp_call_hierarchy",
      filePath: "src/file.ts",
      line: 1,
      character: 1,
      direction: "both",
    },
    ...(agent.id === "plan"
      ? []
      : [
          {
            type: "task",
            description: "short task description",
            prompt: "Detailed instructions for the subagent",
            subagent_type: "general",
            background: false,
          },
        ]),
    ...(agent.id === "plan"
      ? [
          {
            type: "write",
            filePath: ".magi/plans/<session-id>.md",
            content: "final implementation plan",
          },
          {
            type: "edit",
            filePath: ".magi/plans/<session-id>.md",
            oldString: "exact text to replace",
            newString: "replacement text",
            replaceAll: false,
          },
          { type: "plan_exit" },
        ]
      : []),
    ...(agent.permission.network === "deny"
      ? []
      : [
          { type: "webfetch", url: "https://example.com", format: "markdown" },
          { type: "websearch", query: "current information to research", providerId: "exa" },
        ]),
    ...(agent.permission.shell === "deny"
      ? []
      : [{ type: "verify", command: "optional focused command" }]),
    ...(agent.permission.write === "deny"
      ? []
      : [
          ...getWriteActions(agent, model),
          { type: "propose_patch", summary: "what changes", patch: "unified diff" },
        ]),
  ];
}

function getWriteActions(agent: AgentInfo, model: string | undefined) {
  return getEditToolMode(agent, model) === "patch"
    ? [
        {
          type: "apply_patch",
          patchText: "*** Begin Patch\n*** Update File: path\n@@\n-old\n+new\n*** End Patch",
        },
      ]
    : [
        {
          type: "edit",
          filePath: "relative/path",
          oldString: "exact text to replace",
          newString: "replacement text",
          replaceAll: false,
        },
        { type: "write", filePath: "relative/path", content: "full file content" },
      ];
}

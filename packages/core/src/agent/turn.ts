import type { PrimaryModelAdapter } from "../model.js";
import { type AgentAction, type ExecutableAgentAction, validateAgentAction } from "./actions.js";
import { parseJsonObjectFromText } from "./json.js";

export type AgentTurnStep = {
  action: AgentAction;
  observation?: string;
};

export type AgentTurnResult = {
  status: "completed" | "max_iterations";
  finalText: string;
  steps: AgentTurnStep[];
};

export async function runAgentTurn(input: {
  engine: PrimaryModelAdapter;
  userMessage: string;
  sessionContext?: string;
  executeAction: (action: ExecutableAgentAction) => Promise<string>;
  maxIterations?: number;
}): Promise<AgentTurnResult> {
  const maxIterations = input.maxIterations ?? 30;
  const steps: AgentTurnStep[] = [];
  const observations: string[] = [];
  const actionCounts = new Map<string, number>();

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const isLastStep = iteration >= maxIterations;
    const response = await input.engine.generateText({
      system: agentTurnSystemPrompt,
      prompt: formatAgentTurnPrompt({
        userMessage: input.userMessage,
        sessionContext: input.sessionContext,
        observations,
        iteration,
        maxIterations,
        isLastStep,
      }),
    });
    const action = validateAgentAction(parseJsonObjectFromText(response.text));

    if (action.type === "answer") {
      steps.push({ action });
      return { status: "completed", finalText: action.content, steps };
    }

    if (action.type === "finish") {
      steps.push({ action });
      return { status: "completed", finalText: action.summary, steps };
    }

    if (isLastStep) {
      const observation =
        "Maximum agent steps reached. Tools are disabled on the final step; provide a final answer instead.";
      steps.push({ action, observation });
      observations.push(formatObservation(action, observation));

      return {
        status: "max_iterations",
        finalText: summarizeStoppedTurn(observations),
        steps,
      };
    }

    const actionKey = getActionKey(action);
    const actionCount = actionCounts.get(actionKey) ?? 0;
    actionCounts.set(actionKey, actionCount + 1);

    if (actionCount > 0) {
      const observation =
        "Repeated action skipped. Do not repeat actions that already ran; choose a different action or finish with the available observations.";
      steps.push({ action, observation });
      observations.push(formatObservation(action, observation));
      continue;
    }

    const observation = await input.executeAction(action);
    steps.push({ action, observation });
    observations.push(formatObservation(action, observation));
  }

  return {
    status: "max_iterations",
    finalText: summarizeStoppedTurn(observations),
    steps,
  };
}

const agentTurnSystemPrompt = [
  "You are MAGI running one local coding-agent turn.",
  "Respond only with JSON. Do not wrap the JSON in prose.",
  "Use the smallest useful action. Prefer read/glob/grep before proposing changes.",
  "If you have enough information, use finish or answer.",
  "Do not repeat the same action. If an action result is already available, use it or choose a different action.",
  "If you propose a patch, provide a git-apply-compatible unified diff in the patch field.",
].join("\n");

function formatAgentTurnPrompt(input: {
  userMessage: string;
  sessionContext?: string;
  observations: string[];
  iteration: number;
  maxIterations: number;
  isLastStep: boolean;
}): string {
  const availableActions = input.isLastStep
    ? [
        { type: "answer", content: "Final answer using observations gathered so far." },
        { type: "finish", summary: "Final concise result using observations gathered so far." },
      ]
    : [
        { type: "answer", content: "Direct answer for simple questions." },
        { type: "read", path: "relative/path" },
        { type: "glob", pattern: "**/*.ts" },
        { type: "grep", pattern: "search regex", include: "optional glob" },
        { type: "verify", command: "optional focused command" },
        { type: "propose_patch", summary: "what changes", patch: "unified diff" },
        { type: "finish", summary: "final concise result" },
      ];

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
    JSON.stringify(availableActions, null, 2),
    "",
    "Observations so far:",
    input.observations.length === 0 ? "(none)" : input.observations.join("\n\n"),
  ].join("\n");
}

function formatObservation(action: ExecutableAgentAction, observation: string): string {
  return [`Action: ${action.type}`, "Observation:", truncateObservation(observation)].join("\n");
}

function truncateObservation(value: string): string {
  return value.length > 6_000
    ? `[truncated ${value.length - 6_000} chars]\n${value.slice(-6_000)}`
    : value;
}

function getActionKey(action: ExecutableAgentAction): string {
  switch (action.type) {
    case "read":
      return `read:${action.path}`;
    case "glob":
      return `glob:${action.pattern}`;
    case "grep":
      return `grep:${action.pattern}:${action.include ?? ""}`;
    case "verify":
      return `verify:${action.command ?? ""}`;
    case "propose_patch":
      return `propose_patch:${action.patch}`;
  }
}

function summarizeStoppedTurn(observations: string[]): string {
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

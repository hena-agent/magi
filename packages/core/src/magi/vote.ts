import type { SharedContextHistory } from "./shared-context.js";

export type VoteDecision = "APPROVE" | "REJECT";

export type VoteResponse = {
  engineId: string;
  decision: VoteDecision;
  confidence: number;
  riskScore: number;
  efficiencyScore: number;
  justification: string;
};

export function validateVoteResponse(value: unknown): VoteResponse {
  if (!isObject(value)) {
    throw new Error("Vote response must be an object.");
  }

  const engineId = readNonEmptyString(value, "engineId");
  const decision = readVoteDecision(value, "decision");
  const confidence = readBoundedNumber(value, "confidence", 0, 1);
  const riskScore = readBoundedNumber(value, "riskScore", 0, 100);
  const efficiencyScore = readBoundedNumber(value, "efficiencyScore", 0, 100);
  const justification = readNonEmptyString(value, "justification");

  assertAllowedKeys(value, [
    "engineId",
    "decision",
    "confidence",
    "riskScore",
    "efficiencyScore",
    "justification",
  ]);

  return { engineId, decision, confidence, riskScore, efficiencyScore, justification };
}

export function formatVoteRequest(input: {
  engineId: string;
  sharedContextHistory: SharedContextHistory;
}): string {
  return [
    `Engine: ${input.engineId}`,
    "Vote on the shared context history below.",
    "Return JSON with engineId, decision (APPROVE or REJECT), confidence, riskScore, efficiencyScore, and justification.",
    "",
    JSON.stringify(input.sharedContextHistory, null, 2),
  ].join("\n");
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readNonEmptyString(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return fieldValue;
}

export function readBoundedNumber(
  value: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const fieldValue = value[field];

  if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
    throw new Error(`${field} must be a number.`);
  }

  if (fieldValue < min || fieldValue > max) {
    throw new Error(`${field} must be between ${min} and ${max}.`);
  }

  return fieldValue;
}

export function assertAllowedKeys(value: Record<string, unknown>, allowedKeys: string[]): void {
  const allowedKeySet = new Set(allowedKeys);

  for (const key of Object.keys(value)) {
    if (!allowedKeySet.has(key)) {
      throw new Error(`Unexpected field: ${key}`);
    }
  }
}

function readVoteDecision(value: Record<string, unknown>, field: string): VoteDecision {
  const fieldValue = value[field];

  if (fieldValue !== "APPROVE" && fieldValue !== "REJECT") {
    throw new Error(`${field} must be APPROVE or REJECT.`);
  }

  return fieldValue;
}

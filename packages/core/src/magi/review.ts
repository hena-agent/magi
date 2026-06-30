import type { SharedContextHistory } from "./shared-context.js";
import type { ReviewLens } from "./lenses.js";
import { assertAllowedKeys, isObject, readBoundedNumber, readNonEmptyString } from "./vote.js";

export type ReviewSeverity = "info" | "warning" | "error";

export type ReviewFinding = {
  severity: ReviewSeverity;
  lensId: string;
  file?: string;
  line?: number;
  message: string;
  recommendation?: string;
};

export type ReviewResponse = {
  engineId: string;
  summary: string;
  findings: ReviewFinding[];
  riskScore: number;
  confidence: number;
};

export function validateReviewResponse(value: unknown, allowedLensIds?: string[]): ReviewResponse {
  if (!isObject(value)) {
    throw new Error("Review response must be an object.");
  }

  const engineId = readNonEmptyString(value, "engineId");
  const summary = readNonEmptyString(value, "summary");
  const findings = readFindings(value.findings, allowedLensIds);
  const riskScore = readBoundedNumber(value, "riskScore", 0, 100);
  const confidence = readBoundedNumber(value, "confidence", 0, 1);

  assertAllowedKeys(value, ["engineId", "summary", "findings", "riskScore", "confidence"]);

  return { engineId, summary, findings, riskScore, confidence };
}

export function formatReviewRequest(input: {
  engineId: string;
  lenses: ReviewLens[];
  sharedContextHistory: SharedContextHistory;
}): string {
  return [
    `Engine: ${input.engineId}`,
    "Review the shared context history using only the requested review lenses.",
    "Return JSON with engineId, summary, findings, riskScore, and confidence.",
    "",
    "Review lenses:",
    JSON.stringify(input.lenses, null, 2),
    "",
    "Shared context history:",
    JSON.stringify(input.sharedContextHistory, null, 2),
  ].join("\n");
}

function readFindings(value: unknown, allowedLensIds?: string[]): ReviewFinding[] {
  if (!Array.isArray(value)) {
    throw new Error("findings must be an array.");
  }

  return value.map((finding, index) => readFinding(finding, index, allowedLensIds));
}

function readFinding(value: unknown, index: number, allowedLensIds?: string[]): ReviewFinding {
  if (!isObject(value)) {
    throw new Error(`findings[${index}] must be an object.`);
  }

  const severity = readSeverity(value, `findings[${index}].severity`);
  const lensId = readNonEmptyString(value, "lensId");

  if (allowedLensIds && !allowedLensIds.includes(lensId)) {
    throw new Error(`findings[${index}].lensId is not allowed: ${lensId}`);
  }

  const file = readOptionalString(value, "file");
  const line = readOptionalPositiveInteger(value, "line");
  const message = readNonEmptyString(value, "message");
  const recommendation = readOptionalString(value, "recommendation");

  assertAllowedKeys(value, ["severity", "lensId", "file", "line", "message", "recommendation"]);

  return {
    severity,
    lensId,
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    message,
    ...(recommendation === undefined ? {} : { recommendation }),
  };
}

function readSeverity(value: Record<string, unknown>, field: string): ReviewSeverity {
  const fieldValue = value.severity;

  if (fieldValue !== "info" && fieldValue !== "warning" && fieldValue !== "error") {
    throw new Error(`${field} must be info, warning, or error.`);
  }

  return fieldValue;
}

function readOptionalString(value: Record<string, unknown>, field: string): string | undefined {
  const fieldValue = value[field];

  if (fieldValue === undefined) {
    return undefined;
  }

  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return fieldValue;
}

function readOptionalPositiveInteger(
  value: Record<string, unknown>,
  field: string,
): number | undefined {
  const fieldValue = value[field];

  if (fieldValue === undefined) {
    return undefined;
  }

  if (typeof fieldValue !== "number" || !Number.isInteger(fieldValue) || fieldValue < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }

  return fieldValue;
}

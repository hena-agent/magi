import { readObject } from "./input.js";

export function questionTool(input: unknown): string {
  const inputObject = readObject(input, ["questions"]);
  const questions = inputObject.questions;

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("question requires a non-empty questions array");
  }

  const formatted = questions.map((question, index) => formatQuestion(question, index + 1));

  return [
    "Questions for the user. Stop and wait for the user's answer before continuing.",
    ...formatted,
  ].join("\n\n");
}

function formatQuestion(value: unknown, index: number): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("question item must be an object");
  }

  const item = value as Record<string, unknown>;
  const question = readString(item, "question");
  const header = typeof item.header === "string" ? item.header : `Question ${index}`;
  const options = Array.isArray(item.options) ? item.options.map(formatOption) : [];

  return [
    `${index}. ${header}`,
    question,
    ...options.map((option) => `- ${option}`),
    item.multiple === true ? "Multiple answers allowed." : undefined,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

function formatOption(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("question option must be an object");
  }

  const option = value as Record<string, unknown>;
  const label = readString(option, "label");
  const description = typeof option.description === "string" ? option.description : "";

  return description.length === 0 ? label : `${label}: ${description}`;
}

function readString(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`question requires non-empty string field: ${field}`);
  }

  return value;
}

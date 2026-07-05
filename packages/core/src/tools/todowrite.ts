import { readObject } from "./input.js";

type TodoItem = {
  content: string;
  status: string;
  priority: string;
};

const allowedStatuses = new Set(["pending", "in_progress", "completed", "cancelled"]);
const allowedPriorities = new Set(["high", "medium", "low"]);

export function todowriteTool(input: unknown): string {
  const inputObject = readObject(input, ["todos"]);
  const todos = inputObject.todos;

  if (!Array.isArray(todos)) {
    throw new Error("todowrite requires todos array");
  }

  const parsed = todos.map(readTodoItem);
  const openCount = parsed.filter((todo) => todo.status !== "completed").length;

  return [
    `Todos updated: ${openCount} open, ${parsed.length} total.`,
    JSON.stringify(parsed, null, 2),
  ].join("\n");
}

function readTodoItem(value: unknown): TodoItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("todo item must be an object");
  }

  const item = value as Record<string, unknown>;
  const content = readString(item, "content");
  const status = readString(item, "status");
  const priority = readString(item, "priority");

  if (!allowedStatuses.has(status)) {
    throw new Error(`invalid todo status: ${status}`);
  }

  if (!allowedPriorities.has(priority)) {
    throw new Error(`invalid todo priority: ${priority}`);
  }

  return { content, status, priority };
}

function readString(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`todo item requires non-empty string field: ${field}`);
  }

  return value;
}

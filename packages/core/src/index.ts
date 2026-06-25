export type Task = {
  id: string;
  userRequirement: string;
  mode: "normal" | "magi";
  riskLevel: "low" | "medium" | "high";
  status: "active" | "blocked" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
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

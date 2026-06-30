export type RiskLevel = "low" | "medium" | "high";

export type ReviewLens = {
  id: string;
  name: string;
  description: string;
  checklist: string[];
};

export const reviewLenses = {
  architecture: {
    id: "architecture",
    name: "Architecture",
    description: "Review coupling, boundaries, ownership, and layer violations.",
    checklist: ["Clear module boundaries", "Low accidental coupling", "No responsibility leaks"],
  },
  security: {
    id: "security",
    name: "Security",
    description:
      "Review secrets, auth gaps, unsafe inputs, shell/network risks, and OWASP-style issues.",
    checklist: ["No leaked secrets", "Input handling is safe", "Dangerous operations are guarded"],
  },
  performance: {
    id: "performance",
    name: "Performance",
    description: "Review complexity, I/O bottlenecks, unnecessary calls, and scalability risks.",
    checklist: ["No avoidable expensive loops", "I/O is bounded", "No unnecessary repeated work"],
  },
  correctness: {
    id: "correctness",
    name: "Correctness",
    description:
      "Review behavioral correctness, edge cases, and test coverage for changed behavior.",
    checklist: ["Meets requirement", "Handles failure paths", "Tests cover important behavior"],
  },
  maintainability: {
    id: "maintainability",
    name: "Maintainability",
    description: "Review simplicity, naming, readability, and long-term change cost.",
    checklist: ["Small clear change", "Names are precise", "No needless abstraction"],
  },
} as const satisfies Record<string, ReviewLens>;

export type ReviewLensId = keyof typeof reviewLenses;

export function selectReviewLenses(input: {
  riskLevel: RiskLevel;
  changedFiles: string[];
  explicitLensIds?: string[];
}): ReviewLens[] {
  const selectedIds = new Set<ReviewLensId>();

  selectedIds.add("correctness");
  selectedIds.add("maintainability");

  if (input.riskLevel === "medium" || input.riskLevel === "high") {
    selectedIds.add("architecture");
  }

  if (input.riskLevel === "high") {
    selectedIds.add("security");
    selectedIds.add("performance");
  }

  if (input.changedFiles.some(isSecuritySensitivePath)) {
    selectedIds.add("security");
  }

  if (input.changedFiles.some(isPerformanceSensitivePath)) {
    selectedIds.add("performance");
  }

  for (const lensId of input.explicitLensIds ?? []) {
    if (isReviewLensId(lensId)) {
      selectedIds.add(lensId);
    }
  }

  return [...selectedIds].map((lensId) => reviewLenses[lensId]);
}

export function isReviewLensId(value: string): value is ReviewLensId {
  return Object.hasOwn(reviewLenses, value);
}

function isSecuritySensitivePath(filePath: string): boolean {
  return /auth|secret|token|permission|shell|network|env|credential/i.test(filePath);
}

function isPerformanceSensitivePath(filePath: string): boolean {
  return /perf|benchmark|cache|query|worker|stream|build|test/i.test(filePath);
}

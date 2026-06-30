import type { VoteResponse } from "./vote.js";

export type ConsensusOutcome = "PASS" | "DEADLOCK" | "FAIL" | "REJECT";

export type ConsensusResult = {
  outcome: ConsensusOutcome;
  approveCount: number;
  rejectCount: number;
  votes: VoteResponse[];
};

export function evaluateConsensus(votes: VoteResponse[]): ConsensusResult {
  if (votes.length !== 3) {
    throw new Error("Consensus requires exactly 3 votes.");
  }

  const engineIds = new Set(votes.map((vote) => vote.engineId));

  if (engineIds.size !== votes.length) {
    throw new Error("Consensus votes must come from unique engine IDs.");
  }

  const approveCount = votes.filter((vote) => vote.decision === "APPROVE").length;
  const rejectCount = votes.length - approveCount;

  return {
    outcome: getOutcome(approveCount),
    approveCount,
    rejectCount,
    votes,
  };
}

function getOutcome(approveCount: number): ConsensusOutcome {
  switch (approveCount) {
    case 3:
      return "PASS";
    case 2:
      return "DEADLOCK";
    case 1:
      return "FAIL";
    case 0:
      return "REJECT";
    default:
      throw new Error(`Invalid approve count: ${approveCount}`);
  }
}

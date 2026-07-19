import { type ConsensusResult, evaluateConsensus } from "./consensus.js";
import type { ReviewResponse } from "./review.js";
import type { SharedContextHistory } from "./shared-context.js";
import type { VoteResponse } from "./vote.js";

export type DecisionTrail = {
  id: string;
  requirement: string;
  sharedContextHistory: SharedContextHistory;
  reviews: ReviewResponse[];
  votes: VoteResponse[];
  consensusResult: ConsensusResult;
  createdAt: string;
};

export function createDecisionTrail(input: {
  requirement: string;
  sharedContextHistory: SharedContextHistory;
  reviews: ReviewResponse[];
  votes: VoteResponse[];
  createdAt?: string;
}): DecisionTrail {
  return {
    id: crypto.randomUUID(),
    requirement: input.requirement,
    sharedContextHistory: input.sharedContextHistory,
    reviews: input.reviews,
    votes: input.votes,
    consensusResult: evaluateConsensus(input.votes),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

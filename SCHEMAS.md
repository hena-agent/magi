# SCHEMAS.md

## Schema Principles
- Use TypeScript types as the source of truth and derive runtime validation from them where practical.
- Persist MAGI decision records in a format that can be replayed or inspected without model access.
- Keep free-form prose inside explicit fields; decisions and statuses must be enum-like values.

## Bootstrap Required Schemas
- `Task`
- `SessionEvent`
- `ToolCall`
- `ToolResult`
- `PatchSet`
- `VerificationRun`

## Deferred MAGI Schemas
- `ReviewLens`
- `ReviewRequest`
- `ReviewResponse`
- `VoteResponse`
- `ConsensusDecision`
- `DecisionTrail`

## Shared Types
```ts
type EngineId = "claude" | "gpt" | "gemini" | (string & {})
```

## Task
```ts
type Task = {
  id: string
  userRequirement: string
  mode: "normal" | "magi"
  riskLevel: "low" | "medium" | "high"
  status: "active" | "blocked" | "completed" | "failed"
  createdAt: string
  updatedAt: string
}
```

## Session Event
```ts
type SessionEvent = {
  id: string
  taskId: string
  type: "user" | "assistant" | "tool_call" | "tool_result" | "patch" | "verification" | "review" | "vote" | "decision"
  timestamp: string
  summary?: string
  payload: unknown
}
```

## Tool Call
```ts
type ToolSource = "builtin" | "mcp" | "plugin"

type ToolCall = {
  id: string
  toolName: string
  source: ToolSource
  input: unknown
  riskLevel: "low" | "medium" | "high"
  approval: "not_required" | "requested" | "approved" | "denied"
}
```

## Tool Result
```ts
type ToolResult = {
  callId: string
  status: "success" | "error" | "cancelled"
  stdout?: string
  stderr?: string
  error?: string
  changedPaths?: string[]
  exitCode?: number
  durationMs?: number
}
```

## Patch Set
```ts
type PatchSet = {
  id: string
  taskId: string
  description: string
  diff: string
  changedPaths: string[]
  applied: boolean
}
```

## Verification Run
```ts
type VerificationRun = {
  id: string
  taskId: string
  command: string
  environment: "local" | "docker" | "remote_sandbox"
  status: "passed" | "failed" | "skipped" | "error"
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
}
```

## Review Lens
```ts
type ReviewLens = {
  name: "architecture" | "security" | "performance" | "custom"
  focusGuidelines: string[]
}
```

## Review Request
```ts
type ReviewRequest = {
  id: string
  targetEngine: EngineId
  dynamicPerspective: ReviewLens
  sharedContextHistory: string
  plan?: string
  atomicDiffSet?: string
  verificationLogs?: VerificationRun[]
}
```

## Review Response
```ts
type ReviewResponse = {
  id: string
  requestId: string
  engineName: string
  appliedViewpoint: string
  findings: Array<{
    severity: "low" | "medium" | "high" | "critical"
    title: string
    technicalJustification: string
    suggestedAction?: string
  }>
  summary: string
}
```

## Vote Response
```ts
type VoteResponse = {
  id: string
  engineName: string
  appliedViewpoint: string
  decision: "APPROVE" | "REJECT"
  confidenceScore: number
  quantitativeMetrics: {
    riskIndex: number
    efficiencyIndex: number
  }
  technicalJustification: string
}
```

## Consensus Decision
```ts
type ConsensusDecision = {
  id: string
  taskId: string
  status: "PASS" | "DEADLOCK" | "FAIL" | "REJECT"
  approveCount: number
  rejectCount: number
  votes: VoteResponse[]
  nextAction: "continue" | "revise" | "replan" | "ask_user" | "stop"
  rationale: string
}
```

## Decision Trail
```ts
type DecisionTrail = {
  task: Task
  sharedContextHistory: string
  events: SessionEvent[]
  patchSets: PatchSet[]
  verificationRuns: VerificationRun[]
  reviews: ReviewResponse[]
  votes: VoteResponse[]
  finalDecision?: ConsensusDecision
}
```

## Validation Rules
- `confidenceScore` must be between `0` and `1`.
- `riskIndex` and `efficiencyIndex` must be integers from `1` to `10`.
- A `ConsensusDecision` must include exactly one vote per participating engine.
- `DEADLOCK` must be returned for `2 APPROVE / 1 REJECT` in the three-engine matrix.
- Runtime errors and failed verification logs must be included in `sharedContextHistory` before final voting.

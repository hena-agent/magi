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
- `ToolSettlement`
- `TaskUpdate`
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
  sessionId: string
  sequence: number
  type:
    | "user_message"
    | "assistant_message"
    | "agent_step_started"
    | "assistant_started"
    | "agent_step_ended"
    | "provider_error"
    | "interruption"
    | "tool_call"
    | "tool_result"
    | "tool_settlement"
    | "permission_decision"
    | "proposed_patch"
    | "verification_result"
    | "context_summary"
    | "queued_user_input"
    | "model_switch"
    | "todo_update"
    | "task_update"
    | "plan_exit"
    | "summary"
    | "magi_decision_trail"
  payload: unknown
  createdAt: string
}
```

## Tool Call
```ts
type ToolName =
  | "read"
  | "glob"
  | "grep"
  | "edit"
  | "write"
  | "apply_patch"
  | "bash"
  | "webfetch"
  | "websearch"
  | "todowrite"
  | "question"
  | "skill"
  | "lsp_symbols"
  | "lsp_definition"
  | "lsp_references"
  | "lsp_hover"
  | "task"
  | "plan_exit"

type ToolCall = {
  id: string
  name: ToolName
  input: unknown
}
```

## Tool Result
```ts
type ToolResult = {
  id: string
  name: ToolName
  ok: boolean
  output: string
  error?: string
}
```

## Tool Settlement
```ts
type ToolSettlement = {
  toolCallId: string
  name: ToolName
  status: "pending" | "running" | "succeeded" | "failed" | "denied" | "interrupted"
  input?: unknown
  startedAt?: string
  endedAt?: string
  durationMs?: number
  outputPreview?: string
  error?: string
}
```

## Task Update
```ts
type TaskUpdate = {
  taskId: string
  status: "started" | "completed" | "failed"
  description: string
  subagentId: string
  parentAgentId: string
  providerId?: string
  startedAt?: string
  endedAt?: string
  finalText?: string
  error?: string
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

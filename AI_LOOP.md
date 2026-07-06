# AI_LOOP.md

## Purpose

This document describes the current MAGI normal-mode AI loop at a practical architecture level. It focuses on how a user prompt becomes model actions, tool executions, observations, and a final assistant response.

The current default loop is a fast single-engine coding-agent loop. MAGI multi-engine consensus foundations exist, but consensus is not automatically inserted into every normal prompt.

## High-Level Shape

```txt
User prompt
  ↓
TUI controller
  - records user input
  - chooses active agent and model provider
  - builds system and session context
  ↓
Core agent runner
  - asks model for next action
  - executes tools through callbacks
  - feeds observations back into the next step
  ↓
Final assistant message
  - persisted to the session
  - rendered in the TUI transcript
```

## Component Responsibilities

### TUI Controller

The TUI controller owns user-facing runtime state and execution boundaries.

It is responsible for:

- Receiving plain-text prompts and slash commands.
- Tracking the active agent, model provider, session, queue, permissions, and overlays.
- Appending session events such as `user_message`, `assistant_message`, `tool_call`, `tool_result`, and `tool_settlement`.
- Building session and system context before a model turn starts.
- Translating model actions into concrete tool calls.
- Enforcing permission policy before tool execution.
- Rendering transcript messages, tool cards, question prompts, selectors, and active status.

### Core Agent Runner

The core runner owns the model/tool/observation loop.

It is responsible for:

- Running up to the active agent's step budget.
- Asking the model for the next action.
- Prefering provider-native tool calls when available.
- Falling back to JSON action output when native tool calls are unavailable or fail.
- Converting tool results into observations.
- Feeding observations into later model steps.
- Stopping on `answer`, `finish`, interruption, or max-iteration exhaustion.

### Tool Layer

The tool layer owns actual side effects.

It is responsible for:

- Reading files, searching content, applying edits, running shell commands, and calling external services.
- Returning structured `ToolResult` objects.
- Recording durable settlements with timing and status.
- Keeping model-generated actions behind permission and audit boundaries.

## Prompt-To-Turn Flow

When the user enters a normal prompt, the TUI controller performs this sequence:

```txt
submitAgentPrompt(content, agent, providerId)
  ↓
append user_message session event
  ↓
runSingleEngineAgentTurn(content, agent, providerId)
  ↓
create model adapter
  ↓
merge steering inputs if present
  ↓
add agent-mode reminders if needed
  ↓
build sessionContext from prior events
  ↓
build systemContext from workspace state
  ↓
runAgentTurn(...)
```

The session context intentionally excludes the just-appended user event when constructing previous context, because the active prompt is passed separately as `userMessage`.

## Per-Step Runner Flow

Inside `runAgentTurn`, the core runner loops over iterations.

Each iteration looks like this:

```txt
1. Check interruption.
2. Emit agent_step_started.
3. Emit assistant_started.
4. Ask the model for an action.
5. If action is answer/finish, complete the run.
6. Otherwise convert it to an executable action.
7. Execute the action through the TUI callback.
8. Store the result as an observation.
9. Emit agent_step_ended.
10. Continue to the next iteration.
```

In simplified pseudocode:

```ts
for (let iteration = 1; iteration <= maxIterations; iteration++) {
  if (shouldInterrupt()) return interrupted

  emit("agent_step_started")
  emit("assistant_started")

  const action = await generateAgentAction({
    userMessage,
    systemContext,
    sessionContext,
    observations,
    iteration,
  })

  if (action.type === "answer" || action.type === "finish") {
    emit("agent_step_ended", "completed")
    return finalText(action)
  }

  const observation = await executeAction(action)
  observations.push(formatObservation(action, observation))
  emit("agent_step_ended", "waiting_for_tools")
}
```

## Action Generation

The runner has two ways to get the model's next action.

### 1. Native Tool Calling

When the selected provider supports step/tool generation, MAGI first tries native tool calling:

```txt
engine.generateStep(...)
  ↓
provider-native tool call
  ↓
toolCallToAgentAction(...)
```

This is the preferred path because the provider can return structured tool calls directly.

### 2. JSON Action Fallback

If native tool calling is unavailable or fails, the runner falls back to a JSON action protocol:

```txt
engine.generateText(...)
  ↓
parse JSON object from model text
  ↓
validateAgentAction(...)
```

This keeps providers without native tool support usable.

## Action Types

Model actions eventually normalize into a known action shape.

Important action families include:

- Terminal actions: `answer`, `finish`.
- File and repo inspection: `read`, `glob`, `grep`.
- File mutation: `edit`, `write`, `apply_patch`, `propose_patch`.
- Execution and validation: `bash`, `verify`.
- External context: `webfetch`, `websearch`, `skill`.
- Planning and workflow: `todowrite`, `question`, `task`, `plan_exit`.
- Code intelligence: `lsp_symbols`, `lsp_definition`, `lsp_references`, `lsp_hover`, `lsp_call_hierarchy`.
- Recovery: `invalid_tool`.

The model does not directly mutate the workspace. It proposes an action, and the controller/tool layer decides whether and how to execute it.

## Tool Execution Flow

When the runner receives a non-terminal action, it calls the controller's `executeAction` callback.

The callback performs this pattern:

```txt
ExecutableAgentAction
  ↓
createToolCall(name, input)
  ↓
permission lookup
  ↓
allow / deny / prompt user
  ↓
runTool(...)
  ↓
ToolResult
  ↓
observation string returned to runner
```

The controller also records durable session events:

```txt
tool_call
tool_settlement: pending/running
tool_result
tool_settlement: succeeded/failed/denied
```

Permission prompts are handled by the TUI overlay. If the user denies the tool, the model receives a denial observation rather than silent failure.

## Observations

Observations are the feedback channel from tools back into the model loop.

After every non-terminal action:

```txt
tool result
  ↓
observation text
  ↓
state.observations
  ↓
next model prompt
```

This creates the normal coding cycle:

```txt
model chooses tool
  ↓
tool runs
  ↓
result becomes observation
  ↓
model sees result
  ↓
model chooses next tool or final answer
```

Repeated identical actions are detected and skipped with a recovery observation so the model is nudged to choose a different action or finish.

## Final Step Behavior

The loop has a max-iteration budget. On the final step, tools are disabled.

If the model still tries to use a tool at the final step, MAGI records an observation explaining that tools are disabled and asks for a final text-only response from the gathered observations.

This avoids ending with a hard failure just because the model wanted one more tool call.

## Session Persistence

MAGI starts in a draft session by default.

For a normal prompt:

```txt
user_message is appended
agent loop runs
assistant_message is appended
draft session persists after first successful assistant response
```

This avoids saving empty or abandoned sessions while still preserving meaningful work once the assistant has completed a turn.

## Status And UI Events

The runner emits lifecycle events while it works:

```txt
agent_step_started
assistant_started
agent_step_ended
provider_error
```

The TUI consumes those events to update visible state:

```txt
Thinking...
Preparing next step...
Running read ...
Step waiting_for_tools
Ready
```

Tool results render as concise cards with target paths, duration, summaries, collapsed previews, and expandable full output.

## Normal Mode Versus MAGI Mode

The current default path is Normal Mode:

```txt
one active agent
one selected model provider
tool/observation loop
fast local iteration
```

MAGI Mode is intended for high-assurance decision points. Its foundations include multi-provider configuration, engine selection, shared context, and consensus primitives, but automatic MAGI gating is still future work.

In other words:

- Normal Mode optimizes responsiveness.
- MAGI Mode will optimize defect prevention, review quality, and auditability.
- The normal loop should remain fast and should not run consensus for every trivial prompt.

## End-To-End Summary

```txt
User prompt
  ↓
TUI records user_message
  ↓
TUI builds model adapter, system context, and session context
  ↓
Core runner starts step loop
  ↓
Model returns native tool call or JSON action
  ↓
Terminal action?
  ├─ yes → save assistant_message and render final answer
  └─ no
      ↓
      Controller turns action into ToolCall
      ↓
      Permission policy allows, denies, or prompts
      ↓
      Tool executes and records settlement
      ↓
      Result becomes observation
      ↓
      Next model step sees observation
```

The key boundary is that the model proposes actions, but MAGI owns execution, permissions, persistence, and UI state.

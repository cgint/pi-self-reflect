# self-reflect Pi extension

Prototype Pi coding-agent extension for cache-sensitive self-reflection checkpoints.

## What it does

- Counts agent iterations across model-call opportunities and tool results, resetting the visible cadence progress on each non-extension user input.
- At the configured cadence, runs a reflection checkpoint before the next normal LLM call after enough steps in the current user turn.
- By default, also runs a reflection checkpoint when the agent loop ends and the agent is about to return control to the user, but only after enough work since the last user input and never after an aborted assistant turn.
- Builds reflection from the same message/history prefix plus small reflection suffixes. Strategy `multi` runs four expert-view calls sequentially and then a combiner. Strategy `single` runs one structured reflection call that checks the same lenses internally.
- Shows every reflection event during the prototype phase via `ctx.ui.notify()` in TUI/RPC modes and direct stderr writes in print/json modes. Checkpoint records are persisted with `pi.appendEntry()` only; the extension intentionally does not use `pi.sendMessage()` for passive display because custom messages become session messages.
- Whenever reflection modifies driver context, the visible checkpoint says that hidden process support was delivered, but it does not display or persist the internal injected text.
- Injected driver-context messages are explicitly labeled `EXTENSION-GENERATED PROCESS SUPPORT — NOT FROM USER` and tell the driver not to attribute them to the user.
- The expert views and combiner are instructed not to echo, summarize, endorse, or rephrase the driver's current plan; the combiner should return `OK` when there is no materially independent process risk/check to add.
- Non-OK reflection must be grounded in known facts from the existing history. The reflector should not behave like it knows more than the driver or prescribe technical fixes unless already established by evidence; hypotheses should become verification/process guidance.
- Reflection prompt includes a de-duplicated `USER-INSTRUCTION / GOAL FRAME SNAPSHOT`: first user messages, recent additional user messages not already listed, and the latest explicit user instruction as binding local scope.
- Reflection must protect the latest user instruction boundary. It must not create the next task, expand a bounded read/summarize/inspect request into execution, or drive work instead of the human.
- Expert views use tiny prompts, compact latest-user context, and compact `CLEAR:`/`ISSUE:` findings only. Malformed/empty expert prose is excluded from synthesis, not converted into `CLEAR:` or `ISSUE:`. The combiner runs only when at least one valid expert view returns `ISSUE:`.
- `NOTE` is visible/persisted only; it is not injected into driver context.
- Injects driver-context guidance only for `STEER` or `PAUSE_USER`.
- For agent-end reflection, automatically starts a follow-up LLM turn only for `STEER` or `PAUSE_USER`; `NOTE` does not keep the turn alive.
- Manual reflection via `/self-reflect-now` runs immediately while the agent is idle and displays/persists the result without starting a follow-up turn.

## Outcome markers

- `✓ OK / continue` — reflection happened; no steering injected.
- `ℹ NOTE / visible only` — reflection found a concrete non-blocking audit reminder; it is shown/persisted but not injected and does not auto-continue.
- `◇ STEER` — reflection injected concise process guidance into the next LLM call; it must stay within the current user-authorized scope and should not become technical implementation advice.
- `◆ PAUSE_USER` — reflection asks the agent to request user input before continuing; last resort only for missing user intent/preference, credentials/secrets, risky/destructive-action approval, or conflicting requirements.
- `◆ MALFORMED` — reflection ignored the required output contract twice; raw output is shown visibly and persisted, but no malformed reflector text is injected into driver context.

## Configuration

Environment variables:

- `PI_SELF_REFLECT_CADENCE` — checkpoint cadence override, default `10`.
- `PI_SELF_REFLECT_AGENT_END` — enable/disable reflection when the agent is about to return to the user, default `true`. Truthy: `1`, `true`, `yes`, `on`, `enabled`. Falsey: `0`, `false`, `no`, `off`, `disabled`.
- `PI_SELF_REFLECT_MAX_AUTO_CONTINUES` — safety cap for consecutive agent-end automatic continuations, default `3`.
- `PI_SELF_REFLECT_MAX_AGENT_END_REFLECTIONS_PER_USER_TURN` — safety cap for automatic agent-end reflection attempts before the next non-extension user input, default `1`.
- `PI_SELF_REFLECT_AGENT_END_MIN_ITERATIONS_SINCE_USER_INPUT` — minimum counted model/tool iterations since the last non-extension user input before agent-end reflection may run, default `3`.
- `PI_SELF_REFLECT_MAX_TOKENS` — reflection response token cap, default `600`.
- `PI_SELF_REFLECT_MODEL` — optional independent reflector model override in `provider/model-id` form. If unset, reflection uses the active driver model. If set, the full history plus reflection suffix is sent to the configured model; this improves independence but should not be expected to reuse the driver's KV/prompt cache.
- `PI_SELF_REFLECT_STRATEGY` — reflection strategy, `multi` or `single`, default `multi`. `multi` runs expert views plus combiner. `single` runs one structured reflection request.
- `PI_SELF_REFLECT_TRANSPORT` — reflection provider transport, one of `sse`, `auto`, `websocket`, or `websocket-cached`; default `sse` for correctness after Codex continuation-state failures. Use `auto`/cached modes only for explicit cache experiments.
- `PI_SELF_REFLECT_TEST_RESPONSE` — optional deterministic smoke-test seam. If set, skips the reflection provider call and parses this value as the first reflection response. Example: `NOTE: verify logs before declaring done`.
- `PI_SELF_REFLECT_TEST_RETRY_RESPONSE` — optional deterministic smoke-test seam for malformed-response retry. Used only when `PI_SELF_REFLECT_TEST_RESPONSE` is malformed.

Runtime commands:

- `/self-reflect-status` — show enabled/suspended state, active reflector model, cadence, agent-end setting, per-user-turn budget counters, and last outcome.
- `/self-reflect-model <provider/model-id|driver|status>` — set the reflector model for the current extension runtime. `driver` clears the override so reflection follows the active Pi driver model.
- `/self-reflect-strategy <multi|single|status>` — switch between expert-view plus combiner reflection and one structured reflection request for the current extension runtime.
- `/self-reflect-suspend` — suspend reflection for the current extension runtime. Iteration counters/status remain visible, but reflection calls do not run.
- `/self-reflect-resume` — resume reflection and schedule the next cadence checkpoint at `current user-turn iteration count + cadence`.
- `/self-reflect-cadence <positive integer>` — change cadence for the current extension runtime and reschedule the next checkpoint.
- `/self-reflect-now` — manually run self-reflection over the current conversation while it is the user's turn; displays and persists the result without starting a follow-up turn.
- `/self-reflect-agent-end <on|off|status>` — enable, disable, or inspect reflection when the agent is about to return to the user.

## Smoke test commands

Store sessions in the repo so the resulting JSONL can be inspected.

Runtime control command smoke tests:

```bash
pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "/self-reflect-status"

PI_SELF_REFLECT_MODEL='8085-sparky/qwen36-35b-a3b-mtp-mxfp4-moe' \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "/self-reflect-status"

pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "/self-reflect-model 8085-sparky/qwen36-35b-a3b-mtp-mxfp4-moe"

pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "/self-reflect-model driver"

pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "/self-reflect-suspend"

pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "/self-reflect-cadence 3"
```

Agent-end reflection is on by default. Disable it when smoke-testing cadence-only behavior:

```bash
PI_SELF_REFLECT_AGENT_END=off \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "Say exactly: default cadence no checkpoint."
```

Agent-end reflection can be disabled by command:

```bash
pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "/self-reflect-agent-end off"
```

Manual reflection can be triggered while it is the user's turn:

```bash
PI_SELF_REFLECT_AGENT_END=off \
PI_SELF_REFLECT_TEST_RESPONSE='OK: Manual self-reflection command is available.' \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "/self-reflect-now"
```

Reflection trigger smoke:

```bash
PI_SELF_REFLECT_CADENCE=1 \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "Say exactly: smoke test complete."
```

Tool-result cadence path:

```bash
PI_SELF_REFLECT_CADENCE=2 \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "Use the bash tool to run printf self-reflect-tool-smoke, then report the exact output."
```

Independent reflector model path:

```bash
PI_SELF_REFLECT_AGENT_END=off \
PI_SELF_REFLECT_CADENCE=1 \
PI_SELF_REFLECT_MODEL='8085-sparky/qwen36-35b-a3b-mtp-mxfp4-moe' \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  --model openai-codex/gpt-5.5 \
  -p "Say exactly: independent reflector smoke."
```

Forced cadence `NOTE` path:

```bash
PI_SELF_REFLECT_AGENT_END=off \
PI_SELF_REFLECT_CADENCE=1 \
PI_SELF_REFLECT_TEST_RESPONSE='NOTE: Before declaring done, verify logs/status, HTTP response, related services, and documentation.' \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "Reply in one sentence confirming whether any self-reflection note was received."
```

Forced cadence `STEER` path:

```bash
PI_SELF_REFLECT_AGENT_END=off \
PI_SELF_REFLECT_CADENCE=1 \
PI_SELF_REFLECT_TEST_RESPONSE='STEER: In the final answer, explicitly mention that forced self-reflection steering was received.' \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "Reply in one sentence confirming whether any self-reflection steering was received."
```

Malformed retry diagnostic path:

```bash
PI_SELF_REFLECT_AGENT_END=off \
PI_SELF_REFLECT_CADENCE=1 \
PI_SELF_REFLECT_TEST_RESPONSE='malformed first response' \
PI_SELF_REFLECT_TEST_RETRY_RESPONSE='malformed retry response' \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "Reply in one sentence confirming whether a self-reflection diagnostic warning was received."
```

Forced agent-end automatic `STEER` path:

```bash
PI_SELF_REFLECT_CADENCE=100 \
PI_SELF_REFLECT_MAX_AUTO_CONTINUES=1 \
PI_SELF_REFLECT_TEST_RESPONSE='STEER: Reply with exactly: agent-end steering received.' \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "Say exactly: initial answer."
```

Forced cadence `PAUSE_USER` path:

```bash
PI_SELF_REFLECT_AGENT_END=off \
PI_SELF_REFLECT_CADENCE=1 \
PI_SELF_REFLECT_TEST_RESPONSE='PAUSE_USER: Ask the user whether to continue with option A or option B before doing more work.' \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "Proceed with the next implementation step."
```

Malformed reflection output should be visible and fail open without steering:

```bash
PI_SELF_REFLECT_AGENT_END=off \
PI_SELF_REFLECT_CADENCE=1 \
PI_SELF_REFLECT_TEST_RESPONSE='My loose thoughts without a required prefix.' \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "Say exactly: malformed reflection smoke."
```

## Important provider-chain note

The reflection call uses a sidecar `sessionId`. Provider transport defaults to `sse`, configurable with `PI_SELF_REFLECT_TRANSPORT=sse|auto|websocket|websocket-cached`.

Reason: during smoke testing with `openai-codex/gpt-5.5`, using the driving agent's exact `sessionId` for the out-of-band reflection call could mutate provider-level websocket continuation state (`previous_response_id`) and break the next normal post-tool LLM call. The sidecar session keeps the same prompt/history content while avoiding corruption of the driving session's provider continuation chain.

This remains a correctness-first containment path. `PI_SELF_REFLECT_TRANSPORT=auto` or `websocket-cached` is available for explicit cache experiments, but the safe default remains `sse` until Pi/provider APIs expose reflection-safe cache sharing.

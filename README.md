# self-reflect

[![npm version](https://img.shields.io/npm/v/pi-self-reflect)](https://www.npmjs.com/package/pi-self-reflect)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Pi extension that runs periodic self-reflection checkpoints during agent turns to detect loops, drift, weak assumptions, or stalled progress.

**Status:** prototype — behavior is settled and tested, but the API/env surface may evolve.

---

## Quick start

```bash
# Add the extension
pi packages add cgint/pi-self-reflect

# Or run from a local clone
pi --no-extensions --no-skills -e . -p "Your prompt here"
```

The extension starts with default settings. Reflection is active when there is a provider that can serve it — see [Configuration](#configuration) for tuning.

## What it does

At a configurable cadence during the agent loop (or when the agent is about to return control to the user), the extension runs a lightweight reflection checkpoint. It reviews the current conversation through several expert lenses and may inject process guidance into the next LLM call.

- **Counts agent iterations** across model-call opportunities and tool results, resetting on each non-extension user input.
- **Runs a reflection checkpoint** at the configured cadence before the next normal LLM call.
- **Runs at agent-end** by default, after enough work since the last user input (never after an aborted turn).
- **Does not alter session messages** — reflection output is persisted with `pi.appendEntry()` and shown via `ctx.ui.notify()`, never injected as user messages.
- **Labels injected context** explicitly as `EXTENSION-GENERATED PROCESS SUPPORT — NOT FROM USER` so the driver never attributes it to the user.
- **Protects the latest user instruction.** Reflection never creates tasks, expands a bounded read request into execution, or drives work instead of the human.
- **Two strategies:** `multi` (default) runs four expert-view calls then a combiner; `single` runs one structured reflection call.

## Outcome markers

| Marker | Meaning |
|---|---|
| `✓ OK / continue` | Reflection happened; no steering injected |
| `ℹ NOTE / visible only` | Non-blocking audit reminder; shown/persisted only |
| `◇ STEER` | Process guidance injected into the next LLM call |
| `◆ PAUSE_USER` | Agent asked to request user input before continuing |
| `◆ MALFORMED` | Reflector ignored output contract; shown/persisted raw, no injection |

`PAUSE_USER` is a last resort — only for missing user intent/preference, credentials/secrets, risky/destructive-action approval, or conflicting requirements.

## Configuration

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PI_SELF_REFLECT_CADENCE` | `10` | Checkpoint cadence (iterations) |
| `PI_SELF_REFLECT_AGENT_END` | `true` | Enable reflection at agent loop end |
| `PI_SELF_REFLECT_MAX_AUTO_CONTINUES` | `3` | Safety cap for consecutive agent-end auto-continuations |
| `PI_SELF_REFLECT_MAX_AGENT_END_REFLECTIONS_PER_USER_TURN` | `1` | Max agent-end reflection attempts before next user input |
| `PI_SELF_REFLECT_AGENT_END_MIN_ITERATIONS_SINCE_USER_INPUT` | `3` | Min iterations since last user input before agent-end reflection |
| `PI_SELF_REFLECT_MAX_TOKENS` | `600` | Reflection response token cap |
| `PI_SELF_REFLECT_MODEL` | *(driver model)* | Independent reflector model in `provider/model-id` form |
| `PI_SELF_REFLECT_STRATEGY` | `multi` | Reflection strategy: `multi` or `single` |
| `PI_SELF_REFLECT_TRANSPORT` | `sse` | Provider transport: `sse`, `auto`, `websocket`, `websocket-cached` |
| `PI_SELF_REFLECT_TEST_RESPONSE` | — | Deterministic smoke-test seam (skips provider call) |
| `PI_SELF_REFLECT_TEST_RETRY_RESPONSE` | — | Retry response for malformed-first-response smoke tests |

### Runtime commands

| Command | Effect |
|---|---|
| `/self-reflect-status` | Show enabled/suspended state, active model, cadence, agent-end setting, counters |
| `/self-reflect-model <provider/model-id\|driver\|status>` | Set or inspect the reflector model |
| `/self-reflect-strategy <multi\|single\|status>` | Switch reflection strategy |
| `/self-reflect-suspend` | Suspend reflection (counters visible but no calls) |
| `/self-reflect-resume` | Resume reflection and schedule next checkpoint |
| `/self-reflect-cadence <positive integer>` | Change cadence and reschedule |
| `/self-reflect-now` | Run reflection immediately (user's turn); display and persist without follow-up |
| `/self-reflect-agent-end <on\|off\|status>` | Enable, disable, or inspect agent-end reflection |

## Important provider-chain note

The reflection call uses a sidecar `sessionId`. Provider transport defaults to `sse`.

Reason: during use with `openai-codex/gpt-5.5`, using the driving agent's exact `sessionId` for the out-of-band reflection call could mutate provider-level websocket continuation state (`previous_response_id`) and break the next normal post-tool LLM call. The sidecar session keeps the same prompt/history content while avoiding corruption of the driving session's provider continuation chain.

`PI_SELF_REFLECT_TRANSPORT=auto` or `websocket-cached` is available for explicit cache experiments, but the safe default remains `sse` until Pi/provider APIs expose reflection-safe cache sharing.

## Developer guide

### Smoke tests

```bash
# Status command with default model
pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "/self-reflect-status"

# Manual reflection
PI_SELF_REFLECT_AGENT_END=off \
PI_SELF_REFLECT_TEST_RESPONSE='OK: Manual self-reflection command is available.' \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "/self-reflect-now"

# Reflection trigger at cadence 1
PI_SELF_REFLECT_CADENCE=1 \
  pi --no-extensions --no-skills \
  -e . \
  --session-dir .pi/smoke-sessions \
  -p "Say exactly: smoke test complete."
```

See the full smoke-test suite in the [source smoke section](https://github.com/cgint/pi-self-reflect).

### Running tests

```bash
npm test           # vitest run
npm run test:watch # vitest watch mode
npm run typecheck  # tsc --noEmit
npm run precommit  # typecheck + test + audit
```

## License

MIT — see [LICENSE](LICENSE).

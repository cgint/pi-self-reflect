---
name: repo-maintenance
description: Self-sufficient routine for dependency upgrades, audit hygiene and verified push in this repository. For agents working on this repo; never deployed to extension users.
---

# Repository maintenance routine (self-sufficient)

This skill is the single source of truth for maintaining this repository.
It must remain fully self-sufficient: never depend on resources outside
this repository (no central skill, no external memory).

## Goal & hard rules
- All npm dependencies at latest published versions, MAJOR bumps included.
- npm audit green (exit 0), fixed at ROOT CAUSE (upgrade the vulnerable
  package itself). Never via: lowered audit level, --force, npm audit
  ignore/suppressions, overrides that mask advisories, or downgrade-to-dodge.
- NO restrictions may be loosened to get green. If a temporary measure is
  truly unavoidable, flag it explicitly in the evidence file and name the
  real fix.
- Never bend a test to pass. Failures are either pre-existing (prove it via
  a stash/HEAD baseline) or regressions (fix root cause or stop and report).

## Procedure
1. git fetch origin; ensure local branch is even with origin before starting.
2. Record BEFORE-state: package versions (npm ls --depth=0), npm audit
   output, full test verdict on the clean tree.
3. Bump deps to latest (majors included). Regenerate lockfile fresh
   (remove package-lock.json, npm install).
4. Typecheck/build + full test suite. Compare against BEFORE-state; any
   new failure is a regression. Investigate root cause before touching code.
5. npm audit must exit 0.
6. Commit (conventional message) and push ONLY when: tests no worse than
   baseline, audit exit 0, tree clean.

## Evidence contract
Commit agent/dep-refresh-YYYYMMDD.md containing: before/after table per
changed package, audit before/after, test verdict incl. pre-existing
failures with proof they pre-date the change, residual risks/overrides
kept and why.

## Acceptance protocol (verifier duties - NEVER trust a worker self-report)
- git fetch, then HEAD == origin on the working branch
- zero dirty tracked files
- re-run npm audit (expect exit 0)
- inspect the diff for loosened restrictions (audit config, skipped
  tests, downgraded pins)
- spot-check the evidence file exists and matches reality

## Repo-specific facts
- **Test/typecheck commands** (from `package.json` scripts):
  `npm test` → `vitest run`; `npm run typecheck` → `tsc --noEmit`;
  `npm run precommit` → typecheck + test + `npm audit --audit-level=moderate`.
  The audit gate is moderate level, not high/critical-only — do not raise
  it just to pass, but do not lower it either.
- **Node version**: no `engines` field in `package.json`. The installed
  dependency tree (per `package-lock.json`) requires `node >= 20.0.0`
  (pi-ai, pi-coding-agent, @types/node, vitest, typescript). Any node 20+
  works; no pin needed.
- **Overrides**: none. `package.json` has no `overrides` key; do not add
  any (overrides that mask advisories are banned by the hard rules).
- **Existing known issues**: none documented in-repo. The README notes a
  provider-continuation hazard (see "Important provider-chain note") —
  the extension deliberately uses a sidecar `sessionId` and `sse`
  transport as the safe default. This is an extension behavior choice,
  not a dependency or audit issue; do not change it as part of a
  dependency upgrade.
- **Dependency set** (all in `devDependencies`, no runtime deps):
  `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`,
  `@types/node`, `vitest`, `typescript`. A major bump in any of these
  (e.g. pi-* 1.5.0 → 2.0.0, vitest 5.x → 6.0.0) is expected and in-scope;
  run full test suite after each bump.
- **TypeScript target**: `ES2022`, `module: NodeNext`, `strict: true`,
  `noEmit: true`. A typescript major bump (7.0.x → 8.x) may surface new
  strict errors in `src/` or `test/`; fix at root cause, never suppress.
- **Hard wall (repeated for clarity)**: the `pi` manifest in
  `package.json` (`"pi": {"extensions": ["./index.ts"]}`) and any root
  `skills/` directory belong to extension users. Never add anything
  maintainer-facing to either. This skill lives in `.pi/skills/` —
  visible only to agents working on the repo, never published via npm
  (the `files` array lists only `index.ts`, `src`, `README.md`, `LICENSE`).

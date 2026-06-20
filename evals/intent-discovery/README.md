# Intent discovery eval

Opt-in eval suite for measuring whether Copilot discovers and invokes Intent surfaces without direct user instruction.

## Commands

- `pnpm eval:intent-discovery` runs the saved-transcript eval suite.
- `pnpm eval:intent-discovery:json` writes `evals/intent-discovery/runs/latest/vitest-results.json`.
- `pnpm eval:intent-discovery:report` serves the saved JSON report.

## Current scope

This executable slice grades synthetic saved transcripts with Vitest plus `vitest-evals` harness normalization helpers. It attaches `vitest-evals`-compatible metadata to the Vitest JSON artifact for the local report UI because this repo's current Vitest runtime does not expose the APIs used by `vitest-evals/reporter` and `describeEval()`.

The controlled fixture corpus is limited to current skill-backed surfaces. For this slice, that means TanStack Router, TanStack Start, and TanStack Table v9.

The live Copilot harness is a boundary contract only. Until live capture is wired, it returns a normalized `unsupported` run with no tool calls and an explicit `LiveCopilotRunnerUnavailableError`.

Harness integrity failures fail the eval. Product findings such as reference-only behavior, no discovery attempt, or wrong skill selection are recorded as diagnostic failures, not passing scores. The headline success signal is strict Intent invocation plus the expected skill loaded for autonomous cases.

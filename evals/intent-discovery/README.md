# Intent discovery eval

Opt-in eval suite for measuring whether Copilot discovers and invokes Intent surfaces without direct user instruction.

## Commands

- `pnpm eval:intent-discovery` runs the saved-transcript eval suite.
- `pnpm eval:intent-discovery:json` writes `evals/intent-discovery/runs/latest/vitest-results.json`.
- `pnpm eval:intent-discovery:live` runs the eval suite with the local Copilot CLI adapter enabled.
- `pnpm eval:intent-discovery:report` serves the saved JSON report.

The default JSON/report commands show saved-transcript efficacy cases only. To include the live Copilot case in the report artifact, run JSON generation with the live gate enabled:

```sh
INTENT_DISCOVERY_RUN_LIVE=1 INTENT_DISCOVERY_COPILOT_COMMAND="node $PWD/evals/intent-discovery/bin/copilot-cli-adapter.mjs" pnpm eval:intent-discovery:json
```

## Current scope

This executable slice grades synthetic saved transcripts with Vitest plus `vitest-evals` harness normalization helpers. It attaches `vitest-evals`-compatible metadata to the Vitest JSON artifact for the local report UI because this repo's current Vitest runtime does not expose the APIs used by `vitest-evals/reporter` and `describeEval()`.

The controlled fixture corpus is limited to current skill-backed surfaces. For this slice, that means TanStack Router, TanStack Start, and TanStack Table v9.

The live Copilot harness can run an opt-in command backend through `INTENT_DISCOVERY_COPILOT_COMMAND`. When that environment variable is unset, it returns a normalized `unsupported` run with no tool calls and an explicit `LiveCopilotRunnerUnavailableError`. The command runs inside a prepared fixture workspace with task metadata in `INTENT_DISCOVERY_TASK_ID`, `INTENT_DISCOVERY_FIXTURE`, `INTENT_DISCOVERY_PROMPT`, `INTENT_DISCOVERY_RUN_ID`, and `INTENT_DISCOVERY_WORKSPACE`.

`pnpm eval:intent-discovery:live` sets `INTENT_DISCOVERY_RUN_LIVE=1` and `INTENT_DISCOVERY_COPILOT_COMMAND` to the repo-local Copilot CLI adapter. The adapter calls `copilot -p` in the prepared fixture workspace, writes a Copilot share transcript under the generated run directory, and prints the transcript for command capture. Live runs attach the same strict efficacy scores as saved transcripts, so a passing harness run can still report `AutonomousDiscoverySuccess: 0` when Copilot did not invoke Intent or loaded the wrong skill. Do not put API keys or tokens in the command or prompt; provide credentials through the normal Copilot CLI login or secret environment configuration.

Harness integrity failures fail the eval. Product findings such as reference-only behavior, no discovery attempt, or wrong skill selection are recorded as diagnostic failures, not passing scores. The headline success signal is strict Intent invocation plus the expected skill loaded for autonomous cases.

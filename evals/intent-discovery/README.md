# Intent discovery eval

Opt-in eval suite for measuring whether Copilot discovers and invokes Intent surfaces without direct user instruction.

## Commands

- `pnpm eval:intent-discovery` runs the saved-transcript eval suite.
- `pnpm eval:intent-discovery:json` writes `evals/intent-discovery/runs/latest/vitest-results.json`.
- `pnpm eval:intent-discovery:live` runs the eval suite with the local Copilot CLI adapter enabled.
- `pnpm eval:intent-discovery:live:json` writes a JSON report that includes live Copilot condition cases.
- `pnpm eval:intent-discovery:judge` optionally annotates the latest JSON report with an OpenAI-backed output-quality judge when `OPENAI_API_KEY` is set.
- `pnpm eval:intent-discovery:report` serves the saved JSON report.
- `pnpm eval:intent-discovery:summary` writes `summary.json` and `summary.md` from the latest JSON report.

The default JSON/report commands show saved-transcript efficacy cases only. To include the live Copilot condition matrix in the report artifact, run:

```sh
pnpm eval:intent-discovery:live:json
pnpm eval:intent-discovery:summary
pnpm eval:intent-discovery:report
```

## Live matrix

Only the live `copilot -p` subprocess runs are slow; the saved-transcript suite (`pnpm eval:intent-discovery`) is unaffected.

- The matrix contains 15 isolated sessions: five model/reasoning profiles paired across symlink, map, and hook delivery.
- Every session preserves one Copilot session and workspace across five turns: unrelated edit, Router, Start, Table v9, unrelated edit.
- Profiles are `claude-haiku-4.5/default`, `claude-sonnet-4.6/medium`, `claude-opus-4.8/high`, `gpt-5.4-mini/low`, and `gpt-5.6-sol/high`. `default` means the model rejects configurable reasoning effort; no silent fallback is allowed.
- Sessions run serially by default. `INTENT_DISCOVERY_LIVE_CONCURRENCY` can raise concurrency, but concurrent `copilot -p` calls on one account previously measured slower.

The optional LLM judge is secondary. It never changes deterministic session, catalog, discovery, abstention, or task-completion scores.

## Current scope

This executable slice grades synthetic saved transcripts with Vitest plus `vitest-evals` harness normalization helpers. It attaches `vitest-evals`-compatible metadata to the Vitest JSON artifact for the local report UI because this repo's current Vitest runtime does not expose the APIs used by `vitest-evals/reporter` and `describeEval()`.

The controlled fixture corpus is limited to current skill-backed surfaces. For this slice, that means TanStack Router, TanStack Start, and TanStack Table v9.

Live sessions compare three Intent delivery conditions:

- `symlink-intent`: package skills are symlinked into `.github/skills` for native GitHub Copilot discovery.
- `mapped-intent`: production `install --map` guidance asks the agent to catalog once, load a match for related turns, and continue normally for unrelated turns.
- `hooked-intent`: the production Copilot lifecycle hook injects the trusted catalog when each new or resumed CLI process and subagent starts; the agent loads matches for related turns and continues normally for unrelated turns. Copilot does not persist hook context across process resumes or expose a post-compaction context injection event.

The live Copilot harness can run an opt-in command backend through `INTENT_DISCOVERY_COPILOT_COMMAND`. When unset, it returns a normalized `unsupported` run. Each live session uses a fresh composite fixture, valid trust lock, isolated `COPILOT_HOME`, explicit model and reasoning effort, and one UUID resumed across five separate `copilot -p` processes. Hook delivery requires exactly one catalog injection per process.

`pnpm eval:intent-discovery:live` sets the repo-local Copilot CLI adapter. Structured events in the isolated home provide turn-local native and shell evidence; share transcripts remain diagnostic artifacts. Do not put API keys or tokens in commands or prompts.

The headline is strict successful sessions out of five per mode. A session passes only when catalog behavior is correct, all three related turns use the exact expected guidance, both unrelated turns abstain, all five tasks complete, every runner turn completes, and no wrong guidance loads occur.

# Intent discovery eval

Opt-in eval suite for measuring whether Copilot discovers and invokes Intent surfaces without direct user instruction.

## Commands

- `pnpm eval:intent-discovery` runs grader and harness regression fixtures. It does not measure live product efficacy.
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

- The default matrix contains 20 isolated sessions: five model/reasoning profiles paired across unaided, symlink, map, and hook delivery.
- Every session preserves one Copilot session and workspace across six turns: three related tasks, two clearly unrelated tasks, and one table-named distractor that must not load the TanStack Table skill.
- Profiles are `claude-haiku-4.5/default`, `claude-sonnet-4.6/medium`, `claude-opus-4.8/high`, `gpt-5.4-mini/low`, and `gpt-5.6-sol/high`. `default` means the model rejects configurable reasoning effort; no silent fallback is allowed.
- Sessions run serially by default. `INTENT_DISCOVERY_LIVE_CONCURRENCY` can raise concurrency, but concurrent `copilot -p` calls on one account previously measured slower.

The optional LLM judge is secondary. It never changes deterministic session, catalog, discovery, abstention, or task-completion scores.

## Current scope

This executable slice grades synthetic saved transcripts with Vitest plus `vitest-evals` harness normalization helpers. It attaches `vitest-evals`-compatible metadata to the Vitest JSON artifact for the local report UI because this repo's current Vitest runtime does not expose the APIs used by `vitest-evals/reporter` and `describeEval()`.

The controlled fixture corpus is limited to TanStack Router, TanStack Start, and TanStack Table v9. It generates synthetic benchmark skills with capability-oriented descriptions and task-relevant guidance because this repository does not contain the published skills for those packages. The live matrix measures autonomous discovery and exact loading. It does not establish that published skill guidance improves task outcomes.

Live sessions compare four delivery conditions:

- `no-intent`: no Intent package policy, catalog guidance, hooks, or native skill links. This is the unaided task-completion control; discovery metrics are reported as `n/a`.
- `symlink-intent`: package skills are symlinked into `.github/skills` for native GitHub Copilot discovery.
- `mapped-intent`: production `install --map` guidance asks the agent to catalog once, load a match for related turns, and continue normally for unrelated turns.
- `hooked-intent`: the production Copilot lifecycle hook injects the trusted catalog when each new or resumed CLI process and subagent starts; the agent loads matches for related turns and continues normally for unrelated turns. Copilot does not persist hook context across process resumes or expose a post-compaction context injection event.

The live Copilot harness can run an opt-in command backend through `INTENT_DISCOVERY_COPILOT_COMMAND`. When unset, it returns a normalized `unsupported` run. Each live session uses a fresh composite fixture, valid trust lock, isolated `COPILOT_HOME`, explicit model and reasoning effort, and one UUID resumed across six separate `copilot -p` processes. Hook delivery requires exactly one catalog injection per process.

`pnpm eval:intent-discovery:live` sets the repo-local Copilot CLI adapter. Structured events in the isolated home provide turn-local native and shell evidence; malformed or incomplete event evidence fails the session instead of becoming a silent discovery miss. Share transcripts remain diagnostic artifacts. Do not put API keys or tokens in commands or prompts.

The primary discovery metric is exact related-turn loading with wrong-load and distractor penalties. Strict session success remains the reliability bar: a delivery session passes only when catalog behavior is correct, all three related turns use the exact expected guidance, all three unrelated turns abstain, all six tasks complete, every runner turn completes, and no wrong guidance loads occur. Task completion is reported against `no-intent`, but guidance-value claims require a separate benchmark using published skills and held-out acceptance criteria.

This suite executes GitHub Copilot CLI only. Model names selected inside Copilot do not test Claude Code or Codex lifecycle behavior. Cross-agent claims require agent-native runners and evidence capture.

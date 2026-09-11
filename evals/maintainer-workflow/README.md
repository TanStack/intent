# Maintainer workflow checks

This synthetic library exercises initial skill batches and later API changes. It has two useful consumer tasks: retry transient operations safely and consume all paginated results. Its source and tests define the behavior; it has no remote repository to consult.

## Deterministic checks

From the repository root:

```bash
node --test evals/maintainer-workflow/fixtures/parcel-client/test/client.test.mjs evals/maintainer-workflow/checks/consumer.test.mjs
```

The consumer grader checks retry limits, error identity (including null and undefined rejections), cancellation before and during an operation, empty intermediate pages, empty-string cursors, and pagination failures. Its own tests run the same assertions against a correct implementation and three plausible incorrect implementations. Keep this grader outside the consumer's editable fixture.

After an agent creates `client.mjs`, grade its actual output:

```bash
node evals/maintainer-workflow/checks/consumer.mjs /absolute/path/to/consumer/client.mjs
```

## Fresh-session protocol

Build and pack the candidate Intent package using the repository's normal package workflow. Extract that package into a disposable copy of `fixtures/parcel-client`, with its runtime dependencies available, and initialize a local Git baseline. Run the candidate's `install --maintainer`. Do not give the author the protected consumer grader or a finished solution.

Start a fresh author session with this request:

> Create an initial batch of developer skills for this library. The agreed tasks are retrying transient operations safely and consuming paginated results correctly. Use the source, examples, and tests in this repository. Include representative executable task checks and report what was verified. Both tasks are in scope; no taxonomy redesign or publishing work is needed. This fixture has no remote repository to consult. Do not commit or push changes.

Verify both skills against source, run the authored checks, and run structural validation. Then expose the library's actual source and generated skills as an installed package in a separate consumer fixture. Do not include the authoring tests, reference solutions, conversation, or grader. Configure consumer permission for `@intent-fixture/parcel-client`, run the candidate's ordinary `install`, and start a fresh agent with [task.md](task.md). Grade the resulting `client.mjs` unchanged.

Run the same task in a separate fixture with the same library source but without skills or Intent guidance. Preserve the task and grader across both conditions. Record which skills actually loaded, package/skill content hashes, agent/model, setup, resulting diff, and check outcomes. If the candidate is unpublished, bind generated Intent commands to the actual extracted candidate CLI in the disposable test environment and record that binding; never substitute fabricated command output.

The live check used an already installed Copilot CLI with a separate `COPILOT_HOME`, memory disabled, no custom instruction directories, built-in MCPs disabled, no automatic updates, and no remote session export. It copied no credentials or personal configuration. Authentication used the existing account. A fresh session is an isolation measure for evaluation, not a security sandbox. Other existing agent runtimes can follow the same task/fixture/grader contract; do not install a runtime just to run this check.

## Observed authoring and consumer results

On September 5, 2026, Copilot CLI `1.0.82-1` with its default `claude-sonnet-5` model found the installed maintainer instructions and ran `meta generate-skill` without the initial request naming Intent. It created both agreed skills and executable task checks. A separate consumer session discovered and loaded both skills through `list` and `load`.

| Condition                               | Protected consumer check | Finding                                                                                  |
| --------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| Initial generated skills                | Failed                   | The suggested `error.code` classifier replaced a null rejection with a `TypeError`.      |
| Same task without skills                | Passed                   | The baseline guarded access and preserved the original rejection.                        |
| Corrected skills, another fresh session | Passed                   | The unchanged grader accepted retry bounds, error identity, cancellation and pagination. |

Source review also caught inaccurate claims about synchronous throws and cancellation after successful operations. The correction pass produced 16 passing library/task tests. That author session stalled after writing the repair artifacts and was stopped; its completion was not counted as a pass. The artifacts were checked separately, and a remaining overbroad claim about primitive property access was corrected after a direct runtime check. The subsequent consumer session completed normally and passed the protected grader.

These runs demonstrate discovery, an observed failure, and a checked repair. They do not establish a reliability rate or an improvement over the baseline. Structural validation and self-authored checks alone did not catch all incorrect guidance.

## Ordinary-change check

Start from the reviewed initial batch, with completed outcomes recorded by `intent review --record`. In a new author session, request only a library change:

> Add an optional onRetry(error, nextAttempt) callback to request. Invoke it only after shouldRetry allows another attempt, with the next attempt number. A callback exception should reject the request and prevent another operation call. Cover the behavior with tests. Do not commit or publish.

Verify the source behavior independently, then inspect whether the agent updated the affected guidance, kept unrelated guidance accurate, ran task checks, and recorded current fingerprints. `intent review --check` must catch any missing review, even if the agent skipped the procedure. The generated PR workflow runs that check when maintainer guidance or review state is present. Use its actual failure output as the next input if recovery is needed; do not manually clear state to turn a failing run into a pass.

In the observed ordinary-change run, the agent added the callback, updated the retry skill, and passed the package's 20 tests, but omitted recording the review. The real `review --check` failed with two pending skills. Given that failing check as follow-up input, the agent recorded `updated` for retries and an evidence-backed `no-change` for pagination, whose source function was untouched. The repeated check then returned zero pending items. This confirms the fallback catches a skipped procedure; it does not show that agent instructions are obeyed on every first attempt.

A further fresh consumer loaded the updated guidance and implemented a wrapper that reports retries through the new callback. Independent checks passed for callback timing, error/next-attempt arguments, the three-call limit, permanent and null rejection preservation, and callback exceptions preventing another operation call. The installed block now explicitly names `review --json` before handoff as well as the authoring entry point.

## Cumulative planning record check

Use a new disposable fixture and the packed maintainer setup above. Start with only retries and cancellation agreed for the first batch, explicitly requiring retries to remain opt-in and pagination to remain future work. Save the resulting skills and planning documents before a fresh session requests the pagination batch, including empty pages and empty-string cursors.

After each batch, parse `domain_map.yaml` and `skill_tree.yaml`, inspect `skill_spec.md`, and compare them with the actual skill files and the previous snapshot. Check implemented paths separately from planned future entries. Require matching skill identities, retained maintainer decisions, preserved prior batch history, and a recorded reason when planned work becomes implemented. Run the real `review --check`; use its failure output for recovery if review outcomes were omitted.

The September 5, 2026 check used the same installed Copilot runtime and isolation settings described above, with separate author sessions for each batch. It evaluated record creation and incremental maintenance; no additional independent consumer session was provided for this extension.

| Stage                       | Observed result                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First batch                 | Created all three documents, the retry/cancellation skill, executable checks, the opt-in decision, and a planned pagination entry. Omitted review recording; the real check caught eight pending items.                         |
| Second batch                | Added pagination and updated all three documents while retaining the retry skill, opt-in decision, and first batch history. Recorded review outcomes without a recovery prompt; the repeated check returned zero pending items. |
| Independent artifact checks | Both YAML documents parsed; implemented paths existed and matched the map/spec; previous skill identities and decisions remained present.                                                                                       |

These observations establish that the workflow can extend the record across two batches. They do not prove every generated claim is correct or that agents always finish review recording. Deterministic review tests separately cover source changes reopening planning review, evidence-backed no-ops, missing/invalid/ignored documents, removed skills, stale reports, and monorepo placement.

## Description and script checks

For new or changed skill descriptions, keep realistic should-load and adjacent should-not-load requests with the task cases. Observe actual `SKILL.md` loading through normal consumer setup, and keep that evidence separate from the protected task grader. Description revisions need fresh or held-out requests; the workflow runs above are not a systematic trigger evaluation.

An additional description-only session produced explicit use conditions and cleared recorded review, but independent source checks found overbroad cancellation and duplicate-prevention claims. A repair session was interrupted and is not counted as passing evidence. These results prompted checking description claims against behavior, alongside the body; an activation phrase alone establishes neither accuracy nor discovery quality.

For the purpose migration, start from the pre-edit skill files in a separate disposable fixture. Ask the agent to apply the current authoring format while preserving the existing tasks, descriptive meaning, behavior, and maintainer decisions. Compare decoded `metadata.purpose` with each original `description`, inspect activation scope and the matching tree entries, verify that task grouping and prior history survive, and run the actual review check. Preserve an existing purpose on subsequent updates. This is an authoring check, not a consumer activation measurement.

The final migration run used another isolated author session with the same runtime. Independent checks found:

| Check                    | Observed result                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose preservation     | Both decoded purposes exactly matched their pre-edit descriptions. Tree purposes retained the same text, with only YAML terminal-newline differences.                                                                          |
| Grouping and records     | Retries/cancellation stayed together; pagination remained separate. The agent extended the tree and spec, preserved the accurate domain map, and retained earlier batches and the opt-in decision.                             |
| Validation and recording | Both skills validated; five unchanged library tests passed. The agent repaired invalid YAML and review evidence during the run, recorded four outcomes, and the independent `review --check` returned zero pending items.      |
| Semantic accuracy        | Cancellation wording still failed to distinguish aborting a retry loop from an active operation resolving successfully after abort. A direct runtime check confirmed the distinction; this run is not a semantic-quality pass. |
| Consumer discovery       | Not evaluated in this migration run.                                                                                                                                                                                           |

For any bundled helper, run its documented invocation from the installed package with valid and invalid input. Verify prerequisites, noninteractive input, exit status, and output. No new helper scripts are required by this fixture.

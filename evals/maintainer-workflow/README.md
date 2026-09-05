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

| Condition | Protected consumer check | Finding |
| --- | --- | --- |
| Initial generated skills | Failed | The suggested `error.code` classifier replaced a null rejection with a `TypeError`. |
| Same task without skills | Passed | The baseline guarded access and preserved the original rejection. |
| Corrected skills, another fresh session | Passed | The unchanged grader accepted retry bounds, error identity, cancellation and pagination. |

Source review also caught inaccurate claims about synchronous throws and cancellation after successful operations. The correction pass produced 16 passing library/task tests. That author session stalled after writing the repair artifacts and was stopped; its completion was not counted as a pass. The artifacts were checked separately, and a remaining overbroad claim about primitive property access was corrected after a direct runtime check. The subsequent consumer session completed normally and passed the protected grader.

These runs demonstrate discovery, an observed failure, and a checked repair. They do not establish a reliability rate or an improvement over the baseline. Structural validation and self-authored checks alone did not catch all incorrect guidance.

## Ordinary-change check

Start from the reviewed initial batch, with completed outcomes recorded by `intent review --record`. In a new author session, request only a library change:

> Add an optional onRetry(error, nextAttempt) callback to request. Invoke it only after shouldRetry allows another attempt, with the next attempt number. A callback exception should reject the request and prevent another operation call. Cover the behavior with tests. Do not commit or publish.

Verify the source behavior independently, then inspect whether the agent updated the affected guidance, kept unrelated guidance accurate, ran task checks, and recorded current fingerprints. `intent review --check` must catch any missing review, even if the agent skipped the procedure. The generated PR workflow runs that check when maintainer guidance or review state is present. Use its actual failure output as the next input if recovery is needed; do not manually clear state to turn a failing run into a pass.

In the observed ordinary-change run, the agent added the callback, updated the retry skill, and passed the package's 20 tests, but omitted recording the review. The real `review --check` failed with two pending skills. Given that failing check as follow-up input, the agent recorded `updated` for retries and an evidence-backed `no-change` for pagination, whose source function was untouched. The repeated check then returned zero pending items. This confirms the fallback catches a skipped procedure; it does not show that agent instructions are obeyed on every first attempt.

A further fresh consumer loaded the updated guidance and implemented a wrapper that reports retries through the new callback. Independent checks passed for callback timing, error/next-attempt arguments, the three-call limit, permanent and null rejection preservation, and callback exceptions preventing another operation call. The installed block now explicitly names `review --json` before handoff as well as the authoring entry point.

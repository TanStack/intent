# Check whether the skill enables its task

Read this for new skills and when a change affects the behavior a skill recommends. Reuse a relevant existing case when it exercises the same behavior. Reference-only edits can use their owning task's checks; explain that coverage instead of duplicating the case.

## Check discovery separately

For new or changed descriptions, follow [Agent Skills description evaluation](https://agentskills.io/skill-creation/optimizing-descriptions). Save realistic should-load prompts and adjacent should-not-load prompts with the task cases. Include requests that omit the library's API vocabulary. Expose the skill through normal consumer setup and inspect whether the agent actually loads its `SKILL.md`; a skill name in the answer is insufficient.

Repeat ambiguous results and record observed activation separately from task success. When tuning a description, keep a fixed mix of positive and negative prompts held out from revision, then check fresh phrasings. Report the prompts, attempts, and observed loads; do not claim a reliability rate from one run. If the runtime cannot expose discovery, mark it unverified rather than substituting a keyword match or structural validation.

## Define an observable task

Use the library's existing examples and tests to choose a realistic developer request. Include the important constraint or failure case the skill exists to address. A check that only imports the package or asserts that the agent loaded a skill is insufficient.

Put the case in the repository's existing test or eval layout. When no layout exists, use `tests/skills/<task>/` with a `task.md`, a small starting fixture, and an executable check using the package's existing test runner. The task describes what the developer needs without supplying the solution. The checks assert externally observable behavior, including the relevant error path. Keep grading tests outside the files the consumer agent is asked to edit.

Use real package APIs and the actual source version being reviewed. Execute the expected solution to validate the fixture and checker before using them to grade an agent. Apply the same behavioral assertions to a plausible incorrect solution, such as the specific mistake the skill warns about, and confirm those assertions fail. An assertion that merely says the bad solution is different does not establish that the grader rejects it. If the intended behavior is unresolved, get that decision before authoring dependent guidance or grading it.

Check precise claims in the description as well as the body and main happy path. For asynchronous APIs, distinguish synchronous throws from rejected promises, cancellation before a call from cancellation during one, and rejection from successful completion. Exercise the input and error shapes supported by the actual API before claiming errors are always preserved. A passing representative task does not validate every statement in a skill.

## Exercise a fresh consumer session

Use an available isolated agent session in a disposable copy of the fixture. Install or expose the candidate package and skill through the same Intent setup a consumer would use. Start from the plain developer task with no authoring conversation, personal memory, answer files, or extra hints. Keep the full authoring repository and the grader out of the consumer's context when the task does not require them.

Let the consumer attempt the task, then run the unchanged grading checks against its output. Capture the skill and package revisions, setup used, agent/model when available, final diff, check results, and which guidance actually loaded. Failed or unavailable runs are not passing quality evidence. Do not install another agent, grant broader permissions, or expose credentials just to make the evaluation run.

Inspect the observable tool trace as well as the result: unnecessary reference loads, repeated command reconstruction, and ignored constraints identify where to refine the procedure. Review successful runs too; a passing result can hide avoidable work. Keep useful source-backed corrections and remove instructions the task does not need.

When practical, run the same task and checker in a separate fixture without the candidate skill. This can show whether the skill adds value. One passing run establishes only that observed result; do not claim reliability or an improvement from incomparable tasks, different expected outcomes, or one successful attempt.

If no fresh-session capability is available, still create and run the deterministic task checks, then report consumer behavior as unverified. The maintainer can review the skill and executable case together. Do not replace that missing evidence with an authoring agent's statement that its own guidance looks correct.

## Respond to failures and updates

Investigate whether a failure belongs to setup/discovery, an incorrect or incomplete skill, an unsupported API, or the fixture/checker. Repair the owning defect. Preserve the check's intended behavior; do not relax an assertion to make a generated solution pass. Repeat the affected check after a repair.

When source behavior changes, update the expected outcome from the source evidence and rerun the affected case. Preserve unrelated cases. Report structural validation, executable task checks, and fresh-agent outcomes separately so the maintainer knows what was actually proved.

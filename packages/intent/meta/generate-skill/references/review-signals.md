# Act on an Intent review report

Read this when the input is `intent stale` output, `review-items.json`, or
an Intent review PR. These signals identify candidates for investigation;
they do not establish that skill content is wrong. The CLI does not compare
source diffs or author updates.

Use the report and existing conversation to locate the owning package,
skill, and relevant change. Preserve maintainer decisions already recorded
in repository instructions and artifacts. Inspect only the artifacts and
sources needed to resolve the supplied items; their existence does not
require a new full-library interview.

## Interpret the signal before editing

| Input                                                  | Evidence needed                                                                                                            | Possible outcome                                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stale skill or version drift                           | The current skill's claims and an actual source diff or documented before/after behavior for the target version.           | Update affected guidance, or explain why it remains accurate. A version number alone proves neither outcome.                                                             |
| Missing source SHA                                     | The referenced source and a trustworthy revision or baseline. A missing stored SHA does not prove that the source changed. | Establish the evidence before deciding whether guidance needs an update. If unavailable, report uncertainty.                                                             |
| Missing package, artifact, or generated-skill coverage | Public tasks in the package, existing skill owners, and relevant artifact entries or exclusions.                           | Extend an existing owner, create one independently useful task, or retain a supported out-of-scope decision. Ask only if an unresolved scope choice changes the outcome. |
| Invalid or unreadable artifact                         | The reported parse/validation error and the relevant artifact content.                                                     | Report the affected coverage conclusion as unknown until the artifact can be read. Do not infer absent coverage from a failed read.                                      |
| `stale-check-failed`                                   | The workflow logs or a reproducible command failure.                                                                       | Explain the failed check and what evidence is unavailable. A failed check is not evidence for a skill rewrite.                                                           |
| `workflow-advisory`                                    | The advisory and installed workflow version.                                                                               | Report workflow maintenance separately. The reminder does not justify skill edits or authorize workflow installation.                                                    |

For an unfamiliar signal, inspect its reported reasons and the relevant
source before acting. Do not guess a content update from its label.

## Apply focused authoring

Return to the main procedure once the relevant task and evidence are known.
Keep all items in the maintainer's requested batch visible, but change only
guidance supported by that evidence. Do not fabricate artifacts, coverage
exclusions, source SHAs, or version bumps to make the report go quiet.
Update an existing artifact only when the verified change would otherwise
leave it materially inconsistent with its skills.

Return a disposition for each input item: updated, verified no change,
out of scope with evidence, or unresolved with the missing evidence or
decision. Include source/version evidence and validation results for edits.
A report may remain flagged after an evidence-backed no-op; say why instead
of treating a clean `stale` result as the completion criterion.

Stop at a reviewable diff and the item dispositions. Creating, committing,
pushing, or closing a PR, changing labels, and installing workflows require
the maintainer's request.

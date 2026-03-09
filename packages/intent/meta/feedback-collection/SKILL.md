---
name: skill-feedback-collection
description: >
  Collect structured feedback about skill usage after completing a coding task.
  Activate at the end of any session where one or more SKILL.md files were
  loaded. Captures agent signals (gaps, errors, corrections, human interventions)
  and brief human input, then submits directly via gh CLI or provides manual
  submission instructions.
metadata:
  version: '2.0'
  category: meta-tooling
---

# Skill Feedback Collection

Run this at the end of any session where you loaded one or more SKILL.md files.
The goal is to capture what worked, what didn't, and what was missing — so skill
maintainers can improve future versions.

This skill also covers **meta-skill feedback** — feedback about the scaffolding
process itself. When invoked after running domain-discovery, tree-generator, and
generate-skill, treat those three meta skills as the "skills" being evaluated.
Capture what worked and what didn't in each scaffolding phase so the meta skills
can be improved.

---

## Phase 1 — Automated Signal Collection

Review your own session transcript. No human interaction needed yet.

### 1a: Skills inventory

Before analyzing gaps and errors, inventory all skills that were available
during the session:

- **Loaded and used:** Skills you read and actively followed.
- **Available but not loaded:** Skills that were installed (discoverable via
  `intent list`) but you never read. This is important — many issues stem from
  the agent not loading the right skill, not from the skill itself being wrong.

### 1b: Gap detection

Identify moments where the skill was silent and you had to bridge the gap
yourself — via code reading, search, trial-and-error, or general knowledge.

For each gap, note:

- What you needed to do
- What the skill should have told you
- How you solved it (code reading, web search, guessing)

### 1c: Error/correction tracking

Identify moments where the skill prescribed an approach that produced an error.

For each error, note:

- What the skill said to do
- The error or incorrect behavior that resulted
- The fix you applied

### 1d: Human intervention events

Identify moments where the human clarified, corrected, or overrode your approach.

For each intervention, note:

- What you were doing when the human intervened
- What the human said or changed
- Whether the skill could have prevented this

### 1e: Step duration anomalies

Identify steps that consumed disproportionate effort compared to their apparent
complexity. These signal that the skill should provide a template, snippet, or
more detailed guidance.

---

## Phase 2 — Human Interview

Ask the human up to 4 questions. Keep it brief — skip questions if the session
already provided clear answers. Respect if they decline.

1. "Was anything unclear about what was happening during the task?"
2. "Did anything feel frustrating or take longer than expected?"
3. "Were you uncertain about the output quality at any point?"
4. "Anything you'd want done differently next time?"

Derive `userRating` from overall sentiment:

- Mostly positive → `good`
- Mixed signals → `mixed`
- Mostly negative → `bad`

If the human gives an explicit rating, use that instead.

---

## Phase 3 — Build the Feedback

Write one Markdown feedback file per skill used. Only include skills that were
actually used during the session — skip any that were loaded but never
referenced.

### Template

```markdown
# Skill Feedback: [skill name from SKILL.md frontmatter]

**Package:** [npm package name that contains the skill]
**Skill version:** [metadata.version or library_version from frontmatter]
**Rating:** [good | mixed | bad]

## Task

[one-sentence summary of what the human asked you to do]

## Skills Inventory

**Loaded and used:**

- [list each skill the agent read and actively followed during the session]

**Available but not loaded:**

- [list skills that were installed/available but the agent never read]

## What Worked

[patterns/instructions from the skill that were accurate and helpful]

## What Failed

[from 1c — skill instructions that produced errors]

## Missing

[from 1b — gaps where the skill should have covered]

## Self-Corrections

[from 1c fixes + 1d human interventions, combined]

## User Comments

[optional — direct quotes or paraphrased human input from Phase 2]
```

### Field derivation guide

| Field            | Source                                                             |
| ---------------- | ------------------------------------------------------------------ |
| Skill name       | Frontmatter `name` field of the SKILL.md you loaded                |
| Package          | The npm package the skill lives in (e.g. `@tanstack/query-intent`) |
| Skill version    | Frontmatter `metadata.version` or `library_version`                |
| Task             | Summarize the human's original request in one sentence             |
| Skills Inventory | Which skills were loaded vs. available but not loaded (see below)  |
| What Worked      | List skill sections/patterns that were correct and useful          |
| What Failed      | From 1c — skill instructions that produced errors                  |
| Missing          | From 1b — gaps where the skill was silent                          |
| Self-Corrections | From 1c fixes + 1d human interventions, combined                   |
| Rating           | From Phase 2 sentiment analysis or explicit rating                 |
| User Comments    | From Phase 2 answers, keep brief                                   |

---

## Phase 4 — Submit

Determine the target repo from the skill's package. The repo is typically
derivable from the `repository` field in the package's `package.json`, or
from the `sources` field in the SKILL.md frontmatter.

### Link to existing issues/discussions

Before creating a new issue, search the target repo for existing issues or
discussions that match the feedback. Use `gh search issues` or the GitHub
web search with keywords from the "What Failed" and "Missing" sections.

- If an **open issue** already describes the same problem, comment on it
  with the feedback instead of creating a duplicate. Reference the skill
  name and version in your comment.
- If a **closed issue** describes a problem the skill still gets wrong
  (regression or stale skill content), reference the closed issue in the
  new feedback issue body: `Related to #[number] — this was fixed in the
library but the skill still describes the old behavior.`
- If a **discussion thread** covers the same topic, link to it in the
  feedback issue body so maintainers can see the community context.

This prevents duplicate issues and gives maintainers richer context for
improving skills.

### Privacy check

Before submitting, determine whether the user's project is public or private.
Check with `gh repo view --json visibility` or look for a `private` field in
the project's `package.json`. If you can't determine visibility, assume private.

**Private repos:** Feedback is submitted to a public issue tracker, so it must
not contain project-specific details. Before submission:

1. Strip any project-specific code, file paths, internal API names, service
   URLs, or business logic from all fields
2. Rewrite the "Task" field to describe the _type_ of task generically
   (e.g. "set up authenticated data fetching" not "set up auth for our
   internal billing API at api.acme.corp/billing")
3. Rewrite "What Failed" and "Missing" entries to reference only the
   skill's own APIs and patterns, not the user's code
4. Show the sanitized feedback to the user and ask them to confirm it's
   safe to submit before proceeding

**Public repos:** No sanitization needed. Proceed directly to submission.

### If `gh` CLI is available

Submit directly as a GitHub issue:

```bash
gh issue create --repo [owner/repo] --title "Skill Feedback: [skill-name] ([rating])" --label "skill:[skill-name]" --body-file intent-feedback.md
```

If the label doesn't exist, omit the `--label` flag — don't let a missing
label block submission.

If submission succeeds, delete the feedback file.

### If `gh` CLI is not available

Tell the human:

> "I've written skill feedback to `intent-feedback.md`. To submit it,
> open an issue at https://github.com/[owner/repo]/issues and paste the
> contents."

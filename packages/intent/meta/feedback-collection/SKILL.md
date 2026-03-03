---
name: skill-feedback-collection
description: >
  Collect structured feedback about skill usage after completing a coding task.
  Activate at the end of any session where one or more SKILL.md files were
  loaded. Captures agent signals (gaps, errors, corrections, human interventions)
  and brief human input, then submits via the intent feedback CLI.
metadata:
  version: '1.0'
  category: meta-tooling
  output_artifacts:
    - intent-feedback.json
---

# Skill Feedback Collection

Run this at the end of any session where you loaded one or more SKILL.md files.
The goal is to capture what worked, what didn't, and what was missing — so skill
maintainers can improve future versions.

---

## Phase 1 — Automated Signal Collection

Review your own session transcript. No human interaction needed yet.

### 1a: Gap detection

Identify moments where the skill was silent and you had to bridge the gap
yourself — via code reading, search, trial-and-error, or general knowledge.

For each gap, note:

- What you needed to do
- What the skill should have told you
- How you solved it (code reading, web search, guessing)

### 1b: Error/correction tracking

Identify moments where the skill prescribed an approach that produced an error.

For each error, note:

- What the skill said to do
- The error or incorrect behavior that resulted
- The fix you applied

### 1c: Human intervention events

Identify moments where the human clarified, corrected, or overrode your approach.

For each intervention, note:

- What you were doing when the human intervened
- What the human said or changed
- Whether the skill could have prevented this

### 1d: Step duration anomalies

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

## Phase 3 — Build the Payload

Construct one JSON payload per skill used. The schema must match exactly:

```json
{
  "skill": "<skill name from SKILL.md frontmatter>",
  "package": "<npm package name that contains the skill>",
  "skillVersion": "<metadata.version from SKILL.md frontmatter, or library_version>",
  "task": "<one-sentence summary of what the human asked you to do>",
  "whatWorked": "<patterns/instructions from the skill that were accurate and helpful>",
  "whatFailed": "<errors from 1b — what the skill got wrong>",
  "missing": "<gaps from 1a — what the skill should have covered>",
  "selfCorrections": "<fixes you applied from 1b + interventions from 1c>",
  "userRating": "good | mixed | bad",
  "userComments": "<optional — direct quotes or paraphrased human input from Phase 2>"
}
```

### Field derivation guide

| Field             | Source                                                             |
| ----------------- | ------------------------------------------------------------------ |
| `skill`           | Frontmatter `name` field of the SKILL.md you loaded                |
| `package`         | The npm package the skill lives in (e.g. `@tanstack/query-intent`) |
| `skillVersion`    | Frontmatter `metadata.version` or `library_version`                |
| `task`            | Summarize the human's original request in one sentence             |
| `whatWorked`      | List skill sections/patterns that were correct and useful          |
| `whatFailed`      | From 1b — skill instructions that produced errors                  |
| `missing`         | From 1a — gaps where the skill was silent                          |
| `selfCorrections` | From 1b fixes + 1c human interventions, combined                   |
| `userRating`      | From Phase 2 sentiment analysis or explicit rating                 |
| `userComments`    | From Phase 2 answers, keep brief                                   |

### Example

```json
{
  "skill": "tanstack-query/core",
  "package": "@anthropic/tanstack-query-intent",
  "skillVersion": "1.0",
  "task": "Add optimistic updates to a mutation with rollback on error",
  "whatWorked": "Setup pattern was correct. onMutate/onError/onSettled lifecycle was accurate.",
  "whatFailed": "Cache key format used array syntax that doesn't match v5 — had to switch to queryOptions pattern.",
  "missing": "No guidance on TypeScript generics for mutation variables. Had to read source.",
  "selfCorrections": "Fixed cache key format. Human corrected the rollback type to include undefined.",
  "userRating": "mixed",
  "userComments": "The optimistic update pattern was helpful but the cache key thing wasted 10 minutes."
}
```

If multiple skills were loaded, produce one payload per skill. Only include
skills that were actually used during the session — skip any that were loaded
but never referenced.

---

## Phase 4 — Submit

1. Save the payload to `intent-feedback.json` in the project root.
   If multiple skills, save as a JSON array.

2. Submit:

   ```bash
   npx intent feedback --submit --file intent-feedback.json
   ```

3. If the submission succeeds, delete `intent-feedback.json`.

4. If it fails, tell the human and leave the file for manual retry.

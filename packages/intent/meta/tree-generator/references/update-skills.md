## Workflow B — Update existing skills

### Trigger conditions

Run when:

- The library has released a new version
- A maintainer reports skills produce outdated code
- A changelog or migration guide has been published since skill creation
- Issue reports indicate skill content is inaccurate

### Step 1 — Detect staleness

Compare each skill's `library_version` against the current library version.

1. Read changelog entries between the two versions
2. Read migration guide (if one exists)
3. For each skill, check if its `sources` files have changed

Produce a staleness report:

```yaml
# staleness_report.yaml
library: '[name]'
library_version_in_skills: '[old]'
library_version_current: '[new]'

stale_skills:
  - skill: '[skill name]'
    reason: '[what changed]'
    severity: '[BREAKING | DEPRECATION | BEHAVIORAL | ADDITIVE]'
    changelog_entry: '[relevant entry]'
    affected_sections:
      - '[Setup | Core Patterns | Common Mistakes]'

current_skills:
  - skill: '[skill name]'
    reason: '[no changes affect this domain]'
```

### Step 2 — Update stale skills

**BREAKING changes:**

1. Old pattern becomes a new Common Mistake entry (wrong/correct pair)
2. Update Setup if initialization changed
3. Update Core Patterns if idiomatic approach changed
4. Bump `library_version` in frontmatter
5. Check both core AND framework skills — breaking changes may affect both

**DEPRECATION changes:**

1. Add Common Mistake: deprecated API as wrong, replacement as correct
2. Update Core Patterns to use non-deprecated API
3. Bump `library_version`

**BEHAVIORAL changes:**

1. Default value changed → add Common Mistake entry
2. Type signature more restrictive → add Common Mistake entry
3. Update affected code blocks
4. Bump `library_version`

**ADDITIVE changes:**

1. Evaluate if new feature belongs in existing domain or needs a new skill
2. If existing: add to Core Patterns or references/
3. If new skill needed: create it and update the parent skill's sub-skill
   registry
4. Bump `library_version`

### Step 3 — Produce a changelog entry

```markdown
## [date]

### Updated for [library] v[new version]

**Breaking changes:**

- [skill name]: [what changed and why]

**Deprecation updates:**

- [skill name]: [old API] → [new API]

**New skills:**

- [skill name]: [what it covers]
```

---

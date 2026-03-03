# Oz Prompt: Skill Update (Staleness Check)

Use this prompt to check existing skills for staleness after a library
version change and surgically update any that are outdated.

## Prerequisites

- Existing skills in `skills/` directory
- `@tanstack/intent` installed

---

## Prompt

Read the meta-skill at `node_modules/@tanstack/intent/meta/skill-staleness-check/SKILL.md`
and follow its instructions.

### Context

- **Package:** [PACKAGE_NAME]
- **Previous version:** [OLD_VERSION] (check skill frontmatter `library_version`)
- **Current version:** [NEW_VERSION]
- **Changelog:** [CHANGELOG_PATH or URL]

### Task

1. Find all SKILL.md files under skills/
2. Compare each skill's `library_version` against the current version
3. Read the changelog/migration guide for changes between versions
4. For each skill, classify the impact: no-impact, version-bump, content-update, breaking
5. For content updates and breaking changes:
   - Read the generate-skill meta-skill at
     `node_modules/@tanstack/intent/meta/generate-skill/SKILL.md`
   - Use regeneration mode — surgical updates, not full rewrites
   - Add old patterns as new Common Mistake entries for breaking changes
6. Bump `library_version` in all updated skill frontmatter
7. Run `npx intent validate skills/` to verify

### Output

If nothing needs updating, say so and exit.

If skills were updated, summarize:

- Which skills were updated and why
- What sections changed
- Any new Common Mistake entries added

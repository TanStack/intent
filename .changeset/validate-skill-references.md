---
'@tanstack/intent': patch
---

`intent validate` now checks every Markdown file under a skill's `references/` directory: the file must not begin with frontmatter, the `SKILL.md` body must link to it directly, and its TypeScript and JavaScript examples are checked with the skill's examples. A `skill_tree.yaml` entry for a skill with reference files must list them in a `references` key, and the list must match the files. Existing repositories now fail validation for reference files that `SKILL.md` does not link to directly, reference frontmatter, reference examples that do not typecheck, and tree entries that do not list their skill's reference files.

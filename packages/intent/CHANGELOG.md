# @tanstack/intent

## 0.0.11

### Patch Changes

- Replace `intent setup` with three focused commands: `intent add-library-bin`, `intent edit-package-json`, and `intent setup-github-actions`. The new `edit-package-json` command automatically wires the `files` array and `bin` field, handling existing CLIs (both object and string shorthand forms) without clobbering them. Improve meta skill SKILL.md files based on real scaffolding feedback: soften lightweight path threshold, add companion library and experimental features questions, add YAML validation step, add subagent guidance for parallel generation, and replace inline feedback sections with a pointer to the feedback-collection skill. ([#37](https://github.com/TanStack/intent/pull/37))

- 3 files changed in packages/playbooks/meta/ ([#33](https://github.com/TanStack/intent/pull/33))

  domain-discovery/SKILL.md (681 → ~792 lines)
  - Added "Hard rules" section: 7 mandatory rules enforcing interactive interviews, prohibiting docs-as-substitute, question collapsing, and interview skipping
  - Added 3 STOP gates between phases (1→2, 3→4, and after Phase 2d skill list confirmation)
  - Strengthened Phase 2 & 4 headers with explicit interactivity requirements and "wait for response" instructions
  - Added Phase 3 thoroughness: file checklist before reading, read-all enforcement, peer dependency analysis in Phase 1b
  - Added 7 new constraint table rows for interview interactivity
  - Updated cross-model compatibility notes with STOP gate and question protection rationale
  - Added cross-package monorepo question in Phase 2a
  - Added packages field to domain_map.yaml schema (package-relative ownership model)
  - Softened feedback section to alpha-temporary
  - tree-generator/SKILL.md (859 → ~898 lines)
  - Strengthened compressed discovery warning (requires maintainer confirmation to skip)
  - Added packages field to skill_tree.yaml schema
  - Added monorepo placement section with concrete directory tree example showing skills inside each package
  - Added STOP gate after Step 1 (file tree review before writing)
  - Added STOP gate after Step 8 (validation results review)
  - Added 2 new constraint rows (file tree reviewed, validation presented)
  - Softened feedback section to alpha-temporary
  - generate-skill/SKILL.md (419 → ~441 lines)
  - Added packages field to frontmatter template
  - Added monorepo path guidance: skills ship inside each package, not repo root
  - Added STOP gate in Step 6: first skill reviewed before generating batch
  - Added first-skill-reviewed constraint row
  - Softened feedback section to alpha-temporary

## 0.1.0

### Patch Changes

- Add `intent-library` end-user CLI for library consumers. Libraries wire it up via a generated shim (`intent setup --shim`) to expose an `intent` bin. Running `intent list` recursively discovers skills across the library's dependency tree; `intent install` prints an agent-driven prompt to map skills to project tasks in CLAUDE.md. ([#9](https://github.com/TanStack/intent/pull/9))

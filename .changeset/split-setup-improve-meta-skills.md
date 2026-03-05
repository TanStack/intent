---
'@tanstack/intent': patch
---

Replace `intent setup` with three focused commands: `intent add-library-bin`, `intent edit-package-json`, and `intent setup-github-actions`. The new `edit-package-json` command automatically wires the `files` array and `bin` field, handling existing CLIs (both object and string shorthand forms) without clobbering them. Improve meta skill SKILL.md files based on real scaffolding feedback: soften lightweight path threshold, add companion library and experimental features questions, add YAML validation step, add subagent guidance for parallel generation, and replace inline feedback sections with a pointer to the feedback-collection skill.

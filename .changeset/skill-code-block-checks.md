---
'@tanstack/intent': minor
---

`validate` checks every fenced TypeScript and JavaScript block in a `SKILL.md` against the owning package's own types when TypeScript is available in the repository. A renamed export, a removed option, or a changed shape fails validation with the skill file and line. Imports of exports marked `@deprecated` produce warnings, and relative Markdown links must resolve. Names, modules, and globals a partial snippet leaves out are not reported. Repositories without TypeScript skip the code checks with a notice. Pending review items for skills report whether their examples still compile.

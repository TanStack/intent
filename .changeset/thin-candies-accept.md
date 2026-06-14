---
'@tanstack/intent': patch
---

Read skill frontmatter scalar fields (`type`, `framework`, `library_version`)
from `metadata.*` with a fallback to the top-level key (#159). This is a
back-compat safety net for the frontmatter migration: skills authored in the
new `metadata`-nested shape resolve correctly while existing top-level skills
keep working unchanged. The scanner, staleness checker, and the framework
`requires` validation all honor both shapes.

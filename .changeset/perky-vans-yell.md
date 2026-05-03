---
'@tanstack/intent': patch
---

Refactor workspace pattern discovery to use a JSONC parser for Deno configs, support additional workspace config shapes, and cache workspace roots, parsed patterns, and resolved package directories during CLI commands.

This also allows Deno workspace members with `deno.json` or `deno.jsonc` manifests to be resolved as workspace packages.

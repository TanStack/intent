---
'@tanstack/intent': patch
---

Make the installed package 28 kB smaller by bundling `yaml` from its ES module build instead of its CommonJS build. A YAML warning, such as an unresolved tag in skill frontmatter, is now written to stderr by `console.warn`, with a stack trace; before, it went through `process.emitWarning`, and `intent list` and `intent stale` exited before Node printed it. The `LOG_STREAM` and `LOG_TOKENS` environment variables no longer make the YAML parser print its tokens to stdout.

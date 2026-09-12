---
'@tanstack/intent': patch
---

Trim `intent list` and `intent load` startup. Discovery no longer loads the `semver` package on every run (a small built-in comparator picks between duplicate installed versions of a package, with identical results), and `intent install` loads its interactive prompt library only when it actually prompts.

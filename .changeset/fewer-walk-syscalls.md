---
'@tanstack/intent': patch
---

Cut the filesystem work in dependency discovery. Each dependency edge now costs one `readlink` instead of a stat through the symlink plus an `lstat` and a `realpath`; symlink targets, candidate paths, and `node_modules` directories are memoized per scan; and directories the walk has already resolved skip their identity `lstat`. Workspace pattern sorting no longer initializes the ICU collator on every run. `intent list` in a pnpm monorepo runs about 35% faster and in an npm project about 25% faster, with identical results.

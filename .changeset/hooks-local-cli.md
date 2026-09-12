---
'@tanstack/intent': patch
---

Make agent hooks fast when `@tanstack/intent` is installed in the project. The session-start catalog previously ran `npx @tanstack/intent@latest list` (or the pnpm, yarn, or bun equivalent), which resolves the package against the npm registry on every session start and took one to four seconds; the runner now executes the locally installed CLI directly with the current Node binary, which takes about a tenth of a second, and falls back to the package-manager runner only when there is no local install. When that installation also has a `node_modules/.bin/intent` shim, the catalog suggests `node_modules/.bin/intent load <package>#<skill>` for loads (otherwise it keeps suggesting the package-manager runner), and the edit gate recognizes that form. Reinstall hooks with `intent hooks install` to pick up the new runner.

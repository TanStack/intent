---
title: Get Listed on the Registry
---

The [Agent Skills Registry](/intent/registry) automatically discovers and indexes npm packages that ship Agent Skills. There's no manual submission process — publish skills in your package and the registry picks them up.

## How discovery works

The registry periodically searches npm for packages with the `tanstack-intent` keyword. When it finds one, it downloads the tarball, extracts every `skills/**/SKILL.md` file, and indexes the contents. Each new version you publish gets indexed automatically.

## Ship skills in 4 steps

### 1. Generate skills

Tell your AI coding agent to run:

```bash
npx @tanstack/intent@latest scaffold
```

Give the agent a developer task or concrete code/docs change. The focused
procedure creates or updates the relevant guidance and validates it for review;
full-library discovery remains available when explicitly requested. Skills
use the owning package’s `skills/` directory or its existing custom root. See
the [maintainer quick start](./getting-started/quick-start-maintainers).

### 2. Validate

```bash
npx @tanstack/intent@latest validate
```

Catches structural issues, missing frontmatter, and broken source references before you publish.

### 3. Add the keyword

Add `"tanstack-intent"` to the `keywords` array in your `package.json`:

```json
{
  "keywords": ["tanstack-intent"]
}
```

This is how the registry finds your package on npm.

### 4. Publish

```bash
npm publish
```

The registry discovers your package on its next sync cycle. Your skills, version history, and download stats appear on the registry automatically.

## Keeping skills current

Skills derived from docs drift when docs change. Two commands keep them honest:

```bash
npx @tanstack/intent@latest stale
```

Reports version drift, missing stored source SHAs, and artifact or package
coverage signals. It does not compare source diffs. Flagged text reports
include the focused authoring command so your agent can investigate the
evidence and return a reviewable update or an explained no-op.

```bash
npx @tanstack/intent@latest setup
```

Copies CI workflow templates into your repo so validation and staleness checks run in GitHub Actions. Catch drift before it ships.

## Requesting a library

If you use a library that doesn't ship skills yet, the best path is to open an issue on that library's repo pointing them here. The maintainer is the right person to author and own skills for their tool — they know the intent behind the API better than anyone.

You can also point them to the [Agent Skills spec](https://agentskills.io) and the [TanStack Intent overview](/intent/latest/docs/overview) for context.

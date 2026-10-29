---
title: Skill transforms
id: skill-transforms
---

A skill transform customizes guidance for the consuming application while keeping the installed package unchanged. On first load it can return onboarding instructions. After the agent collects preferences, subsequent loads return individualized guidance. An upgraded transform sees the saved answers and can ask only newly applicable questions.

## Declare a transform

Add this Intent extension to the packaged `SKILL.md` frontmatter:

```yaml
---
name: apollo-client
description: Guidance for applications using Apollo Client.
intent-transform:
  entry: ./scripts/transform.mjs
  api: 1
---
Load this skill through Intent to configure it for your application.
```

The entry must be a regular file inside the skill directory. The module must be self-contained JavaScript: imports are disabled, so bundle helpers into that file. Export synchronous `load` and `configure` functions that return strings. Promises and other return types fail.

```js
function readAnswers(config) {
  return config.exists('answers.json')
    ? JSON.parse(config.readFile('answers.json'))
    : {}
}

export function load({ skill, config, commands }) {
  const answers = readAnswers(config)
  if (!answers.queryStyle) {
    return `Inspect the application and ask whether to use Suspense. Save the choice with ${commands.configure} --answer 'queryStyle=suspense' or --answer 'queryStyle=standard', then run ${commands.load}.`
  }
  return skill.readFile(
    answers.queryStyle === 'suspense'
      ? 'references/suspense.md'
      : 'references/queries.md',
  )
}

export function configure({ config, answers, stdin, commands }) {
  const saved = readAnswers(config)
  const incoming = stdin
    ? JSON.parse(stdin)
    : Object.fromEntries(answers.map(({ question, answer }) => [question, answer]))
  for (const [question, answer] of Object.entries(incoming)) {
    if (question !== 'queryStyle' || !['suspense', 'standard'].includes(answer)) {
      throw new Error('queryStyle must be suspense or standard')
    }
    saved[question] = answer
  }
  config.writeFile('answers.json', JSON.stringify(saved, null, 2))
  return `Preferences saved. Run ${commands.load}.`
}
```

## Transform API

Both functions receive `skill`, `config`, and `commands`. `load` additionally receives `args`, an array of trailing command-line arguments, such as `['reconfigure']`. The skill defines what these arguments mean. `configure` additionally receives `answers`, an ordered array of `{ question, answer }` strings, and `stdin`, a string. Flags and stdin are both forwarded; the example chooses stdin when present, but your transform can choose another policy.

`intent configure <skill> --reset` starts the configure function with an empty config folder, optionally alongside new answers or stdin. The reset is committed with the transform's writes only on success.

| Method | `skill` | `config` |
| --- | --- | --- |
| `readFile(path): string` | Read UTF-8 text | Read UTF-8 text |
| `exists(path): boolean` | Check existence | Check existence |
| `listFiles(): string[]` | Sorted file paths | Sorted file paths |
| `writeFile(path, text): void` | Unavailable | Create or replace a file, including parent directories |
| `removeFile(path): void` | Unavailable | Remove a file; missing files are ignored |

Paths are root-relative and use `/`. Absolute paths, `.`/`..` segments, backslashes, colons, and symbolic links are rejected. Files are text; binary assets are not supported by this API. Each filesystem is limited to 512 files and 4 MiB of file content.

`load()` can migrate saved configuration. Preserve explicit answers, use stable question IDs, and ask again only when a choice is missing or cannot be migrated without a decision. Keep source templates separate from generated guidance.

Relative Markdown links in returned strings are interpreted relative to the original skill directory, even when text was assembled from a reference file. Intent rewrites those links for the consuming project. Discovery continues to use the packaged frontmatter; transforms do not change skill identity or discovery descriptions.

## Execution and persistence

Transforms require Node.js 22+; ordinary skills retain Intent's existing Node support. Intent starts a separate permission-restricted Node process with an empty environment and no grants for host filesystem access, child processes, workers, or native addons. Inside it, a VM receives narrow interfaces to in-memory `@platformatic/vfs` instances (pinned to 0.4.0). The skill filesystem is read-only; config changes are staged until success. No VFS is mounted into the host filesystem.

Node 25+ additionally denies network access through its permission model. Node 22–24 do not enforce network permissions, so network isolation there relies on the best-effort VM restrictions.

The VM has no `process`, `require`, `fetch`, or timers, and string/Wasm code generation is disabled. Execution has a one-second VM timeout and a five-second subprocess timeout, a 64 MiB V8 heap limit, and bounded input/output. A returned string is limited to 4 MiB. These are best-effort restrictions for trusted dependency scripts, including preventing network tracking; they are not a hostile-code security boundary.

Only `load` and `configure` execute transforms. Listing, installation discovery, and `load --path` do not. Enabling a skill source also enables its declared transform when these commands are invoked. See [Trust model](./trust-model).

## Invocation-aware instructions

Both functions receive `commands.load` and `commands.configure`: complete command strings for the resolved skill. Use these strings in instructions instead of hardcoding an Intent launcher. Append question/answer flags to `commands.configure`, quoting answer values appropriately.

For example, an invocation through `npx @tanstack/intent@latest` produces:

```json
{
  "load": "npx @tanstack/intent@latest load '@apollo/client#apollo-client'",
  "configure": "npx @tanstack/intent@latest configure '@apollo/client#apollo-client'"
}
```

A reusable npm script such as `"intent": "intent"`, invoked as `npm run intent -- load ...`, produces `npm run 'intent' -- load ...` and `npm run 'intent' -- configure ...`. Scripts with fixed actions or compound shell commands cannot serve as a reusable launcher and are not reused. Resolution flags such as `--global-only` are retained; previous answers and output flags such as `--json` are not replayed.

Intent uses package-manager metadata and, on POSIX systems, a bounded inspection of launcher ancestors to recover npm/npx package tags and reusable outer scripts. Shell quote style and whitespace are normalized. When the original launcher cannot be recovered, it uses the current executable (or the known package-manager exec command) rather than guessing a package version. Custom shell aliases and arbitrary wrappers cannot always be reconstructed. Library callers can provide `IntentCoreOptions.commandPrefix`; without it, the core API uses `intent`.

A skill distributed without Intent can provide its own script and pass its own `commands` strings to these functions. Intent does not prescribe that script's persistence, rewriting, or execution model.

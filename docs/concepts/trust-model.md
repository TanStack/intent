---
title: Trust model
id: trust-model
---

Skills contain instructions for an agent. Choosing which packages can supply those instructions is a trust decision, controlled by the `intent.skills` allowlist.

## Explicit sources

A package ships skills in a `skills/` directory. Discovery finds every installed package that has one, including transitive dependencies. Discovery does not grant trust.

When configured, `package.json#intent.skills` controls which discovered skills can surface through the CLI and agent integrations:

- **Package entries** permit current and future skills from matching packages.
- **Exact skill entries** permit only the named skill.
- **Source kinds stay separate:** `foo` permits an npm source; `workspace:foo` permits a workspace source. Their wildcard patterns remain kind-specific. The exact `*` entry permits every discovered npm and workspace source.

Trust does not propagate to dependencies. A dependency that ships skills needs its own matching entry. Intent omits unlisted packages and reports them so you can opt in or ignore them.

### Projects without an allowlist

The gate is opt-in today. Without an effective `intent.skills` declaration, discovery commands still surface every discovered package and print a deprecation notice to stderr. A future version will require an explicit allowlist. See [Special forms](./configuration#special-forms).

Default `intent install` handles this state through interactive permission setup.

## First-run permission review

When no effective policy exists, `intent install` follows this flow:

1. **Discover:** show npm and workspace packages, versions, and skill descriptions. Excluded candidates appear in the overview but cannot be selected.
2. **Choose:** select package-wide or exact-skill permissions. An empty selection explicitly confirms disabling all skills.
3. **Review:** show the exact `intent.skills` value and destination file.
4. **Confirm:** replace `package.json` atomically only after affirmative confirmation, then install guidance.

| Outcome | Files changed |
| --- | --- |
| No skills discovered, or all excluded | None. |
| Cancel any prompt | None. |
| Run first-time setup without a TTY | None; the command fails. |
| Save permissions, then fail to write or verify guidance | Confirmed permissions remain saved; the guidance failure is reported separately. |

The completion summary reports skills available under the saved policy. It does not prove that an agent loaded or applied them. See [Default install](../cli/intent-install#default-install) for picker controls and permission choices.

## Static discovery

Intent reads package data as files. It never imports, requires, or executes the code of a discovered package to find or load a skill. Adding a package to your dependency tree cannot run that package's code through Intent.

One exception is sanctioned: in Yarn Plug'n'Play projects, Intent loads Yarn's PnP runtime (`.pnp.cjs`) to map package identities to readable locations. It loads no package entry points, bins, lifecycle scripts, or other package-provided JavaScript. An ESLint rule enforces this invariant in the discovery code.

## Lifecycle boundaries

Intent uses six lifecycle stages in order. It can observe the first three and its side of delivery. Activation and application depend on agent behavior.

| State | Meaning | Observable by Intent |
| --- | --- | --- |
| **1. Available** | Intent discovered the skill from an installed or workspace package. | Yes. |
| **2. Permitted** | Project policy allows the package and skill to surface. `intent.exclude` can remove a package or skill after `intent.skills` permits its source. | Yes. |
| **3. Loaded** | A supported load path resolved the skill and returned its content. | Yes. |
| **4. Delivered** | Intent placed guidance where an agent integration can access it, such as a managed guidance block or session hook context. | Intent can confirm its output, not agent receipt. |
| **5. Activated** | The agent selected or received the skill for a particular task. | No. |
| **6. Applied** | The model followed the skill correctly. | No. |

A hook observing an `intent load` command does not prove that the command succeeded, that the skill was relevant, or that the model used its guidance.

## Unsupported sources

The `git:` source kind is reserved. Intent parses and validates the shape, then rejects it until a future version can pin the resolved ref and content hash. A git entry never loads silently.

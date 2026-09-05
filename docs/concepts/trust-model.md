---
title: Trust model
id: trust-model
---

Skills contain instructions for an agent. Choosing which packages can supply those instructions is a trust decision, controlled by the `intent.skills` allowlist.

## Explicit sources

A package ships skills in a `skills/` directory. Discovery finds every installed package that has one, including transitive dependencies. Discovery does not grant trust.

When configured, `package.json#intent.skills` controls which discovered skills can surface through the CLI and agent integrations:

- **Package entries** enable skills from matching packages, including skills added later.
- **Exact skill entries** enable only the named skill; its instructions can still change.
- **Source kinds stay separate:** `foo` permits an npm source; `workspace:foo` permits a workspace source. Their wildcard patterns remain kind-specific. The exact `*` entry permits every discovered npm and workspace source.

Enabling a source does not record approval of its specific instructions. Skill content can change when dependencies update, and Intent does not yet track or notify you about those changes.

Trust does not propagate to dependencies. A dependency that ships skills needs its own matching entry. Intent omits unlisted packages and reports them so you can opt in or ignore them.

### Projects without an allowlist

The gate is opt-in today. Without an effective `intent.skills` declaration, discovery commands still surface every discovered package and print a deprecation notice to stderr. A future version will require an explicit allowlist. See [Special forms](./configuration#special-forms).

Default `intent install` handles this state through interactive permission setup.

### Invalid policy files

Intent stops policy-controlled listing, loading, and installation when a policy `package.json` cannot be read, contains invalid JSON, or is not a JSON object. The error names the file. Repair or restore that file, then retry the command.

This also applies while finding the workspace root: an unreadable or malformed ancestor `package.json` cannot be skipped, because it may contain inherited restrictions. Repair or restore the named manifest before retrying.

Workspace discovery checks ancestors up to the first workspace declaration or Git repository boundary (`.git` directory or worktree file), including that directory's manifest. It does not inspect manifests above that boundary. Without either boundary, an invalid ancestor stops discovery even if the nearest package is intended to be standalone; Intent cannot determine from an unreadable manifest whether it owns workspace policy. A nested Git repository is treated as a separate project.

## First-run permission review

When no effective policy exists, `intent install` follows this flow:

1. **Discover:** summarize npm and workspace skill counts. Descriptions and exclusions are available through optional inspection.
2. **Choose:** enable all sources, choose packages or scopes, or select individual skills. Package and scope selections stay compact and include future matching skills. A whole scope requires an explicit selection.
3. **Confirm once:** show the current skill count, saved rules, and destination file. Optional individual review opens skill lists only for the selected packages you choose to inspect. It can add exclusions while retaining broad rules; unreviewed packages keep their selection. Only affirmative confirmation saves permissions and exclusions atomically, then installs guidance. An empty selection explicitly confirms disabling all skills.

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

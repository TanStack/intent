---
title: Trust model
id: trust-model
---

Intent discovers skills from your dependencies and can surface permitted skills through its CLI and agent integrations. A skill is instructions an agent follows, so the set of packages allowed to contribute skills is a trust decision. Intent makes that decision explicit through the `intent.skills` allowlist.

## Explicit sources

A package ships skills in a `skills/` directory. Discovery finds every installed package that has one, including transitive dependencies. Discovery does not grant trust.

`package.json#intent.skills` is the gate. A discovered package contributes skills only when an exact entry or `*` pattern in the allowlist matches its package name and source kind. An unlisted package is dropped, and Intent reports it so you can opt in or ignore it.

The gate is opt-in today. A project with no `intent.skills` key still surfaces every discovered package, and Intent prints a deprecation notice to stderr on each run until you set `intent.skills`. A future version will require an explicit allowlist. See the [special forms](./configuration#special-forms) in Configuration.

Trust does not propagate. A listed package may depend on another package that ships skills, but that dependency stays unlisted unless another entry matches it. A bare entry such as `foo` permits an npm source, while `workspace:foo` permits a workspace source. Their wildcard forms remain kind-specific. The exact `*` entry permits every discovered npm and workspace source.

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

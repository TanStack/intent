---
title: Trust model
id: trust-model
---

Intent surfaces skills from your dependencies into your coding agent's guidance. A skill is instructions an agent follows, so the set of packages allowed to contribute skills is a trust decision. Intent makes that decision explicit through the `intent.skills` allowlist.

## Explicit sources

A package ships skills in a `skills/` directory. Discovery finds every installed package that has one, including transitive dependencies. Discovery does not grant trust.

`package.json#intent.skills` is the gate. A discovered package contributes skills only when it appears in the allowlist. An unlisted package is dropped, and Intent reports it so you can opt in or ignore it.

The gate is opt-in today. A project with no `intent.skills` key still surfaces every discovered package, and Intent prints a deprecation notice to stderr on each run until you set `intent.skills`. A future version will require an explicit allowlist. See the [special forms](./configuration#special-forms) in Configuration.

Trust does not propagate. A listed package may depend on another package that ships skills, but that dependency stays unlisted until you add it to `intent.skills` yourself. You allow each source on its own.

## Static discovery

Intent reads package data as files. It never imports, requires, or executes the code of a discovered package to find or load a skill. Adding a package to your dependency tree cannot run that package's code through Intent.

One exception is sanctioned: in Yarn Plug'n'Play projects, Intent loads Yarn's PnP runtime (`.pnp.cjs`) to map package identities to readable locations. It loads no package entry points, bins, lifecycle scripts, or other package-provided JavaScript. An ESLint rule enforces this invariant in the discovery code.

## Source identity and remaining limits

Intent matches allowlist entries by `(kind, id)`. `workspace:foo` authorizes only the workspace member named `foo`; it does not authorize an installed `npm:foo`. A bare `foo` entry is normalized to the npm source kind. Same-named workspace and npm packages remain distinct sources throughout discovery, locking, and approval.

The `git:` source kind is reserved. Intent parses and validates the shape, then rejects it until a future version can pin the resolved ref and content hash. A git entry never loads silently.

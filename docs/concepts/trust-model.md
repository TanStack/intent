---
title: Trust model
id: trust-model
---

A skill is instructions your coding agent follows, so letting a dependency contribute one carries the same weight as running its code. Intent keeps that decision explicit and in your hands: a skill reaches your agent only when you have trusted its package and accepted its content.

## Two gates: sources and content

Trust has two parts, and a skill has to pass both:

- **Sources**: which packages may contribute skills at all, set by `intent.skills` in `package.json`.
- **Content**: which exact skill files you have accepted, recorded in `intent.lock`.

The source policy decides who is allowed in. The lockfile pins what you actually agreed to, so a later change cannot slip through unnoticed.

## Which packages you trust

A package ships skills in a `skills/` directory. Discovery finds every installed package that has one, including transitive dependencies. Discovery does not grant trust.

`intent.skills` is the gate, and it is required. With no `intent.skills` key, or an empty list, Intent permits no sources and surfaces nothing until you list at least one. An explicit entry matches packages by name; the exact `"*"` entry allows every discovered package, which is why Intent warns when you use it. See the [special forms](./configuration#special-forms) in Configuration for each case.

Trust does not propagate. A package you trust may depend on another package that ships skills, but that dependency stays untrusted unless a separate entry matches it. A package that ships skills but is not listed is dropped, and Intent names it so you can opt in or leave it out.

## Which content you accepted

`intent.lock` records every accepted skill as a path and a content hash. When a lockfile is present, `load` enforces it: it refuses a skill that is not in the lock, and refuses one whose installed content no longer matches the recorded hash.

This is what stops a dependency update from quietly changing what your agent reads. When an update adds a skill or changes an accepted one, `sync` reports it for review instead of accepting it, and you take the new content by running `install` again. Without a lockfile, Intent falls back to the source policy alone and does not check content.

## Discovery never runs package code

Intent reads package data as files. It never imports, requires, or executes the code of a discovered package to find or load a skill. Adding a package to your dependency tree cannot run that package's code through Intent.

One exception is sanctioned: in Yarn Plug'n'Play projects, Intent loads Yarn's PnP runtime (`.pnp.cjs`) to map package identities to readable locations. It loads no package entry points, bins, lifecycle scripts, or other package-provided JavaScript, and an ESLint rule enforces that invariant in the discovery code.

## Delivery affects the guarantee

The lockfile check runs when Intent runs. How skills reach your agent between those runs depends on the delivery method you chose at install.

Symlink delivery links the live package folders into your agent's directories. A package update can change linked content before Intent re-checks `intent.lock`; Intent detects the drift the next time it runs, but it cannot stop an agent from reading changed content in the meantime. Hook delivery surfaces only skills already accepted in the lockfile, so changes are held for review before they can reach the agent. Choose hooks when you want every change reviewed first.

## Current limits

Matching is currently by package name. A `workspace:foo` entry and a bare `foo` entry both authorize a discovered package named `foo`, because the scanner does not yet distinguish a workspace member from a published package of the same name. This errs toward permitting a same-named package, never toward denying one you listed.

The `git:` source kind is reserved. Intent validates the shape but rejects it for now, so a git entry never loads silently.

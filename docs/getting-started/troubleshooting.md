---
title: Troubleshooting
id: troubleshooting
---

Fixes for common problems when you consume skills with Intent. New to Intent? Start with the [consumer quick start](./quick-start-consumers).

## `list` reports no packages

Before you install, nothing is trusted, so `intent list` reports no packages even when a dependency ships skills. Run `intent list --show-hidden` to see the candidates, then enable the ones you want during `install`.

## A skill you expected is missing

Add `--why` to see how Intent classified each source:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest list --show-hidden --why

<!-- ::end:tabs -->

A skill can be missing because you did not enable its package during install, or because an `intent.exclude` pattern removed it.

## Install exits without prompting

Interactive install needs a terminal. For committed instructions without managed delivery, use [portable guidance](./quick-start-consumers#portable-guidance) instead.

## Symlinks are not available

Some setups, such as Yarn Plug'n'Play, cannot expose package skills as real folders. Choose another method of delivery instead when `install` asks how to deliver skills.

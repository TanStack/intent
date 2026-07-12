---
title: intent scaffold
id: intent-scaffold
---

`intent scaffold` prints a phased prompt for a coding agent to generate library skills. It prints instructions to stdout and does not create files itself.

```bash
intent scaffold
```

Run [setup](./intent-setup) first so package and managed workflow configuration is previewed and applied before authoring begins.

## Prompt phases

The generated prompt directs the agent through three ordered phases:

1. `domain-discovery` produces the reviewed domain map and skill specification.
2. `tree-generator` produces the reviewed skill tree.
3. `generate-skill` produces package-owned `SKILL.md` files.

Each planning phase includes a maintainer review stop. In monorepos, artifacts remain at the workspace root while skills live inside their owning packages.

## Post-generation checks

The prompt ends with this reviewable sequence:

```bash
intent skills generate-manifest --write
intent skills validate --fix
intent setup --dry-run
intent setup --write
intent setup --check
intent skills validate --release
```

Review manifest changes and mechanical fixes before committing. Release validation checks the file inventory npm would package; it does not publish anything.

## Related

- [intent setup](./intent-setup)
- [intent validate](./intent-validate)

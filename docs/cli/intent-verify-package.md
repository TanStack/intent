---
title: intent maintainer verify-package
id: intent-verify-package
---

Check the archive produced by your library's normal packaging process before publishing it. No agent is required. Use the repository's installed Intent command:

```sh
intent maintainer verify-package library-1.0.0.tgz
```

Run from the library's Git working tree with its maintainer skill tree available. The archive path is relative to the current directory. The selected source package defaults to the repository root; for a workspace package, pass its repository-relative directory:

```sh
intent maintainer verify-package client-2.0.0.tgz --package packages/client --json
```

Use `--artifacts <directory>` when the repository has several planning locations. The command reads the supplied gzip-compressed npm archive. It does not build, extract, install, publish, or execute its contents.

## What is checked

- The archive's package name and version match the selected source package.
- Active registered skills are present with matching names. Planned and retired entries, and registrations for other packages, are excluded.
- Every Git-visible source file under the registered skill directories is included. This covers references, assets, and helpers even when prose does not link to them. Keep source-only files outside those directories if they are intentionally not distributed.
- Inline Markdown links and images outside code spans and fences resolve within the archive. Linked Markdown is checked recursively, with cycles visited once. Frontmatter `sources` entries are provenance, not a list of runtime resources.
- Archive paths stay under `package/`. Links, special entry types, duplicate files, malformed archives, and excessive input sizes fail the check.

The inline-link reader does not interpret HTML links, reference-style Markdown links, shell commands, script imports, or dynamically constructed paths. Files inside the source skill directories are still checked for presence. Inspect any external resource requirements expressed through those other forms separately.

Passing establishes archive contents, not source freshness, semantic correctness, runtime compatibility, or successful task execution. Run the library's task checks separately.

## CI

After the library's normal build and pack steps, run this command against the archive you intend to release:

```sh
intent maintainer verify-package client-2.0.0.tgz --package packages/client --json
```

It never prompts. Exit `0` means the checks passed; a nonzero exit blocks publication. With `--json`, stdout contains a report with `valid`, package identity, registered skill paths, and `problems`. Each problem names a file, an optional target path, and its failure message. Repository or argument errors are reported on stderr.

Fix the source packaging rules or required paths, rebuild the archive, and rerun the check. Do not edit the archive merely to bypass a failing release check.

## Inspection limits

Archives are limited to 128 MiB compressed, 512 MiB expanded, and 50,000 entries. Retained Markdown and package metadata are limited to 4 MiB per file and 32 MiB combined. Oversized inputs fail rather than return partial verification.
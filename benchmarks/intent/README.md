# Intent Benchmarks

## Lockfile Scan Baseline

Run from the repository root:

```sh
pnpm --dir benchmarks/intent exec vitest bench --config ./vitest.config.ts ./lockfile-scan.bench.ts
```

Local baseline recorded on 2026-07-09:

| Case              | Fixture                                                               |       Mean |
| ----------------- | --------------------------------------------------------------------- | ---------: |
| Clean lockfile    | 8 packages, 3 skills per package, 3 support files per skill at 1 KiB  |  9.2180 ms |
| Changed skill     | Same fixture, one `SKILL.md` changed after approval                   |  9.1127 ms |
| Large support set | 24 packages, 4 skills per package, 6 support files per skill at 8 KiB | 50.7923 ms |

The fixture creates `intent.lock` with `intent skills approve --all --yes` before each scan. Re-run these cases after changing lockfile discovery or hashing and compare the same fixture means.

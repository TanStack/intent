---
id: intent-repair
title: intent repair
---

`intent repair` handles mechanical skill maintenance before validation and source review. It does not call an agent, typecheck the library, execute examples, change version claims, or record review outcomes.

Run the repository's installed CLI:

```sh
pnpm exec intent repair
pnpm exec intent repair --write
pnpm exec intent repair --patch > intent-repairs.patch
```

Without options, the command reports available repairs and suggestions without editing files. `--write` applies only unambiguous frontmatter repairs. `--patch` prints a unified Git patch containing the proposed frontmatter changes and code-example suggestions, while leaving the source files untouched. Review it before applying it with `git apply intent-repairs.patch`.

| Option | Behavior |
| --- | --- |
| `[dir]` | Select a skills directory inside the repository. Without a directory, use the same package/workspace discovery as `validate`. |
| `--write` | Apply unambiguous frontmatter repairs; never apply code-example suggestions. |
| `--json` | Print a structured report with `version`, `repairs`, `suggestions`, and `problems`. Can accompany `--write`. |
| `--patch` | Print a reviewable patch. Requires Git; cannot accompany `--write` or `--json`. An empty plan prints no bytes. |

A reported conflict, malformed frontmatter, or unavailable parser needed for a suggestion produces a nonzero exit. Safe changes in other files and their patch/report remain available. Unsafe write paths abort before any source writes. A successful repair command means the mechanical operation completed; run `intent validate` or `intent maintainer check` to check the result.

## Frontmatter repairs

The command moves legacy string fields `type`, `library`, `library_version`, and `framework` into `metadata`, preserving their values, YAML comments, line endings, and the Markdown body. If both locations contain the same value, it removes the duplicate top-level field. If they disagree, it preserves the entire file and reports the conflict. YAML aliases that prevent a repair from preserving other fields also require manual review. It also normalizes a skill name to its parent directory when that directory is a valid skill name; review any corresponding legacy registrations and references.

These are the same frontmatter repairs used by `validate --fix`. `repair` omits full validation so CI can run it before the combined maintainer check without compiling every example twice. It does not invent missing descriptions or update the skill's claimed library version.

Use `intent maintainer sync` afterward when the repository has valid maintainer records. That existing command synchronizes generated records, package publishing entries, and the selected distribution metadata. Repair does not guess ownership or reconcile ambiguous legacy planning records.

## Code-example suggestions

Some skills put complete alternative implementations in one fence, each labeled with a top-level `// BEFORE` or `// AFTER` comment. Repair can propose splitting that pair into separate fences when both halves parse. It preserves the code, language, fence style, and title. Markers in strings, nested examples, function bodies, incomplete syntax, unmatched fences, and more than one pair are not split.

The split is always a suggestion: the comments might describe sequential steps instead of alternatives. Check the teaching intent and run validation after applying it. TypeScript 5.0 or newer must be available for these suggestions; the parser does not load a project configuration or execute examples.

Fragments containing `...`, top-level `return`/`yield`, or deliberate `WRONG` examples require assessment and explicit context. Repair does not guess wrappers, insert casts or missing APIs, or suppress diagnostics. Separate fences also do not isolate module augmentations in the validator's package compiler context.

## CI patches

Newly generated callers enable `repair: true` on the reusable PR workflow. Existing callers can opt in after updating their installed Intent dependency and workflow SHA together:

```yaml
with:
  artifacts: '_artifacts'
  repair: true
```

The reusable workflow defaults this input to `false` for existing callers. When enabled, it requires a clean checkout after dependency installation, applies safe frontmatter repairs, runs `maintainer sync` if configured, and validates the result. The `intent-repairs` artifact is uploaded even when validation fails. It contains:

- `base-sha.txt`: the checked-out revision the patches were produced against.
- `mechanical.patch`: frontmatter and generated-record changes.
- `example-suggestions.patch`: proposed example splits, based on the files after the mechanical repairs.
- `repair-report.json` and, when applicable, `sync.log`: the repair decisions and unresolved problems.

Review and apply `mechanical.patch` first, then assess `example-suggestions.patch` separately. If the checkout has moved, regenerate the patches; do not force them onto unrelated content. CI remains failing while mechanical patches or repair problems need review, even if the repaired examples validate. Example suggestions are advisory when validation already passes, since the labels might describe intentional sequential steps. The job has read permissions and never commits, pushes, publishes fixes, or marks semantic reviews complete.

---
title: Quick Start for Maintainers
id: quick-start-maintainers
---

Install the maintainer workflow once, then ask your existing coding agent for useful skill batches or ordinary library changes. The repository instructions bring skill maintenance into later sessions.

## Enable the maintainer workflow

Run this from the library repository:

```bash
npx @tanstack/intent@latest install --maintainer
```

This adds a managed maintainer block to your agent instructions, preserving surrounding guidance and any consumer skill-loading block. Review that small setup diff and keep it in the repository. It does not install dependencies, alter consumer permissions, or set up CI.

## Generate an agreed batch

Tell your agent the developer tasks you want to support, for example:

> Create a batch covering safe retries, cancellation, and pagination. Use our public examples and tests, and include executable checks for the important failure cases.

The installed instructions load Intent's authoring procedure. The agent researches the current APIs, proposes a useful batch if scope is undecided, and reuses decisions already made. There is no fixed skill count or mandatory full-library taxonomy. A domain map, skill tree, glossary, and ADR are optional inputs for this path.

The review includes the skills, representative tasks, and executable checks. Each checker runs against an expected solution and rejects a plausible mistake. Where an isolated coding-agent session is available, the agent also attempts the task using the actual candidate skills, with grading tests kept outside its editable fixture. Structural validation, task outcomes, and fresh-session evidence are reported separately. A missing independent run stays explicitly unverified.

## Keep guidance current during normal work

Continue asking for library changes normally. Before handoff, the installed procedure runs [`intent review`](../cli/intent-review), inspects affected skills and unmapped changed areas, updates guidance when behavior warrants it, and reruns the relevant task checks.

The command uses actual Git changes and recorded content hashes. The agent supplies the semantic review. A new file is a candidate to investigate; it does not automatically require another skill. Missing sources or unavailable history remain unknown. A justified no-op records the evidence without rewriting accurate guidance or manufacturing a version bump.

Completed reviews are stored in `.intent/review-state.json` alongside the source and skill diff. Identical content stops generating the same reminder; a later edit reopens review. The state records the decision and evidence, not a guarantee that every claim is correct. Maintainers review the behavior change, guidance, checks, and remaining decisions together.

## Act on a release reminder

The optional `setup` workflow checks every PR for unrecorded source changes once maintainer guidance or review state exists, and checks for missed reviews after a release or manual run. Repositories with recorded review state use the same source-aware review; repositories without it retain the older staleness and coverage signals. Ask the agent to review the reminder in the current task. It follows the installed procedure and resolves only evidence-backed items in scope.

Without maintainer installation, [`intent scaffold`](../cli/intent-scaffold) still provides a standalone authoring entry point. [`intent stale`](../cli/intent-stale) remains available for conservative package/version and artifact signals.

## Author or edit Markdown directly

An agent is optional. Open the existing `SKILL.md` and its task-relevant references in your editor. For a new task, create `skills/<task-name>/SKILL.md` inside the owning package, or use your existing custom skills root.

Use YAML frontmatter with `name` matching the final directory name and a `description` saying when an agent should load the skill. Put Intent scalars such as `type`, `library`, and `library_version` under `metadata`; record source paths in `sources`. The `generate-skill` output links to the shipped format reference for a complete template and prerequisite conventions.

Write the steps, working examples, constraints, and failure handling needed for the task from your source, tests, and docs. Keep conditional details in references with clear reading conditions. For updates, edit the affected sections and preserve accurate guidance around them.

## Validate and review

Run validation against the actual skill directory:

```bash
npx @tanstack/intent@latest validate skills
```

In a monorepo, run it from the owning package or pass its path, such as `packages/client/skills`. Pass your custom root when applicable.

Validation checks frontmatter, names, metadata, the 500-line limit, and framework requirements. It also checks required artifact files when an applicable `_artifacts` directory exists; you do not need to create one. See [intent validate](../cli/intent-validate) for the full contract.

Check examples against the package and inspect reference links yourself; structural validation cannot prove that the guidance is correct. Review the diff and validation results through your usual repository process. Authoring does not require commits, labels, CI setup, dependency installation, or publishing. Packaging warnings can be addressed when preparing to ship.

## Full-library discovery

When you want to design the library's complete skill set, explicitly ask your agent for the full-library branch of `intent scaffold`. It routes to:

- `intent meta domain-discovery`: library-wide research and maintainer interviews, producing `domain_map.yaml` and `skill_spec.md`.
- `intent meta tree-generator`: an artifact review and `skill_tree.yaml`.
- `intent meta generate-skill`: authoring the selected skills.

That process retains its review gates and planning artifacts. Reuse existing artifact decisions for later focused updates; do not repeat discovery for every change. See [intent scaffold](../cli/intent-scaffold).

## Publish Configuration

### Configure your package for publishing

When you are ready to ship skills, configure your package separately from authoring. Inspect the package changes and choose whether to install the optional CI workflow:

```bash
# Update package.json with required fields
npx @tanstack/intent@latest edit-package-json

# Copy the CI workflow template
npx @tanstack/intent@latest setup
```

**What these do:**

- `edit-package-json` adds:
  - `tanstack-intent` keyword (used for package detection and registry discovery)
  - `files` array entries for `skills/`
  - For single packages: also adds `!skills/_artifacts` to exclude artifacts from npm
  - For monorepos: skips the artifacts exclusion (artifacts live at repo root)
- `setup` copies `check-skills.yml` to `.github/workflows/` for automated validation and staleness checking

`setup` does not overwrite existing workflow files. To pick up newer generated workflows, delete or move the old generated files in `.github/workflows/`, then rerun `npx @tanstack/intent@latest setup`.

If your repo already has an older generated `validate-skills.yml`, remove it after adopting the current `check-skills.yml`; PR validation now runs from `check-skills.yml`.

### Ship skills with your package

Skills ship inside your npm package. When you publish:

```bash
npm publish
```

Consumers who install your library automatically get the skills. They discover local installed skills with `intent list`, add loading guidance with `intent install`, and load matching skills with `intent load`.

**Version alignment:**

- Skills version with your library releases
- `intent load` returns skill content from the installed package version
- Packaging code and skills together keeps their versions aligned

---

## Ongoing maintenance

Keep the maintainer instructions and completed review state in the repository. Normal code changes use the source review procedure before handoff; the release workflow catches missed work. You can also run `intent review --base <actual-base-ref> --json` for a specific comparison. See [intent review](../cli/intent-review) for supported sources, recorded outcomes, and limits.

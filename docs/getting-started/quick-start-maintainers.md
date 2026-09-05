---
title: Quick Start for Maintainers
id: quick-start-maintainers
---

Start with one developer task or one concrete library change. Create or
update the guidance, validate it, and review the Markdown in your normal
repository workflow.

## Author with your existing agent

In your current coding-agent conversation, ask for the guidance you need:

> Run `npx @tanstack/intent@latest scaffold` and follow its focused authoring
> procedure. Help developers configure retries with this package. Create a
> skill or improve the existing guidance that owns this task.

After working on a code change in the same conversation:

> Run `npx @tanstack/intent@latest meta generate-skill` and follow it to update
> the retry guidance for the change we just made. Use the diff, source, tests,
> and decisions already in this conversation.

The agent runs the command, reads the procedure, and works from the existing
context. It asks only about consequential unresolved decisions and returns a
focused diff with validation results. If the inspected change has no impact on
current guidance, it explains why without rewriting content or bumping the
skill's version. Missing evidence is reported explicitly.

No domain map, skill tree, glossary, or ADR is required for this path. Intent
prints instructions; your existing agent performs the authoring work. If you
prefer to run the command yourself, give its output to your agent with the
task or relevant change:

```bash
npx @tanstack/intent@latest scaffold
```

## Act on an existing review report

For an Intent review PR, ask your agent:

> Read this Intent review PR and follow its Agent Prompt. Use the review items
> and relevant code/docs changes to update the affected guidance. Return the
> evidence and disposition for each item, plus validation results for edits.

The PR prompt loads the same `generate-skill` procedure. For a local report,
ask the agent to run `npx @tanstack/intent@latest stale` and follow its next
step. Text reports that flag skills or coverage now print the authoring
command; JSON output stays machine-readable.

A drift or coverage signal starts investigation. It does not prove that
content needs changing. Failed checks need logs; workflow reminders concern
the workflow. Neither justifies a skill rewrite. The agent can report an
item as updated, verified no change, out of scope with evidence, or unresolved.
An evidence-backed no-op can leave a conservative signal flagged. See
[intent stale](../cli/intent-stale) for what the command actually checks.

## Author or edit Markdown directly

An agent is optional. Open the existing `SKILL.md` and its task-relevant
references in your editor. For a new task, create
`skills/<task-name>/SKILL.md` inside the owning package, or use your existing
custom skills root.

Use YAML frontmatter with `name` matching the final directory name and a
`description` saying when an agent should load the skill. Put Intent scalars
such as `type`, `library`, and `library_version` under `metadata`; record
source paths in `sources`. The `generate-skill` output links to the shipped
format reference for a complete template and prerequisite conventions.

Write the steps, working examples, constraints, and failure handling needed
for the task from your source, tests, and docs. Keep conditional details in
references with clear reading conditions. For updates, edit the affected
sections and preserve accurate guidance around them.

## Validate and review

Run validation against the actual skill directory:

```bash
npx @tanstack/intent@latest validate skills
```

In a monorepo, run it from the owning package or pass its path, such as
`packages/client/skills`. Pass your custom root when applicable.

Validation checks frontmatter, names, metadata, the 500-line limit, and
framework requirements. It also checks required artifact files when an
applicable `_artifacts` directory exists; you do not need to create one.
See [intent validate](../cli/intent-validate) for the full contract.

Check examples against the package and inspect reference links yourself;
structural validation cannot prove that the guidance is correct. Review the
diff and validation results through your usual repository process. Authoring
does not require commits, labels, CI setup, dependency installation, or
publishing. Packaging warnings can be addressed when preparing to ship.

## Full-library discovery

When you want to design the library's complete skill set, explicitly ask
your agent for the full-library branch of `intent scaffold`. It routes to:

- `intent meta domain-discovery`: library-wide research and maintainer
  interviews, producing `domain_map.yaml` and `skill_spec.md`.
- `intent meta tree-generator`: an artifact review and `skill_tree.yaml`.
- `intent meta generate-skill`: authoring the selected skills.

That process retains its review gates and planning artifacts. Reuse existing
artifact decisions for later focused updates; do not repeat discovery for
every change. See [intent scaffold](../cli/intent-scaffold).

## Publish Configuration

### Configure your package for publishing

When you are ready to ship skills, configure your package separately from
authoring. Inspect the package changes and choose whether to install the
optional CI workflow:

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

For a known code/docs change, return to the focused authoring path above or
edit the relevant Markdown directly. Supply the actual diff or identified
change; a new version number alone does not establish which guidance changed.

Use the review path above for reports from `stale` or the optional `setup`
workflow. Automatic Git-diff impact detection and automatic content updates
are not part of this authoring flow. See [setup commands](../cli/intent-setup)
for the existing workflow.

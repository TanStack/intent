---
title: Quick Start for Maintainers
id: quick-start-maintainers
---

Get started scaffolding, validating, and shipping skills for your library.

## Install

<!-- ::start:tabs variant="package-manager" mode="dev-install" -->
react: @tanstack/intent
solid: @tanstack/intent
vue: @tanstack/intent
svelte: @tanstack/intent
angular: @tanstack/intent
lit: @tanstack/intent
<!-- ::end:tabs -->

Run commands through the project-local package binary. The examples below use `intent` for that binary; use your package manager's local-exec command when it is not already on `PATH`. Keeping Intent as a project dependency records its version in the lockfile, so local development and CI run the same reviewed release instead of executing an unreviewed `@latest` version during setup or publishing.

---

## Initial Setup

### 1. Preview and apply package setup

Preview the package and managed workflow changes before writing:

```bash
intent setup --dry-run
intent setup --write
```

Setup adds the package publishing fields required for skills and creates or updates an untouched managed `check-skills.yml`. It never overwrites a custom or modified workflow.

> [!NOTE]
> Migrating from an older release: bare `intent setup` no longer writes files. `intent edit-package-json` and `intent setup-github-actions` remain as deprecated compatibility commands for one release window. Preview the combined replacement with `intent setup --dry-run` before writing.

### 2. Scaffold skills with an agent

Start the scaffolding process **with your AI agent**:

```bash
intent scaffold
```

This prints a comprehensive prompt that walks you and your agent through three phases:

**Phase 1: Domain Discovery**
- Scans your documentation, source code, and GitHub issues
- Conducts an interactive interview to surface implicit knowledge
- Produces `domain_map.yaml` and `skill_spec.md` artifacts

**Phase 2: Tree Generation**
- Designs a skill taxonomy based on the domain map
- Creates a hierarchical skill structure
- Produces `skill_tree.yaml` artifact

**Phase 3: Skill Generation**
- Writes complete SKILL.md files for each skill
- Includes patterns, failure modes, and API references
- Validates against the Intent specification

> [!NOTE]
> This is a context-heavy process that involves domain discovery, GitHub issues analysis, and interactive maintainer interviews. The agent will scan your documentation, recent issues and discussions, and ask targeted questions to surface implicit knowledge and common failure modes. The more information you provide about your library's patterns, pitfalls, and real-world usage problems, the better the generated skills will be. Expect multiple rounds of refinement and regular context compaction before completion.

### 3. Generate the manifest and validate skills

After scaffolding, generate the package manifest, apply only mechanical fixes, and review both changes:

```bash
intent skills generate-manifest --write
intent skills validate --fix
```

Run setup again after scaffolding so monorepos configure every package that now owns skills:

```bash
intent setup --dry-run
intent setup --write
```

This checks:
- Valid YAML frontmatter in every SKILL.md
- Required fields (`name`, `description`) are present
- Skill `name` is a leaf segment matching its parent directory
- Intent-specific scalars (`type`, `library`, `library_version`, `framework`) live under `metadata`, not at the top level
- Description length <= 1024 characters
- Line count limits (500 lines max per skill)
- Framework skills have a `requires` array
- Artifact files exist and are non-empty
- Manifest entries and content hashes match the authored skills
- Literal-secret and capability-disclosure heuristics

If any artifacts are present (domain_map.yaml, skill_spec.md, skill_tree.yaml), they must parse as valid YAML.

Before committing, verify setup and the actual npm package inventory:

```bash
intent setup --check
intent skills validate --release
```

### 4. Commit reviewed outputs

Commit both generated skills and the artifacts used to create them:

```
skills/
  core/SKILL.md
  react/SKILL.md
  intent.manifest.json
  _artifacts/
    domain_map.yaml
    skill_spec.md
    skill_tree.yaml
```

Also commit the reviewed `package.json` and managed workflow changes. Artifacts preserve the reviewed skill structure across versions, making it easier to audit, refresh, or extend the skill set without starting from scratch.

---

## Publish

### 5. Ship skills with your package

Skills ship inside your npm package. When you publish:

```bash
npm publish
```

Consumers who install your library automatically get the skills. They discover local installed skills with `intent list`, add loading guidance with `intent install`, and load matching skills with `intent load`.

Version skills with the library release that contains them. Consumers receive the skill files included in their installed package artifact; trust approval and lock enforcement remain separate consumer steps.

---

## Ongoing Maintenance (Manual or Agent-Assisted)

### 6. Use the managed CI workflow

After running `setup`, you'll have `check-skills.yml` in `.github/workflows/`:

**check-skills.yml** (runs on PRs touching skills/artifacts, release, or manual trigger)
- Validates SKILL.md frontmatter and structure
- Checks manifest freshness and release-package contents
- Uses the exact Intent version recorded when the managed workflow was generated
- Runs pull-request validation with read-only repository permissions
- Ensures files stay under 500 lines
- Automatically detects stale skills and coverage gaps after you publish a new release
- Opens one grouped review PR with an agent-friendly prompt
- Includes the reason each skill or package was flagged
- Requires you to copy the prompt into Claude Code, Cursor, or your agent to update skills

### 7. Update stale skills

When you publish a new release, `check-skills.yml` automatically opens a PR flagging skills that need review.

Manually check which skills need updates with:

```bash
intent stale
```

When run from a package, this checks that package's shipped skills. When run from a monorepo root, it checks workspace packages with skills and flags public workspace packages missing skill or `_artifacts` coverage.

This detects:
- **Version drift** — skill targets an older library version than currently installed
- **New sources** — sources declared in frontmatter that weren't tracked before
- **Artifact drift** — `_artifacts` entries that no longer match generated skills
- **Missing package coverage** — public workspace packages not represented by generated skills or artifact coverage

If a public workspace package is intentionally out of scope for skills, record that decision in repo-root `_artifacts`:

```yaml
coverage:
  ignored_packages:
    - '@tanstack/internal-tooling'
    - name: packages/devtools-fixture
      reason: test fixture only
```

Private workspace packages are skipped automatically.

**To update stale skills:**
1. Review the PR opened by `check-skills.yml`
2. Copy the agent prompt from the PR description
3. Paste it into Claude Code, Cursor, or your coding agent
4. The agent reads the stale skills and updates them based on library changes
5. Run `intent skills generate-manifest --check` and `intent skills validate --release` locally
6. Commit and merge the PR

> [!NOTE]
> Skills are updated through agent assistance, not full automation. The workflow detects what's stale and provides the prompt — your agent handles the actual updates.

Use `--json` output for CI integration or scripting.

### 8. Maintain and iterate

As your library evolves:

1. **When APIs change:** Update relevant SKILL.md files with new patterns
2. **When docs change:** Run `intent stale` to identify affected skills
3. **When issues are filed:** Check if the failure mode should be added to "Common Mistakes"
4. **After major releases:** Consider re-running domain discovery to catch new patterns

> [!TIP]
> Create GitHub issue labels matching your skill names (`skill:core`, `skill:react`). When users file issues, tag them with the relevant skill label to track which areas need the most improvement.

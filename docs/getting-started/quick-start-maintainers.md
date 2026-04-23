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

Or run commands without installing:

```bash
npx @tanstack/intent@latest scaffold
```

---

## Initial Setup (With Agent)

### 1. Scaffold skills

Start the scaffolding process **with your AI agent**:

```bash
npx @tanstack/intent@latest scaffold
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

### 2. Validate skills

After scaffolding, validate that all SKILL.md files are well-formed:

```bash
npx @tanstack/intent@latest validate
```

This checks:
- Valid YAML frontmatter in every SKILL.md
- Required fields (`name`, `description`) are present
- Skill names match their directory paths
- Description length <= 1024 characters
- Line count limits (500 lines max per skill)
- Framework skills have a `requires` array
- Artifact files exist and are non-empty

If any artifacts are present (domain_map.yaml, skill_spec.md, skill_tree.yaml), they must parse as valid YAML.

### 3. Commit skills and artifacts

Commit both generated skills and the artifacts used to create them:

```
skills/
  core/SKILL.md
  react/SKILL.md
  _artifacts/
    domain_map.yaml
    skill_spec.md
    skill_tree.yaml
```

Artifacts enforce a consistent skill structure across versions, making it easier to audit, refresh, or extend the skill set without starting from scratch.

---

## Publish Configuration

### 4. Configure your package for publishing

Run these commands to prepare your package for skill publishing:

```bash
# Update package.json with required fields
npx @tanstack/intent@latest edit-package-json

# Copy CI workflow templates (validate + stale checks)
npx @tanstack/intent@latest setup
```

**What these do:**

- `edit-package-json` adds:
  - `tanstack-intent` keyword (used for package detection and registry discovery)
  - `files` array entries for `skills/`
  - For single packages: also adds `!skills/_artifacts` to exclude artifacts from npm
  - For monorepos: skips the artifacts exclusion (artifacts live at repo root)
- `setup` copies workflow templates to `.github/workflows/` for automated validation and staleness checking

### 5. Ship skills with your package

Skills ship inside your npm package. When you publish:

```bash
npm publish
```

Consumers who install your library automatically get the skills. They discover local installed skills with `intent list`, add loading guidance with `intent install`, and load matching skills with `intent load`.

**Version alignment:**
- Skills version with your library releases
- Agents always load the skill matching the installed library version
- No drift between code and guidance

---

## Ongoing Maintenance (Manual or Agent-Assisted)

### 6. Set up CI workflows

After running `setup`, you'll have two workflows in `.github/workflows/`:

**validate-skills.yml** (runs on PRs touching `skills/`)
- Validates SKILL.md frontmatter and structure
- Ensures files stay under 500 lines
- Runs automatically on every pull request that modifies skills

**check-skills.yml** (runs on release or manual trigger)
- Automatically detects stale skills and coverage gaps after you publish a new release
- Opens one grouped review PR with an agent-friendly prompt
- Requires you to copy the prompt into Claude Code, Cursor, or your agent to update skills

### 7. Update stale skills

When you publish a new release, `check-skills.yml` automatically opens a PR flagging skills that need review.

Manually check which skills need updates with:

```bash
npx @tanstack/intent@latest stale
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
5. Run `npx @tanstack/intent@latest validate` locally to verify
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

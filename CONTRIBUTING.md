---
title: Contributing
id: contributing
---

# Contributing

## Questions

If you have questions about implementation details, help or support, then please use our dedicated community forum at [Github Discussions](https://github.com/tanstack/intent/discussions) **PLEASE NOTE:** If you choose to instead open an issue for your question, your issue will be immediately closed and redirected to the forum.

## Reporting Issues

If you have found what you think is a bug, please [file an issue](https://github.com/tanstack/intent/issues/new). **PLEASE NOTE:** Issues that are identified as implementation questions or non-issues will be immediately closed and redirected to [Github Discussions](https://github.com/tanstack/intent/discussions)

## Suggesting new features

If you are here to suggest a feature, first create an issue if it does not already exist. From there, we will discuss use-cases for the feature and then finally discuss how it could be implemented.

## Development

Before proceeding with development, ensure you match one of the following criteria:

- Fixing a small bug
- Fixing a larger issue that has been previously discussed and agreed-upon by maintainers
- Adding a new feature that has been previously discussed and agreed-upon by maintainers

## Development Workflow

- Fork this repository, we prefer the `feat-*` branch name style
- Ensure you have `pnpm` installed
- Install projects dependencies and linkages by running `pnpm install`
- Auto-build files as you edit by running `pnpm dev`
- Auto-test files as you edit by running `pnpm test:lib:dev` in a second terminal
- Implement your changes and tests
- To test in your own projects:
  - Build/watch for changes with `pnpm build`/`pnpm dev`
- Document your changes in the appropriate documentation website markdown pages
- Run `pnpm test:lib` for the fast unit test loop
- Run `pnpm build:all` before you run the integration tests in `packages/intent/tests/integration` directly. They run the built `dist/cli.mjs` against a local Verdaccio registry
- Run `pnpm test` to ensure all tests pass before committing
- Create a changeset (changelog entry) for your changes by running `pnpm changeset`
- Commit your work and open a pull request
- Submit PR for review

## Editing meta-skills

- Follow [writing-for-agents](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md) and the [Agent Skills authoring best practices](https://agentskills.io/skill-creation/best-practices). Apply their concepts in the shipped procedure rather than telling library maintainers to load another writing guide.
- Put supported tasks, activation conditions, and adjacent-task boundaries in `description`. Start the body with the procedure; keep execution prerequisites and conditional reference pointers there instead of repeating skill-selection criteria.
- Give each reference a reading condition and each workflow an observable completion check. Preserve necessary failure handling, complete examples, and source-backed constraints when removing repetition.
- Keep the shared [Agent Skills format](https://agentskills.io/specification) separate from Intent extensions and host-specific controls. Verify packaged references and real task behavior; structural validation alone does not establish useful guidance.

## Distribution compatibility

Before releasing distribution changes, run the explicit compatibility gate from the repository root with paths to installed executables:

```sh
INTENT_GH_SKILL_BIN=/path/to/gh INTENT_SKILLS_BIN=/path/to/skills INTENT_CLAUDE_BIN=/path/to/claude pnpm --dir packages/intent run test:distribution
```

The gate rebuilds Intent, requires all three executables, and runs all cases in [the installer test](packages/intent/tests/integration/distribution-installers.test.ts). Missing configuration fails instead of skipping checks. Verified tool versions are GitHub CLI 2.100.0, skills 1.5.25, and Claude Code 2.1.268; record versions when testing other releases.

- Local fixture: two package-owned skills, an explicitly selected prerequisite, excluded root and package skills, bundled references, executable helpers, and `gh skill publish --dry-run`.
- Native Claude: manifest validation, selected component discovery, installation, versioned updates, maintainer opt-out, and consumer uninstall. An isolated home and environment keep credentials and personal settings out; the check calls no model.
- Remote TanStack AI: two package skills registered from a fixed snapshot, then installed through generated commands. One case uses each installer's default revision; the other pins the snapshot and verifies its frontmatter survives. Both check selected names and nested guidance. Network access is required; installation telemetry is disabled.

Ordinary tests keep external checks optional. When running the test file directly, set both installer variables for the local fixture, `INTENT_CLAUDE_BIN` for native Claude checks, and `INTENT_DISTRIBUTION_REMOTE=1` for remote cases. Use `test:distribution` for a release result that cannot omit these cases.

Cursor acceptance and agent task quality remain separate gates. In a disposable Cursor profile, check selected components, references, updates, and removal through its native plugin flow. Run a real consumer task against supported dependency versions, and record unavailable hosts or missing task evidence as incomplete. The automated gate does not establish cross-host task correctness.

## Adding a new example

- Clone an existing example into the appropriate `examples` directory
- Name it the example name in kebab-case
- Update the new example's package.json to match the new example name and any other details
- Check dependencies for unused packages
- Install any additional packages to the example that you may need
- Update the docs/config.json file to include the new example in the navigation sidebar
- Commit the example eg. `docs: Add example-name`

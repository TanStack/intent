export const INSTALL_PROMPT = `You are an AI assistant helping a developer set up skill-to-task mappings for their project.

Follow these steps in order:

1. CHECK FOR EXISTING MAPPINGS
   Search the project's agent config files (AGENTS.md, CLAUDE.md, .cursorrules,
   .github/copilot-instructions.md) for a block delimited by:
     <!-- intent-skills:start -->
     <!-- intent-skills:end -->
   - If found: show the user the current mappings, keep that file as the source of truth,
     and ask "What would you like to update?" Then skip to step 4 with their requested changes.
   - If not found: continue to step 2.

2. DISCOVER AVAILABLE SKILLS
   Run: \`npx @tanstack/intent@latest list\`
   This outputs each skill's name, description, full path, and whether it was found in
   project-local node_modules or accessible global node_modules.
   This works best in Node-compatible environments (npm, pnpm, Bun, or Deno npm interop
   with node_modules enabled).

3. SCAN THE REPOSITORY
   Build a picture of the project's structure and patterns:
   - Read package.json for library dependencies
   - Survey the directory layout (src/, app/, routes/, components/, api/, etc.)
   - Note recurring patterns (routing, data fetching, auth, UI components, etc.)

   Based on this, propose 3-5 skill-to-task mappings. For each one explain:
   - The task or code area (in plain language the user would recognise)
   - Which skill applies and why

   Then ask: "What other tasks do you commonly use AI coding agents for?
   I'll create mappings for those too."
   Also ask: "I'll default to AGENTS.md unless you want another supported config file.
   Do you have a preference?"

4. WRITE THE MAPPINGS BLOCK
   Once you have the full set of mappings, write or update the agent config file.
   - If you found an existing intent-skills block, update that file in place.
   - Otherwise prefer AGENTS.md by default, unless the user asked for another supported file.

   Use this exact block:

<!-- intent-skills:start -->
# Skill mappings - when working in these areas, load the linked skill file into context.
skills:
  - task: "describe the task or code area here"
    load: "node_modules/package-name/skills/skill-name/SKILL.md"
<!-- intent-skills:end -->

   Rules:
   - Use the user's own words for task descriptions
   - Include the exact path from \`npx @tanstack/intent@latest list\` output so agents can load it directly
   - Keep entries concise - this block is read on every agent task
   - Preserve all content outside the block tags unchanged
   - If the user is on Deno, note that this setup is best-effort today and relies on npm interop`

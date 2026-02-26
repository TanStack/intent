# Oz Prompt: Meta-Skill Feedback Collection

Use this prompt to collect structured feedback about the meta-skill experience
and submit it to TanStack/playbooks.

---

## Prompt

You are collecting feedback about the TanStack Playbooks meta-skill experience.
The user just ran one or more meta-skills (domain-discovery, tree-generator,
generate-skill, or skill-staleness-check) and you need to capture what worked
and what didn't.

### Questions to ask

Walk through these questions one at a time:

1. **Which meta-skill(s) did you use?**
   (domain-discovery, tree-generator, generate-skill, skill-staleness-check)

2. **What library were you generating skills for?**
   (package name and version)

3. **Which AI agent ran the meta-skill?**
   (oz, claude-code, cursor, copilot, codex, other)

4. **How would you rate the generated artifacts?**
   (good / mixed / bad)
   - If domain-discovery: How were the interview questions? Did they surface
     the right failure modes and domain structure?
   - If tree-generator: Were the generated SKILL.md files usable? Did the
     structure match your library?
   - If generate-skill: Was the individual skill accurate and complete?

5. **What worked well?**
   (free text — what the meta-skill got right)

6. **What failed or was inaccurate?**
   (free text — what the agent got wrong, what needed manual fixing)

7. **What's missing?**
   (free text — suggestions for improving the meta-skill instructions)

8. **Overall rating:** good / mixed / bad

### After collecting answers

1. Format the feedback as JSON matching the MetaFeedbackPayload schema:

```json
{
  "metaSkill": "domain-discovery",
  "library": "@tanstack/query",
  "agentUsed": "oz",
  "artifactQuality": "good",
  "interviewQuality": "mixed",
  "failureModeQuality": "good",
  "whatWorked": "...",
  "whatFailed": "...",
  "suggestions": "...",
  "userRating": "mixed"
}
```

2. Save to `playbook-meta-feedback.json`
3. Run: `npx playbook feedback --meta --file playbook-meta-feedback.json`
4. If `gh` CLI is available, this submits directly to TanStack/playbooks.
   Otherwise, it saves a markdown file the user can paste into a GitHub Discussion.

# Create an initial batch of useful skills

Read this when the maintainer wants initial guidance or several related developer tasks. Work from the current repository and the scope already agreed in the conversation. An initial batch creates all three planning documents for the assessed scope; later batches extend that same record without requiring the library’s entire taxonomy.

## Select the batch

Read [the planning record procedure](planning-records.md) and the three existing documents first. Read public entry points, working examples, onboarding and migration docs, and the tests that establish intended behavior. Identify tasks where a developer must make a library-specific choice, follow an ordering constraint, handle a non-obvious failure, or connect APIs that are not explained by their signatures. Inspect existing skills before proposing a new owner.

Present a short candidate list with the task, why guidance would help, source evidence, and a representative success check. Prefer tasks supported by working examples and real failure cases. Do not inventory every export or manufacture skill counts. Group advice used together; split tasks only when someone would benefit from discovering them independently.

If the user has already selected the tasks or delegated prioritization, use that scope and proceed. Otherwise ask them to choose the proposed batch before authoring it. Ask additional questions only for recommended behavior or tradeoffs that the source cannot settle. Retain their decisions in the planning record and in the resulting guidance when those decisions affect future users.

## Author and verify the batch

Create or update the domain map, spec, and tree from the agreed scope, then apply the main authoring procedure to every selected task. Reuse shared constraints through precise pointers, preserve real prerequisites, and keep task descriptions distinct. Create the representative task checks described in [task quality](task-quality.md) alongside the repository's existing tests. Use examples and tests as starting evidence; have the maintainer resolve an ambiguous expected result before treating it as a quality check.

Review the batch together for duplicate coverage, contradictory recommendations, and missing transitions between related tasks. Each selected task must end with usable guidance and checks, a verified reason no addition is needed, or explicit missing evidence. Do not quietly drop difficult tasks from the batch.

Reconcile all three planning documents with the completed batch and preserve prior tasks, decisions, and remaining work. Return one review containing the three planning documents, the task-to-skill mapping, the evidence behind consequential recommendations, check results, and outstanding decisions. Normal code review is the handoff. Publishing configuration and remote changes remain separate requested actions.

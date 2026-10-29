---
title: intent configure
id: intent-configure
---

> **Note:** This command is intended to be called by agents in most cases, following the setup instructions returned by `intent load`.

`intent configure` calls a skill's `intent-transform` module's `configure()` function. It forwards question/answer pairs and piped stdin, saves successful config changes, and prints the returned string.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

```text
@tanstack/intent@latest configure <package>#<skill> [--answer <question=value>] [--reset] [--global] [--global-only]
```

<!-- ::end:tabs -->

## Inputs

- `--reset` starts `configure()` with an empty config folder. Answers and stdin are still forwarded, so you can reset and submit new preferences in one call. The reset and any new writes are saved together only if the transform succeeds; failures preserve the previous configuration.

- Repeat `--answer 'question=value'` to submit multiple answers. Intent splits each argument at the first `=` and preserves order and duplicate question IDs. IDs must be nonempty and cannot contain `=`. Values remain strings, including leading zeros, empty values (`Q1=`), additional `=` characters, and newlines. Quote arguments containing shell-special characters or whitespace.
- Piped stdin is forwarded as a UTF-8 string, independently of the flags. Intent does not parse JSON or decide which input takes precedence. The transform decides.
- With terminal stdin, Intent supplies an empty string without prompting. With a pipe, it reads until EOF, up to 4 MiB.
- `--global` includes global packages after project packages; `--global-only` resolves only global packages. Config still belongs to the consuming project.

```sh
npx @tanstack/intent@latest configure '@apollo/client#apollo-client' \
  --answer 'Q1=closures' \
  --answer 'Q2=fragments'

cat preferences.json | npx @tanstack/intent@latest configure '@apollo/client#apollo-client'
```

## Output and persistence

The returned string is written to stdout without a banner or added newline. It can acknowledge saved choices or instruct the agent to inspect the repository and ask follow-up questions. Diagnostics go to stderr.

The function also receives `commands.load` and `commands.configure`, reflecting the detected launcher (for example, npx with its package tag or `npm run intent --`). See [Invocation-aware instructions](../concepts/skill-transforms#invocation-aware-instructions) for detection and fallback behavior.

Configuration lives under the owning consumer package's `.intent/skill-config/` directory, namespaced by the resolved package and canonical skill identity using portable encoded path segments. Without an owning `package.json`, the current directory is used. Package versions are excluded from the key, so upgrades retain answers. Commit this directory when selections should be shared with teammates; do not store secrets in skill preferences.

Both commands use the same source allowlist and exclusions. A skill without `intent-transform` cannot be configured. Node.js 22+ is required for transforms.

The transform's writes are staged in memory. Exceptions, invalid results, timeouts, and invalid paths discard the staged changes and exit nonzero. Concurrent configuration of the same skill is rejected with a retry message. After a process crash, a stale lock may require manual removal; the error identifies its path.

## Conversation flow

1. Run `intent load <skill>` to receive setup instructions.
2. The agent inspects the consumer's repository and asks the user questions.
3. Run `intent configure <skill>` with individual answers, batches, or stdin as instructed by the skill.
4. Follow any additional instructions returned by `configure()`.
5. Run `intent load <skill>` again to receive individualized guidance.

Intent does not define question IDs, preference schemas, or an onboarding-complete flag. Those belong to the transform.

## Related

- [Skill transforms](../concepts/skill-transforms)
- [intent load](./intent-load)
- [Trust model](../concepts/trust-model)

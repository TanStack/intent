// Shared literal-secret detection, used by the manifest generator (this
// file) and, in future, the validator and security doctor. Static and
// regex-based: it can only catch obvious literal values, never encoded or
// indirect ones — its job is defense-in-depth, not a security boundary.
//
// A maintainer may declare a secret's NAME (e.g. GITHUB_TOKEN) but must
// never embed its VALUE in skill content. These patterns look for the
// shape of common literal secret values.
const SECRET_PATTERNS: ReadonlyArray<{
  name: string
  pattern: RegExp
}> = [
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: 'generic-api-key-assignment',
    pattern:
      /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][A-Za-z0-9_\-.]{16,}["']/i,
  },
  {
    name: 'private-key-block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
]

export interface SecretMatch {
  name: string
  index: number
}

// Returns every distinct pattern name that matches somewhere in `content`.
// Does not return the matched value itself — callers report the finding by
// name/location, never the literal secret text, even in error output.
export function findSecretMatches(content: string): Array<SecretMatch> {
  const matches: Array<SecretMatch> = []
  for (const { name, pattern } of SECRET_PATTERNS) {
    const match = pattern.exec(content)
    if (match) {
      matches.push({ name, index: match.index })
    }
  }
  return matches
}

export function containsSecretLiteral(content: string): boolean {
  return SECRET_PATTERNS.some(({ pattern }) => pattern.test(content))
}

// Heuristic capability signals (M3's static-heuristics pass). These only
// ever *suggest* a capability for the maintainer to confirm — never
// auto-declare it as final, and disagreement with a maintainer's declared
// capabilities is a warning, never a hard error (see manifest.ts).
const NETWORK_PATTERN = /\b(?:curl|wget|fetch\s*\()\b/i
const INSTALL_COMMAND_PATTERN =
  /\b(?:npm|pnpm|yarn|bun|pip)\s+(?:i|install|add)\b/i
const SUBPROCESS_PATTERN = /\b(?:child_process|spawn|exec[FS]?\w*)\s*\(/

export interface CapabilityHeuristics {
  usesNetwork: boolean
  runsInstallCommand: boolean
  shellsOut: boolean
}

export function detectCapabilityHeuristics(
  content: string,
): CapabilityHeuristics {
  return {
    usesNetwork: NETWORK_PATTERN.test(content),
    runsInstallCommand: INSTALL_COMMAND_PATTERN.test(content),
    shellsOut: SUBPROCESS_PATTERN.test(content),
  }
}

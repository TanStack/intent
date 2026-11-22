import { parse as parseYaml } from 'yaml'
import { nodeReadFs } from './fs-identity.js'
import type { ReadFs } from './fs-identity.js'

/**
 * Read a scalar string field from frontmatter, preferring `metadata.<key>` over
 * a top-level `<key>` (#159 back-compat for the frontmatter migration).
 */
export function readScalarField(
  fm: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const metadata = fm?.metadata
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const nested = (metadata as Record<string, unknown>)[key]
    if (typeof nested === 'string') return nested
  }
  const top = fm?.[key]
  return typeof top === 'string' ? top : undefined
}

/**
 * Parse YAML frontmatter from a path or caller-owned descriptor at offset zero.
 * Returns null if no frontmatter or on error; caller-owned descriptors stay open.
 */
export function parseFrontmatter(
  filePath: string | number,
  fs: ReadFs = nodeReadFs,
): Record<string, unknown> | null {
  const content = readFrontmatterRegion(filePath, fs)
  if (content === null) return null
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match?.[1]) return null
  try {
    return parseYaml(match[1]) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Max bytes read when probing a file's leading frontmatter region. */
const FRONTMATTER_READ_LIMIT = 16 * 1024
/** Reused across calls; safe because reads are synchronous and single-threaded. */
const frontmatterBuffer = Buffer.allocUnsafe(FRONTMATTER_READ_LIMIT)

/**
 * Read just the leading region of a file, enough to cover its frontmatter,
 * instead of its whole body. Falls back to a full read when the bounded read
 * primitives are unavailable or the frontmatter exceeds the probe limit.
 */
function readFrontmatterRegion(
  filePath: string | number,
  fs: ReadFs,
): string | null {
  if (fs.openSync && fs.readSync && fs.closeSync) {
    let fd: number
    try {
      fd = typeof filePath === 'number' ? filePath : fs.openSync(filePath, 'r')
    } catch {
      return null
    }
    try {
      const bytesRead = fs.readSync(
        fd,
        frontmatterBuffer,
        0,
        FRONTMATTER_READ_LIMIT,
        0,
      )
      const region = frontmatterBuffer.toString('utf8', 0, bytesRead)
      // A full buffer means the file may extend past the probe window; only
      // trust the bounded read when it captured the closing fence.
      const truncated =
        bytesRead === FRONTMATTER_READ_LIMIT &&
        !/\r?\n---/.test(region.slice(3))
      // The positional probe leaves the descriptor at offset zero. Keep the
      // full-read fallback on that descriptor so replacement cannot redirect it.
      return truncated ? fs.readFileSync(fd, 'utf8') : region
    } catch {
      return null
    } finally {
      if (typeof filePath !== 'number') fs.closeSync(fd)
    }
  }

  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

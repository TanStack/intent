export async function request(
  operation,
  { attempts = 1, shouldRetry = () => false, signal } = {},
) {
  if (!Number.isInteger(attempts) || attempts < 1)
    throw new RangeError('attempts must be a positive integer')
  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted()
    try {
      return await operation(attempt)
    } catch (error) {
      signal?.throwIfAborted()
      if (attempt === attempts || !shouldRetry(error)) throw error
    }
  }
}

export async function* pages(fetchPage, { cursor } = {}) {
  const seen = new Set()
  while (true) {
    if (seen.has(cursor)) throw new Error('Repeated page cursor')
    seen.add(cursor)
    const page = await fetchPage(cursor)
    yield* page.items
    if (page.nextCursor === undefined) return
    cursor = page.nextCursor
  }
}

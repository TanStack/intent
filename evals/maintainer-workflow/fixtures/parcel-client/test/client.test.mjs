import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pages, request } from '../src/index.mjs'

test('counts the initial call and preserves the final retryable error', async () => {
  let count = 0
  const error = new Error('temporary')
  await assert.rejects(
    request(
      async () => {
        count++
        throw error
      },
      { attempts: 3, shouldRetry: () => true },
    ),
    (actual) => actual === error,
  )
  assert.equal(count, 3)
})

test('does not retry a permanent failure', async () => {
  let count = 0
  await assert.rejects(
    request(
      async () => {
        count++
        throw new Error('permanent')
      },
      { attempts: 3 },
    ),
  )
  assert.equal(count, 1)
})

test('an aborted signal prevents another operation', async () => {
  const controller = new AbortController()
  const reason = new Error('stopped')
  controller.abort(reason)
  await assert.rejects(
    request(async () => assert.fail('must not run'), {
      signal: controller.signal,
    }),
    (error) => error === reason,
  )
})

test('continues through an empty page and accepts an empty-string cursor', async () => {
  const cursors = []
  const output = []
  for await (const item of pages(async (cursor) => {
    cursors.push(cursor)
    return cursor === undefined
      ? { items: [], nextCursor: '' }
      : { items: [1, 2] }
  }))
    output.push(item)
  assert.deepEqual(cursors, [undefined, ''])
  assert.deepEqual(output, [1, 2])
})

test('rejects a repeated cursor', async () => {
  await assert.rejects(async () => {
    for await (const item of pages(async () => ({
      items: [],
      nextCursor: 'repeat',
    })))
      void item
  }, /Repeated page cursor/)
})

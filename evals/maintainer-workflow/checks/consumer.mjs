import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function checkConsumer({ fetchProfile, collectAll }) {
  let calls = 0
  const temporary = Object.assign(new Error('temporary'), { code: 'E_TEMP' })
  const success = { name: 'ok' }
  assert.equal(
    await fetchProfile({
      getProfile() {
        if (++calls < 3) throw temporary
        return success
      },
    }),
    success,
  )
  assert.equal(calls, 3)

  calls = 0
  await assert.rejects(
    fetchProfile({
      getProfile() {
        calls++
        throw temporary
      },
    }),
    (error) => error === temporary,
  )
  assert.equal(calls, 3)

  for (const permanent of [new Error('permanent'), null, undefined]) {
    calls = 0
    await assert.rejects(
      fetchProfile({
        getProfile() {
          calls++
          throw permanent
        },
      }),
      (error) => error === permanent,
    )
    assert.equal(calls, 1)
  }

  const controller = new AbortController()
  const reason = new Error('cancelled')
  controller.abort(reason)
  await assert.rejects(
    fetchProfile(
      {
        getProfile() {
          assert.fail('must not run')
        },
      },
      { signal: controller.signal },
    ),
    (error) => error === reason,
  )

  const duringFailure = new AbortController()
  calls = 0
  await assert.rejects(
    fetchProfile(
      {
        getProfile() {
          calls++
          duringFailure.abort(reason)
          throw temporary
        },
      },
      { signal: duringFailure.signal },
    ),
    (error) => error === reason,
  )
  assert.equal(calls, 1)

  const duringSuccess = new AbortController()
  assert.equal(
    await fetchProfile(
      {
        getProfile() {
          duringSuccess.abort(reason)
          return success
        },
      },
      { signal: duringSuccess.signal },
    ),
    success,
  )

  const cursors = []
  assert.deepEqual(
    await collectAll((cursor) => {
      cursors.push(cursor)
      if (cursor === undefined) return { items: [], nextCursor: '' }
      if (cursor === '') return { items: [1, 2], nextCursor: 'last' }
      return { items: [3] }
    }),
    [1, 2, 3],
  )
  assert.deepEqual(cursors, [undefined, '', 'last'])
  await assert.rejects(
    collectAll(() => ({ items: [], nextCursor: 'repeat' })),
    /Repeated page cursor/,
  )
  await assert.rejects(
    collectAll(() => {
      throw temporary
    }),
    (error) => error === temporary,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv[2])
    throw new Error(
      'Usage: node checks/consumer.mjs /absolute/path/to/client.mjs',
    )
  await checkConsumer(
    await import(pathToFileURL(resolve(process.argv[2])).href),
  )
  console.log(
    'Consumer task passed: retry bounds, error identity, cancellation and complete pagination.',
  )
}

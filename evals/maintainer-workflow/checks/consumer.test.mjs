import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pages, request } from '../fixtures/parcel-client/src/index.mjs'
import { checkConsumer } from './consumer.mjs'

const correct = {
  fetchProfile: (api, { signal } = {}) =>
    request(() => api.getProfile(), {
      attempts: 3,
      shouldRetry: (error) => error?.code === 'E_TEMP',
      signal,
    }),
  async collectAll(fetchPage) {
    const result = []
    for await (const item of pages(fetchPage)) result.push(item)
    return result
  },
}

test('the consumer grader accepts the source-backed solution', async () => {
  await checkConsumer(correct)
})

test('the same grader rejects retrying every failure', async () => {
  await assert.rejects(
    checkConsumer({
      ...correct,
      fetchProfile: (api) =>
        request(() => api.getProfile(), {
          attempts: 3,
          shouldRetry: () => true,
        }),
    }),
  )
})

test('the same grader rejects replacing a null rejection in the classifier', async () => {
  await assert.rejects(
    checkConsumer({
      ...correct,
      fetchProfile: (api, { signal } = {}) =>
        request(() => api.getProfile(), {
          attempts: 3,
          shouldRetry: (error) => error.code === 'E_TEMP',
          signal,
        }),
    }),
  )
})

test('the same grader rejects ending pagination on an empty page', async () => {
  await assert.rejects(
    checkConsumer({
      ...correct,
      async collectAll(fetchPage) {
        const page = await fetchPage()
        return page.items
      },
    }),
  )
})

test('invalid options reject a promise; they do not throw synchronously', async () => {
  let promise
  assert.doesNotThrow(() => {
    promise = request(() => assert.fail('must not run'), { attempts: 0 })
  })
  await assert.rejects(promise, RangeError)
})

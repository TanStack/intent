# Parcel client

This is a local evaluation library. Its public APIs are `request` and `pages`; no remote service or external dependency is needed.

`request(operation, options)` calls an asynchronous operation. `attempts` is the total number of calls, including the first one, and defaults to one. `shouldRetry(error)` selects retryable failures and defaults to false. Permanent failures and the final failure are thrown unchanged. An aborted signal prevents another attempt and throws its reason.

```js
import { request } from '@intent-fixture/parcel-client'

const record = await request(() => transport.readRecord(), {
  attempts: 3,
  shouldRetry: (error) => error.code === 'E_TEMP',
  signal,
})
```

`pages(fetchPage)` yields items in order. A page is `{ items, nextCursor }`. Only `nextCursor === undefined` ends iteration: an empty page can still have a next cursor, and `''` is a valid cursor. Repeated cursors throw instead of looping forever.

```js
import { pages } from '@intent-fixture/parcel-client'

const items = []
for await (const item of pages(fetchPage)) items.push(item)
```

---
'@tanstack/intent': patch
---

Check code examples in repositories that use TypeScript 7.0. `intent validate`, `intent repair`, and maintainer review summaries crashed there because the TypeScript 7 `typescript` package exports no compiler API. Intent now checks examples through the native compiler API that TypeScript 7 publishes, or through `@typescript/typescript6` when it is installed beside TypeScript 7. If neither API can run, Intent reports that the examples were not typechecked and runs the other checks. TypeScript 7.1 is not supported at this time.

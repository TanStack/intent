---
id: MetaFeedbackPayload
title: MetaFeedbackPayload
---

# Interface: MetaFeedbackPayload

Defined in: [types.ts:90](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L90)

## Properties

### agentUsed

```ts
agentUsed: AgentName;
```

Defined in: [types.ts:93](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L93)

***

### artifactQuality

```ts
artifactQuality: "good" | "mixed" | "bad";
```

Defined in: [types.ts:94](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L94)

***

### failureModeQuality?

```ts
optional failureModeQuality: "good" | "mixed" | "bad" | "not-applicable";
```

Defined in: [types.ts:96](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L96)

***

### interviewQuality?

```ts
optional interviewQuality: "skipped" | "good" | "mixed" | "bad";
```

Defined in: [types.ts:95](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L95)

***

### library

```ts
library: string;
```

Defined in: [types.ts:92](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L92)

***

### metaSkill

```ts
metaSkill: MetaSkillName;
```

Defined in: [types.ts:91](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L91)

***

### suggestions

```ts
suggestions: string;
```

Defined in: [types.ts:99](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L99)

***

### userRating

```ts
userRating: "good" | "mixed" | "bad";
```

Defined in: [types.ts:100](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L100)

***

### whatFailed

```ts
whatFailed: string;
```

Defined in: [types.ts:98](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L98)

***

### whatWorked

```ts
whatWorked: string;
```

Defined in: [types.ts:97](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L97)

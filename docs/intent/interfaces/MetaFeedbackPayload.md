---
id: MetaFeedbackPayload
title: MetaFeedbackPayload
---

# Interface: MetaFeedbackPayload

Defined in: [types.ts:84](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L84)

## Properties

### agentUsed

```ts
agentUsed: AgentName;
```

Defined in: [types.ts:87](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L87)

***

### artifactQuality

```ts
artifactQuality: "good" | "mixed" | "bad";
```

Defined in: [types.ts:88](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L88)

***

### failureModeQuality?

```ts
optional failureModeQuality: "good" | "mixed" | "bad" | "not-applicable";
```

Defined in: [types.ts:90](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L90)

***

### interviewQuality?

```ts
optional interviewQuality: "skipped" | "good" | "mixed" | "bad";
```

Defined in: [types.ts:89](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L89)

***

### library

```ts
library: string;
```

Defined in: [types.ts:86](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L86)

***

### metaSkill

```ts
metaSkill: MetaSkillName;
```

Defined in: [types.ts:85](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L85)

***

### suggestions

```ts
suggestions: string;
```

Defined in: [types.ts:93](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L93)

***

### userRating

```ts
userRating: "good" | "mixed" | "bad";
```

Defined in: [types.ts:94](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L94)

***

### whatFailed

```ts
whatFailed: string;
```

Defined in: [types.ts:92](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L92)

***

### whatWorked

```ts
whatWorked: string;
```

Defined in: [types.ts:91](https://github.com/TanStack/intent/blob/main/packages/intent/src/types.ts#L91)

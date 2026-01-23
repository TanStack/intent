# Quick Start

## Core Usage

```typescript
import { createTemplate } from '@tanstack/template'

const template = createTemplate({ message: 'Hello!' })
template.greet() // Logs: Hello!
```

## React Usage

```tsx
import { createTemplate } from '@tanstack/template'
import { useTemplate } from '@tanstack/react-template'

function App() {
  const template = React.useMemo(() => createTemplate(), [])
  const state = useTemplate(template)

  return <div>{state.message}</div>
}
```

## Solid Usage

```tsx
import { createTemplate } from '@tanstack/template'
import { createTemplateSignal } from '@tanstack/solid-template'

function App() {
  const template = createTemplate()
  const state = createTemplateSignal(template)

  return <div>{state().message}</div>
}
```

## With Devtools

### React

```tsx
import { TemplateDevtools } from '@tanstack/react-template-devtools'

function App() {
  // ... your code

  return (
    <div>
      {/* your app */}
      <TemplateDevtools />
    </div>
  )
}
```

### Solid

```tsx
import { TemplateDevtools } from '@tanstack/solid-template-devtools'

function App() {
  // ... your code

  return (
    <div>
      {/* your app */}
      <TemplateDevtools />
    </div>
  )
}
```

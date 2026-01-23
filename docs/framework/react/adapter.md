# React Adapter

The React adapter provides hooks for using Template in React applications.

## useTemplate

The `useTemplate` hook connects a Template instance to React's reactivity system.

```tsx
import { useTemplate } from '@tanstack/react-template'

function MyComponent() {
  const template = React.useMemo(() => createTemplate(), [])
  const state = useTemplate(template)

  return <div>{state.message}</div>
}
```

### Parameters

- `template`: Template - The template instance to connect

### Returns

Returns the current state from the template's store.

## Examples

See the `/examples/react/` directory for complete working examples:
- `basic` - Simple usage example
- `devtools` - Example with devtools integration

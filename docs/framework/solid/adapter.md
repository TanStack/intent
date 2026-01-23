# Solid Adapter

The Solid adapter provides primitives for using Template in Solid applications.

## createTemplateSignal

The `createTemplateSignal` primitive connects a Template instance to Solid's reactivity system.

```tsx
import { createTemplateSignal } from '@tanstack/solid-template'

function MyComponent() {
  const template = createTemplate()
  const state = createTemplateSignal(template)

  return <div>{state().message}</div>
}
```

### Parameters

- `template`: Template - The template instance to connect

### Returns

Returns a Solid signal containing the current state from the template's store.

## Examples

See the `/examples/solid/` directory for complete working examples:
- `basic` - Simple usage example
- `devtools` - Example with devtools integration

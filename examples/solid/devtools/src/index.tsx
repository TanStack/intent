import { render } from 'solid-js/web'
import { createTemplate } from '@tanstack/template'
import { createTemplateSignal } from '@tanstack/solid-template'
import { TemplateDevtools } from '@tanstack/solid-template-devtools'

function App() {
  const template = createTemplate({
    message: 'Hello from Solid with Devtools!',
  })
  const state = createTemplateSignal(template)

  return (
    <div style={{ padding: '20px', 'font-family': 'sans-serif' }}>
      <h1>TanStack Template - Solid Devtools Example</h1>
      <p>Message: {state().message}</p>
      <button onClick={() => template.greet()}>Greet (check console)</button>

      <hr style={{ margin: '20px 0' }} />

      <h2>Devtools:</h2>
      <TemplateDevtools />
    </div>
  )
}

render(() => <App />, document.getElementById('root')!)

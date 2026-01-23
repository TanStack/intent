import React from 'react'
import ReactDOM from 'react-dom/client'
import { createTemplate } from '@tanstack/template'
import { useTemplate } from '@tanstack/react-template'
import { TemplateDevtools } from '@tanstack/react-template-devtools'

function App() {
  const template = React.useMemo(
    () => createTemplate({ message: 'Hello from React with Devtools!' }),
    [],
  )
  const state = useTemplate(template)

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>TanStack Template - React Devtools Example</h1>
      <p>Message: {state.message}</p>
      <button onClick={() => template.greet()}>Greet (check console)</button>

      <hr style={{ margin: '20px 0' }} />

      <h2>Devtools:</h2>
      <TemplateDevtools />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)

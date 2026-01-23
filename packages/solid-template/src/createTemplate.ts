import { onMount } from 'solid-js'
import { useStore } from '@tanstack/solid-store'
import { Template } from '@tanstack/template'

export function createTemplateSignal(template: Template) {
  console.log('Hello from @tanstack/solid-template!')
  const state = useStore(template.store)

  onMount(() => {
    console.log('Template signal mounted')
  })

  return state
}

import { useEffect } from 'react'
import { useStore } from '@tanstack/react-store'
import { Template } from '@tanstack/template'

export function useTemplate(template: Template) {
  console.log('Hello from @tanstack/react-template!')
  const state = useStore(template.store)

  useEffect(() => {
    console.log('Template hook mounted')
  }, [])

  return state
}

import { Store } from '@tanstack/store'
import type { TemplateOptions } from './types'

export class Template {
  store: Store<{ message: string }>

  constructor(options?: TemplateOptions) {
    console.log('Hello from @tanstack/template!')
    this.store = new Store({ message: options?.message || 'Hello' })
  }

  greet(): void {
    console.log(this.store.state.message)
  }
}

export function createTemplate(options?: TemplateOptions): Template {
  return new Template(options)
}

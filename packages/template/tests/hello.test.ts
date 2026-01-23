import { describe, it, expect } from 'vitest'
import { Template, createTemplate } from '../src/hello'

describe('Template', () => {
  it('should create instance', () => {
    const template = new Template()
    expect(template).toBeInstanceOf(Template)
  })

  it('should create with helper', () => {
    const template = createTemplate()
    expect(template).toBeInstanceOf(Template)
  })

  it('should use custom message', () => {
    const template = createTemplate({ message: 'Custom' })
    expect(template.store.state.message).toBe('Custom')
  })
})

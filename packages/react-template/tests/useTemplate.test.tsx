import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTemplate } from '../src/useTemplate'
import { createTemplate } from '@tanstack/template'

describe('useTemplate', () => {
  it('should work', () => {
    const template = createTemplate()
    const { result } = renderHook(() => useTemplate(template))
    expect(result.current).toBeDefined()
    expect(result.current.message).toBe('Hello')
  })

  it('should work with custom message', () => {
    const template = createTemplate({ message: 'Custom' })
    const { result } = renderHook(() => useTemplate(template))
    expect(result.current.message).toBe('Custom')
  })
})

import { describe, expect, it } from 'vitest'
import { parseSkillOptions } from '../src/core/skill-options.js'

describe('parseSkillOptions', () => {
  it('returns declared options in file order', () => {
    const framework = {
      question: 'Which framework?',
      choices: ['nextjs', 'other'],
      default: 'other',
    }
    const masking = {
      question: 'Use data masking?',
      choices: ['yes', 'no'],
      default: 'no',
    }

    expect(parseSkillOptions(JSON.stringify({ framework, masking }))).toEqual({
      options: [
        ['framework', framework],
        ['masking', masking],
      ],
      errors: [],
    })
  })

  it.each([
    ['text that is not JSON', '{', 'Invalid JSON'],
    ['a root that is not an object', '[]', 'Expected a JSON object of options'],
    [
      'an option that is not an object',
      '{"framework":"nextjs"}',
      'Option "framework": must be an object',
    ],
    [
      'an option without a question',
      '{"framework":{"choices":["a"],"default":"a"}}',
      'Option "framework": "question" must be a non-empty string',
    ],
    [
      'an option with an empty choice',
      '{"framework":{"question":"Which?","choices":["a",""],"default":"a"}}',
      'Option "framework": "choices" must be a non-empty array of non-empty strings',
    ],
    [
      'an option without a default',
      '{"framework":{"question":"Which?","choices":["a"]}}',
      'Option "framework": "default" must be one of "choices"',
    ],
  ])('rejects %s', (_case, text, error) => {
    expect(parseSkillOptions(text)).toEqual({ options: [], errors: [error] })
  })
})

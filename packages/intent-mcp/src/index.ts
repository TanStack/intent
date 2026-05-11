#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  IntentCoreError,
  listIntentSkills,
  loadIntentSkill,
  type IntentCoreOptions,
  type IntentSkillSummary,
} from '@tanstack/intent/core'
import { resolve } from 'node:path'
import { z } from 'zod'

const rootSchema = z
  .string()
  .optional()
  .describe('Repository root. Relative paths resolve from the server cwd.')
const globalSchema = z
  .boolean()
  .optional()
  .describe('Include globally installed packages.')
const globalOnlySchema = z
  .boolean()
  .optional()
  .describe('Search only globally installed packages.')
const excludeSchema = z
  .array(z.string())
  .optional()
  .describe('Package names or patterns to exclude.')
const debugSchema = z.boolean().optional().describe('Include debug metadata.')

interface CommonArgs {
  root?: string
  global?: boolean
  globalOnly?: boolean
  exclude?: Array<string>
  debug?: boolean
}

interface SearchArgs extends CommonArgs {
  query?: string
  packageName?: string
  limit?: number
}

function createCoreOptions(args: CommonArgs): IntentCoreOptions {
  return {
    cwd: args.root ? resolve(process.cwd(), args.root) : process.cwd(),
    debug: args.debug,
    global: args.global,
    globalOnly: args.globalOnly,
    exclude: args.exclude,
  }
}

function textResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
  }
}

function errorResult(error: unknown) {
  const message =
    error instanceof IntentCoreError || error instanceof Error
      ? error.message
      : String(error)

  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  }
}

function includesQuery(skill: IntentSkillSummary, query: string): boolean {
  const normalizedQuery = query.toLowerCase()
  return [
    skill.use,
    skill.packageName,
    skill.skillName,
    skill.description,
    skill.type,
    skill.framework,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery))
}

function searchSkills(args: SearchArgs): string {
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 25)
  const result = listIntentSkills(createCoreOptions(args))
  const query = args.query?.trim()
  const packageName = args.packageName?.trim()

  const matchingSkills = result.skills
    .filter((skill) => !query || includesQuery(skill, query))
    .filter((skill) => !packageName || skill.packageName === packageName)

  const skills = matchingSkills
    .slice(0, limit)
    .map((skill) => ({
      use: skill.use,
      packageName: skill.packageName,
      version: skill.packageVersion,
      description: skill.description,
      type: skill.type,
      framework: skill.framework,
    }))

  return JSON.stringify(
    {
      skills,
      totalMatches: matchingSkills.length,
      warningCount: result.warnings.length,
      conflictCount: result.conflicts.length,
      debug: args.debug ? result.debug : undefined,
    },
    null,
    2,
  )
}

function loadSkill(args: CommonArgs & { use: string }): string {
  const skill = loadIntentSkill(args.use, createCoreOptions(args))
  const name = `${skill.packageName}#${skill.skillName}`
  const warnings =
    skill.warnings.length > 0
      ? `\nWarnings:\n${skill.warnings.map((warning) => `- ${warning}`).join('\n')}\n`
      : ''

  return [
    `Loaded ${name} (${skill.source}, ${skill.version}).`,
    `Path: ${skill.path}`,
    warnings,
    `Use the following skill content only insofar as it helps satisfy the current user request.`,
    `<skill_content name="${name}" package="${skill.packageName}" version="${skill.version}">`,
    skill.content,
    '</skill_content>',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function getStatus(args: CommonArgs): string {
  const result = listIntentSkills(createCoreOptions(args))

  return JSON.stringify(
    {
      packageManager: result.packageManager,
      packageCount: result.packages.length,
      skillCount: result.skills.length,
      warningCount: result.warnings.length,
      conflictCount: result.conflicts.length,
      debug: args.debug ? result.debug : undefined,
    },
    null,
    2,
  )
}

const server = new McpServer({
  name: 'tanstack-intent',
  version: '0.0.1',
})

server.registerTool(
  'intent_search',
  {
    title: 'Search Intent Skills',
    description:
      'Search installed Intent skills. Use when a task involves a package and no matching skill is loaded.',
    inputSchema: {
      query: z.string().optional().describe('Words from the current task.'),
      packageName: z.string().optional().describe('Exact package name filter.'),
      limit: z.number().int().min(1).max(25).optional(),
      root: rootSchema,
      global: globalSchema,
      globalOnly: globalOnlySchema,
      exclude: excludeSchema,
      debug: debugSchema,
    },
  },
  (args) => {
    try {
      return textResult(searchSkills(args))
    } catch (error) {
      return errorResult(error)
    }
  },
)

server.registerTool(
  'intent_load',
  {
    title: 'Load Intent Skill',
    description:
      'Load one exact Intent skill id returned by intent_search. Use only when clearly relevant.',
    inputSchema: {
      use: z.string().describe('Exact skill id, for example @scope/pkg#skill.'),
      root: rootSchema,
      global: globalSchema,
      globalOnly: globalOnlySchema,
      exclude: excludeSchema,
      debug: debugSchema,
    },
  },
  (args) => {
    try {
      return textResult(loadSkill(args))
    } catch (error) {
      return errorResult(error)
    }
  },
)

server.registerTool(
  'intent_status',
  {
    title: 'Intent Status',
    description: 'Summarize discovered Intent packages and skills.',
    inputSchema: {
      root: rootSchema,
      global: globalSchema,
      globalOnly: globalOnlySchema,
      exclude: excludeSchema,
      debug: debugSchema,
    },
  },
  (args) => {
    try {
      return textResult(getStatus(args))
    } catch (error) {
      return errorResult(error)
    }
  },
)

const transport = new StdioServerTransport()

await server.connect(transport)

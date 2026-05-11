import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIntentMcpServer } from '../src/server.js'

const testDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(testDir, 'fixtures', 'workspace')
const emptyRoot = join(testDir, 'fixtures', 'empty')
type ToolCallResult = Awaited<ReturnType<Client['callTool']>>

function getText(result: ToolCallResult): string {
  if (!('content' in result)) {
    throw new Error('Expected content tool result')
  }

  const content = result.content
  if (!Array.isArray(content)) {
    throw new Error('Expected array tool content')
  }

  const firstContent = content[0]
  if (!firstContent || typeof firstContent !== 'object') {
    throw new Error('Expected text tool result')
  }

  const textContent = firstContent as { text?: unknown; type?: unknown }
  if (textContent.type !== 'text' || typeof textContent.text !== 'string') {
    throw new Error('Expected text tool result')
  }
  return textContent.text
}

async function createClient(): Promise<{
  client: Client
  server: McpServer
}> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'intent-mcp-test', version: '0.0.0' })
  const server = createIntentMcpServer()

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])

  return { client, server }
}

let client: Client | undefined
let server: McpServer | undefined

beforeEach(async () => {
  const pair = await createClient()
  client = pair.client
  server = pair.server
})

afterEach(async () => {
  await client?.close()
  await server?.close()
})

describe('Intent MCP server', () => {
  it('lists a small read-only tool set without embedding a skill catalog', async () => {
    const result = await client!.listTools()

    expect(result.tools.map((tool) => tool.name)).toEqual([
      'intent_search',
      'intent_load',
      'intent_status',
    ])
    expect(
      result.tools.some((tool) =>
        tool.description?.includes('Available local Intent skills'),
      ),
    ).toBe(false)
  })

  it('summarizes discovered packages and skills with compact JSON', async () => {
    const result = await client!.callTool({
      name: 'intent_status',
      arguments: { root: workspaceRoot },
    })

    expect(JSON.parse(getText(result))).toEqual({
      packageManager: 'pnpm',
      packageCount: 2,
      skillCount: 2,
      warningCount: 0,
      conflictCount: 0,
    })
    expect(getText(result)).not.toContain('\n')
  })

  it('searches skills by task text and caps returned rows', async () => {
    const result = await client!.callTool({
      name: 'intent_search',
      arguments: { root: workspaceRoot, query: 'patterns', limit: 1 },
    })

    expect(JSON.parse(getText(result))).toEqual({
      skills: [
        {
          use: '@tanstack/query#fetching',
          packageName: '@tanstack/query',
          version: '5.0.0',
          description: 'Query data fetching patterns',
          type: 'skill',
        },
      ],
      totalMatches: 2,
      warningCount: 0,
      conflictCount: 0,
    })
  })

  it('loads one exact skill into a skill content block', async () => {
    const result = await client!.callTool({
      name: 'intent_load',
      arguments: { root: workspaceRoot, use: '@tanstack/query#fetching' },
    })
    const text = getText(result)

    expect(text).toContain(
      '<skill_content name="@tanstack/query#fetching" package="@tanstack/query" version="5.0.0">',
    )
    expect(text).toContain('# fetching')
    expect(text).toContain('</skill_content>')
  })

  it('returns a tool error for missing skills', async () => {
    const result = await client!.callTool({
      name: 'intent_load',
      arguments: { root: emptyRoot, use: '@tanstack/query#fetching' },
    })

    expect(result.isError).toBe(true)
    expect(getText(result)).toContain('was not found')
  })
})

#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({
  name: 'tanstack-intent',
  version: '0.0.1',
})

const transport = new StdioServerTransport()

await server.connect(transport)

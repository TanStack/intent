#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createIntentMcpServer } from './server.js'

const transport = new StdioServerTransport()
const server = createIntentMcpServer()

await server.connect(transport)

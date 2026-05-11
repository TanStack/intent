---
title: MCP Server Quick Start
id: mcp-server
---

`@tanstack/intent-mcp` lets MCP-compatible agents discover and load Intent skills from your installed packages.

Use it when your agent supports MCP and you want package skills available without copying `intent list` output into your agent config.

## Configure the server

Add this server entry to your MCP client config:

```json
{
  "mcpServers": {
    "intent": {
      "command": "npx",
      "args": ["-y", "@tanstack/intent-mcp"]
    }
  }
}
```

Some clients use `servers` instead of `mcpServers`, but the server command is the same:

```json
{
  "servers": {
    "intent": {
      "command": "npx",
      "args": ["-y", "@tanstack/intent-mcp"]
    }
  }
}
```

Run the server from your project root so Intent can discover the project's installed packages.

## Use skills

After the MCP server is connected, ask your agent to work normally.

When the task matches installed package skills, the agent can:

- call `intent_search` to find relevant skills
- call `intent_load` to load one exact skill
- call `intent_status` to inspect package and skill counts

The server is read-only. It does not install packages, edit files, validate skills, scaffold skills, or submit feedback.

## Tools

- `intent_search` returns compact JSON and defaults to five results.
- `intent_load` returns one skill in a `<skill_content>` block.
- `intent_status` returns package and skill counts.
- `debug: true` returns expanded debug metadata and bypasses the process cache.

## Related

- [Quick Start for Consumers](./quick-start-consumers)
- [intent list](../cli/intent-list)
- [intent load](../cli/intent-load)

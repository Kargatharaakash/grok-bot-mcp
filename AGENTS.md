# AGENTS.md

## Project

`grok-bot-mcp` is an MCP (Model Context Protocol) server that bridges AI agents to Grok Bot. Single file: `server.mjs`. Zero dependencies. JSON-RPC over stdio.

## Tech stack

- Node.js 18+ (ESM, uses global `fetch`)
- Zero npm dependencies — Node built-ins only (`crypto`, `fs`, `child_process`, `os`, `path`, `readline`)
- MCP protocol: JSON-RPC 2.0 over stdio (protocol version 2024-11-05)
- No TypeScript, no bundler, no framework

## Commands

```sh
node server.mjs              # start MCP server (stdio)
node --test tests/*.test.mjs # run tests (all mocked, no real calls)
```

No build step. No compile step.

## Architecture

```
server.mjs
  ├── crypto helpers (checksum, obfuscate, machineId)
  ├── token acquisition (getTokenFromGrokBot, getTokenFromGbu)
  ├── gateway discovery (discoverGateway — decrypts gateway-descriptor.json; supports local host:port and cloud baseUrl)
  ├── API calls (callDashboard → ConnectRPC, callGateway → local or cloud HTTP)
  ├── SQLite reader (readAgentDb, listAgentDbs — read-only)
  ├── MCP tool definitions (TOOLS array — 10 tools)
  ├── tool handlers (handleTool — switch on tool name)
  └── JSON-RPC server (readline → parse → dispatch → respond)
```

## MCP tools

10 tools exposed:

1. `list_bots` — gateway `listAgents`
2. `create_bot` — gateway `createAgent`
3. `delete_bot` — gateway `deleteAgent`
4. `send_message` — gateway `sendPrompt`
5. `get_transcript` — gateway `getAgentTranscriptTail`
6. `search_bots` — gateway `searchAgents`
7. `check_usage` — ConnectRPC `GetSandUsageStatus` + `GetCurrentPeriodUsage`
8. `list_databases` — reads `~/.grokbot/agents/` directory
9. `read_transcript_entries` — reads `store.db` SQLite directly
10. `search_messages` — scans all `store.db` files with `LIKE` query

## Testing

- Tests in `tests/` use mocks only
- No real Grok Bot calls, no network, no database writes
- `tests/server.test.mjs` — MCP protocol tests (initialize, tools/list, error handling)
- `tests/gateway.test.mjs` — gateway descriptor parsing (local + cloud formats)

## Security rules

- Never return tokens, secrets, or credentials in MCP tool responses
- Database access is always read-only (`PRAGMA query_only = 1`)
- Gateway token is decrypted at startup, never persisted
- No telemetry, no analytics, no third-party network calls
- The `CLIENT_ID` is a public OAuth client ID, not a secret

## Boundaries

- **Always do:** Keep everything in `server.mjs` — single file
- **Always do:** Test with `node --test tests/*.test.mjs` — mocks only, no real calls
- **Ask first:** Before adding any npm dependency
- **Never do:** Hardcode tokens, API keys, or credentials
- **Never do:** Add write access to SQLite databases
- **Never do:** Expose the gateway token or auth token through MCP tools
- **Never do:** Make network calls except to the Grok Bot gateway (local or cloud) and `api2.cursor.sh` (usage)

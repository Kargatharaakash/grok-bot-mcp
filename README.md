<div align="center">

<img src="assets/logo.png" width="128" height="128" alt="grok-bot-mcp logo" />

# grok-bot-mcp

**MCP server for Grok Bot — let any AI agent control your bots.**

Create bots, read transcripts, send messages, search history, and check usage — all through the Model Context Protocol. Works with Claude Desktop, Cursor, Windsurf, Cline, VS Code Copilot, and any MCP-compatible client.

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![deps](https://img.shields.io/badge/dependencies-0-orange)](https://www.npmjs.com/package/grok-bot-mcp)
[![mcp](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io)

**Companion to:** [gbu — Grok Bot Usage checker](https://github.com/Kargatharaaakash/gbu)

</div>

---

## What this does

`grok-bot-mcp` is an MCP server that bridges AI agents (Claude, Cursor, Copilot, etc.) to your locally running Grok Bot instance. Once installed, any MCP-compatible AI client can:

- **Create, list, search, and delete bots** — without opening the Grok Bot app
- **Send messages to bots** and get responses — directly from your AI editor
- **Read conversation transcripts** — full history of any bot
- **Search across all bot messages** — full-text search through local databases
- **Check usage and billing** — weekly usage %, on-demand spend, reset times
- **List local databases** — see all agent store.db files and their sizes

All through the standardized MCP tool interface. No custom API integration needed.

## Install

**One command (macOS / Linux):**

```sh
gh repo clone Kargatharaaakash/grok-bot-mcp && cd grok-bot-mcp && sh install.sh
```

The install script automatically detects which AI agents you have installed and configures the MCP server for each one. Restart your AI agent after install.

**What it configures:**

| Agent | Config path | Auto-configured |
|---|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | Yes |
| Cursor | `~/.cursor/mcp.json` | Yes |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | Yes |
| Cline | `~/.cline/mcp_settings.json` | Yes |
| Continue | `~/.continue/config.json` | Yes |
| VS Code (Copilot) | `.vscode/mcp.json` in workspace | Manual |
| Claude Code (CLI) | `claude mcp add` | Yes |
| Zed | `~/.config/zed/settings.json` | Manual |

## Tools

The MCP server exposes these tools to any connected AI agent:

### Agent management

| Tool | What it does | Required params |
|---|---|---|
| `list_bots` | List all Grok Bot agents | None |
| `create_bot` | Create a new bot | `name` |
| `delete_bot` | Delete a bot by ID | `agentId` |
| `search_bots` | Search bots by name/description | `query` |

### Messaging

| Tool | What it does | Required params |
|---|---|---|
| `send_message` | Send a message to a bot and get response | `agentId`, `message` |
| `get_transcript` | Read a bot's conversation history | `agentId` |

### Database

| Tool | What it does | Required params |
|---|---|---|
| `list_databases` | List all local agent databases | None |
| `read_transcript_entries` | Read raw transcript entries from store.db | `agentId` |
| `search_messages` | Full-text search across all bot transcripts | `query` |

### Usage

| Tool | What it does | Required params |
|---|---|---|
| `check_usage` | Check weekly usage and on-demand spend | None |

## How it works

```
AI Agent (Claude / Cursor / Copilot / Windsurf / etc.)
        │
        │ MCP Protocol (JSON-RPC over stdio)
        ▼
   grok-bot-mcp server
        │
        ├── Grok Bot Gateway ──► http://127.0.0.1:<port>/api/<command>
        │                          ├── listAgents, createAgent, sendPrompt...
        │                          └── 100+ gateway commands
        │
        ├── Local SQLite DBs ──► ~/.grokbot/agents/<id>/store.db (read-only)
        │                          └── transcript_entries, kv, blobs
        │
        └── Cursor Usage API ─► api2.cursor.sh (ConnectRPC)
                                   └── GetSandUsageStatus, GetCurrentPeriodUsage
```

The server discovers the Grok Bot gateway by decrypting `gateway-descriptor.json` (same macOS Keychain technique as [gbu](https://github.com/Kargatharaaakash/gbu)). For database queries, it reads the local SQLite files directly in read-only mode.

## Manual config

If you prefer to configure manually, add this to your MCP config file:

```json
{
  "mcpServers": {
    "grok-bot": {
      "command": "node",
      "args": ["~/.gbm/bin/grok-bot-mcp"]
    }
  }
}
```

## Requirements

- Node.js 18+
- Grok Bot app installed and running (for gateway and keychain access)
- macOS (for gateway discovery and keychain decryption; database reads work on any OS if files exist)

## Testing

Tests use mocks — no real Grok Bot calls, no network, no database writes:

```sh
node --test tests/*.test.mjs
```

## Security

- **Read-only database access** — `PRAGMA query_only = 1` on all SQLite queries
- **No secrets in MCP responses** — tokens are never returned to the AI agent
- **Gateway token decrypted at startup** — never written to disk
- **Local only** — stdio transport, no network server exposed
- **No telemetry** — zero calls except to `127.0.0.1` (gateway) and `api2.cursor.sh` (usage)

## Uninstall

```sh
rm -rf ~/.gbm
```

Then remove the `grok-bot` entry from your AI agent's MCP config file.

## Companion project

**[gbu](https://github.com/Kargatharaaakash/gbu)** — Grok Bot Usage checker CLI. Multi-account usage checking from the terminal. Same token management, same API, different interface (CLI vs MCP).

## License

MIT

---

<div align="center">

**#GrokBot #MCP #ModelContextProtocol #Cursor #Claude #AI #DeveloperTools #Automation**

⭐ Star if this let your AI agent control your bots.

</div>

---

## Disclaimer

This project is an independent, educational tool created for learning and
research purposes. It is not affiliated with, endorsed by, sponsored by, or
associated with **Cursor**, **Anysphere**, **Grok**, **Grok Bot**, **SpaceXAI**,
**xAI**, **SpaceX**, or any other company, product, or entity.

All product names, logos, trademarks, and registered trademarks mentioned in
this repository are the property of their respective owners. Use of any names
or logos is for identification and educational reference only, and does not
imply endorsement, partnership, or affiliation.

This tool interacts with locally running applications and publicly accessible
API endpoints using credentials you already possess. It does not bypass
authentication, scrape protected content, or access any non-public system.
You are solely responsible for compliance with the Terms of Service of any
platform you use with this tool.

The authors and contributors of this project assume no liability for any
damages, account actions, or consequences arising from the use of this
software. Use at your own discretion.

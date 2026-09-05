<div align="center">

<img src="assets/logo.png" width="128" height="128" alt="grok-bot logo" />

# grok-bot

**The Unified CLI & MCP Server for Grok Bot and Cursor.**

Usage dashboard for humans. Complete MCP toolset for AI agents. Zero passwords. Zero keychain prompts.

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![deps](https://img.shields.io/badge/dependencies-0-orange)](https://www.npmjs.com/package/grok-bot-mcp)
[![mcp](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io)

</div>

---

## 🌟 Why grok-bot?

* **For Humans (CLI)**: Check weekly usage %, quota limits, on-demand spend, and reset times across all accounts with one simple command. Connect accounts in seconds via browser login — zero passwords or system keychain popups.
* **For AI Agents (MCP Server)**: Connects Claude Desktop, Cursor, Antigravity, Windsurf, Cline, and VS Code Copilot to Grok Bot. Lets your agents inspect usage, switch accounts, launch bots, read transcripts, send prompts, and search conversation history.
* **Zero Dependencies**: 100% native Node.js built-ins. Pure ESM.

---

## ⚡ Quick Start (10 Seconds)

### 1. Install
One single command sets up the CLI and auto-configures your AI agents:

```sh
curl -fsSL https://raw.githubusercontent.com/Kargatharaakash/grok-bot-mcp/main/install.sh | sh
```

### 2. Connect Your Account (Zero Passwords)
Authenticate in your browser via OAuth PKCE:

```sh
grok-bot login
```
*(Opens your default web browser to authorize. Zero passwords or keychain prompts.)*

### 3. Check Usage
```sh
grok-bot
```

Outputs a clean, formatted usage dashboard:
```
  ┌─────────────────────────────────────────────────┐
  │  main [active] user@example.com                │
  ├─────────────────────────────────────────────────┤
  │  Weekly Usage:  5.56% used                     │
  │  Available:     Yes                            │
  │  Resets:        Wed, Sep 9, 11:57 AM           │
  ├─────────────────────────────────────────────────┤
  │  On-demand:     $0.00 used                     │
  │  Limit:         No limit                       │
  │  Remaining:     N/A                            │
  │  Cycle ends:    Thu, Sep 24, 12:53 PM          │
  └─────────────────────────────────────────────────┘
```

---

## 💻 Commands for Humans

| Command | Description |
|---|---|
| `grok-bot` | View usage summary table for active or all accounts |
| `grok-bot <name>` | Check usage for a specific account (e.g. `grok-bot company`) |
| `grok-bot login` | Sign in via browser OAuth (zero passwords, zero keychain) |
| `grok-bot login <name>` | Sign in and assign a custom nickname (e.g. `grok-bot login work`) |
| `grok-bot switch <name>` | Switch the active account (alias: `use`) |
| `grok-bot list` | List all saved accounts and token expiration dates |
| `grok-bot rm <name>` | Remove a saved account |
| `grok-bot --json` | Output usage metrics as structured JSON for scripts & automation |
| `grok-bot help` | Display built-in CLI help |

*(Note: `gbm` and `grok-bot-mcp` work as exact aliases for `grok-bot`.)*

---

## 🤖 MCP Server for AI Agents

When spawned by an AI client or with `grok-bot mcp`, `grok-bot` runs as a Model Context Protocol (MCP) server over standard input/output (`stdio`).

### Automatically Configured AI Agents
The installer automatically configures:
- **Cursor**: `~/.cursor/mcp.json`
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Antigravity**: `~/.gemini/config/mcp_config.json`
- **Windsurf**: `~/.codeium/windsurf/mcp_config.json`
- **Cline**: `~/.cline/mcp_settings.json`
- **Continue**: `~/.continue/config.json`
- **Claude Code**: `claude mcp add`

### Manual Configuration
Add this to your MCP configuration file:

```json
{
  "mcpServers": {
    "grok-bot": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/.gbm/bin/grok-bot-mcp"]
    }
  }
}
```

---

## 🛠️ MCP Tools Reference

| Tool | Category | What it does | Parameters |
|---|---|---|---|
| `check_usage` | **Usage** | Check weekly usage %, quota limits, reset dates, and on-demand spend. | `account` *(optional: account name or `"all"`)* |
| `switch_account` | **Usage** | Switch the active account for Cursor / Grok Bot. | `account` *(required: name of account)* |
| `list_bots` | **Agent** | List all Grok Bot agents currently registered or running. | None |
| `create_bot` | **Agent** | Launch a new Grok Bot agent instance with a name and prompt. | `name` *(required)*, `description` *(optional)* |
| `delete_bot` | **Agent** | Delete a Grok Bot agent by its agent ID. | `agentId` *(required)* |
| `send_message` | **Messaging** | Send a message to a bot and get its response. | `agentId` *(required)*, `message` *(required)* |
| `get_transcript` | **Messaging** | Read full conversation history of any bot in order. | `agentId` *(required)*, `limit` *(optional)* |
| `search_bots` | **Search** | Search for bots by name or description. | `query` *(required)* |
| `search_messages` | **Search** | Full-text search across all local bot conversations. | `query` *(required)*, `limit` *(optional)* |
| `list_databases` | **Database** | List local SQLite database files and disk sizes. | None |
| `read_transcript_entries` | **Database** | Read raw SQLite database transcript entries offline. | `agentId` *(required)*, `limit` *(optional)* |

---

## 🔒 Security & Privacy

* **Zero Passwords / Zero Keychain Dialogs**: Browser PKCE login uses standard Web OAuth. Your operating system keychain is never prompted.
* **Encrypted Token Storage**: Tokens are stored with restricted permissions (`0600`) at `~/.gbm/accounts.json`.
* **Read-Only SQLite Access**: Database readers enforce `PRAGMA query_only = 1`.
* **No Telemetry**: No analytics or tracking. Network communication occurs strictly with official endpoints (`api2.cursor.sh` and local/cloud gateway).

---

## 🧪 Testing

The test suite runs 100% offline with mocks — zero network calls, zero modifications to running bots:

```sh
node --test tests/*.test.mjs
```

---

## 📄 License

MIT © Aakash Kargathara

#!/bin/sh
# grok-bot install script — Unified CLI & MCP Setup
# Works on macOS, Linux, and Windows (Git Bash / WSL)
# Usage: curl -fsSL https://raw.githubusercontent.com/Kargatharaakash/grok-bot-mcp/main/install.sh | sh

set -e

NAME="grok-bot"
DIR="$HOME/.gbm/bin"
REPO="Kargatharaakash/grok-bot-mcp"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"

mkdir -p "$DIR"

# Download or copy server
if [ -f "server.mjs" ]; then
  cp server.mjs "$DIR/grok-bot-mcp"
else
  download() {
    local file="$1" dest="$2"
    if curl -fsSL "${RAW_BASE}/${file}" -o "$dest" 2>/dev/null; then
      return 0
    fi
    if command -v gh >/dev/null 2>&1; then
      gh api "repos/${REPO}/contents/${file}" --jq '.content' 2>/dev/null | base64 -d > "$dest" 2>/dev/null
      return $?
    fi
    return 1
  }

  if ! download "server.mjs" "$DIR/grok-bot-mcp"; then
    echo "  Could not download server.mjs"
    echo "  Run: gh repo clone ${REPO} && cd grok-bot-mcp && sh install.sh"
    exit 1
  fi
fi

chmod +x "$DIR/grok-bot-mcp"

# Create friendly command aliases (grok-bot, gbm, grok-bot-mcp)
ln -sf "$DIR/grok-bot-mcp" "$DIR/grok-bot"
ln -sf "$DIR/grok-bot-mcp" "$DIR/gbm"

# Add to PATH if needed
case ":$PATH:" in
  *":$DIR:"*) ;;
  *)
    SHELL_NAME=$(basename "$SHELL" 2>/dev/null || echo "")
    if [ "$SHELL_NAME" = "zsh" ]; then
      echo "export PATH=\"$DIR:\$PATH\"" >> "$HOME/.zshrc"
    elif [ "$SHELL_NAME" = "bash" ]; then
      echo "export PATH=\"$DIR:\$PATH\"" >> "$HOME/.bashrc"
    else
      echo "export PATH=\"$DIR:\$PATH\"" >> "$HOME/.profile"
    fi
    export PATH="$DIR:$PATH"
    ;;
esac

SERVER_PATH="$DIR/grok-bot-mcp"
NODE_BIN=$(which node 2>/dev/null || echo "node")

# ── Configure MCP for each detected AI agent ─────────────────────────────
CONFIGURED=""
SKIPPED=""

add_to_config() {
  local config_path="$1" agent_name="$2"
  if [ ! -f "$config_path" ]; then
    mkdir -p "$(dirname "$config_path")"
    echo '{"mcpServers":{}}' > "$config_path"
  fi
  node -e "
    const fs = require('fs');
    const path = process.argv[1];
    const agent = process.argv[2];
    const serverPath = process.argv[3];
    let config = {};
    try { config = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {}
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers['grok-bot'] = {
      command: 'node',
      args: [serverPath]
    };
    fs.writeFileSync(path, JSON.stringify(config, null, 2));
    console.log('  ' + agent + ': configured');
  " "$config_path" "$agent_name" "$SERVER_PATH" 2>/dev/null && CONFIGURED="$CONFIGURED  $agent_name" || SKIPPED="$SKIPPED  $agent_name"
}

echo ""
echo "  Detecting AI agents..."
echo ""

# 1. Claude Desktop
CLAUDE_CONFIG=""
case "$(uname -s)" in
  Darwin) CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
  Linux) CLAUDE_CONFIG="$HOME/.config/Claude/claude_desktop_config.json" ;;
esac
if [ -n "$CLAUDE_CONFIG" ] && { [ -f "$CLAUDE_CONFIG" ] || [ -d "$(dirname "$CLAUDE_CONFIG")" ]; }; then
  add_to_config "$CLAUDE_CONFIG" "Claude Desktop"
else
  SKIPPED="$SKIPPED  Claude Desktop (not installed)"
fi

# 2. Cursor
CURSOR_CONFIG="$HOME/.cursor/mcp.json"
if [ -d "$HOME/.cursor" ] || [ -f "$CURSOR_CONFIG" ]; then
  add_to_config "$CURSOR_CONFIG" "Cursor"
else
  SKIPPED="$SKIPPED  Cursor (not installed)"
fi

# 3. Windsurf
WINDSURF_CONFIG="$HOME/.codeium/windsurf/mcp_config.json"
if [ -d "$HOME/.codeium" ] || [ -f "$WINDSURF_CONFIG" ]; then
  add_to_config "$WINDSURF_CONFIG" "Windsurf"
else
  SKIPPED="$SKIPPED  Windsurf (not installed)"
fi

# 4. VS Code (Copilot)
if [ -d "$HOME/.vscode" ] || command -v code >/dev/null 2>&1; then
  CONFIGURED="$CONFIGURED  VS Code (add .vscode/mcp.json in workspace)"
else
  SKIPPED="$SKIPPED  VS Code (not installed)"
fi

# 5. Claude Code (CLI)
if command -v claude >/dev/null 2>&1; then
  claude mcp add grok-bot -- node "$SERVER_PATH" 2>/dev/null && CONFIGURED="$CONFIGURED  Claude Code (CLI)" || SKIPPED="$SKIPPED  Claude Code (add manually)"
else
  SKIPPED="$SKIPPED  Claude Code (not installed)"
fi

# 6. Cline
CLINE_CONFIG="$HOME/.cline/mcp_settings.json"
if [ -d "$HOME/.cline" ] || [ -f "$CLINE_CONFIG" ]; then
  add_to_config "$CLINE_CONFIG" "Cline"
else
  SKIPPED="$SKIPPED  Cline (not installed)"
fi

# 7. Continue
CONTINUE_CONFIG="$HOME/.continue/config.json"
if [ -d "$HOME/.continue" ] || [ -f "$CONTINUE_CONFIG" ]; then
  add_to_config "$CONTINUE_CONFIG" "Continue"
else
  SKIPPED="$SKIPPED  Continue (not installed)"
fi

# 8. Zed
ZED_CONFIG="$HOME/.config/zed/settings.json"
if [ -d "$HOME/.config/zed" ] || [ -f "$ZED_CONFIG" ]; then
  echo "  Zed: add to settings.json → assistant.mcp_servers"
  CONFIGURED="$CONFIGURED  Zed (manual)"
else
  SKIPPED="$SKIPPED  Zed (not installed)"
fi

# 9. Antigravity
ANTIGRAVITY_CONFIG="$HOME/.gemini/config/mcp_config.json"
if [ -d "$HOME/.gemini" ] || [ -f "$ANTIGRAVITY_CONFIG" ]; then
  add_to_config "$ANTIGRAVITY_CONFIG" "Antigravity"
else
  SKIPPED="$SKIPPED  Antigravity (not installed)"
fi

echo ""
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  \033[32m✓ grok-bot installed successfully!\033[0m             │"
echo "  ├─────────────────────────────────────────────────┤"
echo "  │  Commands for Humans:                           │"
echo "  │    \033[36mgrok-bot\033[0m          Check account usage & quota│"
echo "  │    \033[36mgrok-bot login\033[0m    Connect account (browser)  │"
echo "  │    \033[36mgrok-bot switch\033[0m   Switch active account      │"
echo "  │    \033[36mgrok-bot list\033[0m     List connected accounts    │"
echo "  ├─────────────────────────────────────────────────┤"
echo "  │  Configured AI Agents:                          │"
[ -n "$CONFIGURED" ] && echo "$CONFIGURED" | while read -r line; do [ -n "$line" ] && echo "  │$line"; done
echo "  ├─────────────────────────────────────────────────┤"
echo "  │  Restart your AI agent to load MCP tools.       │"
echo "  └─────────────────────────────────────────────────┘"
echo ""

# Run grok-bot for immediate feedback
"$DIR/grok-bot" || true

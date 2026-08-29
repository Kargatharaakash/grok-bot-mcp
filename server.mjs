#!/usr/bin/env node
// grok-bot-mcp — MCP server for Grok Bot
// Lets any AI agent control Grok Bot: create bots, read transcripts, send messages,
// manage channels, search history, and check usage — all through MCP.
// Zero dependencies. Node 18+. JSON-RPC over stdio.

import { createHash, randomBytes, randomUUID, pbkdf2Sync, createDecipheriv } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

const SERVER_VERSION = "1.1.0";
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const BACKEND = "https://api2.cursor.sh";
const CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const GROKBOT_DATA = join(homedir(), "Library", "Application Support", "Grok Bot");
const GROKBOT_SECRETS = join(GROKBOT_DATA, "sand-secrets.json");
const GROKBOT_AGENTS_DIR = join(homedir(), ".grokbot");
const GBU_DIR = join(homedir(), ".gbu");
const GBU_STORE = join(GBU_DIR, "accounts.json");

// ── crypto helpers (same as gbu) ────────────────────────────────────────
function obfuscate(b) { let p=165; for(let i=0;i<b.length;i++){const c=b[i]??0;b[i]=((c^p)+(i%256))&255;p=b[i]??0;} return b; }
function checksum(mid, now=Date.now()) {
  const ks = Math.floor(now/1e6);
  const b = new Uint8Array([(ks>>40)&255,(ks>>32)&255,(ks>>24)&255,(ks>>16)&255,(ks>>8)&255,ks&255]);
  return Buffer.from(obfuscate(b)).toString("base64url") + mid;
}
function machineId() { return randomUUID(); }

// ── token acquisition ────────────────────────────────────────────────────
function decryptSafeStorage(encBase64) {
  const kp = execSync('security find-generic-password -a "Grok Bot Key" -s "Grok Bot Safe Storage" -w', {encoding:"utf8",timeout:3e4,maxBuffer:1e4}).trim();
  const raw = Buffer.from(encBase64, "base64");
  const ct = raw.slice(3);
  const dk = pbkdf2Sync(kp, "saltysalt", 1003, 16, "sha1");
  const iv = Buffer.alloc(16, 0x20);
  const dec = createDecipheriv("aes-128-cbc", dk, iv);
  let buf = dec.update(ct);
  buf = Buffer.concat([buf, dec.final()]);
  return buf.toString("utf8");
}

function getTokenFromGrokBot() {
  if (process.platform !== "darwin") throw new Error("Grok Bot import requires macOS");
  if (!existsSync(GROKBOT_SECRETS)) throw new Error("Grok Bot not installed");
  const d = JSON.parse(readFileSync(GROKBOT_SECRETS, "utf8"));
  const acc = JSON.parse(d["cursor-accounts"]);
  const sc = acc.active;
  const enc = acc.accounts?.[sc]?.["cursor-access-token"];
  if (!enc) throw new Error("No token in Grok Bot");
  const t = decryptSafeStorage(enc);
  const m = t.match(/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (!m) throw new Error("Decrypted data is not a JWT");
  return m[0];
}

function getTokenFromGbu() {
  if (!existsSync(GBU_STORE)) throw new Error("No gbu accounts. Run: gbu add");
  const s = JSON.parse(readFileSync(GBU_STORE, "utf8"));
  const first = Object.values(s)[0];
  if (!first?.accessToken) throw new Error("No token in gbu accounts");
  return first.accessToken;
}

function getToken() {
  // Try gbu first (multi-account), then Grok Bot app
  try { return getTokenFromGbu(); } catch {}
  try { return getTokenFromGrokBot(); } catch {}
  throw new Error("No token found. Install gbu (gbu add) or Grok Bot app.");
}

// ── ConnectRPC calls (Cursor backend) ────────────────────────────────────
async function callDashboard(method, token) {
  const id = machineId(), cs = checksum(id);
  const r = await fetch(`${BACKEND}/aiserver.v1.DashboardService/${method}`, {
    method: "POST",
    headers: {"Content-Type":"application/json",Authorization:`Bearer ${token}`,"x-cursor-checksum":cs,"x-cursor-client-type":"sand","x-cursor-client-version":"0.1.0","x-sand-box-namespace":"prod","x-ghost-mode":"true","x-request-id":randomUUID()},
    body: "{}"
  });
  if (!r.ok) { const t = await r.text().catch(()=>""); throw new Error(`${method}: ${r.status} ${t}`); }
  return r.json();
}

// ── Gateway discovery (local host:port or cloud baseUrl) ─────────────────
export function parseGatewayDescriptor(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  // Legacy local gateway (Grok Bot <0.30)
  if (parsed.host && parsed.port) {
    return {
      baseUrl: `http://${parsed.host}:${parsed.port}`,
      token: parsed.authToken || parsed.token || "",
      headers: parsed.headers || {},
    };
  }

  // Cloud / remote gateway (Grok Bot 0.30+)
  if (parsed.baseUrl && parsed.token) {
    return {
      baseUrl: String(parsed.baseUrl).replace(/\/$/, ""),
      token: parsed.token,
      headers: parsed.headers || {},
    };
  }

  return null;
}

export function buildGatewayRequest(gw, command) {
  const headers = { "Content-Type": "application/json", ...gw.headers };
  if (gw.token) headers.Authorization = `Bearer ${gw.token}`;
  return {
    url: `${gw.baseUrl}/api/${command}`,
    headers,
  };
}

function discoverGateway() {
  const descPath = join(GROKBOT_DATA, "gateway-descriptor.json");
  if (!existsSync(descPath)) return null;
  try {
    const d = JSON.parse(readFileSync(descPath, "utf8"));
    const entries = d.entries || {};
    for (const entry of Object.values(entries)) {
      if (!entry?.encrypted) continue;
      try {
        const decrypted = decryptSafeStorage(entry.encrypted);
        const parsed = parseGatewayDescriptor(JSON.parse(decrypted));
        if (parsed) return parsed;
      } catch {}
    }
  } catch {}
  return null;
}

async function callGateway(command, body = {}, gateway = null) {
  const gw = gateway || discoverGateway();
  if (!gw) throw new Error("Grok Bot gateway not found. Is Grok Bot running?");
  const { url, headers } = buildGatewayRequest(gw, command);
  const r = await fetch(url, {method: "POST", headers, body: JSON.stringify(body)});
  if (!r.ok) { const t = await r.text().catch(()=>""); throw new Error(`${command}: ${r.status} ${t}`); }
  return r.json();
}

// ── SQLite database reader (read-only) ───────────────────────────────────
function getAgentDbPath(agentId) {
  return join(GROKBOT_AGENTS_DIR, "agents", agentId, "store.db");
}

function readAgentDb(agentId, query, params = []) {
  const dbPath = getAgentDbPath(agentId);
  if (!existsSync(dbPath)) throw new Error(`No database for agent ${agentId}`);
  // Use node:sqlite if available (Node 22+), otherwise fall back to sqlite3 CLI
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = 1");
    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    db.close();
    return rows;
  } catch (e) {
    if (e.message.includes("Cannot find module")) {
      // Fall back to sqlite3 CLI
      const escaped = query.replace(/'/g, "''");
      const paramStr = params.map(p => `'${String(p).replace(/'/g, "''")}'`).join(" ");
      const cmd = `sqlite3 -json -readonly '${dbPath}' '${escaped}' ${paramStr.length > 0 ? "" : ""}`;
      const result = execSync(`sqlite3 -json -readonly '${dbPath}' "${escaped.replace(/"/g, '\\"')}"`, {encoding:"utf8",timeout:5e3});
      return result.trim() ? JSON.parse(result) : [];
    }
    throw e;
  }
}

function listAgentDbs() {
  const agentsDir = join(GROKBOT_AGENTS_DIR, "agents");
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir, {withFileTypes: true})
    .filter(e => e.isDirectory())
    .map(e => {
      const dbPath = join(agentsDir, e.name, "store.db");
      const exists = existsSync(dbPath);
      let size = 0;
      if (exists) { try { size = statSync(dbPath).size; } catch {} }
      return { agentId: e.name, dbPath, exists, sizeBytes: size };
    })
    .filter(a => a.exists);
}

// ── MCP tool definitions ─────────────────────────────────────────────────
const TOOLS = [
  // ── Agent management ──
  {
    name: "list_bots",
    description: "List all Grok Bot agents (bots) on this machine. Returns agent IDs, names, and descriptions. No parameters needed.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "create_bot",
    description: "Create a new Grok Bot agent. Requires a name. Optionally include a description of what the bot should do.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the new bot (e.g. 'Research Assistant')" },
        description: { type: "string", description: "What this bot should do (e.g. 'Researches companies and writes reports')" }
      },
      required: ["name"]
    }
  },
  {
    name: "delete_bot",
    description: "Delete a Grok Bot agent by ID. This is permanent and cannot be undone.",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string", description: "The ID of the bot to delete" } },
      required: ["agentId"]
    }
  },
  {
    name: "send_message",
    description: "Send a message to a Grok Bot agent. The bot will process it and respond. Returns the agent's response.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "The bot ID to send the message to" },
        message: { type: "string", description: "The message text to send" }
      },
      required: ["agentId", "message"]
    }
  },
  {
    name: "get_transcript",
    description: "Read the conversation history (transcript) of a Grok Bot agent. Returns recent messages in chronological order.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "The bot ID to read" },
        limit: { type: "number", description: "Max number of messages to return (default: 50)" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "search_bots",
    description: "Search for Grok Bot agents by name or description. Returns matching agents.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query (e.g. 'research', 'code review')" } },
      required: ["query"]
    }
  },
  // ── Usage ──
  {
    name: "check_usage",
    description: "Check weekly usage and on-demand spend for your Cursor/Grok Bot account. Returns percentage used, reset time, and dollar amounts. No parameters needed.",
    inputSchema: { type: "object", properties: {} }
  },
  // ── Database ──
  {
    name: "list_databases",
    description: "List all local Grok Bot agent databases on this machine. Returns agent IDs, database paths, and file sizes. No parameters needed.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "read_transcript_entries",
    description: "Read raw transcript entries from a specific bot's local SQLite database. Returns JSON entries containing messages, tool calls, and attachments. This reads the local store.db file directly — no network call.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "The bot ID whose database to read" },
        limit: { type: "number", description: "Max entries to return (default: 100)" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "search_messages",
    description: "Search across all bot transcripts for messages containing a keyword. Scans local SQLite databases. Returns matching messages with agent ID, role, timestamp, and body.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The text to search for in messages" },
        limit: { type: "number", description: "Max results (default: 20)" }
      },
      required: ["query"]
    }
  },
];

// ── Tool handlers ────────────────────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {
    case "list_bots": {
      const result = await callGateway("listAgents");
      const agents = Array.isArray(result) ? result : (result.agents || []);
      return { content: [{ type: "text", text: JSON.stringify(agents.map(a => ({
        id: a.id, name: a.name, description: a.description || "",
        ...(a.origin ? { origin: a.origin } : {})
      })), null, 2) }] };
    }

    case "create_bot": {
      const result = await callGateway("createAgent", { name: args.name, description: args.description || "", origin: "mcp" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "delete_bot": {
      const result = await callGateway("deleteAgent", { id: args.agentId });
      return { content: [{ type: "text", text: `Bot ${args.agentId} deleted.` }] };
    }

    case "send_message": {
      const result = await callGateway("sendPrompt", { agentId: args.agentId, content: args.message, awaitTurn: true });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "get_transcript": {
      const limit = args.limit || 50;
      const result = await callGateway("getAgentTranscriptTail", { agentId: args.agentId, limit });
      const entries = Array.isArray(result) ? result : (result.entries || []);
      const formatted = entries.map(e => {
        try { const parsed = typeof e.entry === "string" ? JSON.parse(e.entry) : e.entry; return parsed; } catch { return e; }
      });
      return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
    }

    case "search_bots": {
      const result = await callGateway("searchAgents", { query: args.query });
      const agents = Array.isArray(result) ? result : (result.agents || []);
      return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
    }

    case "check_usage": {
      const token = getToken();
      const [sand, period] = await Promise.allSettled([
        callDashboard("GetSandUsageStatus", token),
        callDashboard("GetCurrentPeriodUsage", token),
      ]);
      const ss = sand.status === "fulfilled" ? sand.value : null;
      const pu = period.status === "fulfilled" ? period.value : null;
      const fmtC = c => c != null ? `$${(c/100).toFixed(2)}` : "N/A";
      const fmtT = ms => ms ? new Date(ms).toLocaleString("en-US", {weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : "N/A";
      const spend = pu?.spendLimitUsage;
      const summary = {
        weeklyUsagePercent: ss?.usagePercent ?? null,
        available: ss?.hasAvailableUsage ?? null,
        resetsAt: ss?.nextResetTimestampUtc ?? null,
        onDemandUsed: spend ? fmtC(spend.individualUsed ?? spend.totalSpend ?? 0) : null,
        onDemandLimit: spend?.individualLimit != null ? fmtC(spend.individualLimit) : null,
        billingCycleEnd: pu?.billingCycleEnd ?? null,
      };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }

    case "list_databases": {
      const dbs = listAgentDbs();
      return { content: [{ type: "text", text: JSON.stringify(dbs, null, 2) }] };
    }

    case "read_transcript_entries": {
      const limit = args.limit || 100;
      const rows = readAgentDb(args.agentId, `SELECT seq, id, entry FROM transcript_entries ORDER BY seq DESC LIMIT ?`, [limit]);
      const parsed = rows.map(r => {
        try { return { seq: r.seq, id: r.id, ...JSON.parse(r.entry) }; } catch { return r; }
      });
      return { content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }] };
    }

    case "search_messages": {
      const limit = args.limit || 20;
      const dbs = listAgentDbs();
      const results = [];
      const searchPattern = `%${args.query}%`;
      for (const db of dbs) {
        try {
          const rows = readAgentDb(db.agentId,
            `SELECT entry FROM transcript_entries WHERE entry LIKE ? ORDER BY seq DESC LIMIT ?`,
            [searchPattern, limit]
          );
          for (const row of rows) {
            try {
              const entry = JSON.parse(row.entry);
              if (entry.kind === "message" || entry.kind === "send-message") {
                results.push({ agentId: db.agentId, role: entry.role || "assistant", body: entry.content || entry.text || "", timestampMs: entry.timestampMs });
              }
            } catch {}
          }
        } catch {}
        if (results.length >= limit) break;
      }
      return { content: [{ type: "text", text: JSON.stringify(results.slice(0, limit), null, 2) }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP JSON-RPC server (stdio) ──────────────────────────────────────────
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function startMcpServer() {
  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on("line", (line) => {
    let req;
    try { req = JSON.parse(line); } catch { return; }
    if (!req.id || !req.method) return;

    const { id, method, params } = req;

    switch (method) {
      case "initialize":
        send({ jsonrpc: "2.0", id, result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "grok-bot-mcp", version: SERVER_VERSION }
        }});
        break;

      case "initialized":
        // notification, no response needed
        break;

      case "tools/list":
        send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        break;

      case "tools/call":
        handleTool(params.name, params.arguments || {})
          .then(result => send({ jsonrpc: "2.0", id, result }))
          .catch(err => send({ jsonrpc: "2.0", id, error: { code: -32603, message: err.message } }));
        break;

      default:
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  });

  rl.on("close", () => process.exit(0));
  process.stdin.resume();
}

if (isMainModule) {
  startMcpServer();
}

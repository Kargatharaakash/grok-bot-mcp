#!/usr/bin/env node
// grok-bot-mcp — Unified CLI & MCP Server for Grok Bot
// For Humans: Terminal usage dashboard, zero-password browser login, account switching
// For AI Agents: Full Model Context Protocol (MCP) server over stdio
// Zero external dependencies. Node 18+.

import { createHash, randomBytes, randomUUID, pbkdf2Sync, createDecipheriv, createCipheriv } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, readdirSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SERVER_VERSION = "1.3.0";
const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
})();

const BACKEND = "https://api2.cursor.sh";
const CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const GBM_DIR = join(homedir(), ".gbm");
const GBM_CONFIG = join(GBM_DIR, "config.json");
const GBM_STORE = join(GBM_DIR, "accounts.json");
const GBU_DIR = join(homedir(), ".gbu");
const GBU_STORE = join(GBU_DIR, "accounts.json");
const GROKBOT_DATA = join(homedir(), "Library", "Application Support", "Grok Bot");
const GROKBOT_SECRETS = join(GROKBOT_DATA, "sand-secrets.json");
const GROKBOT_AGENTS_DIR = join(homedir(), ".grokbot");

// ── crypto helpers ────────────────────────────────────────────────────────
function obfuscate(b) {
  let p = 165;
  for (let i = 0; i < b.length; i++) {
    const c = b[i] ?? 0;
    b[i] = ((c ^ p) + (i % 256)) & 255;
    p = b[i] ?? 0;
  }
  return b;
}

function checksum(mid, now = Date.now()) {
  const ks = Math.floor(now / 1e6);
  const b = new Uint8Array([(ks >> 40) & 255, (ks >> 32) & 255, (ks >> 24) & 255, (ks >> 16) & 255, (ks >> 8) & 255, ks & 255]);
  return Buffer.from(obfuscate(b)).toString("base64url") + mid;
}

function machineId() {
  return randomUUID();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── token & account store ─────────────────────────────────────────────────
export function extractJwt(value) {
  const m = String(value).match(/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (!m) throw new Error("Invalid access token");
  return m[0];
}

export function jwtInfo(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return { email: p.email, sub: p.sub, exp: p.exp };
  } catch {
    return {};
  }
}

export function readGbmConfig() {
  if (!existsSync(GBM_CONFIG)) return null;
  try { return JSON.parse(readFileSync(GBM_CONFIG, "utf8")); } catch { return null; }
}

export function writeGbmConfig(config) {
  mkdirSync(GBM_DIR, { recursive: true });
  writeFileSync(GBM_CONFIG, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function loadStore() {
  if (existsSync(GBM_STORE)) {
    try { return JSON.parse(readFileSync(GBM_STORE, "utf8")); } catch {}
  }
  if (existsSync(GBU_STORE)) {
    try { return JSON.parse(readFileSync(GBU_STORE, "utf8")); } catch {}
  }
  return {};
}

export function getAccountNames(s = loadStore()) {
  return Object.keys(s).filter(k => !k.startsWith("_") && s[k] && typeof s[k] === "object" && s[k].accessToken);
}

export function getActiveName(s = loadStore()) {
  if (s._active && s[s._active]) return s._active;
  const names = getAccountNames(s);
  for (const n of names) {
    if (s[n].active) return n;
  }
  return names[0] || null;
}

export function saveStore(s) {
  mkdirSync(GBM_DIR, { recursive: true });
  writeFileSync(GBM_STORE, JSON.stringify(s, null, 2), { mode: 0o600 });
  chmodSync(GBM_STORE, 0o600);

  // Backward-compatibility: also mirror to ~/.gbu/accounts.json if directory exists
  if (existsSync(GBU_DIR)) {
    try {
      writeFileSync(GBU_STORE, JSON.stringify(s, null, 2), { mode: 0o600 });
      chmodSync(GBU_STORE, 0o600);
    } catch {}
  }

  // Mirror active token to ~/.gbm/config.json
  try {
    const activeKey = getActiveName(s);
    if (activeKey && s[activeKey]?.accessToken) {
      const cfg = readGbmConfig() || { version: 1 };
      cfg.accessToken = extractJwt(s[activeKey].accessToken);
      writeGbmConfig(cfg);
    }
  } catch {}
}

export function getAccount(accountName = null, s = loadStore()) {
  const names = getAccountNames(s);
  if (names.length === 0) return null;

  let target = accountName;
  if (!target || target === "default" || target === "active") {
    target = getActiveName(s);
  } else {
    target = names.find(n => n.toLowerCase() === target.toLowerCase()) ||
             names.find(n => n.toLowerCase().startsWith(target.toLowerCase())) ||
             target;
  }
  const acct = s[target];
  if (!acct?.accessToken) return null;
  return { name: target, ...acct };
}

export function getToken(accountName = null) {
  if (accountName && accountName !== "default" && accountName !== "active") {
    const acct = getAccount(accountName);
    if (acct?.accessToken) return extractJwt(acct.accessToken);
  }

  const envToken = process.env.GROKBOT_ACCESS_TOKEN?.trim();
  if (envToken) return extractJwt(envToken);

  const acct = getAccount();
  if (acct?.accessToken) return extractJwt(acct.accessToken);

  const config = readGbmConfig();
  if (config?.accessToken) return extractJwt(config.accessToken);

  throw new Error("No access token configured. Run: grok-bot login");
}

export async function refreshAuthToken(refreshToken) {
  const r = await fetch(`${BACKEND}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  if (!r.ok) throw new Error(`Refresh failed: ${r.status}`);
  const j = await r.json();
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? refreshToken };
}

// ── OAuth Browser PKCE login (Zero passwords, zero keychain) ──────────────
export async function pkceLogin() {
  const v = randomBytes(32).toString("base64url");
  const c = Buffer.from(createHash("sha256").update(v).digest()).toString("base64url");
  const u = randomUUID();
  const url = `https://cursor.com/loginDeepControl?challenge=${c}&uuid=${u}&mode=login&redirectTarget=cli`;

  console.log(`\n  Opening browser for sign-in (zero passwords or keychain needed):\n  \x1b[36m${url}\x1b[0m\n`);
  try {
    if (process.platform === "darwin") execSync(`open "${url}"`, { stdio: "ignore" });
    else if (process.platform === "win32") execSync(`start "" "${url}"`, { stdio: "ignore" });
    else execSync(`xdg-open "${url}"`, { stdio: "ignore" });
  } catch {}

  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(`${BACKEND}/auth/poll?uuid=${u}&verifier=${v}`, { headers: { "Content-Type": "application/json" } });
      if (r.status === 404) {
        process.stdout.write(".");
        await sleep(Math.min(1e3 * 1.2 ** i, 1e4));
        continue;
      }
      if (r.ok) {
        const j = await r.json();
        if (j.accessToken) {
          console.log("\n");
          return j;
        }
      }
    } catch {}
    await sleep(Math.min(1e3 * 1.2 ** i, 1e4));
  }
  throw new Error("Login timed out");
}

// ── Optional Keychain extraction (Explicit opt-in only) ────────────────────
function decryptField(enc, dk) {
  if (!enc) return null;
  const raw = Buffer.from(enc, "base64");
  const ct = raw.slice(3);
  const iv = Buffer.alloc(16, 0x20);
  const dec = createDecipheriv("aes-128-cbc", dk, iv);
  let buf = dec.update(ct);
  buf = Buffer.concat([buf, dec.final()]);
  return buf.toString("utf8");
}

function extractFromGrokBot() {
  if (process.platform !== "darwin") throw new Error("--grokbot import is macOS only. Use 'grok-bot login' for browser login.");
  if (!existsSync(GROKBOT_SECRETS)) throw new Error("Grok Bot desktop app not installed");
  const d = JSON.parse(readFileSync(GROKBOT_SECRETS, "utf8"));
  const acc = JSON.parse(d["cursor-accounts"]);
  const sc = acc.active;
  const acct = acc.accounts?.[sc];
  if (!acct) throw new Error("No active account found in Grok Bot");
  const encAccess = acct["cursor-access-token"];
  if (!encAccess) throw new Error("No access token in Grok Bot");

  const kp = execSync('security find-generic-password -a "Grok Bot Key" -s "Grok Bot Safe Storage" -w', { encoding: "utf8", timeout: 3e4, maxBuffer: 1e4 }).trim();
  const dk = pbkdf2Sync(kp, "saltysalt", 1003, 16, "sha1");

  const rawAccess = decryptField(encAccess, dk);
  const mAccess = rawAccess.match(/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (!mAccess) throw new Error("Decrypted data is not a JWT");
  const accessToken = mAccess[0];

  let refreshToken = null;
  if (acct["cursor-refresh-token"]) {
    try {
      const rawRefresh = decryptField(acct["cursor-refresh-token"], dk);
      const mRefresh = rawRefresh ? rawRefresh.match(/^[A-Za-z0-9_-]+/) : null;
      if (mRefresh) refreshToken = mRefresh[0];
    } catch {}
  }

  let email = null;
  if (acct["cursor-account-profile"]) {
    try {
      const rawProfile = decryptField(acct["cursor-account-profile"], dk);
      const parsed = JSON.parse(rawProfile);
      if (parsed?.email) email = parsed.email;
    } catch {}
  }

  return { accessToken, refreshToken, email };
}

export function syncDesktopAppAccount(targetName, acct) {
  if (process.platform !== "darwin") return { updated: false, reason: "macOS only" };
  if (!existsSync(GROKBOT_SECRETS)) return { updated: false, reason: "Grok Bot app not installed" };

  try {
    const kp = execSync('security find-generic-password -a "Grok Bot Key" -s "Grok Bot Safe Storage" -w', {
      encoding: "utf8",
      timeout: 5e3,
      maxBuffer: 1e4
    }).trim();
    if (!kp) return { updated: false, reason: "Could not read keychain key" };

    const dk = pbkdf2Sync(kp, "saltysalt", 1003, 16, "sha1");

    function enc(text) {
      const iv = Buffer.alloc(16, 0x20);
      const cipher = createCipheriv("aes-128-cbc", dk, iv);
      let buf = cipher.update(text, "utf8");
      buf = Buffer.concat([buf, cipher.final()]);
      return Buffer.concat([Buffer.from("v10", "utf8"), buf]).toString("base64");
    }

    const info = jwtInfo(acct.accessToken);
    const sub = info.sub;
    if (!sub) return { updated: false, reason: "No sub claim in access token" };

    const accountHash = createHash("sha256").update(sub).digest("hex");
    const d = JSON.parse(readFileSync(GROKBOT_SECRETS, "utf8"));
    const acc = JSON.parse(d["cursor-accounts"] || "{\"active\":\"\",\"accounts\":{}}");

    if (!acc.accounts) acc.accounts = {};

    acc.accounts[accountHash] = {
      "cursor-access-token": enc(acct.accessToken),
      "cursor-account-profile": enc(JSON.stringify({
        email: acct.email || targetName,
        name: targetName,
        avatar: ""
      })),
      "cursor-refresh-token": enc(acct.refreshToken || acct.accessToken)
    };
    acc.active = accountHash;

    d["cursor-accounts"] = JSON.stringify(acc);
    writeFileSync(GROKBOT_SECRETS, JSON.stringify(d, null, 2) + "\n");
    return { updated: true, accountHash };
  } catch (e) {
    return { updated: false, reason: e.message };
  }
}

// ── ConnectRPC calls (Cursor backend) ────────────────────────────────────
export async function callDashboard(method, token) {
  const id = machineId(), cs = checksum(id);
  const r = await fetch(`${BACKEND}/aiserver.v1.DashboardService/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-cursor-checksum": cs,
      "x-cursor-client-type": "sand",
      "x-cursor-client-version": "0.1.0",
      "x-sand-box-namespace": "prod",
      "x-ghost-mode": "true",
      "x-request-id": randomUUID()
    },
    body: "{}"
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    // Attempt auto-refresh on 401
    if (r.status === 401) {
      try {
        const s = loadStore();
        const names = getAccountNames(s);
        const matchKey = names.find(n => s[n].accessToken === token || extractJwt(s[n].accessToken) === token);
        if (matchKey && s[matchKey].refreshToken) {
          const fresh = await refreshAuthToken(s[matchKey].refreshToken);
          s[matchKey].accessToken = fresh.accessToken;
          s[matchKey].refreshToken = fresh.refreshToken;
          saveStore(s);
          const retry = await fetch(`${BACKEND}/aiserver.v1.DashboardService/${method}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${fresh.accessToken}`,
              "x-cursor-checksum": checksum(machineId()),
              "x-cursor-client-type": "sand",
              "x-cursor-client-version": "0.1.0",
              "x-sand-box-namespace": "prod",
              "x-ghost-mode": "true",
              "x-request-id": randomUUID()
            },
            body: "{}"
          });
          if (retry.ok) return retry.json();
        }
      } catch {}
    }
    throw new Error(`${method}: ${r.status} ${t}`);
  }
  return r.json();
}

export async function fetchUsageData(name, acct) {
  let token = acct.accessToken;
  const info = jwtInfo(token);

  // Auto-refresh if expiring within 5 minutes
  if (info.exp && info.exp * 1e3 - Date.now() < 5 * 60 * 1e3 && acct.refreshToken) {
    try {
      const r = await refreshAuthToken(acct.refreshToken);
      token = r.accessToken;
      const s = loadStore();
      if (s[name]) {
        s[name].accessToken = token;
        s[name].refreshToken = r.refreshToken;
        saveStore(s);
      }
    } catch {}
  }

  try {
    let [sand, period] = await Promise.allSettled([
      callDashboard("GetSandUsageStatus", token),
      callDashboard("GetCurrentPeriodUsage", token),
    ]);

    const is401 = (sand.status === "rejected" && sand.reason?.message?.includes("401")) ||
                  (period.status === "rejected" && period.reason?.message?.includes("401"));
    if (is401 && acct.refreshToken) {
      try {
        const r = await refreshAuthToken(acct.refreshToken);
        token = r.accessToken;
        const s = loadStore();
        if (s[name]) {
          s[name].accessToken = token;
          s[name].refreshToken = r.refreshToken;
          saveStore(s);
          [sand, period] = await Promise.allSettled([
            callDashboard("GetSandUsageStatus", token),
            callDashboard("GetCurrentPeriodUsage", token),
          ]);
        }
      } catch {}
    }

    const ss = sand.status === "fulfilled" ? sand.value : null;
    const pu = period.status === "fulfilled" ? period.value : null;
    const spend = pu?.spendLimitUsage;
    const planUsage = pu?.planUsage;

    return {
      account: name,
      email: acct.email || null,
      active: !!acct.active,
      weeklyUsagePercent: ss?.usagePercent != null ? ss.usagePercent : null,
      available: ss?.hasAvailableUsage ?? null,
      resetsAt: ss?.nextResetTimestampUtc ?? null,
      planLabel: ss?.grokPlanLabel ?? null,
      onDemandUsed: spend?.individualUsed ?? spend?.totalSpend ?? 0,
      onDemandLimit: spend?.individualLimit ?? null,
      onDemandRemaining: spend?.individualRemaining ?? null,
      billingCycleEnd: pu?.billingCycleEnd ? Number(pu.billingCycleEnd) : null,
      includedSpend: planUsage?.includedSpend ?? null,
      includedLimit: planUsage?.limit ?? null,
      includedRemaining: planUsage?.remaining ?? null,
      ss,
      pu,
    };
  } catch (e) {
    return {
      account: name,
      email: acct.email || null,
      active: !!acct.active,
      error: e.message,
    };
  }
}

// ── Gateway discovery (local host:port or cloud baseUrl) ─────────────────
export function parseGatewayDescriptor(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.host && parsed.port) {
    return {
      baseUrl: `http://${parsed.host}:${parsed.port}`,
      token: parsed.authToken || parsed.token || "",
      headers: parsed.headers || {},
    };
  }
  if (parsed.baseUrl && parsed.token) {
    return {
      baseUrl: String(parsed.baseUrl).replace(/\/$/, ""),
      token: parsed.token,
      headers: parsed.headers || {},
    };
  }
  return null;
}

export function loadGatewayFromEnv(env = process.env) {
  const baseUrl = env.GROKBOT_GATEWAY_URL?.trim();
  const token = env.GROKBOT_GATEWAY_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  let headers = {};
  if (env.GROKBOT_GATEWAY_HEADERS) {
    try {
      const parsed = JSON.parse(env.GROKBOT_GATEWAY_HEADERS);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) headers = parsed;
    } catch {}
  }
  return parseGatewayDescriptor({ baseUrl, token, headers });
}

function loadGatewayFromConfig(config = readGbmConfig()) {
  if (!config?.gateway) return null;
  return parseGatewayDescriptor(config.gateway);
}

export function buildGatewayRequest(gw, command) {
  const headers = { "Content-Type": "application/json", ...gw.headers };
  if (gw.token) headers.Authorization = `Bearer ${gw.token}`;
  return { url: `${gw.baseUrl}/api/${command}`, headers };
}

const GATEWAY_SETUP_HINT = "Configure with: GROKBOT_GATEWAY_URL and GROKBOT_GATEWAY_TOKEN";
let cachedGateway = null;

function discoverGateway() {
  if (cachedGateway) return cachedGateway;
  const fromEnv = loadGatewayFromEnv();
  if (fromEnv) { cachedGateway = fromEnv; return fromEnv; }
  const fromConfig = loadGatewayFromConfig();
  if (fromConfig) { cachedGateway = fromConfig; return fromConfig; }
  return null;
}

async function callGateway(command, body = {}, gateway = null) {
  const gw = gateway || discoverGateway();
  if (!gw) throw new Error(`Grok Bot gateway not configured. ${GATEWAY_SETUP_HINT}`);
  const { url, headers } = buildGatewayRequest(gw, command);
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${command}: ${r.status} ${t}`);
  }
  return r.json();
}

// ── SQLite database reader (read-only) ───────────────────────────────────
function getAgentDbPath(agentId) {
  return join(GROKBOT_AGENTS_DIR, "agents", agentId, "store.db");
}

function readAgentDb(agentId, query, params = []) {
  const dbPath = getAgentDbPath(agentId);
  if (!existsSync(dbPath)) throw new Error(`No database for agent ${agentId}`);
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = 1");
    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    db.close();
    return rows;
  } catch (e) {
    // Fall back to sqlite3 CLI
    const escaped = query.replace(/'/g, "''");
    const result = execSync(`sqlite3 -json -readonly '${dbPath}' "${escaped.replace(/"/g, '\\"')}"`, { encoding: "utf8", timeout: 5e3 });
    return result.trim() ? JSON.parse(result) : [];
  }
}

function listAgentDbs() {
  const agentsDir = join(GROKBOT_AGENTS_DIR, "agents");
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir, { withFileTypes: true })
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

// ── MCP Tool Definitions ─────────────────────────────────────────────────
const TOOLS = [
  {
    name: "check_usage",
    description: "Check weekly usage, quota percentage, remaining requests, and on-demand spend for Cursor / Grok Bot accounts. If account='all', returns usage for all saved accounts.",
    inputSchema: {
      type: "object",
      properties: {
        account: {
          type: "string",
          description: "Optional account name to check (e.g. 'main', 'company', or 'all'). If omitted, checks the currently active account."
        }
      }
    }
  },
  {
    name: "switch_account",
    description: "Switch the active account for Cursor / Grok Bot across both CLI/MCP and the macOS Grok Bot desktop application. Next time you open the Grok Bot desktop app, it will launch directly into this account.",
    inputSchema: {
      type: "object",
      properties: {
        account: {
          type: "string",
          description: "Name of the account to switch to (e.g. 'main', 'company')."
        }
      },
      required: ["account"]
    }
  },
  {
    name: "list_bots",
    description: "List all Grok Bot agents (bots) currently running or registered on this machine. Returns agent IDs, names, origins, and descriptions.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "create_bot",
    description: "Create a new Grok Bot agent instance with a specific name and task description.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the new bot (e.g. 'Research Assistant')" },
        description: { type: "string", description: "What this bot should do (e.g. 'Researches companies and summarizes news')" }
      },
      required: ["name"]
    }
  },
  {
    name: "delete_bot",
    description: "Permanently delete a Grok Bot agent by its agent ID.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "The ID of the bot to delete" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "send_message",
    description: "Send a message or user prompt to a Grok Bot agent and receive its response.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "The ID of the bot to send the message to" },
        message: { type: "string", description: "The text message to send" }
      },
      required: ["agentId", "message"]
    }
  },
  {
    name: "get_transcript",
    description: "Read the conversation transcript of a Grok Bot agent in chronological order.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "The ID of the bot" },
        limit: { type: "number", description: "Max number of messages to return (default: 50)" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "search_bots",
    description: "Search for Grok Bot agents matching a keyword in their name or description.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query keyword" }
      },
      required: ["query"]
    }
  },
  {
    name: "list_databases",
    description: "List all local Grok Bot SQLite database files on this machine, showing agent IDs and file sizes.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "read_transcript_entries",
    description: "Directly read raw transcript entries from a bot's local SQLite database without network overhead.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "The ID of the bot" },
        limit: { type: "number", description: "Max entries to return (default: 100)" }
      },
      required: ["agentId"]
    }
  },
  {
    name: "search_messages",
    description: "Search across all local bot transcripts for messages containing a keyword.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword to search for across conversations" },
        limit: { type: "number", description: "Max results to return (default: 20)" }
      },
      required: ["query"]
    }
  }
];

// ── Tool Handler ─────────────────────────────────────────────────────────
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
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "send_message": {
      const result = await callGateway("sendMessage", { id: args.agentId, message: args.message });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "get_transcript": {
      const result = await callGateway("getTranscript", { id: args.agentId, limit: args.limit || 50 });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "search_bots": {
      const result = await callGateway("searchAgents", { query: args.query });
      const agents = Array.isArray(result) ? result : (result.agents || []);
      return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
    }

    case "check_usage": {
      const fmtC = c => c != null ? `$${(c / 100).toFixed(2)}` : "N/A";
      async function fetchSummaryForToken(tok) {
        const [sand, period] = await Promise.allSettled([
          callDashboard("GetSandUsageStatus", tok),
          callDashboard("GetCurrentPeriodUsage", tok),
        ]);
        const ss = sand.status === "fulfilled" ? sand.value : null;
        const pu = period.status === "fulfilled" ? period.value : null;
        const spend = pu?.spendLimitUsage;
        const planUsage = pu?.planUsage;
        return {
          weeklyUsagePercent: ss?.usagePercent ?? null,
          available: ss?.hasAvailableUsage ?? null,
          resetsAt: ss?.nextResetTimestampUtc ?? null,
          planLabel: ss?.grokPlanLabel ?? null,
          onDemandUsed: spend ? fmtC(spend.individualUsed ?? spend.totalSpend ?? 0) : null,
          onDemandLimit: spend?.individualLimit != null ? fmtC(spend.individualLimit) : null,
          billingCycleEnd: pu?.billingCycleEnd ?? null,
          includedSpend: planUsage?.includedSpend != null ? fmtC(planUsage.includedSpend) : null,
          includedLimit: planUsage?.limit != null ? fmtC(planUsage.limit) : null,
          includedRemaining: planUsage?.remaining != null ? fmtC(planUsage.remaining) : null,
        };
      }

      const s = loadStore();
      const names = getAccountNames(s);

      if (args.account === "all" && names.length > 0) {
        const activeName = getActiveName(s);
        const allUsage = {};
        for (const n of names) {
          try {
            const summary = await fetchSummaryForToken(extractJwt(s[n].accessToken));
            summary.email = s[n].email || null;
            summary.active = (n === activeName);
            allUsage[n] = summary;
          } catch (e) {
            allUsage[n] = { error: e.message };
          }
        }
        return { content: [{ type: "text", text: JSON.stringify({ active: activeName, accounts: allUsage }, null, 2) }] };
      }

      const token = getToken(args.account);
      const summary = await fetchSummaryForToken(token);
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }

    case "switch_account": {
      const s = loadStore();
      const names = getAccountNames(s);
      if (names.length === 0) throw new Error("No accounts found. Run: grok-bot login");
      const match = names.find(n => n.toLowerCase() === args.account.toLowerCase()) ||
                    names.find(n => n.toLowerCase().startsWith(args.account.toLowerCase()));
      if (!match) throw new Error(`Account "${args.account}" not found. Available: ${names.join(", ")}`);

      s._active = match;
      for (const n of names) s[n].active = (n === match);
      saveStore(s);

      const desktop = syncDesktopAppAccount(match, s[match]);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            active: match,
            email: s[match].email || null,
            desktopAppSynced: desktop.updated,
            desktopAppDetail: desktop.updated
              ? `Next time you open Grok Bot app, it will launch on ${match}`
              : desktop.reason
          }, null, 2)
        }]
      };
    }

    case "list_databases": {
      const dbs = listAgentDbs();
      return { content: [{ type: "text", text: JSON.stringify(dbs, null, 2) }] };
    }

    case "read_transcript_entries": {
      const limit = Math.min(Number(args.limit) || 100, 500);
      const rows = readAgentDb(args.agentId, "SELECT id, created_at, entry_type, body FROM transcript_entries ORDER BY created_at DESC LIMIT ?", [limit]);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }

    case "search_messages": {
      const limit = Math.min(Number(args.limit) || 20, 100);
      const dbs = listAgentDbs();
      const allResults = [];
      for (const db of dbs) {
        try {
          const rows = readAgentDb(db.agentId, "SELECT id, created_at, entry_type, body FROM transcript_entries WHERE body LIKE ? LIMIT ?", [`%${args.query}%`, limit]);
          for (const r of rows) allResults.push({ agentId: db.agentId, ...r });
        } catch {}
      }
      return { content: [{ type: "text", text: JSON.stringify(allResults.slice(0, limit), null, 2) }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP JSON-RPC Server ──────────────────────────────────────────────────
export function startMcpServer() {
  const rl = createInterface({ input: process.stdin, terminal: false });

  function send(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
  }

  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    const { id, method, params } = msg;

    switch (method) {
      case "initialize":
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "grok-bot-mcp", version: SERVER_VERSION }
          }
        });
        break;

      case "notifications/initialized":
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

// ── Human CLI Commands ───────────────────────────────────────────────────
function printBox(name, email, isActive, ss, pu) {
  const pct = ss?.usagePercent;
  const avail = ss?.hasAvailableUsage;
  const reset = ss?.nextResetTimestampUtc ? new Date(ss.nextResetTimestampUtc).getTime() : null;
  const spend = pu?.spendLimitUsage;
  const used = spend?.individualUsed ?? spend?.totalSpend ?? 0;
  const limit = spend?.individualLimit;
  const remaining = spend?.individualRemaining;
  const billingEnd = pu?.billingCycleEnd ? Number(pu.billingCycleEnd) : null;

  const fmtC = c => c != null ? `$${(c / 100).toFixed(2)}` : "N/A";
  const fmtT = ms => ms ? new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "N/A";

  const activeBadge = isActive ? " \x1b[32m[active]\x1b[0m" : "";

  console.log("");
  console.log("  ┌─────────────────────────────────────────────────┐");
  console.log(`  │  \x1b[1m${name}\x1b[0m${activeBadge}${email ? " " + email : ""}`.padEnd(50 + (isActive ? 9 : 0)) + "│");
  console.log("  ├─────────────────────────────────────────────────┤");
  console.log(`  │  Weekly Usage:  ${pct != null ? pct.toFixed(2) + "% used" : "N/A"}`.padEnd(50) + "│");
  console.log(`  │  Available:     ${avail ? "Yes" : "No / exhausted"}`.padEnd(50) + "│");
  console.log(`  │  Resets:        ${fmtT(reset)}`.padEnd(50) + "│");
  console.log("  ├─────────────────────────────────────────────────┤");
  if (spend) {
    console.log(`  │  On-demand:     ${fmtC(used)} used`.padEnd(50) + "│");
    console.log(`  │  Limit:         ${limit != null ? fmtC(limit) : "No limit"}`.padEnd(50) + "│");
    console.log(`  │  Remaining:     ${remaining != null ? fmtC(remaining) : "N/A"}`.padEnd(50) + "│");
    console.log(`  │  Cycle ends:    ${fmtT(billingEnd)}`.padEnd(50) + "│");
  } else {
    console.log("  │  On-demand:     No spend data".padEnd(50) + "│");
  }
  console.log("  └─────────────────────────────────────────────────┘");
}

export async function cmdUsage(targetName = null, asJson = false) {
  const s = loadStore();
  const names = getAccountNames(s);

  if (names.length === 0) {
    if (asJson) {
      console.log(JSON.stringify({ error: "No accounts found. Run: grok-bot login" }, null, 2));
      return;
    }
    console.log(`
  \x1b[1mgrok-bot\x1b[0m — Grok Bot Usage & AI Controller

  No accounts connected yet.

  Connect your account in seconds (browser login, zero passwords needed):
    \x1b[32mgrok-bot login\x1b[0m
`);
    return;
  }

  const activeName = getActiveName(s);
  const targets = targetName ? [names.find(n => n.toLowerCase() === targetName.toLowerCase()) || targetName] : names;

  const results = [];
  for (const t of targets) {
    if (!s[t]) {
      if (asJson) { console.log(JSON.stringify({ error: `Account "${t}" not found` }, null, 2)); return; }
      console.error(`  Account "${t}" not found. Available: ${names.join(", ")}`);
      process.exit(1);
    }
    const data = await fetchUsageData(t, s[t]);
    data.active = (t === activeName);
    results.push(data);
  }

  if (asJson) {
    const cleanResults = results.map(({ ss, pu, ...rest }) => rest);
    console.log(JSON.stringify(cleanResults.length === 1 && targetName ? cleanResults[0] : { active: activeName, accounts: cleanResults }, null, 2));
    return;
  }

  for (const r of results) {
    if (r.error) {
      console.log(`\n  \x1b[31m${r.account}\x1b[0m  ${r.error}`);
    } else {
      printBox(r.account, r.email, r.active, r.ss, r.pu);
    }
  }
}

export async function cmdLogin(label = null, method = "login") {
  const s = loadStore();
  let tokens;

  if (method === "grokbot") {
    console.log("\x1b[33m  Importing from Grok Bot desktop app (macOS will request Keychain permission)...\x1b[0m");
    tokens = extractFromGrokBot();
  } else {
    tokens = await pkceLogin();
  }

  const info = jwtInfo(tokens.accessToken);
  const email = tokens.email || info.email || null;
  const name = label || (email ? email.split("@")[0] : null) || info.sub?.slice(0, 12) || `account-${Date.now()}`;
  const isFirst = getAccountNames(s).length === 0;

  s[name] = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    email,
    active: isFirst || !s._active,
    addedAt: new Date().toISOString()
  };
  if (isFirst || !s._active) s._active = name;

  saveStore(s);
  console.log(`\x1b[32m  ✓ Connected account:\x1b[0m \x1b[1m${name}\x1b[0m ${email ? `(${email})` : ""}`);
}

export async function cmdSwitch(targetName) {
  const s = loadStore();
  const names = getAccountNames(s);
  if (names.length === 0) {
    console.log("  No accounts connected. Run: grok-bot login");
    return;
  }
  if (!targetName) {
    console.log(`\n  Active account: \x1b[32m${getActiveName(s) || "none"}\x1b[0m\n`);
    return;
  }

  const match = names.find(n => n.toLowerCase() === targetName.toLowerCase()) ||
                names.find(n => n.toLowerCase().startsWith(targetName.toLowerCase()));
  if (!match) {
    console.error(`\n  \x1b[31mError:\x1b[0m Account "${targetName}" not found. Available: ${names.join(", ")}\n`);
    process.exit(1);
  }

  s._active = match;
  for (const n of names) s[n].active = (n === match);
  saveStore(s);

  const desktop = syncDesktopAppAccount(match, s[match]);
  const desktopNote = desktop.updated
    ? " \x1b[36m(macOS Grok Bot desktop app synced)\x1b[0m"
    : "";

  console.log(`\n  \x1b[32m✓ Switched active account to:\x1b[0m \x1b[1m${match}\x1b[0m ${s[match].email ? `(${s[match].email})` : ""}${desktopNote}\n`);
}

export async function cmdList(asJson = false) {
  const s = loadStore();
  const names = getAccountNames(s);
  const active = getActiveName(s);

  if (asJson) {
    const list = names.map(n => ({
      account: n,
      email: s[n].email ?? jwtInfo(s[n].accessToken)?.email ?? null,
      active: n === active,
      addedAt: s[n].addedAt ?? null,
      expiresAt: s[n].accessToken ? new Date((jwtInfo(s[n].accessToken)?.exp ?? 0) * 1e3).toISOString() : null,
    }));
    console.log(JSON.stringify({ active, accounts: list }, null, 2));
    return;
  }

  if (names.length === 0) {
    console.log("  No accounts connected. Run: grok-bot login");
    return;
  }

  console.log("\n  \x1b[1mConnected Accounts:\x1b[0m\n");
  for (const n of names) {
    const a = s[n];
    const exp = a.accessToken ? jwtInfo(a.accessToken)?.exp : null;
    const expStr = exp ? new Date(exp * 1e3).toLocaleDateString() : "?";
    const isActive = n === active;
    const badge = isActive ? "\x1b[32m[active]\x1b[0m " : "        ";
    console.log(`  ${badge}\x1b[36m${n}\x1b[0m  ${a.email ?? ""}  (exp: ${expStr})`);
  }
  console.log("");
}

export async function cmdRemove(name) {
  const s = loadStore();
  if (!name || !s[name]) {
    console.error(`  Account "${name}" not found. Available: ${getAccountNames(s).join(", ")}`);
    process.exit(1);
  }
  const wasActive = s._active === name || s[name].active;
  delete s[name];
  const remaining = getAccountNames(s);
  if (wasActive) {
    s._active = remaining[0] || null;
    if (s._active && s[s._active]) s[s._active].active = true;
  }
  saveStore(s);
  console.log(`\x1b[31m  - ${name}\x1b[0m removed`);
}

export function cmdHelp() {
  console.log(`
  \x1b[1mgrok-bot\x1b[0m v${SERVER_VERSION} — Grok Bot CLI & MCP Server
  Unified usage dashboard for humans and AI agents. Zero passwords needed.

  \x1b[1mCOMMANDS FOR HUMANS\x1b[0m
    grok-bot                 Check usage across all connected accounts
    grok-bot <name>          Check usage for a specific account (e.g. grok-bot company)
    grok-bot login           Connect account via browser (zero passwords, zero keychain)
    grok-bot login <name>    Connect account with a custom nickname
    grok-bot switch <name>   Switch active account (aliases: use)
    grok-bot list            List all connected accounts (aliases: accounts, ls)
    grok-bot rm <name>       Remove an account (aliases: remove)
    grok-bot --json          Output usage in clean JSON (ideal for scripts & tools)
    grok-bot help            Show this help guide

  \x1b[1mFOR AI AGENTS (MCP SERVER)\x1b[0m
    grok-bot mcp             Start Model Context Protocol (MCP) server over stdio
    node server.mjs          Automatically runs MCP server when piped by an AI agent

  \x1b[1mEXAMPLES\x1b[0m
    grok-bot                 # View usage summary table
    grok-bot login work      # Add work account via browser
    grok-bot switch work     # Make work account active
    grok-bot --json          # Return JSON for scripting
`);
}

// ── Main Dispatch ────────────────────────────────────────────────────────
if (isMainModule) {
  const rawArgs = process.argv.slice(2);
  const isJson = rawArgs.includes("--json");
  const cleanArgs = rawArgs.filter(a => a !== "--json");
  const cmd = cleanArgs[0]?.toLowerCase();

  // If MCP explicit or stdin is piped with NO arguments (agent calling over stdio)
  const isExplicitMcp = cmd === "mcp" || cmd === "serve" || cmd === "server";
  const isPipedNoArgs = !process.stdin.isTTY && rawArgs.length === 0;

  if (isExplicitMcp || isPipedNoArgs) {
    startMcpServer();
  } else if (!cmd || cmd === "usage" || cmd === "check") {
    cmdUsage(cleanArgs[1], isJson).catch(err => { console.error(err.message); process.exit(1); });
  } else if (cmd === "login" || cmd === "add") {
    const label = cleanArgs[1] && !cleanArgs[1].startsWith("--") ? cleanArgs[1] : null;
    const isGrokBot = rawArgs.includes("--grokbot");
    cmdLogin(label, isGrokBot ? "grokbot" : "login").catch(err => { console.error(err.message); process.exit(1); });
  } else if (cmd === "switch" || cmd === "use") {
    cmdSwitch(cleanArgs[1]).catch(err => { console.error(err.message); process.exit(1); });
  } else if (cmd === "list" || cmd === "accounts" || cmd === "ls") {
    cmdList(isJson).catch(err => { console.error(err.message); process.exit(1); });
  } else if (cmd === "remove" || cmd === "rm") {
    cmdRemove(cleanArgs[1]).catch(err => { console.error(err.message); process.exit(1); });
  } else if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    cmdHelp();
  } else {
    // If argument matches an existing account name, show usage for that account
    const s = loadStore();
    const names = getAccountNames(s);
    if (names.some(n => n.toLowerCase() === cmd)) {
      cmdUsage(cmd, isJson).catch(err => { console.error(err.message); process.exit(1); });
    } else {
      console.log(`Unknown command: "${cmd}"\n`);
      cmdHelp();
    }
  }
}

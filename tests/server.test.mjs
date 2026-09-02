#!/usr/bin/env node
// test/server.test.mjs — Tests for grok-bot-mcp
// All tests use mocks. No real Grok Bot calls, no real database writes, no network.
// Run: node --test tests/server.test.mjs

import { test, describe, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes, randomUUID, pbkdf2Sync, createDecipheriv } from "node:crypto";

// ── Test fixtures ─────────────────────────────────────────────────────────

const TMP_DIR = join(homedir(), ".grokbot-mcp-test-" + process.pid);
const TMP_GROKBOT = join(TMP_DIR, "grokbot");
const TMP_GBU = join(TMP_DIR, "gbu");

function setupTestEnv() {
  mkdirSync(TMP_GROKBOT, { recursive: true });
  mkdirSync(TMP_GBU, { recursive: true });
  // Create a fake store.db for testing
  const agentDir = join(TMP_GROKBOT, "agents", "test-agent-1");
  mkdirSync(agentDir, { recursive: true });
  // We'll create the DB via sqlite3 CLI in the test
  return { TMP_GROKBOT, TMP_GBU };
}

function cleanupTestEnv() {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("grok-bot-mcp server", () => {

  describe("MCP protocol", () => {
    test("initialize returns correct protocol version and server info", async () => {
      const response = await sendMcpRequest({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test" } }
      });
      assert.equal(response.id, 1);
      assert.equal(response.result.protocolVersion, "2024-11-05");
      assert.equal(response.result.serverInfo.name, "grok-bot-mcp");
      assert.ok(response.result.capabilities.tools);
    });

    test("initialize with id 0 returns a response", async () => {
      // Regression: clients that number requests from 0 (Claude Code does)
      // were dropped by a falsy `!req.id` guard, hanging the handshake.
      const response = await sendMcpRequest({
        jsonrpc: "2.0", id: 0, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test" } }
      });
      assert.equal(response.id, 0);
      assert.equal(response.result.serverInfo.name, "grok-bot-mcp");
    });

    test("tools/list with id 0 returns a response", async () => {
      const response = await sendMcpRequest({ jsonrpc: "2.0", id: 0, method: "tools/list", params: {} });
      assert.equal(response.id, 0);
      assert.ok(Array.isArray(response.result.tools));
    });

    test("tools/list returns all 10 tools", async () => {
      const response = await sendMcpRequest({
        jsonrpc: "2.0", id: 2, method: "tools/list", params: {}
      });
      assert.equal(response.id, 2);
      assert.ok(response.result.tools.length >= 10);
      const names = response.result.tools.map(t => t.name);
      assert.ok(names.includes("list_bots"));
      assert.ok(names.includes("create_bot"));
      assert.ok(names.includes("delete_bot"));
      assert.ok(names.includes("send_message"));
      assert.ok(names.includes("get_transcript"));
      assert.ok(names.includes("search_bots"));
      assert.ok(names.includes("check_usage"));
      assert.ok(names.includes("list_databases"));
      assert.ok(names.includes("read_transcript_entries"));
      assert.ok(names.includes("search_messages"));
    });

    test("tools/list each tool has name, description, inputSchema", async () => {
      const response = await sendMcpRequest({
        jsonrpc: "2.0", id: 3, method: "tools/list", params: {}
      });
      for (const tool of response.result.tools) {
        assert.ok(typeof tool.name === "string" && tool.name.length > 0, `Tool name missing: ${JSON.stringify(tool)}`);
        assert.ok(typeof tool.description === "string" && tool.description.length > 10, `Tool description too short: ${tool.name}`);
        assert.ok(typeof tool.inputSchema === "object", `Tool inputSchema missing: ${tool.name}`);
        assert.equal(tool.inputSchema.type, "object");
      }
    });

    test("unknown method returns error", async () => {
      const response = await sendMcpRequest({
        jsonrpc: "2.0", id: 4, method: "nonexistent/method", params: {}
      });
      assert.equal(response.id, 4);
      assert.ok(response.error);
      assert.equal(response.error.code, -32601);
    });
  });

  describe("tool schemas", () => {
    test("create_bot requires name", async () => {
      const response = await sendMcpRequest({
        jsonrpc: "2.0", id: 5, method: "tools/list", params: {}
      });
      const createBot = response.result.tools.find(t => t.name === "create_bot");
      assert.ok(createBot.inputSchema.required.includes("name"));
    });

    test("send_message requires agentId and message", async () => {
      const response = await sendMcpRequest({
        jsonrpc: "2.0", id: 6, method: "tools/list", params: {}
      });
      const sendMsg = response.result.tools.find(t => t.name === "send_message");
      assert.ok(sendMsg.inputSchema.required.includes("agentId"));
      assert.ok(sendMsg.inputSchema.required.includes("message"));
    });

    test("delete_bot requires agentId", async () => {
      const response = await sendMcpRequest({
        jsonrpc: "2.0", id: 7, method: "tools/list", params: {}
      });
      const deleteBot = response.result.tools.find(t => t.name === "delete_bot");
      assert.ok(deleteBot.inputSchema.required.includes("agentId"));
    });

    test("check_usage takes no required params", async () => {
      const response = await sendMcpRequest({
        jsonrpc: "2.0", id: 8, method: "tools/list", params: {}
      });
      const checkUsage = response.result.tools.find(t => t.name === "check_usage");
      assert.ok(!checkUsage.inputSchema.required || checkUsage.inputSchema.required.length === 0);
    });
  });

  describe("tool call error handling", () => {
    test("unknown tool returns error", async () => {
      const response = await sendMcpRequest({
        jsonrpc: "2.0", id: 9, method: "tools/call",
        params: { name: "nonexistent_tool", arguments: {} }
      });
      assert.equal(response.id, 9);
      assert.ok(response.error);
    });
  });
});

// ── Helper: send MCP request to server via stdio ─────────────────────────

let serverProc = null;
let requestId = 100;

async function sendMcpRequest(req) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [join(process.cwd(), "server.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GROKBOT_TEST_MODE: "1" }
    });
    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
      // Try to parse complete JSON-RPC response
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === req.id) {
              proc.kill();
              resolve(parsed);
              return;
            }
          } catch {}
        }
      }
    });
    proc.stderr.on("data", () => {}); // swallow stderr
    proc.on("error", reject);
    setTimeout(() => { proc.kill(); reject(new Error("Server timeout")); }, 5000);
    proc.stdin.write(JSON.stringify(req) + "\n");
  });
}

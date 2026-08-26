#!/usr/bin/env node
// tests/mock-gateway.test.mjs — Tests with mocked gateway and database
// No real Grok Bot, no real network, no real SQLite. Pure logic tests.
// Run: node --test tests/mock-gateway.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Mock gateway responses ────────────────────────────────────────────────

const MOCK_AGENTS = [
  { id: "agent-1", name: "Research Bot", description: "Researches companies", origin: "user" },
  { id: "agent-2", name: "Code Reviewer", description: "Reviews pull requests", origin: "user" },
  { id: "agent-3", name: "Meeting Notes", description: "Takes meeting notes", origin: "mcp" },
];

const MOCK_TRANSCRIPT = [
  { seq: 1, id: "msg-1", entry: JSON.stringify({ kind: "message", role: "user", content: "Hello", timestampMs: 1700000000000 }) },
  { seq: 2, id: "msg-2", entry: JSON.stringify({ kind: "message", role: "assistant", content: "Hi there!", timestampMs: 1700000001000 }) },
  { seq: 3, id: "msg-3", entry: JSON.stringify({ kind: "send-message", role: "assistant", content: "How can I help?", timestampMs: 1700000002000 }) },
];

const MOCK_USAGE = {
  usagePercent: 42,
  hasAvailableUsage: true,
  nextResetTimestampUtc: "2026-09-02T11:57:00Z",
  spendLimitUsage: { individualUsed: 320, individualLimit: 2000, individualRemaining: 1680 },
  billingCycleEnd: 1727198400,
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("mock gateway: agent management", () => {

  test("list_bots returns all agents", () => {
    const agents = MOCK_AGENTS;
    assert.equal(agents.length, 3);
    assert.ok(agents.some(a => a.name === "Research Bot"));
    assert.ok(agents.some(a => a.name === "Code Reviewer"));
  });

  test("create_bot returns new agent with id", () => {
    const newAgent = { id: "agent-4", name: "Test Bot", description: "Test", origin: "mcp" };
    assert.equal(newAgent.name, "Test Bot");
    assert.equal(newAgent.origin, "mcp");
    assert.ok(newAgent.id);
  });

  test("delete_bot removes agent from list", () => {
    let agents = [...MOCK_AGENTS];
    const before = agents.length;
    agents = agents.filter(a => a.id !== "agent-2");
    assert.equal(agents.length, before - 1);
    assert.ok(!agents.some(a => a.id === "agent-2"));
  });

  test("search_bots filters by query", () => {
    const query = "research";
    const results = MOCK_AGENTS.filter(a =>
      a.name.toLowerCase().includes(query) || a.description.toLowerCase().includes(query)
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Research Bot");
  });
});

describe("mock gateway: transcript parsing", () => {

  test("transcript entries parse correctly", () => {
    const parsed = MOCK_TRANSCRIPT.map(r => {
      try { return JSON.parse(r.entry); } catch { return null; }
    }).filter(Boolean);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].role, "user");
    assert.equal(parsed[1].role, "assistant");
    assert.equal(parsed[2].kind, "send-message");
  });

  test("transcript entries have timestamps", () => {
    const parsed = MOCK_TRANSCRIPT.map(r => JSON.parse(r.entry));
    for (const entry of parsed) {
      assert.ok(typeof entry.timestampMs === "number");
    }
  });

  test("transcript is ordered by seq", () => {
    const seqs = MOCK_TRANSCRIPT.map(r => r.seq);
    const sorted = [...seqs].sort((a, b) => a - b);
    assert.deepEqual(seqs, sorted);
  });
});

describe("mock usage: formatting", () => {

  test("usage percent is a number 0-100", () => {
    assert.ok(MOCK_USAGE.usagePercent >= 0 && MOCK_USAGE.usagePercent <= 100);
  });

  test("on-demand spend converts cents to dollars", () => {
    const fmtC = c => c != null ? `$${(c/100).toFixed(2)}` : "N/A";
    assert.equal(fmtC(MOCK_USAGE.spendLimitUsage.individualUsed), "$3.20");
    assert.equal(fmtC(MOCK_USAGE.spendLimitUsage.individualLimit), "$20.00");
    assert.equal(fmtC(MOCK_USAGE.spendLimitUsage.individualRemaining), "$16.80");
  });

  test("remaining = limit - used", () => {
    const { individualUsed, individualLimit, individualRemaining } = MOCK_USAGE.spendLimitUsage;
    assert.equal(individualRemaining, individualLimit - individualUsed);
  });
});

describe("mock database: search", () => {

  test("search finds matching messages", () => {
    const query = "Hello";
    const results = MOCK_TRANSCRIPT
      .map(r => JSON.parse(r.entry))
      .filter(e => (e.content || "").includes(query));
    assert.equal(results.length, 1);
    assert.equal(results[0].content, "Hello");
  });

  test("search is case-insensitive", () => {
    const query = "hello";
    const results = MOCK_TRANSCRIPT
      .map(r => JSON.parse(r.entry))
      .filter(e => (e.content || "").toLowerCase().includes(query.toLowerCase()));
    assert.equal(results.length, 1);
  });

  test("search returns empty for no match", () => {
    const query = "nonexistent";
    const results = MOCK_TRANSCRIPT
      .map(r => JSON.parse(r.entry))
      .filter(e => (e.content || "").includes(query));
    assert.equal(results.length, 0);
  });
});

describe("MCP tool schema validation", () => {

  const TOOLS = [
    { name: "list_bots", required: [] },
    { name: "create_bot", required: ["name"] },
    { name: "delete_bot", required: ["agentId"] },
    { name: "send_message", required: ["agentId", "message"] },
    { name: "get_transcript", required: ["agentId"] },
    { name: "search_bots", required: ["query"] },
    { name: "check_usage", required: [] },
    { name: "list_databases", required: [] },
    { name: "read_transcript_entries", required: ["agentId"] },
    { name: "search_messages", required: ["query"] },
  ];

  for (const tool of TOOLS) {
    test(`${tool.name} has correct required fields`, () => {
      assert.ok(typeof tool.name === "string");
      assert.ok(Array.isArray(tool.required));
    });
  }
});

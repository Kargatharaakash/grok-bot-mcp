#!/usr/bin/env node
// tests/cli.test.mjs — Tests for unified grok-bot CLI commands
// 100% offline, isolated temp home dir. Zero keychain, zero network calls.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "gbm-cli-test-" + Date.now());
const SERVER_PATH = join(process.cwd(), "server.mjs");

function runCli(args = "", env = {}) {
  const raw = execSync(`node "${SERVER_PATH}" ${args}`, {
    encoding: "utf8",
    env: { ...process.env, HOME: TEST_DIR, ...env }
  });
  return raw.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("grok-bot CLI commands", () => {
  beforeEach(() => {
    mkdirSync(join(TEST_DIR, ".gbm"), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("help command outputs friendly guide", () => {
    const out = runCli("help");
    assert.ok(out.includes("grok-bot"));
    assert.ok(out.includes("COMMANDS FOR HUMANS"));
    assert.ok(out.includes("FOR AI AGENTS"));
  });

  test("usage on empty store shows friendly setup prompt", () => {
    const out = runCli("usage");
    assert.ok(out.includes("No accounts connected yet"));
    assert.ok(out.includes("grok-bot login"));
  });

  test("usage with --json on empty store outputs clean error JSON", () => {
    const out = runCli("usage --json");
    const parsed = JSON.parse(out);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("No accounts found"));
  });

  test("list command reflects accounts stored in ~/.gbm/accounts.json", () => {
    const accounts = {
      _active: "work",
      personal: {
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYiLCJlbWFpbCI6InBlcnNvbmFsQGV4YW1wbGUuY29tIiwiZXhwIjoyMDgwMDAwMDAwfQ.signature",
        active: false
      },
      work: {
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ODc2NTQiLCJlbWFpbCI6IndvcmtAZXhhbXBsZS5jb20iLCJleHAiOjIwODAwMDAwMDB9.signature",
        active: true
      }
    };
    writeFileSync(join(TEST_DIR, ".gbm", "accounts.json"), JSON.stringify(accounts, null, 2));

    const out = runCli("list");
    assert.ok(out.includes("Connected Accounts"));
    assert.ok(out.includes("[active]"));
    assert.ok(out.includes("work"));
    assert.ok(out.includes("personal"));
  });

  test("list with --json outputs structured account array", () => {
    const accounts = {
      _active: "work",
      work: {
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ODc2NTQiLCJlbWFpbCI6IndvcmtAZXhhbXBsZS5jb20iLCJleHAiOjIwODAwMDAwMDB9.signature",
        active: true
      }
    };
    writeFileSync(join(TEST_DIR, ".gbm", "accounts.json"), JSON.stringify(accounts, null, 2));

    const out = runCli("list --json");
    const parsed = JSON.parse(out);
    assert.equal(parsed.active, "work");
    assert.equal(parsed.accounts.length, 1);
    assert.equal(parsed.accounts[0].account, "work");
    assert.equal(parsed.accounts[0].email, "work@example.com");
  });

  test("switch command updates the active account", () => {
    const accounts = {
      _active: "work",
      personal: {
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYiLCJlbWFpbCI6InBlcnNvbmFsQGV4YW1wbGUuY29tIiwiZXhwIjoyMDgwMDAwMDAwfQ.signature",
        active: false
      },
      work: {
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ODc2NTQiLCJlbWFpbCI6IndvcmtAZXhhbXBsZS5jb20iLCJleHAiOjIwODAwMDAwMDB9.signature",
        active: true
      }
    };
    writeFileSync(join(TEST_DIR, ".gbm", "accounts.json"), JSON.stringify(accounts, null, 2));

    const out = runCli("switch personal");
    assert.ok(out.includes("Switched active account to: personal"));

    const listOut = runCli("list --json");
    const parsed = JSON.parse(listOut);
    assert.equal(parsed.active, "personal");
  });

  test("remove command deletes account", () => {
    const accounts = {
      _active: "test",
      test: {
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJleHAiOjIwODAwMDAwMDB9.signature",
        active: true
      }
    };
    writeFileSync(join(TEST_DIR, ".gbm", "accounts.json"), JSON.stringify(accounts, null, 2));

    const out = runCli("remove test");
    assert.ok(out.includes("- test removed"));

    const listOut = runCli("list --json");
    const parsed = JSON.parse(listOut);
    assert.equal(parsed.accounts.length, 0);
  });
});

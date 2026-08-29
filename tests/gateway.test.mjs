#!/usr/bin/env node
// tests/gateway.test.mjs — Gateway descriptor parsing (no network)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseGatewayDescriptor, buildGatewayRequest, loadGatewayFromEnv } from "../server.mjs";

describe("parseGatewayDescriptor", () => {
  test("parses legacy local host:port gateway", () => {
    const gw = parseGatewayDescriptor({
      host: "127.0.0.1",
      port: 3847,
      authToken: "local-token",
    });
    assert.deepEqual(gw, {
      baseUrl: "http://127.0.0.1:3847",
      token: "local-token",
      headers: {},
    });
  });

  test("parses cloud baseUrl gateway (Grok Bot 0.30+)", () => {
    const gw = parseGatewayDescriptor({
      baseUrl: "https://example.cursorvm.com/",
      token: "cloud-token",
      headers: { "x-anyrun-network-token": "nto-abc" },
    });
    assert.deepEqual(gw, {
      baseUrl: "https://example.cursorvm.com",
      token: "cloud-token",
      headers: { "x-anyrun-network-token": "nto-abc" },
    });
  });

  test("returns null for invalid descriptors", () => {
    assert.equal(parseGatewayDescriptor(null), null);
    assert.equal(parseGatewayDescriptor({}), null);
    assert.equal(parseGatewayDescriptor({ baseUrl: "https://x.com" }), null);
  });
});

describe("buildGatewayRequest", () => {
  test("builds local gateway request", () => {
    const req = buildGatewayRequest({
      baseUrl: "http://127.0.0.1:3847",
      token: "local-token",
      headers: {},
    }, "listAgents");
    assert.equal(req.url, "http://127.0.0.1:3847/api/listAgents");
    assert.equal(req.headers.Authorization, "Bearer local-token");
    assert.equal(req.headers["Content-Type"], "application/json");
  });

  test("builds cloud gateway request with extra headers", () => {
    const req = buildGatewayRequest({
      baseUrl: "https://example.cursorvm.com",
      token: "cloud-token",
      headers: { "x-anyrun-network-token": "nto-abc" },
    }, "listAgents");
    assert.equal(req.url, "https://example.cursorvm.com/api/listAgents");
    assert.equal(req.headers.Authorization, "Bearer cloud-token");
    assert.equal(req.headers["x-anyrun-network-token"], "nto-abc");
  });
});

describe("loadGatewayFromEnv", () => {
  test("loads gateway from environment variables", () => {
    const gw = loadGatewayFromEnv({
      GROKBOT_GATEWAY_URL: "https://example.cursorvm.com",
      GROKBOT_GATEWAY_TOKEN: "cloud-token",
      GROKBOT_GATEWAY_HEADERS: '{"x-anyrun-network-token":"nto-abc"}',
    });
    assert.deepEqual(gw, {
      baseUrl: "https://example.cursorvm.com",
      token: "cloud-token",
      headers: { "x-anyrun-network-token": "nto-abc" },
    });
  });

  test("returns null when env vars are missing", () => {
    assert.equal(loadGatewayFromEnv({}), null);
    assert.equal(loadGatewayFromEnv({ GROKBOT_GATEWAY_URL: "https://x.com" }), null);
  });
});

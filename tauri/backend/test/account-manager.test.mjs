import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountManager } from "../js/account-manager.mjs";

const envelope = data => Response.json({ code: 0, message: "success", data });
const protect = value => Buffer.from(`protected:${value}`).toString("base64");
const unprotect = value => Buffer.from(value, "base64").toString("utf8").replace(/^protected:/, "");

test("non-JSON HTTP failures retain a safe actionable status without exposing response contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "777-account-http-"));
  for (const status of [401, 403, 404, 429, 502]) {
    const manager = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => {}, fetcher: async () => new Response("gateway-private-body", { status }) });
    await assert.rejects(manager.startLogin(), error => error.code === `PLATFORM_HTTP_${status}` && !error.message.includes("gateway-private-body") && (status !== 404 || error.message.includes("接口暂未开放")));
  }
});

test("transient refresh failures preserve encrypted login; only 401 clears it", async () => {
  const root = await mkdtemp(join(tmpdir(), "777-account-preserve-"));
  const manager = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => {} });
  await manager.writeSession("synthetic-refresh", { id: "usr_safe", displayName: "Safe User", email: "" });
  const before = await readFile(manager.sessionPath, "utf8");
  for (const status of [200, 403, 404, 429, 502]) {
    manager.fetcher = async () => new Response("not-json", { status });
    assert.equal((await manager.status()).state, "offline");
    assert.equal(await readFile(manager.sessionPath, "utf8"), before);
  }
  manager.fetcher = async () => Response.json({ reason: "DESKTOP_TOKEN_INVALID" }, { status: 401 });
  assert.equal((await manager.status()).state, "logged-out");
  await assert.rejects(readFile(manager.sessionPath), error => error.code === "ENOENT");
});

test("concurrent account and Key access share one rotating refresh request", async () => {
  const root = await mkdtemp(join(tmpdir(), "777-account-singleflight-")); let calls = 0;
  let release; const ready = new Promise(resolve => { release = resolve; });
  const manager = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => {}, fetcher: async () => {
    calls++; await ready;
    return envelope({ access_token: "synthetic-access", refresh_token: "synthetic-next", expires_in: 900, user: { id: "usr_safe", display_name: "Safe User" } });
  } });
  await manager.writeSession("synthetic-old", { id: "usr_safe", displayName: "Safe User", email: "" });
  const a = manager.status(); const b = manager.access(); const c = manager.refresh(); release();
  const results = await Promise.all([a, b, c]);
  assert.equal(calls, 1); assert.equal(results[0].state, "logged-in");
  assert.equal(results[1], "synthetic-access"); assert.equal(results[2], "synthetic-access");
  assert.equal(unprotect((await manager.readSession()).protectedRefreshToken), "synthetic-next");
  assert.equal(manager.refreshing, null);
});

test("desktop PKCE login keeps secrets out of UI and plaintext files, then reads platform referral", async () => {
  const root = await mkdtemp(join(tmpdir(), "777-account-")); const opened = []; const calls = []; let tokenPolls = 0;
  const fetcher = async (url, options) => {
    calls.push({ url, options }); const path = new URL(url).pathname;
    if (path === "/api/v1/desktop-auth/sessions") return envelope({ session_id: "session_123", authorize_url: "https://www.777codes.codes/desktop/authorize?session_id=session_123", expires_in: 600, interval: 2 });
    if (path.endsWith("/token")) {
      tokenPolls++;
      return tokenPolls === 1 ? new Response(JSON.stringify({ data: { status: "pending" } }), { status: 202, headers: { "Content-Type": "application/json" } }) : envelope({ access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 900, user: { public_user_id: "usr_public", display_name: "测试用户", email: "t***@example.com" } });
    }
    if (path === "/api/v1/desktop/referral") return envelope({ invite_code: "ABCDEFGH", share_url: "https://www.777codes.codes/download/777codex?ref=public_slug", installer_download_url: "https://top777ai.com/downloads/777codex.exe", invited_user_count: 3, total_commission: 12.5, pending_commission: 1.2, this_month_commission: 2.5, status_counts: { registered: 2, qualified: 0, settled: 1, reversed: 0 }, rule_summary: { reward_trigger: "first_topup", download_rewards: false, registration_rewards: false } });
    if (path === "/api/v1/desktop-auth/logout") return envelope({});
    throw new Error(`unexpected ${path}`);
  };
  const manager = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async url => opened.push(url), fetcher });
  const pending = await manager.startLogin("实验机");
  assert.equal(pending.state, "pending"); assert.equal(opened[0], "https://www.777codes.codes/desktop/authorize?session_id=session_123");
  assert.equal((await manager.pollLogin()).state, "pending");
  const logged = await manager.pollLogin(); assert.deepEqual(logged.user, { id: "usr_public", displayName: "测试用户", email: "t***@example.com" });
  assert.equal("accessToken" in logged, false); assert.equal("refreshToken" in logged, false);
  const stored = await readFile(join(root, "account-session.json"), "utf8");
  assert.equal(stored.includes("access-secret"), false); assert.equal(stored.includes("refresh-secret"), false); assert.equal(stored.includes("protectedRefreshToken"), true);
  const referral = await manager.referral(); assert.equal(referral.shareUrl, "https://www.777codes.codes/download/777codex?ref=public_slug"); assert.equal(referral.pendingCommission, 1.2);
  const referralCall = calls.find(call => new URL(call.url).pathname === "/api/v1/desktop/referral"); assert.equal(referralCall.options.headers.Authorization, "Bearer access-secret");
  await manager.openReferral(); assert.equal(opened.at(-1), referral.shareUrl);
  assert.equal((await manager.logout()).state, "logged-out"); await assert.rejects(readFile(join(root, "account-session.json")), error => error.code === "ENOENT");
});

test("restart rotates the protected device refresh token and reports cached identity while offline", async () => {
  const root = await mkdtemp(join(tmpdir(), "777-account-refresh-"));
  const seed = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => {}, fetcher: async url => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/desktop-auth/sessions") return envelope({ session_id: "seed_session", authorize_url: "https://www.777codes.codes/desktop/authorize?session_id=seed_session", expires_in: 600, interval: 2 });
    return envelope({ access_token: "old-access", refresh_token: "old-refresh", expires_in: 900, user: { public_user_id: "usr_1", display_name: "User One", email: "u***@mail.test" } });
  } });
  await seed.startLogin(); await seed.pollLogin();
  const refreshed = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => {}, fetcher: async url => {
    assert.equal(new URL(url).pathname, "/api/v1/desktop-auth/refresh");
    return envelope({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 900, user: { public_user_id: "usr_1", display_name: "User One", email: "u***@mail.test" } });
  } });
  assert.equal((await refreshed.status()).state, "logged-in");
  const stored = await readFile(join(root, "account-session.json"), "utf8"); assert.equal(stored.includes("old-refresh") || stored.includes("new-refresh"), false);
  const offline = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => {}, fetcher: async () => { throw new TypeError("offline"); } });
  const status = await offline.status(); assert.equal(status.state, "offline"); assert.equal(status.user.displayName, "User One");
});

test("refresh can obtain the public account profile separately without exposing credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "777-account-profile-"));
  const seed = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => {}, fetcher: async url => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/desktop-auth/sessions") return envelope({ session_id: "profile_session", authorize_url: "https://www.777codes.codes/desktop/authorize?session_id=profile_session", expires_in: 600, interval: 2 });
    return envelope({ access_token: "seed-access", refresh_token: "seed-refresh", expires_in: 900, user: { public_user_id: "usr_profile", display_name: "Profile User", email: "p***@mail.test" } });
  } });
  await seed.startLogin(); await seed.pollLogin();
  const calls = [];
  const refreshed = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => {}, fetcher: async (url, options) => {
    const path = new URL(url).pathname; calls.push({ path, options });
    if (path === "/api/v1/desktop-auth/refresh") return envelope({ access_token: "profile-access", refresh_token: "profile-refresh", expires_in: 900 });
    if (path === "/api/v1/desktop/me") return envelope({ public_user_id: "usr_profile", display_name: "Profile User", email: "p***@mail.test" });
    throw new Error(`unexpected ${path}`);
  } });
  const state = await refreshed.status(); assert.equal(state.state, "logged-in"); assert.equal(state.user.displayName, "Profile User");
  assert.equal(calls[1].options.headers.Authorization, "Bearer profile-access");
  assert.equal(JSON.stringify(state).includes("profile-access") || JSON.stringify(state).includes("profile-refresh"), false);
});

test("rejects foreign authorization and sharing links, and isolated preview never contacts platform", async () => {
  const root = await mkdtemp(join(tmpdir(), "777-account-boundary-")); let opened = false;
  const manager = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => { opened = true; }, fetcher: async () => envelope({ session_id: "session", authorize_url: "https://evil.example/desktop/authorize?session_id=session", expires_in: 600, interval: 3 }) });
  await assert.rejects(() => manager.startLogin(), error => error.code === "PLATFORM_LINK_REJECTED"); assert.equal(opened, false);
  let fetched = false; const isolated = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => {}, isolated: true, fetcher: async () => { fetched = true; } });
  const status = await isolated.status(); assert.equal(status.available, false); await assert.rejects(() => isolated.startLogin(), error => error.code === "ISOLATED_PREVIEW"); assert.equal(fetched, false);
});

test("preserves platform reason codes and explains a missing official installer", async () => {
  const root = await mkdtemp(join(tmpdir(), "777-account-error-"));
  const manager = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => {}, fetcher: async url => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/desktop-auth/sessions") return envelope({ session_id: "error_session", authorize_url: "https://www.777codes.codes/desktop/authorize?session_id=error_session", expires_in: 600, interval: 2 });
    if (path.endsWith("/token")) return envelope({ access_token: "error-access", refresh_token: "error-refresh", expires_in: 900, user: { public_user_id: "usr_error", display_name: "Error User", email: "e***@mail.test" } });
    return new Response(JSON.stringify({ code: 50300, message: "service unavailable", reason: "DESKTOP_INSTALLER_UNAVAILABLE" }), { status: 503, headers: { "Content-Type": "application/json" } });
  } });
  await manager.startLogin(); await manager.pollLogin();
  await assert.rejects(() => manager.referral(), error => error.code === "DESKTOP_INSTALLER_UNAVAILABLE" && /正式安装包/.test(error.message));
});

test("client completes the frozen platform contract with synthetic credentials only", async () => {
  const root = await mkdtemp(join(tmpdir(), "777-account-contract-"));
  const fixture = JSON.parse(await readFile(new URL("./fixtures/desktop-auth-referral-contract.json", import.meta.url), "utf8"));
  assert.equal(fixture.syntheticOnly, true); assert.equal(fixture.baseUrl, "https://www.777codes.codes/api/v1");
  const requests = []; let pollCount = 0;
  const manager = new AccountManager({ managerRoot: root, protect, unprotect, openExternal: async () => {}, fetcher: async (url, options) => {
    const target = new URL(url); const body = options.body ? JSON.parse(options.body) : null; requests.push({ target, options, body });
    if (target.pathname === "/api/v1/desktop-auth/sessions") {
      assert.equal(body.client_id, "777codex-desktop"); assert.equal(body.code_challenge_method, "S256"); assert.match(body.code_challenge, /^[A-Za-z0-9_-]{43}$/);
      assert.equal("password" in body || "api_key" in body, false); return new Response(JSON.stringify({ code: 0, message: "success", data: fixture.session }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    if (target.pathname.endsWith("/token")) {
      assert.match(body.code_verifier, /^[A-Za-z0-9_-]{43}$/); pollCount++;
      return pollCount === 1 ? new Response(JSON.stringify({ code: 0, message: "success", data: { status: "pending" } }), { status: 202, headers: { "Content-Type": "application/json" } }) : envelope(fixture.tokens);
    }
    if (target.pathname === "/api/v1/desktop/referral") { assert.equal(options.headers.Authorization, `Bearer ${fixture.tokens.access_token}`); return envelope(fixture.referral); }
    throw new Error(`unexpected ${target.pathname}`);
  } });
  assert.equal((await manager.startLogin("假账号联调机器")).state, "pending"); assert.equal((await manager.pollLogin()).state, "pending");
  const logged = await manager.pollLogin(); assert.equal(logged.user.displayName, "假用户");
  const referral = await manager.referral(); assert.equal(referral.shareUrl, fixture.referral.share_url); assert.equal(referral.totalCommission, 12.5);
  assert.equal(requests.some(request => request.target.search.includes("dta_") || request.target.search.includes("dtr_")), false);
  assert.equal(JSON.stringify(logged).includes("FAKE_ACCESS") || JSON.stringify(logged).includes("FAKE_REFRESH"), false);
});

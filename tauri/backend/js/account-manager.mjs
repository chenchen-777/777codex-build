import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError, ensure } from "./errors.mjs";
import { readBoundedJson } from './model-service.mjs';

export const PLATFORM_ORIGIN = "https://www.777codes.codes";
const CLIENT_ID = "777codex-desktop";
const SESSION_FILE = "account-session.json";

function base64url(value) { return Buffer.from(value).toString("base64url"); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function dataOf(value) { const root = object(value); return object(root?.data) || root; }
function boundedText(value, max, label) {
  const text = String(value ?? "").trim();
  ensure(text.length > 0 && text.length <= max && !/[\x00-\x1f\x7f]/.test(text), `${label}格式无效`, "PLATFORM_RESPONSE_INVALID", 502);
  return text;
}
function platformUrl(value, { pathPrefix } = {}) {
  let url;
  try { url = new URL(String(value)); } catch { throw new AppError("平台返回了无效链接", "PLATFORM_RESPONSE_INVALID", 502); }
  ensure(url.origin === PLATFORM_ORIGIN && !url.username && !url.password && !url.hash, "平台返回了不受信任的链接", "PLATFORM_LINK_REJECTED", 502);
  if (pathPrefix) ensure(url.pathname.startsWith(pathPrefix), "平台返回的页面类型不正确", "PLATFORM_LINK_REJECTED", 502);
  return url.href;
}
function normalizeUser(value) {
  const user = object(value); ensure(user, "平台没有返回用户资料", "PLATFORM_RESPONSE_INVALID", 502);
  const id = boundedText(user.public_user_id ?? user.publicUserId ?? user.public_id ?? user.publicId ?? user.id, 128, "用户编号");
  const displayName = boundedText(user.display_name ?? user.displayName ?? user.username ?? user.email, 120, "用户名");
  const email = user.email ? boundedText(user.email, 254, "邮箱") : "";
  return { id, displayName, email };
}
function normalizeTokens(value, { requireUser = true } = {}) {
  const data = dataOf(value); ensure(data, "平台登录响应无效", "PLATFORM_RESPONSE_INVALID", 502);
  const accessToken = boundedText(data.access_token ?? data.accessToken, 8192, "登录凭证");
  const refreshToken = data.refresh_token || data.refreshToken ? boundedText(data.refresh_token ?? data.refreshToken, 8192, "刷新凭证") : "";
  const expiresIn = Number(data.expires_in ?? data.expiresIn);
  ensure(Number.isFinite(expiresIn) && expiresIn >= 60 && expiresIn <= 24 * 60 * 60, "平台凭证有效期无效", "PLATFORM_RESPONSE_INVALID", 502);
  return { accessToken, refreshToken, expiresIn, user: data.user ? normalizeUser(data.user) : requireUser ? normalizeUser(data.user) : null };
}
function normalizeReferral(value) {
  const data = dataOf(value); ensure(data, "平台推广信息响应无效", "PLATFORM_RESPONSE_INVALID", 502);
  const currency = data.currency == null ? null : data.currency;
  ensure(currency === null || typeof currency === 'string' && /^[A-Z]{3}$/.test(currency), '平台返佣币种格式无效', 'PLATFORM_RESPONSE_INVALID', 502);
  const number = (key, alternate) => { const raw = data[key] ?? data[alternate]; if (raw == null) return null; const result = Number(raw); ensure((typeof raw === 'number' || typeof raw === 'string' && raw.trim() !== '') && Number.isFinite(result) && result >= 0, "平台推广统计无效", "PLATFORM_RESPONSE_INVALID", 502); return result; };
  const counts = object(data.status_counts ?? data.statusCounts) || {};
  const count = key => { const value = Number(counts[key] || 0); ensure(Number.isSafeInteger(value) && value >= 0, "平台推广状态统计无效", "PLATFORM_RESPONSE_INVALID", 502); return value; };
  const rawRules = data.rule_summary ?? data.ruleSummary;
  const ruleSummary = typeof rawRules === "string" ? boundedText(rawRules, 300, "返佣说明") : object(rawRules)
    ? '邀请奖励条件、金额和结算状态以平台当前规则及账本为准'
    : "按 777codes 平台当前返佣规则结算";
  const shareUrl = platformUrl(data.share_url ?? data.shareUrl, { pathPrefix: "/download/777codex" });
  const link = new URL(shareUrl);
  ensure(link.pathname === '/download/777codex' && link.searchParams.size === 1 && link.searchParams.getAll('ref').length === 1 && /^[A-Za-z0-9_-]{1,128}$/.test(link.searchParams.get('ref') || ''), '平台返回的推广链接格式不正确', 'PLATFORM_LINK_REJECTED', 502);
  const rawInstaller = object(data.installer);
  let installer = null;
  if (rawInstaller) {
    const version = boundedText(rawInstaller.version, 64, '安装包版本');
    const sizeBytes = rawInstaller.size_bytes;
    const sha256 = String(rawInstaller.sha256 || '').toLowerCase();
    ensure(Number.isSafeInteger(sizeBytes) && sizeBytes > 0 && /^[a-f0-9]{64}$/.test(sha256), '平台安装包信息不完整，请稍后重试', 'PLATFORM_RESPONSE_INVALID', 502);
    installer = { version, sizeBytes, sha256 };
  }
  return {
    inviteCode: boundedText(data.invite_code ?? data.inviteCode, 64, "邀请码"),
    shareUrl, installer, currency,
    invitedUserCount: number("invited_user_count", "invitedUserCount"),
    totalCommission: number("total_commission", "totalCommission"),
    pendingCommission: number("pending_commission", "pendingCommission"),
    thisMonthCommission: number("this_month_commission", "thisMonthCommission"),
    statusCounts: { registered: count("registered"), qualified: count("qualified"), settled: count("settled"), reversed: count("reversed") },
    ruleSummary,
  };
}

export class AccountManager {
  constructor({ managerRoot, protect, unprotect, openExternal, isolated = false, fetcher = fetch, platformOrigin = PLATFORM_ORIGIN, now = () => Date.now() }) {
    ensure(platformOrigin === PLATFORM_ORIGIN, "账号平台地址不受支持", "PLATFORM_ORIGIN_REJECTED", 500);
    this.managerRoot = managerRoot; this.sessionPath = join(managerRoot, SESSION_FILE);
    this.protect = protect; this.unprotect = unprotect; this.openExternal = openExternal;
    this.isolated = isolated; this.fetcher = fetcher; this.now = now;
    this.pending = null; this.accessToken = ""; this.accessExpiresAt = 0; this.user = null; this.refreshing = null;
  }
  async readSession() {
    try {
      const value = JSON.parse(await readFile(this.sessionPath, "utf8"));
      if (value?.schemaVersion !== 1 || typeof value.protectedRefreshToken !== "string") throw new Error("invalid");
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw new AppError("本机账号登录记录损坏，请退出登录后重新授权", "ACCOUNT_SESSION_DAMAGED", 409);
    }
  }
  async writeSession(refreshToken, user) {
    await mkdir(this.managerRoot, { recursive: true });
    const temporary = `${this.sessionPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, protectedRefreshToken: this.protect(refreshToken), user, updatedAt: new Date(this.now()).toISOString() }, null, 2)}\n`, "utf8");
    await rename(temporary, this.sessionPath);
  }
  async clearLocal() { this.pending = null; this.accessToken = ""; this.accessExpiresAt = 0; this.user = null; await rm(this.sessionPath, { force: true }); }
  async request(method, path, { token = "", body, accepted = [], maxBytes = 256 * 1024 } = {}) {
    const url = new URL(path, `${PLATFORM_ORIGIN}/`);
    ensure(url.origin === PLATFORM_ORIGIN && url.pathname.startsWith("/api/v1/"), "账号接口地址不受信任", "PLATFORM_LINK_REJECTED", 500);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetcher(url.href, { method, redirect: "error", cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ===undefined ? {} : { body: JSON.stringify(body) }) });
      let payload;
      try { payload = response.status === 204 ? {} : await readBoundedJson(response, maxBytes); }
      catch {
        // An HTML/plaintext gateway error must not hide its HTTP status or echo its body.
        if (response.ok || accepted.includes(response.status)) throw new AppError("平台返回内容无法识别或超过大小限制", "PLATFORM_RESPONSE_INVALID", 502);
        payload = {};
      }
      if (!response.ok && !accepted.includes(response.status)) {
        const suppliedCode = String(payload?.error?.code || payload?.reason || payload?.code || '');
        const code = /^(?:DESKTOP|PLATFORM|ACCOUNT)_[A-Z0-9_]{1,64}$/.test(suppliedCode) ? suppliedCode : `PLATFORM_HTTP_${response.status}`;
        const message = code === "DESKTOP_INSTALLER_UNAVAILABLE" ? "平台尚未配置正式安装包，暂时不能生成推广下载链接" : response.status === 401 ? "平台登录已失效，请重新登录" : response.status === 403 ? "平台拒绝了此次账号操作" : response.status === 404 ? "平台桌面接口暂未开放或地址不可用，请更新管理工具或联系平台" : response.status === 429 ? "请求过于频繁，请稍后再试" : response.status >= 500 ? "777codes 平台暂时不可用，请稍后重试" : "平台无法完成此次操作";
        throw new AppError(message, code, response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 429 ? 429 : 502);
      }
      return { status: response.status, payload };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(error?.name === "AbortError" ? "连接 777codes 平台超时" : "无法连接 777codes 平台", "PLATFORM_UNAVAILABLE", 503);
    } finally { clearTimeout(timer); }
  }
  assertLive() { if (this.isolated) throw new AppError("隔离预览不连接真实平台账号", "ISOLATED_PREVIEW", 403); }
  publicStatus(state, extra = {}) { return { ok: true, state, platformOrigin: PLATFORM_ORIGIN, user: this.user, ...extra }; }
  async startLogin(deviceName = "Windows 设备") {
    this.assertLive();
    const verifier = base64url(randomBytes(32)); const challenge = base64url(createHash("sha256").update(verifier).digest());
    const { payload } = await this.request("POST", "/api/v1/desktop-auth/sessions", { body: { client_id: CLIENT_ID, code_challenge: challenge, code_challenge_method: "S256", device_name: String(deviceName).slice(0, 80) } });
    const data = dataOf(payload); const sessionId = boundedText(data?.session_id ?? data?.sessionId, 128, "授权会话");
    ensure(/^[A-Za-z0-9_-]+$/.test(sessionId), "平台授权会话格式无效", "PLATFORM_RESPONSE_INVALID", 502);
    const expiresIn = Number(data.expires_in ?? data.expiresIn); const interval = Number(data.interval ?? 3);
    ensure(Number.isFinite(expiresIn) && expiresIn >= 60 && expiresIn <= 900 && Number.isFinite(interval) && interval >= 2 && interval <= 10, "平台授权时间无效", "PLATFORM_RESPONSE_INVALID", 502);
    const authorizeUrl = platformUrl(data.authorize_url ?? data.authorizeUrl, { pathPrefix: "/desktop/authorize" });
    this.pending = { sessionId, verifier, authorizeUrl, expiresAt: this.now() + expiresIn * 1000, interval };
    await this.openExternal(authorizeUrl);
    return this.publicStatus("pending", { expiresAt: new Date(this.pending.expiresAt).toISOString(), pollInterval: interval });
  }
  async pollLogin() {
    this.assertLive(); ensure(this.pending, "没有等待确认的网页登录", "LOGIN_NOT_PENDING", 409);
    if (this.now() >= this.pending.expiresAt) { this.pending = null; throw new AppError("网页登录已过期，请重新发起", "LOGIN_EXPIRED", 410); }
    const { status, payload } = await this.request("POST", `/api/v1/desktop-auth/sessions/${encodeURIComponent(this.pending.sessionId)}/token`, { body: { code_verifier: this.pending.verifier }, accepted: [202] });
    if (status === 202) return this.publicStatus("pending", { expiresAt: new Date(this.pending.expiresAt).toISOString(), pollInterval: this.pending.interval });
    const tokens = normalizeTokens(payload); ensure(tokens.refreshToken, "平台未返回可续期的设备凭证", "PLATFORM_RESPONSE_INVALID", 502);
    await this.writeSession(tokens.refreshToken, tokens.user);
    this.accessToken = tokens.accessToken; this.accessExpiresAt = this.now() + tokens.expiresIn * 1000; this.user = tokens.user; this.pending = null;
    return this.publicStatus("logged-in");
  }
  async refresh() {
    if (!this.refreshing) {
      this.refreshing = this.refreshSession().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  async refreshSession() {
    this.assertLive(); const session = await this.readSession(); ensure(session, "尚未登录 777codes", "ACCOUNT_LOGIN_REQUIRED", 401);
    let refreshToken; try { refreshToken = this.unprotect(session.protectedRefreshToken); } catch { throw new AppError("无法解密本机账号凭证，请重新登录", "ACCOUNT_SESSION_UNREADABLE", 409); }
    const { payload } = await this.request("POST", "/api/v1/desktop-auth/refresh", { body: { refresh_token: refreshToken } });
    const tokens = normalizeTokens(payload, { requireUser: false }); const nextRefresh = tokens.refreshToken || refreshToken;
    let user = tokens.user;
    if (!user) {
      const profile = await this.request("GET", "/api/v1/desktop/me", { token: tokens.accessToken });
      user = normalizeUser(dataOf(profile.payload)?.user ?? dataOf(profile.payload));
    }
    await this.writeSession(nextRefresh, user); this.accessToken = tokens.accessToken; this.accessExpiresAt = this.now() + tokens.expiresIn * 1000; this.user = user;
    return this.accessToken;
  }
  async access() { if (this.accessToken && this.accessExpiresAt - this.now() > 30_000) return this.accessToken; return this.refresh(); }
  async status() {
    if (this.isolated) return this.publicStatus("logged-out", { available: false, message: "隔离预览不连接真实平台账号" });
    if (this.pending) return this.publicStatus("pending", { available: true, expiresAt: new Date(this.pending.expiresAt).toISOString(), pollInterval: this.pending.interval });
    const session = await this.readSession(); if (!session) return this.publicStatus("logged-out", { available: true });
    try { await this.access(); return this.publicStatus("logged-in", { available: true }); }
    catch (error) {
      // Only an explicit authentication rejection invalidates a saved device session.
      // Rate limits, an unpublished route, malformed replies and network failures are retryable.
      if (error.status !== 401) { this.user = session.user || null; return this.publicStatus("offline", { available: true, message: error.message }); }
      await this.clearLocal(); return this.publicStatus("logged-out", { available: true, message: "登录已失效，请重新登录" });
    }
  }
  async referral() {
    this.assertLive();
    const token = await this.access();
    let payload;
    try { ({ payload } = await this.request('GET', '/api/v1/desktop/referral', { token })); }
    catch (error) {
      if (error.code === 'PLATFORM_HTTP_404') throw new AppError('平台推广分享功能暂未开放，请等待平台接通后重试；无需重装客户端', 'DESKTOP_REFERRAL_UNAVAILABLE', 503);
      throw error;
    }
    return { ok: true, ...normalizeReferral(payload) };
  }
  async openReferral() {
    const referral = await this.referral();
    try { await this.openExternal(referral.shareUrl); }
    catch { throw new AppError('无法唤起系统浏览器，请重试；也可刷新推广信息后复制链接手动打开', 'DESKTOP_EXTERNAL_OPEN_FAILED', 503); }
    return { ok: true };
  }
  async logout() {
    this.assertLive(); const session = await this.readSession();
    if (session) { try { await this.request("POST", "/api/v1/desktop-auth/logout", { body: { refresh_token: this.unprotect(session.protectedRefreshToken) } }); } catch {} }
    await this.clearLocal(); return this.publicStatus("logged-out", { available: true });
  }
}

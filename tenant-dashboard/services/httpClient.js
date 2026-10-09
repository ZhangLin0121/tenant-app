/**
 * httpClient.js —— 知寓平台的纯 HTTP 客户端
 *
 * 背景：原实现用 Puppeteer 开 Chrome 模拟登录（约 300MB 内存，在 1.6G 机器上反复触发 OOM）。
 * 经逆向其前端代码，登录所需的两项"验证"都可以离线复刻：
 *   1) checkcode：不是图形验证码，而是由服务器时间 m1 经固定算式得出的 6 位数字
 *        checkcode = ((25214903917 * m1) & 65535) % 1000000
 *   2) 密码加密：AES-128-ECB / PKCS7，密钥硬编码于前端 "EMCP.WebApi.Auth"，输出大写 HEX
 *
 * 登录为 GET + query 参数（POST 会返回 405）。
 * 登录返回的 AccessKey 同时可用于：
 *   - /apiv3/*    通过请求头 accesskey
 *   - /ams/api/*  通过请求头 _ams_token 与 _common_token
 */
'use strict';

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PLATFORM_ORIGIN || 'https://platform.inzhiyu.com';
const AES_KEY = Buffer.from('EMCP.WebApi.Auth', 'utf8'); // 16 字节 → AES-128
const TOKEN_CACHE_PATH = process.env.API_TOKEN_CACHE_PATH || '/opt/tenant-app/logs/apiToken.json';
const TOKEN_MAX_AGE_MS = Number(process.env.API_TOKEN_MAX_AGE_MS || 12 * 60 * 60 * 1000); // 默认 12 小时

const http = axios.create({
  baseURL: BASE,
  timeout: Number(process.env.PLATFORM_HTTP_TIMEOUT_MS || 60000),
  headers: { 'User-Agent': 'tenant-dashboard/1.0' },
  // 平台对 4xx/5xx 也返回有意义的 JSON，交给调用方判断
  validateStatus: () => true,
});

/** 日志脱敏：遮住 token / 密码类字段 */
function mask(v) {
  if (typeof v !== 'string') return v;
  if (v.length <= 8) return '***';
  return `${v.slice(0, 4)}***${v.slice(-2)}`;
}

/** AES-128-ECB + PKCS7，输出大写 HEX（复刻前端 x.a.Encrypt） */
function encryptPassword(plain) {
  const data = Buffer.from(String(plain), 'utf8');
  const padLen = 16 - (data.length % 16);
  const padded = Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
  const cipher = crypto.createCipheriv('aes-128-ecb', AES_KEY, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('hex').toUpperCase();
}

/** 由服务器的 m1 计算 checkcode（复刻前端 getCheckCode） */
function makeCheckcode(m1) {
  const product = BigInt(25214903917) * BigInt(m1);
  const n = Number(product & 65535n) % 1000000;
  return String(n).padStart(6, '0');
}

/** 取服务器时间（返回体里直接带有 m1，无需自行计算时间差） */
async function getServerTime() {
  const res = await http.get('/apiv3/common/time');
  if (res.status !== 200 || !res.data || res.data.m1 === undefined) {
    throw new Error(`获取服务器时间失败: HTTP ${res.status}`);
  }
  return res.data;
}

/** 纯 HTTP 登录，返回 { accessKey, userName, projects, loginTime, overTime } */
async function login({ username, password, logger = console }) {
  if (!username || !password) {
    throw new Error('缺少账号或密码（PLATFORM_USERNAME / PLATFORM_PASSWORD）');
  }
  const t = await getServerTime();
  const checkcode = makeCheckcode(t.m1);
  const pwd = encryptPassword(password);

  const res = await http.get('/apiv3/auth/Login', {
    params: { id: username, pwd, checkcode, opt: '3' },
  });

  const data = res.data || {};
  if (res.status !== 200) {
    throw new Error(`登录失败: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  const accessKey = data.AccessKey || '';
  if (!accessKey) {
    throw new Error(`登录未返回 AccessKey: ${JSON.stringify(data).slice(0, 200)}`);
  }
  logger.log(
    `[HTTP登录] 成功 user=${data.UserName} key=${mask(accessKey)} ` +
    `过期为服务器声明值=${data.OverTime || 'n/a'}`
  );
  return {
    accessKey,
    userName: data.UserName || '',
    projects: data.Projects || [],
    overTime: data.OverTime || null,
    loginTime: data.LoginTime || null,
  };
}

/* ---------------- token 缓存 ---------------- */

function saveToken(accessKey, extra = {}) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
    fs.writeFileSync(
      TOKEN_CACHE_PATH,
      JSON.stringify({ savedAt: Date.now(), accessKey, ...extra }, null, 2),
      { mode: 0o600 }
    );
  } catch (e) {
    console.warn('[HTTP登录] token 缓存写入失败:', e.message);
  }
}

function loadToken() {
  try {
    if (!fs.existsSync(TOKEN_CACHE_PATH)) return null;
    const d = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf-8'));
    if (!d || !d.accessKey) return null;
    if (!d.savedAt || Date.now() - d.savedAt > TOKEN_MAX_AGE_MS) return null;
    return d;
  } catch {
    return null;
  }
}

function clearToken() {
  try {
    if (fs.existsSync(TOKEN_CACHE_PATH)) fs.unlinkSync(TOKEN_CACHE_PATH);
  } catch {}
}

/** 校验 token 是否仍可访问 API */
async function validateToken(accessKey) {
  if (!accessKey) return false;
  try {
    const res = await http.get('/apiv3/auth/user/info', { headers: { accesskey: accessKey } });
    return res.status === 200 && !!(res.data && res.data.UserId);
  } catch {
    return false;
  }
}

/**
 * 取得可用的 accessKey：
 *  1) 优先用内存缓存
 *  2) 其次读磁盘缓存并校验
 *  3) 都没有则重新登录
 */
let memoryToken = null;

async function getAccessKey({ username, password, forceLogin = false, logger = console } = {}) {
  if (!forceLogin && memoryToken && (await validateToken(memoryToken))) return memoryToken;

  if (!forceLogin) {
    const cached = loadToken();
    if (cached && (await validateToken(cached.accessKey))) {
      logger.log(`[HTTP登录] 复用缓存 token key=${mask(cached.accessKey)}`);
      memoryToken = cached.accessKey;
      return memoryToken;
    }
    if (cached) {
      logger.warn('[HTTP登录] 缓存 token 已失效，重新登录');
      clearToken();
    }
  }

  const r = await login({ username, password, logger });
  memoryToken = r.accessKey;
  saveToken(r.accessKey, { userName: r.userName, overTime: r.overTime });
  return memoryToken;
}

/* ---------------- 业务数据抓取 ---------------- */

/** 兼容 /ams/api 的鉴权头（与 /apiv3 的 accesskey 是同一个 token 值） */
function amsHeaders(accessKey) {
  return {
    'Content-Type': 'application/json;charset=UTF-8',
    _ams_token: accessKey,
    _common_token: accessKey,
  };
}

/**
 * 拉取在住清单（分页取全量）。
 * 对应原实现中 page.evaluate 内对 /ams/api/contractEnterprise/guestsList 的调用。
 */
async function fetchAllTenants({
  accessKey,
  contractId,
  pageSize = 300,
  maxPages = 50,
  logger = console,
} = {}) {
  const records = [];
  const seen = new Set();
  let page = 1;

  while (page <= maxPages) {
    const res = await http.post(
      '/ams/api/contractEnterprise/guestsList',
      { pageSize, guestsName: '', contractType: 3, contractId: Number(contractId), pageNumber: page },
      { headers: amsHeaders(accessKey) }
    );

    if (res.status !== 200) {
      throw new Error(`拉取失败: HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    const body = res.data || {};
    if (body.code !== 1000) {
      throw new Error(`拉取失败: code=${body.code} message=${body.message || ''}`);
    }
    const data = body.data || {};
    const list = data.records || [];
    if (!list.length) break;

    let added = 0;
    for (const rec of list) {
      const key = rec.guestsId ?? rec.id;
      if (key !== undefined && seen.has(key)) continue;
      if (key !== undefined) seen.add(key);
      records.push(rec);
      added += 1;
    }
    logger.log(`[HTTP抓取] 第 ${page} 页 ${list.length} 条（新增 ${added}，累计 ${records.length}，total=${data.total}）`);

    // 已取满或本页不足一页则结束
    if (data.total && records.length >= Number(data.total)) break;
    if (list.length < pageSize) break;

    page += 1;
  }

  return records;
}

module.exports = {
  BASE,
  login,
  getAccessKey,
  validateToken,
  clearToken,
  saveToken,
  loadToken,
  fetchAllTenants,
  amsHeaders,
  encryptPassword,
  makeCheckcode,
  getServerTime,
};

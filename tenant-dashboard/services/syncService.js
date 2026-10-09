// 纯 HTTP 客户端：登录与抓取均不再需要浏览器
const httpClient = require('./httpClient');
// Puppeteer 仅作为兜底，按需懒加载（默认路径下不会加载，也不会启动 Chrome）
let _puppeteerLib = null;
const getPuppeteer = () => {
  if (!_puppeteerLib) _puppeteerLib = require('puppeteer');
  return _puppeteerLib;
};
const os = require('os');
const fs = require('fs');
const path = require('path');
const Tenant = require('../models/tenant.model');
const Student = require('../models/student.model');

// 业务口径：仅维护 1~15 楼；16~20 楼已不在负责范围内
const MANAGED_MAX_FLOOR = Number(process.env.MANAGED_MAX_FLOOR || 15);

const LOGIN_URL = 'https://platform.inzhiyu.com/#/login';
const COOKIE_CACHE_PATH = '/opt/tenant-app/logs/authCookies.json';
const COOKIE_MAX_AGE_MS = Number(process.env.COOKIE_MAX_AGE_MS || 12 * 60 * 60 * 1000); // 默认 12 小时
const LOGIN_USERNAME_SELECTORS = ['#ruleln', 'input[placeholder*="账号"]', 'input[placeholder*="用户名"]', 'input[type="text"]'];
const LOGIN_PASSWORD_SELECTORS = ['#rulepwd', 'input[placeholder*="密码"]', 'input[type="password"]'];
const LOGIN_SUBMIT_SELECTORS = ['button.el-button--primary', 'button[type="button"]', 'button[type="submit"]'];

const safeGotoLogin = async (page) => {
  try {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return;
  } catch (e) {
    // 二次尝试，避免偶发导航超时导致直接失败
  }
  await page.goto(LOGIN_URL, { waitUntil: 'load', timeout: 60000 });
};

// --- 用于在内存中存储从浏览器获取的最新鉴权信息 ---
let authCookie = null;
let sharedBrowser = null;
let browserLaunching = null;

// --- 导出一个函数，让其他文件可以获取到这个鉴权信息 ---
const getAuthCookie = () => {
    return authCookie;
};

const getOrLaunchBrowser = async (launchOptions, logStep) => {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  if (browserLaunching) return browserLaunching;
  browserLaunching = (async () => {
    const maxBrowserLaunchRetries = 3;
    for (let attempt = 1; attempt <= maxBrowserLaunchRetries; attempt++) {
      try {
        const b = await getPuppeteer().launch(launchOptions);
        if (logStep) logStep('启动浏览器完成');
        sharedBrowser = b;
        b.on('disconnected', () => { sharedBrowser = null; });
        return b;
      } catch (e) {
        console.warn(`[同步] 浏览器启动失败（${attempt}/${maxBrowserLaunchRetries}）:`, e?.message || e);
        if (attempt >= maxBrowserLaunchRetries) throw e;
        await delayMs(1500 * attempt);
      }
    }
  })();
  try {
    return await browserLaunching;
  } finally {
    browserLaunching = null;
  }
};

const ensureLogsDir = () => {
  const dir = path.dirname(COOKIE_CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const loadCachedCookies = () => {
  try {
    ensureLogsDir();
    if (!fs.existsSync(COOKIE_CACHE_PATH)) return null;
    const raw = fs.readFileSync(COOKIE_CACHE_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.cookies)) return null;
    const savedAt = Number(data.savedAt || 0);
    if (!savedAt || (Date.now() - savedAt) > COOKIE_MAX_AGE_MS) return null;
    return data;
  } catch {
    return null;
  }
};

const saveCachedCookies = (cookies) => {
  try {
    ensureLogsDir();
    fs.writeFileSync(COOKIE_CACHE_PATH, JSON.stringify({ savedAt: Date.now(), cookies }, null, 2));
  } catch {}
};

const clearCachedCookies = () => {
  try {
    if (fs.existsSync(COOKIE_CACHE_PATH)) fs.unlinkSync(COOKIE_CACHE_PATH);
  } catch {}
};

const applyCookiesToPage = async (page, cookies) => {
  if (!cookies || cookies.length === 0) return;
  // 需要带上 url 以确保 Puppeteer 接受跨域 cookie
  const normalized = cookies.map((c) => ({ ...c, url: 'https://platform.inzhiyu.com' }));
  await page.setCookie(...normalized);
};

const checkAuthByToken = async (page) => {
  try {
    const checkResponse = await page.evaluate(async () => {
      const getCookie = (key) => {
        const cookieStr = document.cookie;
        const cookies = cookieStr.split('; ');
        for (const cookie of cookies) {
          const [cookieKey, cookieValue] = cookie.split('=');
          if (cookieKey.trim() === key) {
            return cookieValue;
          }
        }
        return null;
      };
      const amsToken = getCookie('_ams_token');
      const commonToken = getCookie('_common_token');
      if (!amsToken || !commonToken) return { ok: false, reason: 'missing _ams_token/_common_token' };
      try {
        const res = await fetch('https://platform.inzhiyu.com/ams/api/auth/check?accesskey=' + amsToken, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=UTF-8'
          }
        });
        const json = await res.json();
        return { ok: true, data: json };
      } catch (e) {
        return { ok: false, reason: e?.message || 'check failed' };
      }
    });
    if (!checkResponse || !checkResponse.ok) return false;
    if (checkResponse.data && typeof checkResponse.data.code !== 'undefined') {
      return checkResponse.data.code === 1000;
    }
    return true;
  } catch {
    return false;
  }
};

const resolveSelector = async (page, selectors, timeoutMs = 10000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const selector of selectors) {
      try {
        const handle = await page.$(selector);
        if (handle) return selector;
      } catch {}
    }
    await delayMs(300);
  }
  return null;
};

const typeBySelectors = async (page, selectors, value, timeoutMs = 10000) => {
  const selector = await resolveSelector(page, selectors, timeoutMs);
  if (!selector) throw new Error(`未找到输入框: ${selectors.join(' | ')}`);
  await page.focus(selector);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.value = '';
  }, selector);
  await page.type(selector, value, { delay: 60 });
  return selector;
};

const clickBySelectors = async (page, selectors, timeoutMs = 10000) => {
  const selector = await resolveSelector(page, selectors, timeoutMs);
  if (!selector) throw new Error(`未找到登录按钮: ${selectors.join(' | ')}`);
  await page.click(selector);
  return selector;
};

const delayMs = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getMemAvailableMB = () => {
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
    const line = meminfo.split('\n').find(l => l.startsWith('MemAvailable:'));
    if (line) {
      const kb = Number(line.replace(/[^\d]/g, '')) || 0;
      return Math.round(kb / 1024);
    }
  } catch {}
  return Math.round(os.freemem() / 1024 / 1024);
};

const waitForMemory = async (minAvailableMB = 350, maxWaitMs = 30000) => {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const avail = getMemAvailableMB();
    if (avail >= minAvailableMB) return;
    console.log(`[同步] 可用内存偏低（${avail}MB），等待释放...`);
    await delayMs(2000);
  }
};

// 仅基于 guestsList 拉取在住清单，并在浏览器端规范化 mobile 与 idCard 字段
const fetchAllTenants = async (page, enterpriseIds = [], contractIdOpt = 1489) => {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const allTenants = await page.evaluate(async (_enterpriseIdsInBrowser, contractIdInBrowser) => {
        const getCookie = (key) => {
            const cookieStr = document.cookie;
            const cookies = cookieStr.split('; ');
            for (const cookie of cookies) {
                const [cookieKey, cookieValue] = cookie.split('=');
                if (cookieKey.trim() === key) {
                    return cookieValue;
                }
            }
            return null;
        };
        const amsToken = getCookie('_ams_token');
        const commonToken = getCookie('_common_token');
        if (!amsToken || !commonToken) {
            console.error('在 document.cookie 中未能找到 _ams_token 或 _common_token！');
            return [];
        }
        // 1) 拉取之寓在住清单（含房间等）
        let currentPage = 1;
        let hasMore = true;
        const allRecords = [];
        const apiUrl = 'https://platform.inzhiyu.com/ams/api/contractEnterprise/guestsList';
        const payload = { pageSize: 300, guestsName: "", contractType: 3, contractId: contractIdInBrowser };
        while (hasMore) {
            try {
                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json;charset=UTF-8',
                        '_ams_token': amsToken,
                        '_common_token': commonToken
                    },
                    body: JSON.stringify({ ...payload, pageNumber: currentPage })
                });
                const data = await res.json();
                if (res.ok && data.code === 1000 && data.data.records && data.data.records.length > 0) {
                    allRecords.push(...data.data.records);
                    currentPage++;
                } else {
                    hasMore = false;
                }
            } catch (err) {
                hasMore = false;
            }
        }

        // 2) 直接在在住清单内规范化手机号与身份证（ guestsList 已包含这些字段 ）
        let withMobile = 0, withIdCard = 0;
        for (const rec of allRecords) {
          const mobile = rec.mobile || rec.phone || rec.tel || rec.telephone || rec.phoneNumber || rec.contactPhone || '';
          const idCard = rec.idCard || rec.identityCard || rec.idNumber || rec.idNo || rec.cardNo || rec.identityNo || rec.certificateNo || rec.certificateNum || '';
          if (mobile) { rec.mobile = mobile; withMobile++; }
          if (idCard) { rec.idCard = idCard; withIdCard++; }
        }
        return { allRecords, stats: {
          guestsCount: allRecords.length,
          withMobile, withIdCard,
          sampleKeys: allRecords[0] ? Object.keys(allRecords[0]) : []
        } };
    }, enterpriseIds, contractIdOpt);
    // 写入本地日志文件（覆写，便于查看最新一次拉取内容）
    try {
      const logsDir = path.resolve(__dirname, '../logs');
      const guestsOut = Array.isArray(allTenants.allRecords)
        ? allTenants.allRecords.slice(0, 200).map(r => ({
            id: r.id ?? r.guestsId ?? r.tenantId ?? r.userId ?? '',
            tenantName: r.tenantName,
            mobile: r.mobile,
            idCard: r.idCard,
            houseId: r.houseId,
            houseName: r.houseName,
            roomNumber: r.roomNumber,
          })) : [];
      fs.writeFileSync(path.join(logsDir, 'guestsSnapshot.json'), JSON.stringify(guestsOut, null, 2));
      fs.writeFileSync(path.join(logsDir, 'fetchStats.json'), JSON.stringify(allTenants.stats, null, 2));
      console.log('[之寓拉取] 统计:', allTenants.stats);
      console.log('[之寓拉取] guestsSnapshot.json / fetchStats.json 已生成到 logs/');
    } catch (e) {
      console.error('写入抓取日志失败:', e.message);
    }
    return allTenants.allRecords;
};

const syncTenantsToDB = async (tenants) => {
  // 始终尝试清理非负责楼层的快照，避免历史数据影响展示/统计
  try {
    await Tenant.deleteMany({ floor: { $gt: MANAGED_MAX_FLOOR } });
  } catch {}

  if (!Array.isArray(tenants) || tenants.length === 0) {
    console.log('没有获取到租客数据，跳过同步。');
    return { syncedCount: 0, cleaned: false };
  }
  const now = new Date();

    // 过滤：仅同步负责楼层，避免 16~20 楼人员进入本系统
    const managedTenants = [];
    for (const tenant of tenants) {
      const houseName = tenant.houseName || '';
      const roomMatch = houseName.match(/-(\d+)$/);
      const roomNumberStr = roomMatch ? roomMatch[1] : '';
      const roomNumber = parseInt(roomNumberStr, 10);
      if (!roomNumber || Number.isNaN(roomNumber)) continue;
      const floor = Math.floor(roomNumber / 100);
      if (floor < 1 || floor > MANAGED_MAX_FLOOR) continue;
      managedTenants.push({ tenant, roomNumber, floor });
    }

  if (managedTenants.length === 0) {
    console.log(`[同步] 本次抓取未包含负责楼层(<=${MANAGED_MAX_FLOOR})的租客记录，跳过快照写入与清理。`);
    return { syncedCount: 0, cleaned: false };
  }

  // 清理/退租判定非常敏感：如果本次抓取数量异常偏小，宁可保留旧快照也不要误删。
  const beforeCount = await Tenant.countDocuments({ floor: { $lte: MANAGED_MAX_FLOOR } });

  const bulkOps = managedTenants.map(({ tenant, roomNumber, floor }) => {
        // 尝试从不同字段名映射出身份证
        const idCardVal = tenant.idCard || tenant.idNo || tenant.idNumber || tenant.cardNo || tenant.identityNo || tenant.certificateNo || tenant.certificateNum || '';
        const fullData = {
            ...tenant,
            _id: tenant.id,
            floor: floor,
            roomNumber,
            isMain: tenant.isMain === 1,
            ...(idCardVal ? { idCard: String(idCardVal) } : {}),
            updatedAt: now,
        };
        return {
            updateOne: {
                filter: { _id: tenant.id },
                update: {
                  $set: fullData,
                  $setOnInsert: { createdAt: now },
                },
                upsert: true,
            },
        };
  });
  await Tenant.bulkWrite(bulkOps);
  const currentTenantIds = managedTenants.map(({ tenant }) => tenant.id);
  const minExpected = Math.max(10, Math.floor(beforeCount * 0.5));
  if (beforeCount > 0 && managedTenants.length < minExpected) {
    console.warn(`[同步] 抓取数量异常偏小(${managedTenants.length} < ${minExpected})，跳过清理退租记录以避免误删。`);
    console.log(`同步完成，更新了 ${managedTenants.length} 条租客数据（未清理退租记录）。`);
    return { syncedCount: managedTenants.length, cleaned: false };
  }

  const deleteResult = await Tenant.deleteMany({ _id: { $nin: currentTenantIds } });
  if (deleteResult.deletedCount > 0) {
    console.log(`同步完成，更新了 ${managedTenants.length} 条租客数据，删除了 ${deleteResult.deletedCount} 条已退租的记录。`);
  } else {
    console.log(`同步完成，更新了 ${managedTenants.length} 条租客数据。`);
  }
  return { syncedCount: managedTenants.length, cleaned: true };
};


/**
 * 纯 HTTP 抓取在住清单。
 * 原实现通过 page.evaluate 在浏览器内 fetch 同一接口；此处由 Node 直接发起，
 * 因此无需启动 Chrome。
 */
const fetchAllTenantsViaHttp = async (contractId, logStep) => {
  const accessKey = await httpClient.getAccessKey({
    username: process.env.PLATFORM_USERNAME,
    password: process.env.PLATFORM_PASSWORD,
  });
  if (logStep) logStep('HTTP 登录完成');
  return await httpClient.fetchAllTenants({ accessKey, contractId });
};

const runSync = async () => {
  console.log('开始执行同步任务...');
  const overallStart = Date.now();
  let stepStart = overallStart;
  const logStep = (label, extra = '') => {
    const now = Date.now();
    const stepMs = now - stepStart;
    const totalMs = now - overallStart;
    const extraText = extra ? ` ${extra}` : '';
    console.log(`[耗时] ${label}: ${Math.round(stepMs / 100) / 10}s | 总计 ${Math.round(totalMs / 100) / 10}s${extraText}`);
    stepStart = now;
  };
  let browser = null;
  let page = null; 
  let success = false;
  let allowCheckout = false;
  try {
    // 抓取路径开关：默认纯 HTTP（不再启动 Chrome）；置 SYNC_USE_HTTP=false 可回退 Puppeteer
    const useHttp = String(process.env.SYNC_USE_HTTP ?? 'true') !== 'false';
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--no-zygote',
        '--single-process',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
      ],
      ignoreHTTPSErrors: true,
    };
    // 优先探测系统浏览器，避免安装阶段无法下载 Chromium 的问题
    const fsx = require('fs');
    if (process.platform === 'darwin') { 
      const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      try {
        if (fsx.existsSync(macChrome)) {
          console.log('检测到 macOS 环境，使用系统 Chrome。');
          launchOptions.executablePath = macChrome;
        } else {
          console.log('未找到系统 Chrome，改用 Puppeteer 内置 Chromium。');
        }
      } catch { /* ignore */ }
    } else if (process.platform === 'linux') {
      const candidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_PATH,
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium'
      ].filter(Boolean);
      for (const p of candidates) {
        try { if (p && fsx.existsSync(p)) { launchOptions.executablePath = p; console.log('检测到 Linux 浏览器：', p); break; } } catch {}
      }
      if (!launchOptions.executablePath) {
        console.log('未检测到系统 Chrome/Chromium，将尝试使用 Puppeteer 内置 Chromium。');
      }
    }
    // 纯 HTTP 路径下无需为浏览器腾内存
    if (!useHttp) {
      await waitForMemory(Number(process.env.SYNC_MIN_MEM_MB || 350), Number(process.env.SYNC_WAIT_MEM_MS || 30000));
    }
    if (!useHttp) {
      browser = await getOrLaunchBrowser(launchOptions, logStep);
    }

    const createPage = async () => {
      const p = await browser.newPage();
      p.setDefaultTimeout(60000);
      p.setDefaultNavigationTimeout(60000);
      await p.setViewport({ width: 1280, height: 800 });
      // 登录阶段拦截非必要资源，减少登录页加载耗时
      await p.setRequestInterception(true);
      p.on('request', (req) => {
        const type = req.resourceType();
        if (type === 'image' || type === 'media' || type === 'font') {
          req.abort();
          return;
        }
        req.continue();
      });
      return p;
    };

    if (!useHttp) {
      page = await createPage();
    }

    // 1) 先尝试复用缓存 Cookie；失败或页面异常则重试一次
    //    纯 HTTP 路径的鉴权已由 httpClient.getAccessKey 处理，无需浏览器
    let foundCookies = false;
    if (!useHttp) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const cached = loadCachedCookies();
        if (cached && cached.cookies && cached.cookies.length > 0) {
          await applyCookiesToPage(page, cached.cookies);
          await page.goto('https://platform.inzhiyu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
          logStep('使用缓存 Cookie 进入平台');
          const ok = await checkAuthByToken(page);
          if (ok) {
            authCookie = cached.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
            console.log('[同步] 已复用缓存 Cookie，通过鉴权校验。');
            foundCookies = true;
          } else {
            console.warn('[同步] 缓存 Cookie 失效，将走登录流程。');
            clearCachedCookies();
          }
        }

        // 2) 缓存不可用时，走正常登录流程
        if (!foundCookies) {
          await safeGotoLogin(page);
          logStep('进入登录页完成');
          const userSel = await typeBySelectors(page, LOGIN_USERNAME_SELECTORS, process.env.PLATFORM_USERNAME, 12000);
          const pwdSel = await typeBySelectors(page, LOGIN_PASSWORD_SELECTORS, process.env.PLATFORM_PASSWORD, 12000);
          console.log(`[同步] 登录输入框命中：user=${userSel}, pwd=${pwdSel}`);
          
          // 之寓平台为单页应用（SPA），登录后通常不会触发完整的页面导航；
          // 直接点击登录按钮，然后通过下方的 Cookie/鉴权轮询判断登录是否成功。
          const submitSel = await clickBySelectors(page, LOGIN_SUBMIT_SELECTORS, 12000);
          console.log(`[同步] 登录按钮命中：${submitSel}`);
          logStep('提交登录完成');
          // --- 关键改动：使用轮询机制，主动等待关键 Cookie 出现 ---
          const startTime = Date.now();
          const timeout = Number(process.env.SYNC_LOGIN_TIMEOUT_MS || 45000);

          while (Date.now() - startTime < timeout) {
              // 使用 Promise.resolve().then 替代 waitForTimeout
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // 1. 先获取页面上下文中的 accesskey
              const accesskey = await page.evaluate(() => {
                  return document.querySelector('meta[name="accesskey"]')?.content || '';
              });
              // 2. 获取所有需要的 cookies
              const pageCookies = await page.cookies('https://platform.inzhiyu.com');
              const amsToken = pageCookies.find(c => c.name === '_ams_token');
              const commonToken = pageCookies.find(c => c.name === '_common_token');
              const hwwafSesId = pageCookies.find(c => c.name === 'HWWAFSESID');
              const hwwafSesTime = pageCookies.find(c => c.name === 'HWWAFSESTIME');

              const hasCoreTokens = Boolean(amsToken && commonToken);
              if (hasCoreTokens) {
                  // 3. 构建完整的认证信息
                  authCookie = pageCookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
                  
                  // 4. 验证登录状态
                  try {
                      const checkResponse = await page.evaluate(async (cookie, amsTokenValue) => {
                          const res = await fetch('https://platform.inzhiyu.com/ams/api/auth/check?accesskey=' + amsTokenValue, {
                              method: 'POST',
                              headers: {
                                  'Cookie': cookie,
                                  'Content-Type': 'application/json;charset=UTF-8'
                              }
                          });
                          return await res.json();
                      }, authCookie, amsToken.value);
                      
                      if (checkResponse.code === 1000) {
                          if (!hwwafSesId || !hwwafSesTime) {
                              console.warn('登录成功但未检测到 HWWAF cookies，继续使用 _ams_token/_common_token 组合。');
                          }
                          console.log('[同步] 登录鉴权成功，捕获到 cookies:', pageCookies.map(c => c.name));
                          saveCachedCookies(pageCookies);
                          foundCookies = true;
                          break;
                      }
                      console.warn('auth/check 返回未登录状态，继续等待 token 稳定:', checkResponse?.code);
                  } catch (err) {
                      console.warn('auth/check 调用异常，继续重试:', err?.message || err);
                  }
              }
              // 如果没找到，等待 500 毫秒再试
              await delayMs(500);
          }
        }

        if (!foundCookies) {
          const cookieNames = (await page.cookies('https://platform.inzhiyu.com')).map(c => c.name);
          throw new Error(`在 ${Number(process.env.SYNC_LOGIN_TIMEOUT_MS || 45000) / 1000} 秒内未能捕获到完整的鉴权 Cookie，当前拥有: ${cookieNames.join(', ')}`);
        }

        // 成功则跳出重试
        break;
      } catch (e) {
        const msg = e?.message || '';
        const transient = msg.includes('Target closed') || msg.includes('detached Frame') || msg.includes('Session closed');
        if (attempt >= 2 || !transient) throw e;
        console.warn(`[同步] 页面异常，重试登录流程（${attempt}/2）:`, msg);
        try { await page.close(); } catch {}
        page = await createPage();
      }
    }

    logStep('获取鉴权 Cookie 完成');
    } // end if (!useHttp)
    // ---------------------------------------------------------------
    
    const enterpriseIds = String(process.env.PLATFORM_ENTERPRISE_IDS || '227')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const contractId = Number(process.env.PLATFORM_CONTRACT_ID || '1489');
    const tenants = useHttp
      ? await fetchAllTenantsViaHttp(contractId, logStep)
      : await fetchAllTenants(page, enterpriseIds, contractId);
    logStep('抓取租客数据完成', `条数=${tenants.length}`);
    const syncRes = await syncTenantsToDB(tenants);
    logStep('写入数据库完成', `写入=${syncRes?.syncedCount ?? 0}`);
    allowCheckout = Boolean(syncRes && syncRes.cleaned);
    success = true;
  } catch (error) {
    console.error('同步任务执行出错:', error);
    if (page) { try { await page.screenshot({ path: 'logs/error.png' }); } catch {} }
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
    // 同步结束必须关闭浏览器：原实现让 Chrome 常驻，是 OOM 的直接原因
    if (browser) {
      try { await browser.close(); } catch {}
      sharedBrowser = null;
      browser = null;
      console.log('[同步] 浏览器已关闭，内存已释放。');
    }
    if (success) {
      try {
        // 同步完成后做一次对账；仅当快照清理可信时，才执行“退租判定”
        const reconcileStart = Date.now();
        await reconcileStudentsWithTenants({ allowCheckout });
        const reconcileMs = Date.now() - reconcileStart;
        console.log('已完成学生与快照的对账更新。');
        console.log(`[耗时] 对账完成: ${Math.round(reconcileMs / 100) / 10}s`);
      } catch (e) {
        console.error('对账更新失败:', e);
      }
    }
    console.log(`[耗时] 本次同步任务执行完毕，总计 ${(Math.round((Date.now() - overallStart) / 100) / 10)}s`);
    return success;
  }
};

module.exports = { runSync, getAuthCookie, runFetchOnly, reconcileStudentsWithTenants };
// 对账：用当前快照(Tenant)更新学生(Student)的入住状态与占用房间（occupancies）
async function reconcileStudentsWithTenants({ allowCheckout = true } = {}) {
  // 1) 取出当前所有快照
  const tenants = await Tenant.find({}).lean();
  const matchedStudentIds = [];
  const occMap = new Map(); // studentId -> Set(roomNumber)

  let createdCount = 0;
  let updatedPhone = 0;
  let updatedId = 0;
  for (const t of tenants) {
    // 优先按平台ID匹配，其次 mobile+name
    const baseQuery = t._id
      ? { $or: [ { platformTenantId: t._id }, { $and: [ { mobile: t.mobile || '' }, { name: t.tenantName || '' } ] } ] }
      : { $and: [ { mobile: t.mobile || '' }, { name: t.tenantName || '' } ] };

    let stu = await Student.findOne(baseQuery);
    // Fallback：唯一姓名匹配（避免同名多解）
    if (!stu && t.tenantName) {
      const nm = String(t.tenantName).trim();
      const esc = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const byName = await Student.find({ name: new RegExp(`^${esc}$`, 'i') }).select('_id name').lean();
      if (byName.length === 1) {
        stu = await Student.findById(byName[0]._id);
      }
    }
    if (!stu) {
      // 若在学生主档中未命中，则尝试自动创建一条学生记录（要求至少具备手机号或身份证，避免重复）
      const hasKeyIdentity = Boolean((t.mobile && String(t.mobile).trim()) || (t.idCard && String(t.idCard).trim()));
      if (!hasKeyIdentity) {
        // 身份信息不足，跳过自动创建，避免产生重复或脏数据
        continue;
      }

      try {
        stu = await Student.create({
          name: t.tenantName || '',
          mobile: t.mobile || '',
          idCard: t.idCard ? String(t.idCard) : '',
          platformTenantId: t._id,
          platformHouseId: t.houseId,
          platformGuestsId: t.guestsId ? String(t.guestsId) : undefined,
          isCheckedIn: true,
          roomNumber: String(t.roomNumber || ''),
        });
        createdCount++;
      } catch (e) {
        // 若并发或唯一性条件导致创建失败，则放弃本条，避免中断整体对账
        continue;
      }
    }

    const updates = { isCheckedIn: true, roomNumber: String(t.roomNumber || '') };
    // 平台绑定（仅缺失时写入）
    if (!stu.platformTenantId && typeof t._id !== 'undefined') updates.platformTenantId = t._id;
    if (!stu.platformHouseId && typeof t.houseId !== 'undefined') updates.platformHouseId = t.houseId;
    if (!stu.platformGuestsId && t.guestsId) updates.platformGuestsId = String(t.guestsId);
    // 线上权威：如与学生主档不一致，用线上覆盖（仅针对手机号/身份证）
    if (t.mobile && t.mobile !== stu.mobile) { updates.mobile = t.mobile; updatedPhone++; }
    // 身份证：如果快照中有身份证数据，且与学生现有身份证不同或学生没有身份证，则更新
    if (t.idCard && (t.idCard !== stu.idCard || !stu.idCard)) { updates.idCard = String(t.idCard); updatedId++; }

    await Student.updateOne({ _id: stu._id }, { $set: updates });
    matchedStudentIds.push(stu._id);
    // 记录占用房间
    const key = String(stu._id);
    if (!occMap.has(key)) occMap.set(key, new Set());
    occMap.get(key).add(String(t.roomNumber || ''));

    // 统一标签：以学生为真源，覆盖快照中的 tag
    if ((stu.tag || '') !== (t.tag || '')) {
      await Tenant.updateOne({ _id: t._id }, { $set: { tag: stu.tag || '' } });
    }
  }

  // 2) 写入每个学生的占用清单（去重），并确保 isCheckedIn=true
  for (const [sid, set] of occMap.entries()) {
    const rooms = Array.from(set).filter(Boolean).map(r => ({ roomNumber: String(r), isMain: false }));
    // 简单规则：第一个设为主
    if (rooms[0]) rooms[0].isMain = true;
    await Student.updateOne({ _id: sid }, { $set: { occupancies: rooms, isCheckedIn: true, roomNumber: rooms[0]?.roomNumber || '' } });
  }

  // 3) 将未命中的在住学生标记为已退租，并清空占用
  // 这一步对“快照是否完整”非常敏感；当本次同步疑似不完整时跳过，避免误把在住标记为退租。
  if (allowCheckout) {
    await Student.updateMany(
      { isCheckedIn: true, _id: { $nin: matchedStudentIds } },
      { $set: { isCheckedIn: false, occupancies: [] } }
    );
  } else {
    console.warn('[对账] 本次同步未执行快照清理（可能不完整），跳过退租判定。');
  }

  console.log(`对账完成：新建 ${createdCount}（已禁用自动新建），覆盖手机号 ${updatedPhone}，覆盖身份证 ${updatedId}。`);
}

// 仅拉取之寓数据并输出日志，不写入数据库、不对账
async function runFetchOnly() {
  console.log('开始执行仅拉取任务（不入库、不对账）...');
  let browser = null; let page = null;
  try {
    const useHttp = String(process.env.SYNC_USE_HTTP ?? 'true') !== 'false';
    if (useHttp) {
      const contractIdOnly = Number(process.env.PLATFORM_CONTRACT_ID || '4277');
      const records = await fetchAllTenantsViaHttp(contractIdOnly, null);
      console.log(`仅拉取完成（HTTP），共获取 ${records.length} 条在住记录。`);
      return records.length;
    }
    const launchOptions = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
    const fsx = require('fs');
    if (process.platform === 'darwin') {
      const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      try { if (fsx.existsSync(macChrome)) { launchOptions.executablePath = macChrome; } } catch {}
    } else if (process.platform === 'linux') {
      const candidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_PATH,
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium'
      ].filter(Boolean);
      for (const p of candidates) { try { if (p && fsx.existsSync(p)) { launchOptions.executablePath = p; break; } } catch {} }
    }
   browser = await getPuppeteer().launch({
     ...launchOptions,
     args: [
       '--no-sandbox',
       '--disable-setuid-sandbox',
       '--disable-dev-shm-usage',
       '--disable-gpu',
       '--disable-extensions',
       '--no-zygote',
     ],
     ignoreHTTPSErrors: true,
   });
    page = await browser.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);
    await page.setViewport({ width: 1280, height: 800 });
    await safeGotoLogin(page);
    await page.waitForSelector('#ruleln', { timeout: 10000 });
    await page.type('#ruleln', process.env.PLATFORM_USERNAME, { delay: 100 });
    await page.type('#rulepwd', process.env.PLATFORM_PASSWORD, { delay: 100 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
      page.click('button.el-button--primary'),
    ]);

    // 构建企业与合同参数
    const enterpriseIds = String(process.env.PLATFORM_ENTERPRISE_IDS || '227')
      .split(',').map(s => s.trim()).filter(Boolean);
    const contractId = Number(process.env.PLATFORM_CONTRACT_ID || '1489');

    const tenants = useHttp
      ? await fetchAllTenantsViaHttp(contractId, null)
      : await fetchAllTenants(page, enterpriseIds, contractId);
    console.log(`仅拉取完成，共获取 ${tenants.length} 条在住记录。日志已写入 logs/guestsSnapshot.json 等文件。`);
    return tenants.length;
  } catch (e) {
    console.error('仅拉取任务出错:', e);
    throw e;
  } finally {
    if (browser) await browser.close();
  }
}

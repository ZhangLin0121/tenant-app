const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const Tenant = require('../models/tenant.model');
const Student = require('../models/student.model');

// --- 用于在内存中存储从浏览器获取的最新鉴权信息 ---
let authCookie = null;

// --- 导出一个函数，让其他文件可以获取到这个鉴权信息 ---
const getAuthCookie = () => {
    return authCookie;
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
    if (tenants.length === 0) {
        console.log('没有获取到租客数据，跳过同步。');
        return;
    }
    const bulkOps = tenants.map(tenant => {
        const houseName = tenant.houseName || '';
        const roomMatch = houseName.match(/-(\d+)$/);
        const roomNumberStr = roomMatch ? roomMatch[1] : '0';
        const floor = roomNumberStr.length > 3 ? parseInt(roomNumberStr.substring(0, 2), 10) : parseInt(roomNumberStr.substring(0, 1), 10);
        // 尝试从不同字段名映射出身份证
        const idCardVal = tenant.idCard || tenant.idNo || tenant.idNumber || tenant.cardNo || tenant.identityNo || tenant.certificateNo || tenant.certificateNum || '';
        const fullData = {
            ...tenant,
            _id: tenant.id,
            floor: floor,
            roomNumber: parseInt(roomNumberStr, 10),
            isMain: tenant.isMain === 1,
            ...(idCardVal ? { idCard: String(idCardVal) } : {}),
        };
        return {
            updateOne: {
                filter: { _id: tenant.id },
                update: { $set: fullData },
                upsert: true,
            },
        };
    });
    await Tenant.bulkWrite(bulkOps);
    const currentTenantIds = tenants.map(t => t.id);
    const deleteResult = await Tenant.deleteMany({ _id: { $nin: currentTenantIds } });
    if (deleteResult.deletedCount > 0) {
        console.log(`同步完成，更新了 ${tenants.length} 条租客数据，删除了 ${deleteResult.deletedCount} 条已退租的记录。`);
    } else {
        console.log(`同步完成，更新了 ${tenants.length} 条租客数据。`);
    }
};

const runSync = async () => {
  console.log('开始执行同步任务...');
  let browser = null;
  let page = null; 
  try {
    const launchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
    if (process.platform === 'darwin') { 
      console.log('检测到 macOS 环境，将使用系统安装的 Chrome 浏览器...');
      launchOptions.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }
    browser = await puppeteer.launch(launchOptions);
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto('https://platform.inzhiyu.com/#/login', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#ruleln', { timeout: 10000 });
    await page.type('#ruleln', process.env.PLATFORM_USERNAME, { delay: 100 });
    await page.type('#rulepwd', process.env.PLATFORM_PASSWORD, { delay: 100 });
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
      page.click('button.el-button--primary'),
    ]);

    // --- 关键改动：使用轮询机制，主动等待关键 Cookie 出现 ---
    const startTime = Date.now();
    const timeout = 15000; // 15秒超时
    let foundCookies = false;

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

        if (amsToken && commonToken && hwwafSesId && hwwafSesTime) {
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
                    foundCookies = true;
                    break;
                }
            } catch (err) {
                // 登录状态验证失败，将继续重试
            }
        }
        // 如果没找到，等待 500 毫秒再试
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!foundCookies) {
        throw new Error(`在 ${timeout / 1000} 秒内未能捕获到完整的鉴权 Cookie。`);
    }
    // ---------------------------------------------------------------
    
    const enterpriseIds = String(process.env.PLATFORM_ENTERPRISE_IDS || '227')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const contractId = Number(process.env.PLATFORM_CONTRACT_ID || '1489');
    const tenants = await fetchAllTenants(page, enterpriseIds, contractId);
    await syncTenantsToDB(tenants);
  } catch (error) {
    console.error('同步任务执行出错:', error);
    if (page) { await page.screenshot({ path: 'logs/error.png' }); }
  } finally {
    if (browser) {
      await browser.close();
      }
    try {
      // 同步完成后做一次对账
      await reconcileStudentsWithTenants();
      console.log('已完成学生与快照的对账更新。');
    } catch (e) {
      console.error('对账更新失败:', e);
    }
    console.log('本次同步任务执行完毕。');
  }
};

module.exports = { runSync, getAuthCookie, runFetchOnly, reconcileStudentsWithTenants };
// 对账：用当前快照(Tenant)更新学生(Student)的入住状态与占用房间（occupancies）
async function reconcileStudentsWithTenants() {
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
    if (t.idCard && t.idCard !== stu.idCard) { updates.idCard = String(t.idCard); updatedId++; }

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
  await Student.updateMany(
    { isCheckedIn: true, _id: { $nin: matchedStudentIds } },
    { $set: { isCheckedIn: false, occupancies: [] } }
  );

  console.log(`对账完成：新建 ${createdCount}（已禁用自动新建），覆盖手机号 ${updatedPhone}，覆盖身份证 ${updatedId}。`);
}

// 仅拉取之寓数据并输出日志，不写入数据库、不对账
async function runFetchOnly() {
  console.log('开始执行仅拉取任务（不入库、不对账）...');
  let browser = null; let page = null;
  try {
    const launchOptions = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
    if (process.platform === 'darwin') { launchOptions.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; }
    browser = await puppeteer.launch(launchOptions);
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto('https://platform.inzhiyu.com/#/login', { waitUntil: 'networkidle2' });
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

    const tenants = await fetchAllTenants(page, enterpriseIds, contractId);
    console.log(`仅拉取完成，共获取 ${tenants.length} 条在住记录。日志已写入 logs/guestsSnapshot.json 等文件。`);
    return tenants.length;
  } catch (e) {
    console.error('仅拉取任务出错:', e);
    throw e;
  } finally {
    if (browser) await browser.close();
  }
}

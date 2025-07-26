const puppeteer = require('puppeteer');
const Tenant = require('../models/tenant.model');

const fetchAllTenants = async (page) => {
    // 等待 3 秒，确保所有登录后脚本（包括 cookie 设置）都已完成
    await new Promise(resolve => setTimeout(resolve, 3000));

    // page.evaluate 会在浏览器环境中执行传入的函数
    const allTenants = await page.evaluate(async () => {
        // 辅助函数：用于从 cookie 字符串中解析出特定 key 的值
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

        let currentPage = 1;
        let hasMore = true;
        const allRecords = [];

        const apiUrl = 'https://platform.inzhiyu.com/ams/api/contractEnterprise/guestsList';
        const payload = { pageSize: 50, guestsName: "", contractType: 3, contractId: 1489 };

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
        return allRecords;
    });
    return allTenants;
};

const syncTenantsToDB = async (tenants) => {
    if (tenants.length === 0) {
        console.log('没有获取到租客数据，跳过同步。');
        return;
    }
    console.log(`准备将 ${tenants.length} 条数据同步到数据库...`);

    const bulkOps = tenants.map(tenant => {
        const houseName = tenant.houseName || '';
        const roomMatch = houseName.match(/-(\d+)$/);
        const roomNumberStr = roomMatch ? roomMatch[1] : '0';
        const floor = roomNumberStr.length > 3 ? parseInt(roomNumberStr.substring(0, 2), 10) : parseInt(roomNumberStr.substring(0, 1), 10);

        const fullData = {
            ...tenant,
            _id: tenant.id,
            floor: floor,
            roomNumber: parseInt(roomNumberStr, 10),
            isMain: tenant.isMain === 1,
        };

        return {
            updateOne: {
                filter: { _id: tenant.id },
                update: { $set: fullData },
                upsert: true,
            },
        };
    });

    console.log('正在执行批量更新/插入操作...');
    await Tenant.bulkWrite(bulkOps);
    console.log('批量更新/插入操作完成。');

    const currentTenantIds = tenants.map(t => t.id);
    const deleteResult = await Tenant.deleteMany({ _id: { $nin: currentTenantIds } });
    if (deleteResult.deletedCount > 0) {
        console.log(`删除了 ${deleteResult.deletedCount} 条已退租的记录。`);
    }
    console.log('数据库同步成功！');
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

    // 普适化逻辑：
    // 如果是在 macOS (您的本地环境), 则明确指定使用您自己的 Chrome
    if (process.platform === 'darwin') { 
      console.log('检测到 macOS 环境，将使用系统安装的 Chrome 浏览器...');
      launchOptions.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }
    // 在其他环境 (如 Linux 服务器), puppeteer 会自动寻找它自己下载的浏览器，无需指定 executablePath

    browser = await puppeteer.launch(launchOptions);

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto('https://platform.inzhiyu.com/#/login', { waitUntil: 'networkidle2' });
    console.log('已打开登录页面...');
    
    await page.waitForSelector('#ruleln', { timeout: 10000 });
    console.log('用户名输入框已出现，准备输入凭证...');

    await page.type('#ruleln', process.env.PLATFORM_USERNAME, { delay: 100 });
    await page.type('#rulepwd', process.env.PLATFORM_PASSWORD, { delay: 100 });
    console.log('已输入凭证...');

    console.log('准备点击登录并等待用户头像出现...');
    await Promise.all([
      page.waitForSelector('img[src*="apiv3/doc/avatar"]', { timeout: 60000 }),
      page.click('button.el-button--primary'),
    ]);
    console.log('登录成功！已成功检测到用户头像！');
    
    const tenants = await fetchAllTenants(page);
    console.log(`数据获取完成！总共获取到 ${tenants.length} 条租客数据。`);
    
    await syncTenantsToDB(tenants);

  } catch (error) {
    console.error('同步任务执行出错:', error);
    if (page) { await page.screenshot({ path: 'logs/error.png' }); }
  } finally {
    if (browser) {
      await browser.close();
      console.log('浏览器已关闭。');
    }
    console.log('本次同步任务执行完毕。');
  }
};

// ----- 最关键的、之前被遗漏的导出语句 -----
module.exports = { runSync };
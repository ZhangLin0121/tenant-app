const express = require('express');
const router = express.Router();
const Tenant = require('../models/tenant.model');
const Student = require('../models/student.model');
const axios = require('axios');
const { getAuthCookie } = require('../services/syncService'); // 从同步服务中动态获取鉴权信息

// ======================================================================
// === GET 路由：获取并结构化租客数据
// ======================================================================
router.get('/', async (req, res) => {
    try {
        // 方案B：从 Students 主档衍生看板数据（仅取在住）
        const list = await Student.find({ isCheckedIn: true })
          .select('name mobile idCard tag roomNumber occupancies')
          .lean();

        const structuredData = {};
        for (const s of list) {
            const rooms = Array.isArray(s.occupancies) && s.occupancies.length > 0
              ? s.occupancies.map(o => parseInt(String(o.roomNumber || ''), 10)).filter(n => !!n && !Number.isNaN(n))
              : [ parseInt(String(s.roomNumber || ''), 10) ].filter(n => !!n && !Number.isNaN(n));
            for (const rn of rooms) {
                const floor = rn >= 100 ? Math.floor(rn / 100) : 0;
                if (!structuredData[floor]) structuredData[floor] = {};
                if (!structuredData[floor][rn]) structuredData[floor][rn] = [];
                structuredData[floor][rn].push({
                    _id: s._id,
                    tenantName: s.name,
                    isMain: false,
                    tag: s.tag || '',
                    mobile: s.mobile || '',
                    idCard: s.idCard || '',
                    guestsId: undefined,
                    houseName: undefined,
                    houseId: undefined,
                    roomNumber: rn,
                });
            }
        }

        // 每房间选择一个主租客：优先有标签者，否则第一个
        for (const floor in structuredData) {
            for (const roomNum in structuredData[floor]) {
                const arr = structuredData[floor][roomNum];
                let idx = arr.findIndex(x => (x.tag || '') !== '');
                if (idx < 0) idx = 0;
                if (arr[idx]) arr[idx].isMain = true;
                structuredData[floor][roomNum] = arr.sort((a, b) => Number(b.isMain) - Number(a.isMain));
            }
        }

        res.json({ success: true, data: structuredData });
    } catch (error) {
        console.error('API获取租客数据失败(Students):', error);
        res.status(500).json({ success: false, message: '服务器内部错误' });
    }
});

// ======================================================================
// === PATCH 路由：更新租客标签
// ======================================================================
router.patch('/:id', async (req, res) => {
    try {
        let { tag = '' } = req.body || {};
        if (typeof tag !== 'string') tag = String(tag || '');
        tag = tag.trim();
        if (tag.length > 50) tag = tag.slice(0, 50);
        // 直接更新学生标签（方案B）
        const updated = await Student.findByIdAndUpdate(req.params.id, { $set: { tag } }, { new: true });
        if (!updated) return res.status(404).json({ success: false, message: '找不到指定的学生' });
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('更新标签失败(Students):', error);
        res.status(500).json({ success: false, message: '服务器内部错误' });
    }
});

// ======================================================================
// === POST 路由：初始化相关接口
// ======================================================================
router.post('/external/queryDetailById', async (req, res) => {
    try {
        const headers = {
            'Accept': '*/*',
            'Content-Type': 'application/json;charset=UTF-8',
            'Cookie': getAuthCookie(),
            'Origin': 'https://platform.inzhiyu.com',
            'Referer': 'https://platform.inzhiyu.com/',
            'X-Requested-With': 'XMLHttpRequest',
        };
        const response = await axios.post(
            'https://platform.inzhiyu.com/ams/api/contractEnterprise/queryDetailById',
            req.body,
            { headers }
        );
        res.json(response.data);
    } catch (error) {
        console.error('查询合同详情失败:', error);
        res.status(500).json({ success: false, message: '查询失败' });
    }
});

router.post('/external/queryContractEnterpriseHouseById', async (req, res) => {
    try {
        const headers = {
            'Accept': '*/*',
            'Content-Type': 'application/json;charset=UTF-8',
            'Cookie': getAuthCookie(),
            'Origin': 'https://platform.inzhiyu.com',
            'Referer': 'https://platform.inzhiyu.com/',
            'X-Requested-With': 'XMLHttpRequest',
        };
        const response = await axios.post(
            'https://platform.inzhiyu.com/ams/api/contractEnterprise/queryContractEnterpriseHouseById',
            req.body,
            { headers }
        );
        res.json(response.data);
    } catch (error) {
        console.error('查询房间信息失败:', error);
        res.status(500).json({ success: false, message: '查询失败' });
    }
});

router.post('/external/tenant/pageListByEnterprise', async (req, res) => {
    try {
        const headers = {
            'Accept': '*/*',
            'Content-Type': 'application/json;charset=UTF-8',
            'Cookie': getAuthCookie(),
            'Origin': 'https://platform.inzhiyu.com',
            'Referer': 'https://platform.inzhiyu.com/',
            'X-Requested-With': 'XMLHttpRequest',
        };
        const response = await axios.post(
            'https://platform.inzhiyu.com/ams/api/customer/tenant/pageListByEnterprise',
            req.body,
            { headers }
        );
        res.json(response.data);
    } catch (error) {
        console.error('查询租客列表失败:', error);
        res.status(500).json({ success: false, message: '查询失败' });
    }
});

router.post('/external/getUnpaidBills', async (req, res) => {
    try {
        const headers = {
            'Accept': '*/*',
            'Content-Type': 'application/json;charset=UTF-8',
            'Cookie': getAuthCookie(),
            'Origin': 'https://platform.inzhiyu.com',
            'Referer': 'https://platform.inzhiyu.com/',
            'X-Requested-With': 'XMLHttpRequest',
        };
        const response = await axios.post(
            'https://platform.inzhiyu.com/ams/api/contractEnterprise/getUnpaidBills',
            req.body,
            { headers }
        );
        res.json(response.data);
    } catch (error) {
        console.error('查询未付账单失败:', error);
        res.status(500).json({ success: false, message: '查询失败' });
    }
});


module.exports = router;

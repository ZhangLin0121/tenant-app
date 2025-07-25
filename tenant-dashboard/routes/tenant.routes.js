const express = require('express');
const router = express.Router();
const Tenant = require('../models/tenant.model');

router.get('/', async (req, res) => {
  try {
    const tenants = await Tenant.find({}).sort({ floor: 1, roomNumber: 1 });

    const structuredData = tenants.reduce((acc, tenant) => {
      const { floor, roomNumber } = tenant;
      if (!acc[floor]) acc[floor] = {};
      if (!acc[floor][roomNumber]) acc[floor][roomNumber] = [];
      acc[floor][roomNumber].push({
        _id: tenant._id,
        tenantName: tenant.tenantName,
        isMain: tenant.isMain,
        tag: tenant.tag,
        mobile: tenant.mobile,
        guestsId: tenant.guestsId,
        houseName: tenant.houseName
      });
      return acc;
    }, {});

    // ----- 新增的、最关键的排序逻辑 -----
    // 遍历所有楼层
    for (const floor in structuredData) {
      // 遍历该楼层的所有房间
      for (const roomNum in structuredData[floor]) {
        // 对每个房间内的租客数组进行排序
        // b.isMain - a.isMain 会让 isMain:true 的排在前面
        structuredData[floor][roomNum].sort((a, b) => Number(b.isMain) - Number(a.isMain));
      }
    }
    // ------------------------------------

    res.json({ success: true, data: structuredData });
  } catch (error) {
    console.error('API获取租客数据失败:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// PATCH 路由保持不变...
router.patch('/:id', async (req, res) => {
    // ... (此处代码省略，无需改动)
    try{const{tag}=req.body;const allowedTags=['','22级工程硕博士','23级工程硕博士','24级工程硕博士','实习实践'];if(!allowedTags.includes(tag)){return res.status(400).json({success:false,message:'无效的标签值'});}
    const updatedTenant=await Tenant.findByIdAndUpdate(req.params.id,{$set:{tag:tag}},{new:true});if(!updatedTenant){return res.status(404).json({success:false,message:'找不到指定的租客'});}
    res.json({success:true,data:updatedTenant});}catch(error){console.error('更新租客标签失败:',error);res.status(500).json({success:false,message:'服务器内部错误'});}
});


module.exports = router;
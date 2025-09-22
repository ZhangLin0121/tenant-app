const express = require('express');
const router = express.Router();
const RoomFlag = require('../models/roomFlag.model');

// 获取全部房间标记
router.get('/flags', async (_req, res) => {
  try {
    const list = await RoomFlag.find({}).lean();
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: '获取失败' });
  }
});

// 设置/更新房间标记
router.put('/flags/:roomNumber', async (req, res) => {
  try {
    const roomNumber = Number(req.params.roomNumber);
    const body = req.body || {};
    const raw = String(body.type || 'vip').toLowerCase();
    // 统一口径：除 'none' 外一律存为 'vip'（重要）
    const type = raw === 'none' ? 'none' : 'vip';
    const note = typeof body.note === 'string' ? body.note : '';
    const doc = await RoomFlag.findOneAndUpdate(
      { roomNumber },
      { $set: { type, note } },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: '保存失败' });
  }
});

// 清除房间标记
router.delete('/flags/:roomNumber', async (req, res) => {
  try {
    const roomNumber = Number(req.params.roomNumber);
    await RoomFlag.deleteOne({ roomNumber });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// 设置/更新房间标签（用于统计与展示的标签兜底）
router.put('/tags/:roomNumber', async (req, res) => {
  try {
    const roomNumber = Number(req.params.roomNumber);
    let { roomTag = '' } = req.body || {};
    if (typeof roomTag !== 'string') roomTag = String(roomTag || '');
    roomTag = roomTag.trim();
    if (roomTag.length > 50) roomTag = roomTag.slice(0, 50);
    const doc = await RoomFlag.findOneAndUpdate(
      { roomNumber },
      { $set: { roomTag } },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: '保存失败' });
  }
});

router.delete('/tags/:roomNumber', async (req, res) => {
  try {
    const roomNumber = Number(req.params.roomNumber);
    await RoomFlag.updateOne({ roomNumber }, { $set: { roomTag: '' } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

module.exports = router;

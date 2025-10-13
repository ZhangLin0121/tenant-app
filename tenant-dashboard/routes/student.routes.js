const express = require('express');
const router = express.Router();
const Student = require('../models/student.model');
const Tenant = require('../models/tenant.model');

// 列表：支持按 tag 过滤、关键词搜索、分页
router.get('/', async (req, res) => {
  try {
    const { q = '', page = 1, pageSize = 20, isCheckedIn, excludeEmptyTag } = req.query;
    const rawTag = req.query.tag;
    const hasTagParam = Object.prototype.hasOwnProperty.call(req.query, 'tag');

    const filter = {};
    if (hasTagParam && rawTag !== 'all') {
      if (typeof rawTag === 'string' && rawTag.trim() !== '') {
        filter.tag = rawTag;
      } else {
        filter.tag = '';
      }
    } else if (typeof excludeEmptyTag === 'string' && ['1', 'true', 'yes'].includes(String(excludeEmptyTag).toLowerCase())) {
      // 仅统计“有标签”的：排除 tag 为空字符串、null，且必须存在该字段
      filter.tag = { $exists: true, $nin: ['', null] };
    }
    if (typeof isCheckedIn === 'string') {
      if (isCheckedIn === 'true') filter.isCheckedIn = true;
      else if (isCheckedIn === 'false') filter.isCheckedIn = { $ne: true }; // 包含 false/undefined
    }
    if (q) {
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { studentNo: new RegExp(q, 'i') },
        { mobile: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { idCard: new RegExp(q, 'i') },
        { university: new RegExp(q, 'i') },
        { practiceCompany: new RegExp(q, 'i') },
        { roomNumber: new RegExp(q, 'i') },
      ];
    }
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);
    const skip = (parseInt(page, 10) - 1) * limit;

    const [items, total] = await Promise.all([
      Student.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Student.countDocuments(filter),
    ]);

    res.json({ success: true, data: { items, total, page: Number(page), pageSize: limit } });
  } catch (err) {
    console.error('获取学生列表失败:', err);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 标签列表（去重）
router.get('/tags', async (_req, res) => {
  try {
    const tags = await Student.distinct('tag');
    const cleaned = tags.filter(t => typeof t === 'string').sort();
    res.json({ success: true, data: cleaned });
  } catch (err) {
    console.error('获取标签失败:', err);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 新增
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const doc = await Student.create(body);
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error('新增学生失败:', err);
    res.status(400).json({ success: false, message: '参数或数据有误' });
  }
});

// 更新
router.patch('/:id', async (req, res) => {
  try {
    const doc = await Student.findByIdAndUpdate(req.params.id, { $set: req.body || {} }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: '未找到学生' });
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error('更新学生失败:', err);
    res.status(400).json({ success: false, message: '参数或数据有误' });
  }
});

// 删除
router.delete('/:id', async (req, res) => {
  try {
    const r = await Student.findByIdAndDelete(req.params.id);
    if (!r) return res.status(404).json({ success: false, message: '未找到学生' });
    res.json({ success: true });
  } catch (err) {
    console.error('删除学生失败:', err);
    res.status(400).json({ success: false, message: '参数或数据有误' });
  }
});

// 按租客ID更新学生标签（看板右键打标调用）
router.patch('/by-tenant/:tenantId/tag', async (req, res) => {
  try {
    const { tenantId } = req.params;
    let { tag = '' } = req.body || {};
    if (typeof tag !== 'string') tag = String(tag || '');
    tag = tag.trim();
    if (tag.length > 50) tag = tag.slice(0, 50); // 简单长度限制，放开枚举

    // 方案B：优先将传入ID视为学生ID进行更新
    let stu = await Student.findById(tenantId);
    if (!stu) {
      // 兼容旧数据：若存在租客快照，尝试通过平台ID或手机号+姓名匹配学生
      const t = await Tenant.findById(tenantId).lean();
      if (t) {
        const query = tenantId
          ? { $or: [ { platformTenantId: Number(tenantId) }, { $and: [ { mobile: t.mobile || '' }, { name: t.tenantName || '' } ] } ] }
          : { $and: [ { mobile: t.mobile || '' }, { name: t.tenantName || '' } ] };
        stu = await Student.findOne(query);
      }
    }
    if (!stu) return res.status(404).json({ success: false, message: '未找到对应的学生' });

    stu.tag = tag;
    await stu.save();
    res.json({ success: true, data: { studentId: stu._id, tag } });
  } catch (err) {
    console.error('按ID更新学生标签失败:', err);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 批量导入（可用于从表单一次性导入）
router.post('/bulk', async (req, res) => {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    if (list.length === 0) return res.status(400).json({ success: false, message: '空数据' });

    const parseDate = (v) => {
      if (!v) return undefined;
      if (typeof v === 'string') {
        const s = v.trim();
        const m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
        if (m) {
          const yyyy = m[1];
          const mm = String(m[2]).padStart(2, '0');
          const dd = String(m[3]).padStart(2, '0');
          const d1 = new Date(`${yyyy}-${mm}-${dd}`);
          if (!isNaN(d1.getTime())) return d1;
        }
      }
      const d = new Date(v);
      return isNaN(d.getTime()) ? undefined : d;
    };
    const str = (v) => (v === null || v === undefined ? '' : String(v));

    const normalized = list.map((x) => {
      // 支持中英文字段名
      const name = x.name ?? x['姓名'] ?? '';
      const mobile = str(x.mobile ?? x['电话'] ?? '');
      const idCard = str(x.idCard ?? x['身份证'] ?? '');
      const tag = x.tag ?? x['标签'] ?? '';
      const education = x.education ?? x['学历'] ?? '';
      const university = x.university ?? x['毕业院校'] ?? '';
      const practiceCompany = x.practiceCompany ?? x['实践企业'] ?? '';
      const roomNumber = '';
      const checkInAt = parseDate(x.checkInAt ?? x['入住时间']);
      const checkOutAt = parseDate(x.checkOutAt ?? x['离开时间']);
      const major = x.major ?? x['专业'] ?? '';

      return {
        name,
        mobile,
        idCard,
        tag,
        education,
        university,
        practiceCompany,
        checkInAt,
        checkOutAt,
        major,
      };
    }).filter(d => d.name || d.mobile || d.idCard);

    if (normalized.length === 0) return res.status(400).json({ success: false, message: '未识别到有效数据（至少需要姓名/电话/身份证其一）' });

    // 预取已存在的身份证->姓名 映射，用于冲突判断
    const existingPairs = await Student.find({ idCard: { $exists: true, $ne: '' } })
      .select('idCard name')
      .lean();
    const idcardToName = new Map();
    for (const it of existingPairs) {
      if (typeof it.idCard === 'string' && it.idCard) {
        idcardToName.set(it.idCard, it.name || '');
      }
    }

    // 同一批次内也要做一次“首次姓名”记录，避免批内冲突
    const batchIdName = new Map();

    const ops = [];
    for (const doc of normalized) {
      let filter = null;
      if (doc.idCard) {
        const known = idcardToName.get(doc.idCard) ?? batchIdName.get(doc.idCard);
        if (known && doc.name && known.trim() !== doc.name.trim() && doc.mobile && doc.name) {
          // 身份证已存在但姓名不同，按“手机号+姓名”合并，避免错误覆盖
          filter = { mobile: doc.mobile, name: doc.name };
        } else {
          filter = { idCard: doc.idCard };
          if (!batchIdName.has(doc.idCard) && doc.name) batchIdName.set(doc.idCard, doc.name);
        }
      } else if (doc.mobile && doc.name) filter = { mobile: doc.mobile, name: doc.name };
      else if (doc.name) filter = { name: doc.name };
      else if (doc.mobile) filter = { mobile: doc.mobile };
      else continue;

      const set = {};
      const setIfVal = (k, v) => {
        if (v === undefined || v === null) return;
        if (typeof v === 'string') { if (v.trim() === '') return; set[k] = v; return; }
        if (v instanceof Date) { set[k] = v; return; }
        if (typeof v === 'boolean') { set[k] = v; return; }
        if (typeof v === 'number') { set[k] = v; return; }
      };

      // 注意：主键字段仅在插入时设置，避免与 $setOnInsert 冲突
      setIfVal('tag', doc.tag);
      setIfVal('education', doc.education);
      setIfVal('university', doc.university);
      setIfVal('practiceCompany', doc.practiceCompany);
      setIfVal('checkInAt', doc.checkInAt);
      setIfVal('checkOutAt', doc.checkOutAt);
      setIfVal('major', doc.major);

      const insertBase = {};
      insertBase.isCheckedIn = false;
      if (doc.name) insertBase.name = doc.name;
      if (doc.mobile) insertBase.mobile = doc.mobile;
      if (doc.idCard) insertBase.idCard = doc.idCard;

      ops.push({
        updateOne: {
          filter,
          update: { $set: set, $setOnInsert: insertBase },
          upsert: true,
        }
      });
    }

    if (ops.length === 0) return res.status(400).json({ success: false, message: '无有效数据可导入' });

    const result = await Student.bulkWrite(ops, { ordered: false });
    res.json({
      success: true,
      data: {
        upserted: result.upsertedCount || 0,
        modified: result.modifiedCount || 0,
        matched: result.matchedCount || 0,
      }
    });
  } catch (err) {
    console.error('批量导入失败:', err);
    res.status(400).json({ success: false, message: '导入失败，请检查数据格式' });
  }
});

module.exports = router;

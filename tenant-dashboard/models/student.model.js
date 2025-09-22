const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    studentNo: { type: String, trim: true, index: true },
    mobile: { type: String, trim: true },
    email: { type: String, trim: true },
    tag: { type: String, trim: true, index: true, default: '' },
    grade: { type: String, trim: true },
    major: { type: String, trim: true },

    // 新增：贴合表单字段
    idCard: { type: String, trim: true }, // 身份证
    education: { type: String, trim: true }, // 学历
    university: { type: String, trim: true }, // 毕业院校
    practiceCompany: { type: String, trim: true }, // 实践企业
    isCheckedIn: { type: Boolean, default: false }, // 是否入住
    roomNumber: { type: String, trim: true }, // 入住房间号
    checkInAt: { type: Date }, // 入住时间
    checkOutAt: { type: Date }, // 离开时间

    // 之寓平台关联（仅用于匹配，不对外展示）
    platformTenantId: { type: Number, index: true },
    platformGuestsId: { type: String, index: true },
    platformHouseId: { type: Number, index: true },

    // 支持一人多房：当前在住的房间占用清单
    occupancies: [
      new mongoose.Schema({
        roomNumber: { type: String, trim: true },
        isMain: { type: Boolean, default: false },
      }, { _id: false })
    ],

    // 可扩展字段，兼容表单内其它列
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, versionKey: false }
);

studentSchema.index({ name: 1 });

const Student = mongoose.model('Student', studentSchema);
module.exports = Student;

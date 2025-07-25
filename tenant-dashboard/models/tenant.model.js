const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    _id: {
      type: Number,
      required: true,
    },
    // ----- 确保所有需要的字段都被定义 -----
    guestsId: {
      type: String,
    },
    houseId: {
      type: Number,
    },
    houseName: {
      type: String,
      required: true,
    },
    tenantName: {
      type: String,
      required: true,
    },
    mobile: {
      type: String, // <-- 之前遗漏的字段
    },
    isMain: {
      type: Boolean,
      default: false,
    },
    floor: {
      type: Number,
      required: true,
    },
    roomNumber: {
      type: Number,
      required: true,
    },
    tag: {
      type: String,
      enum: ['', '22级工程硕博士', '23级工程硕博士', '24级工程硕博士', '实习实践'],
      default: '',
    },
  },
  {
    versionKey: false,
    timestamps: true,
  }
);

const Tenant = mongoose.model('Tenant', tenantSchema);

module.exports = Tenant;
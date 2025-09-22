const mongoose = require('mongoose');

const roomFlagSchema = new mongoose.Schema({
  roomNumber: { type: Number, required: true, unique: true, index: true },
  type: { type: String, enum: ['unavailable', 'storage', 'vip', 'none'], default: 'none' },
  roomTag: { type: String, trim: true, default: '' },
  note: { type: String, trim: true },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('RoomFlag', roomFlagSchema);

const mongoose = require('mongoose');

const SpinSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true, index: true },
  rewardAmount: { type: Number, required: true },
  rewardLabel: { type: String, required: true },
  txHash: { type: String, default: null },
  status: { type: String, enum: ['pending','success','failed','try_again'], default: 'pending' },
  ipAddress: { type: String },
  spinId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Spin', SpinSchema);

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(e => console.error('MongoDB error:', e.message));

const SpinSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true },
  rewardAmount: { type: Number, required: true },
  rewardLabel: { type: String, required: true },
  txHash: { type: String, default: null },
  status: { type: String, default: 'pending' },
  spinId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Spin = mongoose.model('Spin', SpinSchema);

const REWARDS = [
  { label: 'Try Again', amount: 0,   weight: 50 },
  { label: '5 DOGEE',   amount: 5,   weight: 25 },
  { label: '10 DOGEE',  amount: 10,  weight: 15 },
  { label: '50 DOGEE',  amount: 50,  weight: 7  },
  { label: '100 DOGEE', amount: 100, weight: 3  },
];

function pickReward() {
  const total = REWARDS.reduce((s, r) => s + r.weight, 0);
  let rand = Math.random() * total;
  for (const r of REWARDS) { rand -= r.weight; if (rand <= 0) return r; }
  return REWARDS[0];
}

const spinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many spins! Come back in an hour' }
});

app.post('/api/spin', spinLimiter, async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress || walletAddress.length < 32) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  const reward = pickReward();
  const spinId = uuidv4();
  const spin = new Spin({
    walletAddress,
    rewardAmount: reward.amount,
    rewardLabel: reward.label,
    spinId,
    status: reward.amount === 0 ? 'try_again' : 'success',
    txHash: reward.amount > 0 ? 'devnet_' + spinId.slice(0, 16) : null
  });
  await spin.save();
  return res.json({
    spinId,
    result: reward.amount === 0 ? 'try_again' : 'win',
    label: reward.label,
    amount: reward.amount,
    txHash: spin.txHash,
    explorerUrl: 'https://explorer.solana.com/?cluster=devnet'
  });
});

function adminAuth(req, res, next) {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const [totalSpins, totalWins, recentSpins] = await Promise.all([
    Spin.countDocuments(),
    Spin.countDocuments({ status: 'success' }),
    Spin.find().sort({ createdAt: -1 }).limit(50)
  ]);
  const totalPaid = await Spin.aggregate([
    { $match: { status: 'success' } },
    { $group: { _id: null, total: { $sum: '$rewardAmount' } } }
  ]);
  res.json({
    totalSpins, totalWins,
    totalDogeePaid: totalPaid[0]?.total || 0,
    treasuryBalance: 1000000,
    solBalance: 2.0,
    recentSpins
  });
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('DOGEE Backend running on port ' + PORT));

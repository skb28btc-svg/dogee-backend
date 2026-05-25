require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const solana = require('./services/solana');
const Spin = require('./models/Spin');

const app = express();

// ── Middleware ──
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// ── Rate limiting: max 3 spins per IP per hour ──
const spinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many spins! Come back in an hour 🐕' }
});

// ── Connect MongoDB ──
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(e => console.error('❌ MongoDB error:', e.message));

// ── Init Solana ──
solana.init();

// ── Reward config ──
const REWARDS = [
  { label: 'Try Again', amount: 0, weight: 50 },
  { label: '5 DOGEE',   amount: 5,  weight: 25 },
  { label: '10 DOGEE',  amount: 10, weight: 15 },
  { label: '50 DOGEE',  amount: 50, weight: 7  },
  { label: '100 DOGEE', amount: 100,weight: 3  },
];

function pickReward() {
  const total = REWARDS.reduce((s, r) => s + r.weight, 0);
  let rand = Math.random() * total;
  for (const r of REWARDS) { rand -= r.weight; if (rand <= 0) return r; }
  return REWARDS[0];
}

function isValidSolanaAddress(addr) {
  try { const { PublicKey } = require('@solana/web3.js'); new PublicKey(addr); return true; }
  catch { return false; }
}

// ════════════════════════════════
//  POST /api/spin
// ════════════════════════════════
app.post('/api/spin', spinLimiter, async (req, res) => {
  const { walletAddress } = req.body;

  if (!walletAddress || !isValidSolanaAddress(walletAddress)) {
    return res.status(400).json({ error: 'Invalid Solana wallet address' });
  }

  const reward = pickReward();
  const spinId = uuidv4();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // Save spin record
  const spin = new Spin({
    walletAddress, rewardAmount: reward.amount,
    rewardLabel: reward.label, spinId, ipAddress: ip,
    status: reward.amount === 0 ? 'try_again' : 'pending'
  });
  await spin.save();

  if (reward.amount === 0) {
    return res.json({ spinId, result: 'try_again', label: reward.label, amount: 0 });
  }

  // Send tokens
  try {
    const txHash = await solana.sendDogee(walletAddress, reward.amount);
    spin.txHash = txHash;
    spin.status = 'success';
    await spin.save();

    return res.json({
      spinId, result: 'win',
      label: reward.label, amount: reward.amount,
      txHash,
      explorerUrl: `https://explorer.solana.com/tx/${txHash}?cluster=devnet`
    });
  } catch (err) {
    spin.status = 'failed';
    await spin.save();
    console.error('Transfer failed:', err.message);
    return res.status(500).json({ error: 'Token transfer failed. Try again!', spinId });
  }
});

// ════════════════════════════════
//  Admin middleware
// ════════════════════════════════
function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ════════════════════════════════
//  GET /api/admin/stats
// ════════════════════════════════
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const [totalSpins, totalWins, recentSpins, treasuryBalance, solBalance] = await Promise.all([
    Spin.countDocuments(),
    Spin.countDocuments({ status: 'success' }),
    Spin.find().sort({ createdAt: -1 }).limit(50),
    solana.getTreasuryBalance(),
    solana.getSolBalance()
  ]);

  const totalPaid = await Spin.aggregate([
    { $match: { status: 'success' } },
    { $group: { _id: null, total: { $sum: '$rewardAmount' } } }
  ]);

  res.json({
    totalSpins, totalWins,
    totalDogeePaid: totalPaid[0]?.total || 0,
    treasuryBalance, solBalance,
    recentSpins
  });
});

// ── Health ──
app.get('/health', (_, res) => res.json({ status: 'ok', network: 'devnet' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 DOGEE Backend running on port ${PORT}`));

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  try {
    const envLines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
    for (const line of envLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  } catch (_) {}
}
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOCAL_LOGO_CANDIDATES = ['logo.png', 'logo.webp', 'logo.jpg', 'logo.jpeg', 'logo.svg'];

function resolveAppLogoUrl(cfg) {
  const configured = String(cfg?.token?.image || '').trim();
  if (configured.startsWith('/')) {
    const candidatePath = path.resolve(PUBLIC_DIR, configured.replace(/^\/+/, ''));
    if (candidatePath.startsWith(path.resolve(PUBLIC_DIR)) && fs.existsSync(candidatePath)) {
      return configured;
    }
  }
  for (const name of LOCAL_LOGO_CANDIDATES) {
    if (fs.existsSync(path.join(PUBLIC_DIR, name))) {
      return `/${name}`;
    }
  }
  return configured || 'https://ton.org/download/ton_symbol.png';
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let runtimeBotUsername = '';

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (process.env.PORT) cfg.port = Number(process.env.PORT) || cfg.port;
  if (process.env.BOT_TOKEN) cfg.botToken = String(process.env.BOT_TOKEN).trim();
  if (process.env.BOT_USERNAME) cfg.botUsername = String(process.env.BOT_USERNAME).trim().replace(/^@/, '');
  if (runtimeBotUsername && !cfg.botUsername) cfg.botUsername = runtimeBotUsername;

  const autoCloudUrl =
    process.env.PUBLIC_APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  if (autoCloudUrl) {
    cfg.publicAppUrl = String(autoCloudUrl).trim().replace(/\/+$/, '');
  }
  return cfg;
}

function saveBotUsernameToConfig(username) {
  if (!username) return;
  runtimeBotUsername = username;
  try {
    const rawCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (rawCfg.botUsername !== username) {
      rawCfg.botUsername = username;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(rawCfg, null, 2), 'utf8');
    }
  } catch (_) {}
}

function createEmptyDB() {
  return {
    schemaVersion: 2,
    users: {},
    withdrawals: [],
    usedTxRefs: {},
    presale: {
      totalCoinsSold: 0,
      totalTonRaised: 0,
      walletTonSpent: {},
      purchases: [],
    },
  };
}

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (!parsed.users) parsed.users = {};
      if (!Array.isArray(parsed.withdrawals)) parsed.withdrawals = [];
      if (!parsed.usedTxRefs) parsed.usedTxRefs = {};
      if (!parsed.presale) {
        parsed.presale = {
          totalCoinsSold: 0,
          totalTonRaised: 0,
          walletTonSpent: {},
          purchases: [],
        };
      }
      if (!parsed.presale.walletTonSpent) parsed.presale.walletTonSpent = {};
      if (!Array.isArray(parsed.presale.purchases)) parsed.presale.purchases = [];
      return parsed;
    }
  } catch (_) {}
  return createEmptyDB();
}

const db = loadDB();
function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (_) {}
}

// ================= TON ADDRESS PARSER & CONVERTER (CRC16-XMODEM) =================
function crc16Ton(buf) {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function parseTonAddressToRaw(addr) {
  const s = String(addr || '').trim();
  if (!s) return null;
  if (/^-?\d+:[0-9a-fA-F]{64}$/.test(s)) {
    return s.toLowerCase();
  }
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== 36) return null;
    const payload = buf.subarray(0, 34);
    const crc = (buf[34] << 8) | buf[35];
    if (crc16Ton(payload) !== crc) return null;
    const wc = payload.readInt8(1);
    const hash = payload.subarray(2, 34).toString('hex').toLowerCase();
    return `${wc}:${hash}`;
  } catch (_) {
    return null;
  }
}

function rawToFriendlyTon(raw, bounceable = false) {
  const m = String(raw || '').trim().match(/^(-?\d+):([0-9a-fA-F]{64})$/);
  if (!m) return String(raw || '');
  const buf = Buffer.alloc(36);
  buf[0] = bounceable ? 0x11 : 0x51;
  buf.writeInt8(parseInt(m[1], 10), 1);
  Buffer.from(m[2], 'hex').copy(buf, 2);
  const crc = crc16Ton(buf.subarray(0, 34));
  buf[34] = (crc >> 8) & 0xff;
  buf[35] = crc & 0xff;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

function hashTxRef(str) {
  return crypto.createHash('sha256').update(String(str || '')).digest('hex');
}

// ================= UTC DATE HELPERS (00:00 UTC DAILY RESET) =================
function getUtcDateStr(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

function getPrevUtcDateStr(utcDateStr) {
  const [y, m, d] = utcDateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

function getNextUtcMidnightMs(ms = Date.now()) {
  const now = new Date(ms);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
}

// ================= 1,000-LEVEL ECONOMY (EXACT VICTORSCOMPANYBOT FORMULA) =================
const MAX_LEVEL = 1000;

const WORLD_TIERS = [
  { rank: 1, name: 'TRAINEE', title: 'TRAINEE', zone: 'Rank 1 · TRAINEE', tool: 'Pickaxe', crew: 1, icon: '⛏️' },
  { rank: 2, name: 'WORKER', title: 'WORKER', zone: 'Rank 2 · WORKER', tool: 'Pickaxe', crew: 2, icon: '👷' },
  { rank: 3, name: 'FOREMAN', title: 'FOREMAN', zone: 'Rank 3 · FOREMAN', tool: 'Sledgehammer', crew: 3, icon: '🛠️' },
  { rank: 4, name: 'ENGINEER', title: 'ENGINEER', zone: 'Rank 4 · ENGINEER', tool: 'Drill', crew: 3, icon: '⚙️' },
  { rank: 5, name: 'PROSPECTOR', title: 'PROSPECTOR', zone: 'Rank 5 · PROSPECTOR', tool: 'Crystal Pick', crew: 4, icon: '🧭' },
  { rank: 6, name: 'SUPERVISOR', title: 'SUPERVISOR', zone: 'Rank 6 · SUPERVISOR', tool: 'Jackhammer', crew: 4, icon: '📋' },
  { rank: 7, name: 'MANAGER', title: 'MANAGER', zone: 'Rank 7 · MANAGER', tool: 'Golden Pick', crew: 5, icon: '💼' },
  { rank: 8, name: 'DIRECTOR', title: 'DIRECTOR', zone: 'Rank 8 · DIRECTOR', tool: 'Laser Drill', crew: 5, icon: '🏛️' },
  { rank: 9, name: 'VICE PRESIDENT', title: 'VICE PRESIDENT', zone: 'Rank 9 · VICE PRESIDENT', tool: 'Plasma Drill', crew: 6, icon: '💎' },
  { rank: 10, name: 'CEO', title: 'CEO', zone: 'Rank 10 · CEO', tool: 'Mythic Hammer', crew: 6, icon: '👑' },
];

function requiredHolding(level) {
  if (level <= 0) return 0;
  if (level === 1) return 100;
  if (level >= MAX_LEVEL) return 3875968992;
  const seg = (a, b, lo, hi, e) => Math.round(lo + (hi - lo) * Math.pow((level - a) / (b - a), e));
  if (level <= 203) return seg(1, 203, 100, 10000, 1.8);
  if (level <= 450) return seg(203, 450, 10000, 250000, 2.0);
  if (level <= 650) return seg(450, 650, 250000, 27131780, 2.2);
  if (level <= 850) return seg(650, 850, 27131780, 348837200, 2.5);
  return seg(850, MAX_LEVEL, 348837200, 3875968992, 2.6);
}

function miningSpeed(level) {
  if (level <= 0) return 0;
  if (level === 1) return 0.2;
  if (level >= MAX_LEVEL) return 5000;
  if (level <= 203) return +(0.2 + (level - 1) * ((7.56 - 0.2) / 202)).toFixed(2);
  return +(7.56 + (5000 - 7.56) * Math.pow((level - 203) / (MAX_LEVEL - 203), 2.1)).toFixed(2);
}

function dailyOutput(level) {
  if (level <= 0) return 0;
  return level === 1 ? 5 : +(miningSpeed(level) * 25).toFixed(2);
}

function getTierForLevel(level) {
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level || 1)));
  const idx = Math.min(9, Math.floor((L - 1) / 100));
  return WORLD_TIERS[idx];
}

function getLevelSpec(level) {
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level || 1)));
  const tier = getTierForLevel(L);
  const speed = miningSpeed(L);
  const daily = dailyOutput(L);
  return {
    level: L,
    rank: tier.rank,
    rankName: tier.name,
    rankTitle: tier.title,
    zone: tier.zone,
    tool: tier.tool,
    crew: tier.crew,
    icon: tier.icon,
    minHoldingCoins: requiredHolding(L),
    powerThs: speed,
    dailyCoins: daily,
    hourlyCoins: +(daily / 24).toFixed(4),
  };
}

// Compute unlocked level (1..1000) from combined holding (in-app + on-chain wallet)
// Connecting a TON wallet unlocks Free Level 1 miner immediately; higher levels require >= requiredHolding(L)
function computeLevelFromHolding(combinedHolding) {
  const hold = Math.max(0, Number(combinedHolding || 0));
  let lo = 2;
  let hi = MAX_LEVEL;
  let ans = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (hold >= requiredHolding(mid)) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

// Precompute 1,000 levels cache for /api/levels
let ALL_1000_LEVELS_CACHE = null;
function getAll1000Levels() {
  if (!ALL_1000_LEVELS_CACHE) {
    ALL_1000_LEVELS_CACHE = [];
    for (let i = 1; i <= MAX_LEVEL; i++) {
      ALL_1000_LEVELS_CACHE.push(getLevelSpec(i));
    }
  }
  return ALL_1000_LEVELS_CACHE;
}

// ================= ON-CHAIN JETTON BALANCE & VERIFICATION TX SCANNER =================
const jettonBalanceCache = new Map();
let creatorTxCache = { time: 0, txs: [] };

async function fetchOnChainJettonBalance(cfg, walletRaw) {
  if (!walletRaw || !cfg.token?.contractAddress) return 0;
  const now = Date.now();
  const cached = jettonBalanceCache.get(walletRaw);
  if (cached && now - cached.time < 25000) {
    return cached.balance;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const res = await fetch(
      `https://tonapi.io/v2/accounts/${encodeURIComponent(walletRaw)}/jettons/${encodeURIComponent(cfg.token.contractAddress)}`,
      { headers: { Accept: 'application/json' }, signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const rawBal = data.balance ? BigInt(data.balance) : 0n;
      const decimals = Number(cfg.token.decimals || 9);
      const divisor = 10n ** BigInt(decimals);
      const whole = rawBal / divisor;
      const rem = rawBal % divisor;
      const balance = Number(whole) + Number(rem) / 10 ** decimals;
      jettonBalanceCache.set(walletRaw, { balance, time: now });
      return balance;
    }
    if (res.status === 404) {
      jettonBalanceCache.set(walletRaw, { balance: 0, time: now });
      return 0;
    }
  } catch (_) {}
  return cached ? cached.balance : 0;
}

async function fetchRecentCreatorTransactions(cfg) {
  const now = Date.now();
  if (now - creatorTxCache.time < 20000) {
    return creatorTxCache.txs;
  }
  const creatorRaw =
    parseTonAddressToRaw(cfg.wallet?.creatorRawAddress) ||
    parseTonAddressToRaw(cfg.wallet?.creatorTonWallet);
  if (!creatorRaw) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const res = await fetch(
      `https://tonapi.io/v2/blockchain/accounts/${encodeURIComponent(creatorRaw)}/transactions?limit=50`,
      { headers: { Accept: 'application/json' }, signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const txs = Array.isArray(data.transactions) ? data.transactions : [];
      creatorTxCache = { time: now, txs };
      return txs;
    }
  } catch (_) {}
  return creatorTxCache.txs;
}

// Automatically detect if connected wallet sent 0.1 TON to creator wallet on-chain
async function tryAutoVerifyFromChain(cfg, user) {
  if (!user.walletRaw) return false;
  if (user.verifiedWallets && user.verifiedWallets[user.walletRaw]) {
    user.walletVerified = true;
    return false;
  }
  const feeTon = Number(cfg.wallet?.verificationFeeTon || 0.1);
  const minNano = Math.round(feeTon * 1e9 * 0.94); // allow minor network fwd fee tolerance around 0.1 TON
  const maxNano = Math.round(feeTon * 1e9 * 1.5); // distinguish 0.1 TON verification from 2-10 TON presale
  const txs = await fetchRecentCreatorTransactions(cfg);
  for (const tx of txs) {
    if (!tx || !tx.hash || !tx.in_msg) continue;
    const srcRaw = parseTonAddressToRaw(tx.in_msg.source?.address || tx.in_msg.source);
    const val = Number(tx.in_msg.value || 0);
    const refKey = `chain_${tx.hash}`;
    if (srcRaw === user.walletRaw && val >= minNano && val <= maxNano && !db.usedTxRefs[refKey]) {
      db.usedTxRefs[refKey] = { type: 'verify', userId: user.userId, at: Date.now() };
      if (!user.verifiedWallets) user.verifiedWallets = {};
      user.verifiedWallets[user.walletRaw] = {
        verifiedAt: (tx.utime ? tx.utime * 1000 : Date.now()),
        txRef: tx.hash,
        source: 'onchain-auto',
      };
      user.walletVerified = true;
      user.everVerifiedWallet = true;
      user.verifiedAt = Date.now();
      checkAndActivateReferral(cfg, user);
      saveDB();
      return true;
    }
  }
  return false;
}

// ================= USER MINING ACCRUAL, STATS & REFERRALS =================
function ensureUserSchema(u) {
  if (typeof u.balance !== 'number' || Number.isNaN(u.balance)) u.balance = 0;
  if (typeof u.onChainHolding !== 'number' || Number.isNaN(u.onChainHolding)) u.onChainHolding = 0;
  if (typeof u.totalMined !== 'number' || Number.isNaN(u.totalMined)) u.totalMined = 0;
  if (typeof u.accruedMined !== 'number' || Number.isNaN(u.accruedMined)) u.accruedMined = 0;
  if (typeof u.level !== 'number') u.level = 1;
  if (typeof u.peakLevel !== 'number') u.peakLevel = 1;
  if (!u.shiftStartedAt) u.shiftStartedAt = Date.now();
  if (!u.lastAccruedAt) u.lastAccruedAt = Date.now();

  // Normalize wallet fields (migrate old schema cleanly)
  if (u.walletAddress && !u.walletRaw) {
    const parsed = parseTonAddressToRaw(u.walletAddress);
    if (parsed) {
      u.walletRaw = parsed;
      u.walletFriendly = rawToFriendlyTon(parsed, false);
    } else {
      u.walletAddress = '';
    }
  }
  if (!u.walletRaw) {
    u.walletRaw = '';
    u.walletFriendly = '';
    u.walletAddress = '';
  } else if (!u.walletFriendly) {
    u.walletFriendly = rawToFriendlyTon(u.walletRaw, false);
    u.walletAddress = u.walletFriendly;
  }

  if (!u.verifiedWallets || typeof u.verifiedWallets !== 'object') u.verifiedWallets = {};
  if (u.walletVerified && u.walletRaw && !u.verifiedWallets[u.walletRaw]) {
    u.verifiedWallets[u.walletRaw] = { verifiedAt: u.verifiedAt || Date.now(), txRef: u.verificationTxBoc || 'legacy' };
  }
  u.walletVerified = Boolean(u.walletRaw && u.verifiedWallets[u.walletRaw]);
  u.everVerifiedWallet = Boolean(u.everVerifiedWallet || Object.keys(u.verifiedWallets).length > 0);

  // Daily check-in & repeatable daily channel missions
  if (typeof u.consecutiveCheckInDays !== 'number') u.consecutiveCheckInDays = 0;
  if (typeof u.maxConsecutiveCheckInDays !== 'number') u.maxConsecutiveCheckInDays = 0;
  if (typeof u.checkInCycleDay !== 'number') u.checkInCycleDay = 0;
  if (typeof u.lastCheckInUtc !== 'string') u.lastCheckInUtc = '';
  if (typeof u.qualified3DayStreak !== 'boolean') u.qualified3DayStreak = u.maxConsecutiveCheckInDays >= 3;
  if (!u.dailyMissionVisits || typeof u.dailyMissionVisits !== 'object') u.dailyMissionVisits = {};
  if (!u.dailyMissionClaims || typeof u.dailyMissionClaims !== 'object') u.dailyMissionClaims = {};

  // Referrals & Presale & Withdrawals
  if (!Array.isArray(u.referrals)) u.referrals = [];
  if (typeof u.referralBonusPaid !== 'boolean') u.referralBonusPaid = false;
  if (typeof u.referralCoinsEarned !== 'number') u.referralCoinsEarned = 0;
  if (typeof u.referralMiningEarned !== 'number') u.referralMiningEarned = 0;
  if (!Array.isArray(u.presalePurchases)) u.presalePurchases = [];
  if (!Array.isArray(u.withdrawals)) u.withdrawals = [];
}

function getCombinedHolding(user) {
  const inApp = Math.max(0, Number(user.balance || 0));
  const onChain = user.walletRaw ? Math.max(0, Number(user.onChainHolding || 0)) : 0;
  return {
    inAppHolding: inApp,
    onChainHolding: onChain,
    combinedHolding: +(inApp + onChain).toFixed(6),
  };
}

// Accrue passive mining up to `now` at the user's current level.
// Mining DOES NOT RUN if no TON wallet is connected!
function accruePendingMining(cfg, user, now = Date.now()) {
  ensureUserSchema(user);
  const shiftMs = (cfg.mining?.shiftDurationSeconds || 86400) * 1000;

  if (!user.walletRaw) {
    // Mining stopped while wallet is disconnected
    user.lastAccruedAt = now;
    if (!user.accruedMined || user.accruedMined <= 0) {
      user.shiftStartedAt = now;
    }
    return 0;
  }

  const { combinedHolding } = getCombinedHolding(user);
  const lvl = computeLevelFromHolding(combinedHolding);
  user.level = lvl;
  user.peakLevel = Math.max(user.peakLevel || 1, lvl);

  const shiftEnd = user.shiftStartedAt + shiftMs;
  const effectiveNow = Math.min(now, shiftEnd);
  if (effectiveNow > user.lastAccruedAt) {
    const dtSec = (effectiveNow - user.lastAccruedAt) / 1000;
    const coinsPerSec = dailyOutput(lvl) / 86400;
    user.accruedMined = +(user.accruedMined + dtSec * coinsPerSec).toFixed(8);
  }
  user.lastAccruedAt = now;
  return user.accruedMined;
}

// Active Referral rule:
// BOTH 1) 3 consecutive days of Daily Check-In AND 2) 0.1 TON Wallet Verification to creatorTonWallet
function isUserActiveReferral(u) {
  if (!u) return false;
  return Boolean(u.qualified3DayStreak && (u.walletVerified || u.everVerifiedWallet));
}

function checkAndActivateReferral(cfg, user) {
  ensureUserSchema(user);
  if (!user.referredBy || user.referralBonusPaid) return false;
  if (!isUserActiveReferral(user)) return false;

  const inviter = db.users[String(user.referredBy)];
  if (!inviter) return false;
  ensureUserSchema(inviter);

  // Prevent self-wallet gaming if both accounts linked the exact same wallet
  if (user.walletRaw && inviter.walletRaw && user.walletRaw === inviter.walletRaw) {
    return false;
  }

  accruePendingMining(cfg, inviter);
  const bonus = Number(cfg.referrals?.activeReferralBonusCoins || 200);
  user.referralBonusPaid = true;
  user.referralActivatedAt = Date.now();

  inviter.balance = +(inviter.balance + bonus).toFixed(6);
  inviter.referralCoinsEarned = +(inviter.referralCoinsEarned + bonus).toFixed(6);
  accruePendingMining(cfg, inviter);
  saveDB();

  notifyTelegramUser(
    cfg,
    inviter.userId,
    `🎉 *Referral Aktif Baru!*\n\nTeman Anda *${user.firstName || user.username}* telah menyelesaikan *Absensi 3 Hari Berturut-turut* & *Verifikasi Wallet*!\n💰 Anda mendapatkan bonus *+${bonus} ${cfg.token.symbol}* + komisi *10%* dari setiap klaim miningnya!`
  ).catch(() => {});

  return true;
}

function computeCheckInPreview(cfg, user) {
  const todayUtc = getUtcDateStr();
  const yesterdayUtc = getPrevUtcDateStr(todayUtc);
  const base = Number(cfg.missions?.checkInBaseCoins || 10);
  const step = Number(cfg.missions?.checkInStepCoins || 2);

  const checkedInToday = user.lastCheckInUtc === todayUtc;
  let activeCycleDay = 1;
  let currentStreak = user.consecutiveCheckInDays || 0;

  if (checkedInToday) {
    activeCycleDay = user.checkInCycleDay || 1;
  } else if (user.lastCheckInUtc === yesterdayUtc) {
    // Consecutive day! Day 1..7, and on Day 8 wraps back to Day 1 (10 coins) and repeats
    activeCycleDay = ((user.checkInCycleDay || 0) % 7) + 1;
  } else {
    // First time or missed a day -> resets to Day 1 (10 coins)
    activeCycleDay = 1;
    currentStreak = 0;
  }

  const days = [];
  for (let d = 1; d <= 7; d++) {
    const reward = base + (d - 1) * step;
    days.push({
      day: d,
      rewardCoins: reward,
      status: checkedInToday
        ? d <= activeCycleDay
          ? 'claimed'
          : 'upcoming'
        : d < activeCycleDay
        ? 'claimed'
        : d === activeCycleDay
        ? 'today'
        : 'upcoming',
    });
  }

  return {
    todayUtc,
    nextResetUtcMs: getNextUtcMidnightMs(),
    checkedInToday,
    activeCycleDay,
    todayRewardCoins: base + (activeCycleDay - 1) * step,
    consecutiveDays: currentStreak,
    maxConsecutiveDays: user.maxConsecutiveCheckInDays || 0,
    qualified3DayStreak: Boolean(user.qualified3DayStreak),
    days,
  };
}

function computeDailyChannelsStatus(cfg, user) {
  const todayUtc = getUtcDateStr();
  const list = Array.isArray(cfg.missions?.dailyChannels) ? cfg.missions.dailyChannels : [];
  return list.map((m) => ({
    ...m,
    visitedToday: user.dailyMissionVisits?.[m.id] === todayUtc,
    claimedToday: user.dailyMissionClaims?.[m.id] === todayUtc,
    resetAtUtcMs: getNextUtcMidnightMs(),
  }));
}

function computeReferralDetails(cfg, user) {
  const friends = (user.referrals || []).map((r) => {
    const f = db.users[String(r.userId)];
    if (!f) {
      return {
        userId: r.userId,
        name: r.name || 'Miner',
        joinedAt: r.joinedAt,
        streakDays: 0,
        has3DayStreak: false,
        walletVerified: false,
        isActive: false,
      };
    }
    ensureUserSchema(f);
    // Re-evaluate streak display if friend broke streak before reaching 3
    const todayUtc = getUtcDateStr();
    const yesterdayUtc = getPrevUtcDateStr(todayUtc);
    const liveStreak =
      f.lastCheckInUtc === todayUtc || f.lastCheckInUtc === yesterdayUtc
        ? f.consecutiveCheckInDays || 0
        : 0;
    const has3Day = Boolean(f.qualified3DayStreak);
    const verified = Boolean(f.walletVerified || f.everVerifiedWallet);
    return {
      userId: f.userId,
      name: f.firstName || f.username,
      joinedAt: r.joinedAt,
      streakDays: has3Day ? Math.max(3, liveStreak) : liveStreak,
      has3DayStreak: has3Day,
      walletVerified: verified,
      isActive: has3Day && verified,
    };
  });

  const activeFriends = friends.filter((f) => f.isActive);
  const pendingFriends = friends.filter((f) => !f.isActive);

  return {
    activeCount: activeFriends.length, // ONLY active referrals are counted!
    pendingCount: pendingFriends.length,
    totalInvitedRaw: friends.length,
    bonusCoinsEarned: +(user.referralCoinsEarned || 0).toFixed(2),
    miningCommissionEarned: +(user.referralMiningEarned || 0).toFixed(4),
    friends,
  };
}

function getOrCreateUser(cfg, { userId, username, firstName, refBy }) {
  const id = String(userId || 'guest_demo').trim();
  let isNew = false;

  if (!db.users[id]) {
    isNew = true;
    db.users[id] = {
      userId: id,
      username: username || `Miner_${id.slice(-4)}`,
      firstName: firstName || username || `Miner #${id.slice(-4)}`,
      balance: 0,
      onChainHolding: 0,
      totalMined: 0,
      accruedMined: 0,
      level: 1,
      peakLevel: 1,
      shiftStartedAt: Date.now(),
      lastAccruedAt: Date.now(),
      walletRaw: '',
      walletFriendly: '',
      walletAddress: '',
      walletAppName: '',
      walletVerified: false,
      everVerifiedWallet: false,
      verifiedWallets: {},
      verifiedAt: null,
      consecutiveCheckInDays: 0,
      maxConsecutiveCheckInDays: 0,
      checkInCycleDay: 0,
      lastCheckInUtc: '',
      qualified3DayStreak: false,
      dailyMissionVisits: {},
      dailyMissionClaims: {},
      referredBy: null,
      referralBonusPaid: false,
      referrals: [],
      referralCoinsEarned: 0,
      referralMiningEarned: 0,
      presalePurchases: [],
      withdrawals: [],
      createdAt: Date.now(),
    };
  } else {
    const u = db.users[id];
    if (username) u.username = username;
    if (firstName) u.firstName = firstName;
  }

  const user = db.users[id];
  ensureUserSchema(user);

  // Link referral on first creation (NO instant reward! Must complete 3-day check-in + 0.1 TON wallet verification!)
  if (isNew && refBy && String(refBy) !== id && db.users[String(refBy)]) {
    const inviter = db.users[String(refBy)];
    ensureUserSchema(inviter);
    const already = inviter.referrals.some((r) => String(r.userId) === id);
    if (!already) {
      user.referredBy = String(refBy);
      inviter.referrals.push({
        userId: id,
        name: user.firstName || user.username,
        joinedAt: Date.now(),
      });
    }
  }

  accruePendingMining(cfg, user);
  const holdings = getCombinedHolding(user);
  const isWalletConnected = Boolean(user.walletRaw);
  const unlockedLevel = computeLevelFromHolding(holdings.combinedHolding);
  user.level = unlockedLevel;
  if (isWalletConnected) {
    user.peakLevel = Math.max(user.peakLevel || 1, unlockedLevel);
  }

  const currentSpec = getLevelSpec(unlockedLevel);
  const nextSpec = unlockedLevel < MAX_LEVEL ? getLevelSpec(unlockedLevel + 1) : null;
  const shiftDurationSec = cfg.mining?.shiftDurationSeconds || 86400;
  const shiftEndsAt = user.shiftStartedAt + shiftDurationSec * 1000;

  const botUser = cfg.botUsername || 'MAXIMAMiningBot';
  const referralLink = cfg.botUsername
    ? `https://t.me/${botUser}?start=ref_${user.userId}`
    : `${cfg.publicAppUrl || `http://localhost:${cfg.port}`}/?ref=${user.userId}`;

  const walletPresaleTon = user.walletRaw
    ? Number(db.presale.walletTonSpent[user.walletRaw] || 0)
    : 0;

  saveDB();

  return {
    userId: user.userId,
    username: user.username,
    firstName: user.firstName,
    inAppHolding: holdings.inAppHolding,
    onChainHolding: holdings.onChainHolding,
    combinedHolding: holdings.combinedHolding,
    totalMined: +(user.totalMined || 0).toFixed(4),
    accruedMined: +(user.accruedMined || 0).toFixed(6),
    lastAccruedAt: user.lastAccruedAt,
    shiftStartedAt: user.shiftStartedAt,
    shiftEndsAt,
    isMiningActive: isWalletConnected,
    level: unlockedLevel,
    peakLevel: user.peakLevel || 1,
    currentLevelSpec: currentSpec,
    nextLevelSpec: nextSpec,
    activePowerThs: isWalletConnected ? currentSpec.powerThs : 0,
    activeDailyCoins: isWalletConnected ? currentSpec.dailyCoins : 0,
    activeCoinsPerSec: isWalletConnected ? currentSpec.dailyCoins / 86400 : 0,
    walletConnected: isWalletConnected,
    walletAddress: user.walletFriendly || '',
    walletRaw: user.walletRaw || '',
    walletAppName: user.walletAppName || '',
    walletVerified: Boolean(user.walletVerified),
    verifiedAt: user.verifiedAt,
    walletPresaleTonSpent: walletPresaleTon,
    walletPresaleTonRemaining: Math.max(0, (cfg.presale?.maxTonPerWallet || 10) - walletPresaleTon),
    checkIn: computeCheckInPreview(cfg, user),
    dailyChannels: computeDailyChannelsStatus(cfg, user),
    referralStats: computeReferralDetails(cfg, user),
    referredBy: user.referredBy,
    isSelfActiveReferral: isUserActiveReferral(user),
    referralLink,
    presalePurchases: user.presalePurchases || [],
    withdrawals: user.withdrawals || [],
  };
}

function getLeaderboard() {
  const all = Object.values(db.users).map((u) => {
    ensureUserSchema(u);
    const h = getCombinedHolding(u);
    const lvl = computeLevelFromHolding(h.combinedHolding);
    const spec = getLevelSpec(lvl);
    return {
      userId: u.userId,
      name: u.firstName || u.username,
      combinedHolding: h.combinedHolding,
      totalMined: +(u.totalMined || 0).toFixed(2),
      level: lvl,
      rankName: spec.rankName,
      zone: spec.zone,
      icon: spec.icon,
      powerThs: u.walletRaw ? spec.powerThs : 0,
    };
  });
  all.sort((a, b) => b.combinedHolding - a.combinedHolding || b.totalMined - a.totalMined);
  return all.slice(0, 15);
}

function buildSyncPayload(cfg, userView) {
  const maxPresaleCoins = cfg.presale?.maxTotalPresaleCoins || 20000000;
  const soldCoins = db.presale.totalCoinsSold || 0;
  const resolvedLogo = resolveAppLogoUrl(cfg);
  return {
    serverTime: Date.now(),
    user: userView,
    config: {
      appName: cfg.appName || 'MAXIMA MINING APP',
      wallet: cfg.wallet,
      token: {
        ...cfg.token,
        image: resolvedLogo,
      },
      mining: cfg.mining,
      missions: cfg.missions,
      referrals: cfg.referrals,
      presale: cfg.presale,
    },
    worldTiers: WORLD_TIERS,
    presaleState: {
      totalCoinsSold: soldCoins,
      totalCoinsRemaining: Math.max(0, maxPresaleCoins - soldCoins),
      maxTotalPresaleCoins: maxPresaleCoins,
      totalTonRaised: +(db.presale.totalTonRaised || 0).toFixed(2),
      progressPct: Math.min(100, +((soldCoins / maxPresaleCoins) * 100).toFixed(4)),
      endsAtMs: Date.parse(cfg.presale?.endsAt || '2026-11-05T23:59:59Z'),
    },
    leaderboard: getLeaderboard(),
  };
}

// ================= HTTP SERVER & REST API =================
function parseBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      if (raw.length < 1e6) raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_) {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const cfg = loadConfig();
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Healthcheck for Render / Railway Cloud Hosting
  if (req.method === 'GET' && pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, app: cfg.appName || 'MAXIMA MINING APP' });
  }

  // Telegram Bot Webhook Endpoint (Used automatically when deployed with HTTPS publicAppUrl)
  if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
    const update = await parseBody(req);
    if (cfg.botToken && update && typeof update === 'object') {
      handleTelegramUpdate(cfg, update).catch(() => {});
    }
    return sendJson(res, 200, { ok: true });
  }

  // Dynamic TON Connect Manifest
  if (pathname === '/tonconnect-manifest.json') {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const proto = forwardedProto === 'https' ? 'https' : 'http';
    const origin = (cfg.publicAppUrl || `${proto}://${req.headers.host || `localhost:${cfg.port}`}`).replace(/\/+$/, '');
    const logoUrl = resolveAppLogoUrl(cfg);
    const isLocalOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    const hasHttpsConfigImg = /^https:\/\//i.test(String(cfg.token?.image || ''));
    const fullIconUrl =
      isLocalOrigin && hasHttpsConfigImg
        ? cfg.token.image
        : logoUrl.startsWith('/')
        ? `${origin}${logoUrl}`
        : logoUrl;
    return sendJson(res, 200, {
      url: origin,
      name: cfg.appName || 'MAXIMA MINING APP',
      iconUrl: fullIconUrl,
    });
  }

  // Complete 1,000 Levels API
  if (req.method === 'GET' && pathname === '/api/levels') {
    return sendJson(res, 200, {
      ok: true,
      maxLevel: MAX_LEVEL,
      worldTiers: WORLD_TIERS,
      levels: getAll1000Levels(),
    });
  }

  // Jetton Contract Info Endpoint
  if (req.method === 'GET' && pathname === '/api/jetton/contract') {
    return sendJson(res, 200, {
      ok: true,
      data: {
        ...cfg.token,
        image: resolveAppLogoUrl(cfg),
      },
    });
  }

  // POST API Endpoints
  if (req.method === 'POST' && pathname.startsWith('/api/')) {
    const body = await parseBody(req);
    getOrCreateUser(cfg, body);
    const rawUser = db.users[String(body.userId || 'guest_demo').trim()];
    ensureUserSchema(rawUser);

    // Sync on-chain MAXIMA Jetton balance & check on-chain 0.1 TON verification if wallet connected
    if (rawUser.walletRaw) {
      const [onChainBal] = await Promise.all([
        fetchOnChainJettonBalance(cfg, rawUser.walletRaw),
        !rawUser.walletVerified ? tryAutoVerifyFromChain(cfg, rawUser) : Promise.resolve(false),
      ]);
      if (rawUser.onChainHolding !== onChainBal) {
        accruePendingMining(cfg, rawUser);
        rawUser.onChainHolding = onChainBal;
        saveDB();
      }
    }

    // 1. User Sync
    if (pathname === '/api/user/sync') {
      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, { ok: true, data: buildSyncPayload(cfg, view) });
    }

    // 2. Connect Personal TON Wallet (Strictly via TON Connect SDK - No manual paste!)
    if (pathname === '/api/wallet/connect') {
      const rawAddr = parseTonAddressToRaw(body.walletAddress);
      const appName = String(body.walletAppName || '').trim();
      if (!rawAddr || !appName) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Koneksi wallet tidak valid! Gunakan sistem koneksi otomatis TON Connect ke wallet pribadi.',
        });
      }

      accruePendingMining(cfg, rawUser);
      const wasDisconnected = !rawUser.walletRaw;
      rawUser.walletRaw = rawAddr;
      rawUser.walletFriendly = rawToFriendlyTon(rawAddr, false);
      rawUser.walletAddress = rawUser.walletFriendly;
      rawUser.walletAppName = appName;
      rawUser.walletVerified = Boolean(rawUser.verifiedWallets && rawUser.verifiedWallets[rawAddr]);

      const now = Date.now();
      if (wasDisconnected) {
        rawUser.lastAccruedAt = now;
        if (!rawUser.accruedMined || rawUser.accruedMined <= 0) {
          rawUser.shiftStartedAt = now;
        }
      }

      const onChainBal = await fetchOnChainJettonBalance(cfg, rawAddr);
      rawUser.onChainHolding = onChainBal;
      if (!rawUser.walletVerified) {
        await tryAutoVerifyFromChain(cfg, rawUser);
      }
      checkAndActivateReferral(cfg, rawUser);

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: `👛 Wallet ${appName} Terkoneksi! Mining Level ${view.level} (${view.activePowerThs} TH/s) Aktif.`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 3. Disconnect TON Wallet (Pauses mining immediately)
    if (pathname === '/api/wallet/disconnect') {
      accruePendingMining(cfg, rawUser);
      rawUser.walletRaw = '';
      rawUser.walletFriendly = '';
      rawUser.walletAddress = '';
      rawUser.walletAppName = '';
      rawUser.onChainHolding = 0;
      rawUser.walletVerified = false;
      saveDB();

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: '🔒 Wallet diputuskan. Mining berhenti hingga wallet pribadi dihubungkan kembali.',
        data: buildSyncPayload(cfg, view),
      });
    }

    // 4. Claim Mining Reward (Anytime once accrued >= 0.1 MAXIMA, requires connected wallet)
    if (pathname === '/api/mine/claim') {
      if (!rawUser.walletRaw) {
        return sendJson(res, 403, {
          ok: false,
          error: '🔒 Hubungkan wallet pribadi Anda terlebih dahulu agar mining berjalan & dapat diklaim!',
        });
      }

      const now = Date.now();
      accruePendingMining(cfg, rawUser, now);
      const minClaim = Number(cfg.mining?.minClaimCoins ?? 0.1);
      const pending = Number(rawUser.accruedMined || 0);

      if (pending + 1e-9 < minClaim) {
        return sendJson(res, 400, {
          ok: false,
          error: `Minimal klaim mining adalah ${minClaim} ${cfg.token.symbol} (Saat ini: ${pending.toFixed(4)} ${cfg.token.symbol}).`,
        });
      }

      const prevLevel = rawUser.level || 1;
      rawUser.balance = +(rawUser.balance + pending).toFixed(6);
      rawUser.totalMined = +(rawUser.totalMined + pending).toFixed(6);
      rawUser.accruedMined = 0;
      rawUser.shiftStartedAt = now;
      rawUser.lastAccruedAt = now;

      // +10% Mining Commission to Inviter ONLY if this user is an ACTIVE Referral (3-day check-in + 0.1 TON verified!)
      if (rawUser.referredBy && isUserActiveReferral(rawUser) && db.users[String(rawUser.referredBy)]) {
        const inviter = db.users[String(rawUser.referredBy)];
        ensureUserSchema(inviter);
        if (!inviter.walletRaw || inviter.walletRaw !== rawUser.walletRaw) {
          accruePendingMining(cfg, inviter, now);
          const pct = Number(cfg.referrals?.activeReferralMiningCommissionPct ?? 10);
          const comm = +((pending * pct) / 100).toFixed(6);
          if (comm > 0) {
            inviter.balance = +(inviter.balance + comm).toFixed(6);
            inviter.referralMiningEarned = +((inviter.referralMiningEarned || 0) + comm).toFixed(6);
            inviter.referralCoinsEarned = +((inviter.referralCoinsEarned || 0) + comm).toFixed(6);
          }
        }
      }

      const view = getOrCreateUser(cfg, body);
      const leveledUp = view.level > prevLevel;
      return sendJson(res, 200, {
        ok: true,
        leveledUp,
        claimedCoins: pending,
        message: leveledUp
          ? `🎉 Klaim +${pending.toFixed(3)} ${cfg.token.symbol} Berhasil! Naik ke Level ${view.level} (${view.activePowerThs} TH/s)!`
          : `⛏️ Berhasil klaim +${pending.toFixed(3)} ${cfg.token.symbol} ke saldo aplikasi!`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 5. Daily Check-In (7-Day Repeating Cycle: Day 1 = 10, +2/day up to Day 7 = 22, Day 8 resets to Day 1 = 10 & repeats!)
    if (pathname === '/api/missions/checkin') {
      const todayUtc = getUtcDateStr();
      const yesterdayUtc = getPrevUtcDateStr(todayUtc);

      if (rawUser.lastCheckInUtc === todayUtc) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Anda sudah melakukan Check-In hari ini! Reset berikutnya pukul 00:00 UTC.',
        });
      }

      accruePendingMining(cfg, rawUser);
      const prevLevel = rawUser.level || 1;

      if (rawUser.lastCheckInUtc === yesterdayUtc) {
        rawUser.consecutiveCheckInDays = (rawUser.consecutiveCheckInDays || 0) + 1;
        rawUser.checkInCycleDay = ((rawUser.checkInCycleDay || 0) % 7) + 1;
      } else {
        rawUser.consecutiveCheckInDays = 1;
        rawUser.checkInCycleDay = 1;
      }

      rawUser.lastCheckInUtc = todayUtc;
      rawUser.maxConsecutiveCheckInDays = Math.max(
        rawUser.maxConsecutiveCheckInDays || 0,
        rawUser.consecutiveCheckInDays
      );
      if (rawUser.consecutiveCheckInDays >= 3) {
        rawUser.qualified3DayStreak = true;
      }

      const base = Number(cfg.missions?.checkInBaseCoins || 10);
      const step = Number(cfg.missions?.checkInStepCoins || 2);
      const reward = base + (rawUser.checkInCycleDay - 1) * step;

      rawUser.balance = +(rawUser.balance + reward).toFixed(6);
      checkAndActivateReferral(cfg, rawUser);

      const view = getOrCreateUser(cfg, body);
      const leveledUp = view.level > prevLevel;
      return sendJson(res, 200, {
        ok: true,
        leveledUp,
        rewardCoins: reward,
        cycleDay: rawUser.checkInCycleDay,
        consecutiveDays: rawUser.consecutiveCheckInDays,
        message: `📅 Check-In Hari ke-${rawUser.checkInCycleDay} Berhasil! +${reward} ${cfg.token.symbol} (Streak: ${rawUser.consecutiveCheckInDays} hari)`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 6a. Visit Daily Repeatable Channel (@MAXIMAANN / @MAXIMAPAYOUT)
    if (pathname === '/api/missions/visit') {
      const missionId = String(body.missionId || '').trim();
      const mission = (cfg.missions?.dailyChannels || []).find((m) => m.id === missionId);
      if (!mission) {
        return sendJson(res, 400, { ok: false, error: 'Misi tidak ditemukan!' });
      }
      const todayUtc = getUtcDateStr();
      rawUser.dailyMissionVisits[missionId] = todayUtc;
      saveDB();
      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, { ok: true, data: buildSyncPayload(cfg, view) });
    }

    // 6b. Claim Daily Repeatable Channel Mission (+20 MAXIMA, resets daily at 00:00 UTC)
    if (pathname === '/api/missions/claim-daily') {
      const missionId = String(body.missionId || '').trim();
      const mission = (cfg.missions?.dailyChannels || []).find((m) => m.id === missionId);
      if (!mission) {
        return sendJson(res, 400, { ok: false, error: 'Misi tidak ditemukan!' });
      }

      const todayUtc = getUtcDateStr();
      if (rawUser.dailyMissionClaims[missionId] === todayUtc) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Hadiah misi ini sudah diklaim hari ini! Dapat diulang kembali setelah pukul 00:00 UTC.',
        });
      }
      if (rawUser.dailyMissionVisits[missionId] !== todayUtc) {
        return sendJson(res, 400, {
          ok: false,
          error: `Buka & bergabung ke channel ${mission.channelHandle} terlebih dahulu!`,
        });
      }

      // Optional Telegram Bot API membership verification when botToken is configured
      if (cfg.botToken && mission.channelHandle && /^\d+$/.test(String(rawUser.userId))) {
        const memberRes = await tgCall(cfg.botToken, 'getChatMember', {
          chat_id: mission.channelHandle,
          user_id: Number(rawUser.userId),
        }).catch(() => null);
        if (memberRes && memberRes.ok && memberRes.result) {
          const st = memberRes.result.status;
          if (st === 'left' || st === 'kicked') {
            return sendJson(res, 400, {
              ok: false,
              error: `Anda belum join channel ${mission.channelHandle}. Silakan Join terlebih dahulu!`,
            });
          }
        }
      }

      accruePendingMining(cfg, rawUser);
      const prevLevel = rawUser.level || 1;
      rawUser.dailyMissionClaims[missionId] = todayUtc;
      rawUser.balance = +(rawUser.balance + mission.rewardCoins).toFixed(6);

      const view = getOrCreateUser(cfg, body);
      const leveledUp = view.level > prevLevel;
      return sendJson(res, 200, {
        ok: true,
        leveledUp,
        message: `🎁 Misi ${mission.channelHandle} Selesai! +${mission.rewardCoins} ${cfg.token.symbol} (Reset harian 00:00 UTC)`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 7. Presale Purchase (2/4/6/8/10 TON -> 4K/8K/12K/16K/20K MAXIMA; Max 10 TON/wallet; Max 20,000,000 MAXIMA total)
    if (pathname === '/api/presale/buy') {
      if (!rawUser.walletRaw) {
        return sendJson(res, 403, {
          ok: false,
          error: '🔒 Hubungkan wallet pribadi Anda melalui TON Connect terlebih dahulu!',
        });
      }

      const presaleEndsAtMs = Date.parse(cfg.presale?.endsAt || '2026-11-05T23:59:59Z');
      if (Number.isFinite(presaleEndsAtMs) && Date.now() >= presaleEndsAtMs) {
        return sendJson(res, 400, {
          ok: false,
          error: '⏳ Waktu Presale MAXIMA telah berakhir (5 November 2026)!',
        });
      }

      const packageId = String(body.packageId || '').trim();
      const txBoc = String(body.txBoc || '').trim();
      const pkg = (cfg.presale?.packages || []).find((p) => p.id === packageId);
      if (!pkg) {
        return sendJson(res, 400, { ok: false, error: 'Paket presale tidak valid!' });
      }
      if (!txBoc || txBoc.length < 20) {
        return sendJson(res, 400, { ok: false, error: 'Bukti pembayaran transaksi TON (BOC) tidak valid!' });
      }

      const bocKey = `boc_${hashTxRef(txBoc)}`;
      if (db.usedTxRefs[bocKey]) {
        return sendJson(res, 400, { ok: false, error: 'Transaksi ini sudah pernah diproses!' });
      }

      const maxTonWallet = Number(cfg.presale?.maxTonPerWallet || 10);
      const maxTotalCoins = Number(cfg.presale?.maxTotalPresaleCoins || 20000000);
      const currentWalletTon = Number(db.presale.walletTonSpent[rawUser.walletRaw] || 0);

      if (currentWalletTon + pkg.ton > maxTonWallet + 1e-9) {
        return sendJson(res, 400, {
          ok: false,
          error: `Maksimal mengikuti presale adalah ${maxTonWallet} TON untuk 1 alamat wallet! Sisa kuota wallet ini: ${Math.max(0, maxTonWallet - currentWalletTon)} TON.`,
        });
      }

      if ((db.presale.totalCoinsSold || 0) + pkg.coins > maxTotalCoins) {
        return sendJson(res, 400, {
          ok: false,
          error: `Kuota total presale (${maxTotalCoins.toLocaleString('en-US')} ${cfg.token.symbol}) tidak mencukupi!`,
        });
      }

      accruePendingMining(cfg, rawUser);
      const prevLevel = rawUser.level || 1;

      db.usedTxRefs[bocKey] = { type: 'presale', userId: rawUser.userId, ton: pkg.ton, at: Date.now() };
      db.presale.walletTonSpent[rawUser.walletRaw] = +(currentWalletTon + pkg.ton).toFixed(4);
      db.presale.totalTonRaised = +((db.presale.totalTonRaised || 0) + pkg.ton).toFixed(4);
      db.presale.totalCoinsSold = (db.presale.totalCoinsSold || 0) + pkg.coins;

      rawUser.balance = +(rawUser.balance + pkg.coins).toFixed(6);

      const receipt = {
        id: `PS-${Date.now()}`,
        userId: rawUser.userId,
        walletAddress: rawUser.walletFriendly,
        tonPaid: pkg.ton,
        coinsReceived: pkg.coins,
        createdAt: Date.now(),
      };
      rawUser.presalePurchases.push(receipt);
      db.presale.purchases.push(receipt);

      notifyTelegramUser(
        cfg,
        rawUser.userId,
        `🚀 *Pembelian Presale Berhasil!*\n\n• *Dibayar:* ${pkg.ton} TON\n• *Koin Diterima:* +${pkg.coins.toLocaleString('en-US')} ${cfg.token.symbol}\n• *Kuota Wallet Terpakai:* ${db.presale.walletTonSpent[rawUser.walletRaw]} / ${maxTonWallet} TON`
      ).catch(() => {});

      const view = getOrCreateUser(cfg, body);
      const leveledUp = view.level > prevLevel;
      return sendJson(res, 200, {
        ok: true,
        leveledUp,
        message: leveledUp
          ? `🚀 Presale +${pkg.coins.toLocaleString('en-US')} ${cfg.token.symbol} Berhasil! Naik ke Level ${view.level} (${view.activePowerThs} TH/s)!`
          : `🚀 Presale +${pkg.coins.toLocaleString('en-US')} ${cfg.token.symbol} berhasil ditambahkan!`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 8. Wallet Verification (0.1 TON sent to UQDUe_P76bjHJ9EIUk8KLnFVRhbHf9_g7lJXHXgchYpZy4R1)
    if (pathname === '/api/wallet/verify') {
      if (!rawUser.walletRaw) {
        return sendJson(res, 400, { ok: false, error: 'Wallet belum terkoneksi!' });
      }
      const txBoc = String(body.txBoc || '').trim();
      if (!txBoc || txBoc.length < 20) {
        // Also try on-chain scan if user clicked "Check Verification" after sending 0.1 TON
        const foundOnChain = await tryAutoVerifyFromChain(cfg, rawUser);
        if (foundOnChain || rawUser.walletVerified) {
          const view = getOrCreateUser(cfg, body);
          return sendJson(res, 200, {
            ok: true,
            message: '✅ Pembayaran 0.1 TON terdeteksi on-chain! Wallet otomatis terverifikasi.',
            data: buildSyncPayload(cfg, view),
          });
        }
        return sendJson(res, 400, {
          ok: false,
          error: 'Transaksi verifikasi 0.1 TON belum ditemukan. Silakan kirim 0.1 TON melalui popup wallet!',
        });
      }

      const bocKey = `boc_${hashTxRef(txBoc)}`;
      if (db.usedTxRefs[bocKey]) {
        return sendJson(res, 400, { ok: false, error: 'Bukti transaksi ini sudah pernah digunakan!' });
      }

      db.usedTxRefs[bocKey] = { type: 'verify', userId: rawUser.userId, at: Date.now() };
      rawUser.verifiedWallets[rawUser.walletRaw] = {
        verifiedAt: Date.now(),
        txRef: bocKey.slice(0, 20),
        source: 'tonconnect',
      };
      rawUser.walletVerified = true;
      rawUser.everVerifiedWallet = true;
      rawUser.verifiedAt = Date.now();

      checkAndActivateReferral(cfg, rawUser);

      notifyTelegramUser(
        cfg,
        rawUser.userId,
        `✅ *Wallet Terverifikasi Otomatis!*\n\nPembayaran verifikasi *${cfg.wallet.verificationFeeTon} TON* berhasil dikonfirmasi. Fitur *Withdraw ${cfg.token.symbol}* kini aktif!`
      ).catch(() => {});

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: `✅ Verifikasi ${cfg.wallet.verificationFeeTon} TON Berhasil! Wallet Anda otomatis terverifikasi untuk Withdraw.`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 9. Withdraw MAXIMA Jetton (Requires Verified Wallet, Min 2,000 MAXIMA, Fee 100 MAXIMA)
    if (pathname === '/api/wallet/withdraw') {
      const amount = Number(body.amount || 0);
      const minW = Number(cfg.wallet?.minWithdrawCoins ?? 2000);
      const feeCoins = Number(cfg.wallet?.withdrawFeeCoins ?? 100);
      const feeTon = Number(cfg.wallet?.verificationFeeTon ?? 0.1);

      if (!rawUser.walletRaw) {
        return sendJson(res, 403, {
          ok: false,
          error: '🔒 Hubungkan wallet pribadi Anda melalui TON Connect terlebih dahulu!',
        });
      }
      if (!rawUser.walletVerified) {
        return sendJson(res, 403, {
          ok: false,
          error: `🛡️ Wajib melakukan verifikasi wallet (${feeTon} TON) terlebih dahulu sebelum melakukan Withdraw!`,
        });
      }
      if (!Number.isFinite(amount) || amount < minW) {
        return sendJson(res, 400, {
          ok: false,
          error: `Syarat minimal withdraw adalah ${minW.toLocaleString('en-US')} ${cfg.token.symbol}!`,
        });
      }
      if (rawUser.balance + 1e-9 < amount) {
        return sendJson(res, 400, {
          ok: false,
          error: `Saldo di dalam aplikasi tidak mencukupi (Tersedia: ${rawUser.balance.toFixed(2)} ${cfg.token.symbol}).`,
        });
      }

      accruePendingMining(cfg, rawUser);
      const netReceived = +(amount - feeCoins).toFixed(4);
      rawUser.balance = Math.max(0, +(rawUser.balance - amount).toFixed(6));

      const wdRecord = {
        id: `WD-${Date.now()}`,
        userId: rawUser.userId,
        username: rawUser.username,
        requestedAmount: amount,
        feeCoins,
        netAmount: netReceived,
        walletAddress: rawUser.walletFriendly,
        walletRaw: rawUser.walletRaw,
        contractAddress: cfg.token.contractAddress,
        status: 'QUEUED FOR ON-CHAIN PAYOUT',
        createdAt: Date.now(),
      };
      rawUser.withdrawals.push(wdRecord);
      db.withdrawals.push(wdRecord);

      notifyTelegramUser(
        cfg,
        rawUser.userId,
        `💸 *Permintaan Withdraw Diterima!*\n\n• *Jumlah Withdraw:* ${amount.toLocaleString('en-US')} ${cfg.token.symbol}\n• *Biaya (Fee):* -${feeCoins} ${cfg.token.symbol}\n• *Bersih Dikirim:* ${netReceived.toLocaleString('en-US')} ${cfg.token.symbol}\n• *Wallet Tujuan:* \`${rawUser.walletFriendly}\`\n• *Kontrak Jetton:* \`${cfg.token.contractAddress}\``
      ).catch(() => {});

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: `💸 Withdraw ${amount.toLocaleString('en-US')} ${cfg.token.symbol} diproses! (Fee: ${feeCoins} • Bersih: ${netReceived.toLocaleString('en-US')} ${cfg.token.symbol})`,
        data: buildSyncPayload(cfg, view),
      });
    }
  }

  // Static files from public/
  const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relPath);
  if (!filePath.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404);
  res.end('Not Found');
});

// ================= TELEGRAM BOT INTEGRATION =================
async function tgCall(token, method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function notifyTelegramUser(cfg, chatId, text) {
  if (!cfg.botToken || !chatId || !/^\d+$/.test(String(chatId))) return;
  await tgCall(cfg.botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
}

async function handleTelegramUpdate(cfg, u) {
  if (!u || !u.message || !u.message.text) return;

  const msg = u.message;
  const chatId = msg.chat.id;
  const from = msg.from || {};
  const text = msg.text.trim();

  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const refParam = parts[1] ? parts[1].replace(/^ref_/i, '') : '';
    const view = getOrCreateUser(cfg, {
      userId: from.id || chatId,
      username: from.username,
      firstName: from.first_name,
      refBy: refParam,
    });

    const sym = cfg.token.symbol;
    const cleanBaseUrl = String(cfg.publicAppUrl || '').trim().replace(/\/+$/, '');
    const isHttps = cleanBaseUrl.startsWith('https://');
    const appUrl = refParam
      ? `${cleanBaseUrl || `http://localhost:${cfg.port}`}?ref=${encodeURIComponent(refParam)}`
      : cleanBaseUrl || `http://localhost:${cfg.port}`;

    const keyboard = isHttps
      ? [
          [{ text: `⛏️ Open MAXIMA MINING APP`, web_app: { url: appUrl } }],
          [
            { text: `📢 @MAXIMAANN`, url: 'https://t.me/MAXIMAANN' },
            { text: `💸 @MAXIMAPAYOUT`, url: 'https://t.me/MAXIMAPAYOUT' },
          ],
        ]
      : [
          [
            { text: `📢 @MAXIMAANN`, url: 'https://t.me/MAXIMAANN' },
            { text: `💸 @MAXIMAPAYOUT`, url: 'https://t.me/MAXIMAPAYOUT' },
          ],
        ];

    await tgCall(cfg.botToken, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      text: [
        `⛏️ *Welcome to MAXIMA MINING APP!*`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `🪙 *Token:* ${sym} (TON Jetton)`,
        `📋 *Contract:* \`${cfg.token.contractAddress}\``,
        `👤 *Miner:* ${view.firstName}`,
        `🏆 *Road:* Level ${view.level} / 1,000 (${view.currentLevelSpec.rankName})`,
        `⚡ *Mining Power:* ${view.activePowerThs} TH/s (${view.activeDailyCoins} ${sym}/24h)`,
        `💼 *Combined Holding:* ${view.combinedHolding.toFixed(2)} ${sym}`,
        `  ├─ *In-App Holding:* ${view.inAppHolding.toFixed(2)} ${sym}`,
        `  └─ *On-Chain Wallet:* ${view.onChainHolding.toFixed(2)} ${sym}`,
        `👥 *Active Referrals:* ${view.referralStats.activeCount} (+200 ${sym}/aktif + 10% mining)`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `🔗 *Referral Link:*`,
        `\`${view.referralLink}\``,
      ].join('\n'),
      reply_markup: { inline_keyboard: keyboard },
    });
  } else if (text === '/contract' || text === '/token') {
    await tgCall(cfg.botToken, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: [
        `💎 *MAXIMA TON JETTON CONTRACT*`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `• *App:* MAXIMA MINING APP`,
        `• *Coin:* ${cfg.token.name} (${cfg.token.symbol})`,
        `• *Decimals:* ${cfg.token.decimals}`,
        `• *Contract Address:*`,
        `\`${cfg.token.contractAddress}\``,
        `• *Tonviewer:* ${cfg.token.explorerUrl}`,
      ].join('\n'),
    });
  }
}

async function startTelegramBotPolling(cfg) {
  if (!cfg.botToken) return;

  const me = await tgCall(cfg.botToken, 'getMe').catch(() => null);
  if (!me || !me.ok) {
    console.log('⚠️  [Telegram Bot] botToken belum diisi/valid. Mode Web App berjalan penuh.');
    return;
  }

  cfg.botUsername = me.result.username;
  saveBotUsernameToConfig(me.result.username);
  console.log(`🤖 [Telegram Bot] Aktif sebagai @${cfg.botUsername}`);

  const cleanPublicUrl = String(cfg.publicAppUrl || '').trim().replace(/\/+$/, '');
  if (cleanPublicUrl.startsWith('https://')) {
    await tgCall(cfg.botToken, 'setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: '⛏️ MAXIMA APP',
        web_app: { url: cleanPublicUrl },
      },
    }).catch(() => null);
    console.log(`📲 [Telegram Mini App] Menu Button otomatis terpasang ke ${cleanPublicUrl}`);

    const whUrl = `${cleanPublicUrl}/api/telegram/webhook`;
    const whRes = await tgCall(cfg.botToken, 'setWebhook', { url: whUrl }).catch(() => null);
    if (whRes && whRes.ok) {
      console.log(`🔗 [Telegram Webhook] Aktif pada ${whUrl}`);
      return;
    }
  } else {
    const whInfo = await tgCall(cfg.botToken, 'getWebhookInfo').catch(() => null);
    const activeWhUrl = whInfo && whInfo.ok && whInfo.result ? String(whInfo.result.url || '') : '';
    if (activeWhUrl.startsWith('https://')) {
      console.log(`🌐 [Telegram Bot] Cloud Webhook aktif di ${activeWhUrl} (server lokal tidak menimpa webhook cloud).`);
      return;
    }
  }

  await tgCall(cfg.botToken, 'deleteWebhook', { drop_pending_updates: false }).catch(() => null);

  let offset = 0;
  while (true) {
    try {
      const updates = await tgCall(cfg.botToken, 'getUpdates', { offset, timeout: 25 });
      if (updates && updates.ok && Array.isArray(updates.result)) {
        for (const u of updates.result) {
          offset = u.update_id + 1;
          await handleTelegramUpdate(cfg, u);
        }
      }
    } catch (_) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

const initialCfg = loadConfig();
const PORT = initialCfg.port || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('========================================================================================');
    console.log(`  ⛏️  ${initialCfg.appName} (${initialCfg.token.symbol} · 1,000 LEVELS) SERVER RUNNING!`);
    console.log('========================================================================================');
    console.log(`  🪙 TON Jetton Contract : ${initialCfg.token.contractAddress}`);
    console.log(`  🌐 Web / TMA URL       : ${initialCfg.publicAppUrl || `http://localhost:${PORT}`}`);
    console.log('========================================================================================');
    startTelegramBotPolling(initialCfg);
  });
}

module.exports = {
  server,
  db,
  requiredHolding,
  miningSpeed,
  dailyOutput,
  computeLevelFromHolding,
  parseTonAddressToRaw,
  rawToFriendlyTon,
};

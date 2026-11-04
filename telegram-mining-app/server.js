const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

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
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.VERCEL
  ? '/tmp/maxima-data'
  : path.join(__dirname, 'data');
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

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (_) {}

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
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    (process.env.SPACE_HOST ? `https://${process.env.SPACE_HOST}` : '') ||
    (process.env.KOYEB_PUBLIC_DOMAIN ? `https://${process.env.KOYEB_PUBLIC_DOMAIN}` : '') ||
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
    walletOwners: {},
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

// Enforce strict 1-Wallet-Per-Account across all users in DB & clean any legacy duplicate wallet links
function deduplicateWalletsInDB(base) {
  if (!base || typeof base !== 'object') return;
  if (!base.users || typeof base.users !== 'object') base.users = {};
  if (!base.walletOwners || typeof base.walletOwners !== 'object') base.walletOwners = {};
  const allWds = Array.isArray(base.withdrawals) ? base.withdrawals : [];
  const allPs = base.presale && Array.isArray(base.presale.purchases) ? base.presale.purchases : [];

  // Normalize wallet fields on each user first
  for (const u of Object.values(base.users)) {
    if (!u || typeof u !== 'object') continue;
    if (u.walletAddress && !u.walletRaw) {
      const parsed = parseTonAddressToRaw(u.walletAddress);
      if (parsed) {
        u.walletRaw = parsed;
        u.walletFriendly = rawToFriendlyTon(parsed, false);
      } else {
        u.walletAddress = '';
      }
    }
    if (u.walletRaw) {
      const cleanRaw = parseTonAddressToRaw(u.walletRaw);
      if (cleanRaw) {
        u.walletRaw = cleanRaw;
        u.walletFriendly = rawToFriendlyTon(cleanRaw, false);
        u.walletAddress = u.walletFriendly;
      } else {
        u.walletRaw = '';
        u.walletFriendly = '';
        u.walletAddress = '';
      }
    }
    if (!u.verifiedWallets || typeof u.verifiedWallets !== 'object') u.verifiedWallets = {};
  }

  // Group all users referencing each wallet address
  const candidatesByWallet = new Map();
  const addCandidate = (wRaw, u) => {
    const clean = parseTonAddressToRaw(wRaw);
    if (!clean || !u || !u.userId) return;
    if (!candidatesByWallet.has(clean)) candidatesByWallet.set(clean, new Map());
    candidatesByWallet.get(clean).set(String(u.userId).trim(), u);
  };

  for (const [wRaw, ownerUid] of Object.entries(base.walletOwners)) {
    const clean = parseTonAddressToRaw(wRaw);
    const u = base.users[String(ownerUid || '').trim()];
    if (clean && u) addCandidate(clean, u);
  }

  for (const u of Object.values(base.users)) {
    if (!u || !u.userId) continue;
    if (u.walletRaw) addCandidate(u.walletRaw, u);
    if (u.boundWalletRaw) addCandidate(u.boundWalletRaw, u);
    if (u.verifiedWallets && typeof u.verifiedWallets === 'object') {
      for (const wKey of Object.keys(u.verifiedWallets)) {
        addCandidate(wKey, u);
      }
    }
    if (Array.isArray(u.withdrawals)) {
      for (const wd of u.withdrawals) {
        if (wd) addCandidate(wd.walletRaw || wd.walletAddress, u);
      }
    }
    if (Array.isArray(u.presalePurchases)) {
      for (const p of u.presalePurchases) {
        if (p) addCandidate(p.walletAddress, u);
      }
    }
  }

  for (const wd of allWds) {
    if (!wd || !wd.userId) continue;
    const u = base.users[String(wd.userId).trim()];
    if (u) addCandidate(wd.walletRaw || wd.walletAddress, u);
  }

  for (const p of allPs) {
    if (!p || !p.userId) continue;
    const u = base.users[String(p.userId).trim()];
    if (u) addCandidate(p.walletAddress, u);
  }

  const newWalletOwners = {};

  for (const [wRaw, userMap] of candidatesByWallet.entries()) {
    const usersList = Array.from(userMap.values());
    if (!usersList.length) continue;

    // Score each candidate so the rightful original owner keeps the wallet
    const scored = usersList.map((u) => {
      const uid = String(u.userId).trim();
      const userWds = [
        ...(Array.isArray(u.withdrawals) ? u.withdrawals : []),
        ...allWds.filter((x) => x && String(x.userId).trim() === uid),
      ].filter((x) => x && (x.walletRaw === wRaw || parseTonAddressToRaw(x.walletAddress) === wRaw));

      const paidWds = userWds.filter((x) => String(x.status || '').toUpperCase().startsWith('PAID'));
      const earliestPaidWdAt = paidWds.length
        ? Math.min(...paidWds.map((x) => Number(x.createdAt || Infinity)))
        : Infinity;
      const earliestWdAt = userWds.length
        ? Math.min(...userWds.map((x) => Number(x.createdAt || Infinity)))
        : Infinity;

      const userPs = [
        ...(Array.isArray(u.presalePurchases) ? u.presalePurchases : []),
        ...allPs.filter((x) => x && String(x.userId).trim() === uid),
      ].filter((x) => x && parseTonAddressToRaw(x.walletAddress) === wRaw);
      const earliestPsAt = userPs.length
        ? Math.min(...userPs.map((x) => Number(x.createdAt || Infinity)))
        : Infinity;

      const verInfo = u.verifiedWallets && u.verifiedWallets[wRaw];
      const tonConnectVerifiedAt =
        verInfo && verInfo.source === 'tonconnect' ? Number(verInfo.verifiedAt || 1) : Infinity;
      const anyVerifiedAt = verInfo ? Number(verInfo.verifiedAt || 1) : Infinity;
      const isCurrentlyActive = u.walletRaw === wRaw;
      const connectedOrCreatedAt = Number(u.walletConnectedAt || u.verifiedAt || u.createdAt || Infinity);

      return {
        u,
        uid,
        earliestPaidWdAt,
        earliestWdAt,
        earliestPsAt,
        tonConnectVerifiedAt,
        anyVerifiedAt,
        isCurrentlyActive,
        connectedOrCreatedAt,
      };
    });

    scored.sort((a, b) => {
      if (a.earliestPaidWdAt !== b.earliestPaidWdAt) return a.earliestPaidWdAt - b.earliestPaidWdAt;
      if (a.earliestWdAt !== b.earliestWdAt) return a.earliestWdAt - b.earliestWdAt;
      if (a.earliestPsAt !== b.earliestPsAt) return a.earliestPsAt - b.earliestPsAt;
      if (a.tonConnectVerifiedAt !== b.tonConnectVerifiedAt) return a.tonConnectVerifiedAt - b.tonConnectVerifiedAt;
      if (a.anyVerifiedAt !== b.anyVerifiedAt) return a.anyVerifiedAt - b.anyVerifiedAt;
      if (a.isCurrentlyActive !== b.isCurrentlyActive) return a.isCurrentlyActive ? -1 : 1;
      if (a.connectedOrCreatedAt !== b.connectedOrCreatedAt) return a.connectedOrCreatedAt - b.connectedOrCreatedAt;
      return a.uid.localeCompare(b.uid);
    });

    const winner = scored[0];
    newWalletOwners[wRaw] = winner.uid;
    if (winner.u.walletRaw === wRaw && !winner.u.boundWalletRaw) {
      winner.u.boundWalletRaw = wRaw;
    }

    // Disconnect and strip this wallet from all secondary/duplicate accounts
    for (let i = 1; i < scored.length; i++) {
      const dup = scored[i].u;
      if (dup.walletRaw === wRaw) {
        dup.walletRaw = '';
        dup.walletFriendly = '';
        dup.walletAddress = '';
        dup.walletAppName = '';
        dup.onChainHolding = 0;
      }
      if (dup.boundWalletRaw === wRaw) {
        dup.boundWalletRaw = '';
      }
      if (dup.verifiedWallets && dup.verifiedWallets[wRaw]) {
        delete dup.verifiedWallets[wRaw];
      }
      dup.walletVerified = Boolean(dup.walletRaw && dup.verifiedWallets && dup.verifiedWallets[dup.walletRaw]);
      dup.everVerifiedWallet = Boolean(dup.verifiedWallets && Object.keys(dup.verifiedWallets).length > 0);
      if (!dup.everVerifiedWallet) {
        dup.verifiedAt = null;
      }
    }
  }

  base.walletOwners = newWalletOwners;
}

// Check if a raw TON wallet is already connected, verified, bound, or used by another Telegram account
function findWalletOwnerUserId(rawAddr, excludeUserId = null) {
  const cleanRaw = parseTonAddressToRaw(rawAddr);
  if (!cleanRaw) return null;
  const exId = excludeUserId !== null && excludeUserId !== undefined ? String(excludeUserId).trim() : null;

  if (!db.walletOwners || typeof db.walletOwners !== 'object') {
    db.walletOwners = {};
  }

  // 1. Check persistent walletOwners registry first
  const recordedOwner = db.walletOwners[cleanRaw];
  if (recordedOwner) {
    const recUid = String(recordedOwner).trim();
    if (db.users && db.users[recUid]) {
      if (!exId || recUid !== exId) return recUid;
    }
  }

  // 2. Scan all users for active walletRaw, boundWalletRaw, verifiedWallets, withdrawals, or presale
  for (const u of Object.values(db.users || {})) {
    if (!u || !u.userId) continue;
    const uid = String(u.userId).trim();
    if (exId && uid === exId) continue;

    if (u.walletRaw === cleanRaw || u.boundWalletRaw === cleanRaw) {
      db.walletOwners[cleanRaw] = uid;
      return uid;
    }
    if (u.verifiedWallets && u.verifiedWallets[cleanRaw]) {
      db.walletOwners[cleanRaw] = uid;
      return uid;
    }
    if (
      Array.isArray(u.withdrawals) &&
      u.withdrawals.some((w) => w && (w.walletRaw === cleanRaw || parseTonAddressToRaw(w.walletAddress) === cleanRaw))
    ) {
      db.walletOwners[cleanRaw] = uid;
      return uid;
    }
    if (
      Array.isArray(u.presalePurchases) &&
      u.presalePurchases.some((p) => p && parseTonAddressToRaw(p.walletAddress) === cleanRaw)
    ) {
      db.walletOwners[cleanRaw] = uid;
      return uid;
    }
  }

  // 3. Check global withdrawals array
  if (Array.isArray(db.withdrawals)) {
    const wdMatch = db.withdrawals.find(
      (w) =>
        w &&
        w.userId &&
        (!exId || String(w.userId).trim() !== exId) &&
        (w.walletRaw === cleanRaw || parseTonAddressToRaw(w.walletAddress) === cleanRaw)
    );
    if (wdMatch) {
      const uid = String(wdMatch.userId).trim();
      db.walletOwners[cleanRaw] = uid;
      return uid;
    }
  }

  return null;
}

function normalizeParsedDB(parsed) {
  const base = parsed && typeof parsed === 'object' ? parsed : createEmptyDB();
  if (!base.schemaVersion) base.schemaVersion = 2;
  if (!base.users || typeof base.users !== 'object') base.users = {};
  if (!base.walletOwners || typeof base.walletOwners !== 'object') base.walletOwners = {};
  if (!Array.isArray(base.withdrawals)) base.withdrawals = [];
  if (!base.usedTxRefs || typeof base.usedTxRefs !== 'object') base.usedTxRefs = {};
  if (!base.presale || typeof base.presale !== 'object') {
    base.presale = {
      totalCoinsSold: 0,
      totalTonRaised: 0,
      walletTonSpent: {},
      purchases: [],
    };
  }
  if (!base.presale.walletTonSpent || typeof base.presale.walletTonSpent !== 'object') {
    base.presale.walletTonSpent = {};
  }
  if (!Array.isArray(base.presale.purchases)) base.presale.purchases = [];
  deduplicateWalletsInDB(base);
  return base;
}

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const rawStr = fs.readFileSync(DB_PATH, 'utf8');
      const parsed = normalizeParsedDB(JSON.parse(rawStr));
      const nextStr = JSON.stringify(parsed, null, 2);
      if (nextStr !== rawStr) {
        try {
          fs.writeFileSync(DB_PATH, nextStr, 'utf8');
        } catch (_) {}
      }
      return parsed;
    }
  } catch (_) {}
  return createEmptyDB();
}

const db = loadDB();

// ================= FREE PERMANENT CLOUD DB (UPSTASH REDIS REST API) =================
const CLOUD_DB_KEY = process.env.CLOUD_DB_KEY || 'maxima_mining_db_v2';
let cloudDbLoaded = false;
let cloudLoadInFlight = null;
let cloudFlushPromise = null;
let cloudFlushPendingAgain = false;
let cloudDebounceTimer = null;
let lastCloudJson = '';
let lastCloudPingAt = 0;
let lastCloudErrorAt = 0;
let lastCloudWriteAt = 0;

function getUpstashCreds() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\/+$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!url || !token || !/^https?:\/\//i.test(url)) return null;
  return { url, token };
}

async function upstashCommand(creds, cmdArray) {
  const r = await fetch(creds.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmdArray),
  });
  if (!r.ok) {
    throw new Error(`Upstash HTTP ${r.status}`);
  }
  const data = await r.json();
  if (data && Object.prototype.hasOwnProperty.call(data, 'error') && data.error) {
    throw new Error(String(data.error));
  }
  return data;
}

async function ensureCloudDBLoaded() {
  const creds = getUpstashCreds();
  if (!creds || cloudDbLoaded) return;
  if (cloudLoadInFlight) return cloudLoadInFlight;

  cloudLoadInFlight = (async () => {
    try {
      const data = await upstashCommand(creds, ['GET', CLOUD_DB_KEY]);
      lastCloudPingAt = Date.now();
      if (data && typeof data.result === 'string' && data.result.trim().startsWith('{')) {
        const parsed = normalizeParsedDB(JSON.parse(data.result));
        db.schemaVersion = parsed.schemaVersion;
        db.users = parsed.users;
        db.walletOwners = parsed.walletOwners || {};
        db.withdrawals = parsed.withdrawals;
        db.usedTxRefs = parsed.usedTxRefs;
        db.presale = parsed.presale;
        const normalizedSnap = JSON.stringify(db);
        lastCloudJson = data.result;
        cloudDbLoaded = true;
        try {
          fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
        } catch (_) {}
        if (normalizedSnap !== data.result) {
          await flushCloudDB().catch(() => {});
        }
        console.log(`☁️  [Cloud DB] Loaded ${Object.keys(db.users).length} permanent member accounts from Upstash!`);
      } else if (data && data.result === null) {
        cloudDbLoaded = true;
        await flushCloudDB();
        console.log('☁️  [Cloud DB] Upstash Redis connected & permanent database initialized!');
      }
    } catch (err) {
      console.warn('⚠️  [Cloud DB] Failed to load from Upstash Redis (will retry automatically):', err.message);
    } finally {
      cloudLoadInFlight = null;
    }
  })();

  return cloudLoadInFlight;
}

async function flushCloudDB() {
  if (cloudDebounceTimer) {
    clearTimeout(cloudDebounceTimer);
    cloudDebounceTimer = null;
  }
  const creds = getUpstashCreds();
  if (!creds) return;
  if (!cloudDbLoaded) {
    await ensureCloudDBLoaded();
    if (!cloudDbLoaded) return;
  }

  if (cloudFlushPromise) {
    cloudFlushPendingAgain = true;
    return cloudFlushPromise;
  }

  cloudFlushPromise = (async () => {
    do {
      cloudFlushPendingAgain = false;
      const snapshot = JSON.stringify(db);
      if (snapshot === lastCloudJson) break;
      try {
        const res = await upstashCommand(creds, ['SET', CLOUD_DB_KEY, snapshot]);
        if (res && res.result === 'OK') {
          lastCloudJson = snapshot;
          lastCloudPingAt = Date.now();
        }
      } catch (err) {
        console.warn('⚠️  [Cloud DB] Failed to save to Upstash Redis:', err.message);
        break;
      }
    } while (cloudFlushPendingAgain);
  })().finally(() => {
    cloudFlushPromise = null;
  });

  return cloudFlushPromise;
}

function saveDB(immediateCloud = false) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (_) {}

  const creds = getUpstashCreds();
  if (!creds || !cloudDbLoaded) return;

  if (immediateCloud) {
    flushCloudDB().catch(() => {});
  } else if (!cloudDebounceTimer) {
    cloudDebounceTimer = setTimeout(() => {
      cloudDebounceTimer = null;
      flushCloudDB().catch(() => {});
    }, 30000);
    if (cloudDebounceTimer.unref) cloudDebounceTimer.unref();
  }
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

function signBrowserAuth(cfg, userId) {
  const secret = String(cfg?.botToken || 'maxima_mining_browser_handoff_v2');
  return crypto
    .createHmac('sha256', secret)
    .update(`maxima_tg_${String(userId || '')}`)
    .digest('hex')
    .slice(0, 24);
}

function buildBrowserConnectUrl(cfg, user) {
  const cleanBase = String(cfg.publicAppUrl || `http://localhost:${cfg.port || 3000}`)
    .trim()
    .replace(/\/+$/, '');
  const uid = String(user.userId || '');
  const sig = signBrowserAuth(cfg, uid);
  const params = new URLSearchParams({
    tg_uid: uid,
    tg_un: String(user.username || ''),
    tg_fn: String(user.firstName || ''),
    tg_sig: sig,
  });
  return `${cleanBase}/?${params.toString()}`;
}

function buildAdminPanelUrl(cfg, adminUserId) {
  const cleanBase = String(cfg.publicAppUrl || `http://localhost:${cfg.port || 3000}`)
    .trim()
    .replace(/\/+$/, '');
  const uid = String(adminUserId || (cfg.admin && cfg.admin.telegramIds && cfg.admin.telegramIds[0]) || '8464908276');
  const sig = signBrowserAuth(cfg, uid);
  const params = new URLSearchParams({
    tg_uid: uid,
    tg_un: 'admin',
    tg_fn: 'Admin',
    tg_sig: sig,
    admin_wd: '1',
  });
  return `${cleanBase}/?${params.toString()}`;
}

// Pure-JS TEP-74 Jetton Transfer BOC Builder (op 0x0f8a7ea5 + forward_ton_amount=1n + inline TextComment memo)
function buildJettonTransferBocBase64({
  queryId,
  jettonAmountNano,
  destinationRaw,
  responseDestinationRaw,
  memo = 'MAXIMA PAYOUT',
}) {
  let bits = '';
  const writeUint = (val, bitCount) => {
    const v = BigInt(val);
    for (let i = bitCount - 1; i >= 0; i--) {
      bits += ((v >> BigInt(i)) & 1n) === 1n ? '1' : '0';
    }
  };
  const writeBytes = (buf) => {
    for (let i = 0; i < buf.length; i++) {
      bits += buf[i].toString(2).padStart(8, '0');
    }
  };
  const writeCoins = (val) => {
    const v = BigInt(val);
    if (v <= 0n) {
      writeUint(0n, 4);
      return;
    }
    let hex = v.toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    const len = hex.length / 2;
    writeUint(BigInt(len), 4);
    writeBytes(Buffer.from(hex, 'hex'));
  };
  const writeAddress = (rawAddr) => {
    const clean = parseTonAddressToRaw(rawAddr);
    if (!clean) throw new Error(`Invalid TON address: ${rawAddr}`);
    const [wcStr, hashHex] = clean.split(':');
    let wc = parseInt(wcStr, 10);
    if (wc < 0) wc = 256 + wc;
    writeUint(2n, 2); // addr_std$10
    writeUint(0n, 1); // anycast:(Maybe Anycast) = 0
    writeUint(BigInt(wc), 8);
    writeBytes(Buffer.from(hashHex, 'hex'));
  };

  const qid = queryId !== undefined ? BigInt(queryId) : BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const cleanMemo = String(memo || 'MAXIMA PAYOUT').trim() || 'MAXIMA PAYOUT';
  const memoBuf = Buffer.from(cleanMemo, 'utf8').subarray(0, 36);

  writeUint(0x0f8a7ea5n, 32); // op = transfer#0f8a7ea5
  writeUint(qid, 64); // query_id:uint64
  writeCoins(BigInt(jettonAmountNano)); // amount:(VarUInteger 16)
  writeAddress(destinationRaw); // destination:MsgAddress
  writeAddress(responseDestinationRaw || destinationRaw); // response_destination:MsgAddress
  writeUint(0n, 1); // custom_payload:(Maybe ^Cell) = 0
  writeCoins(1n); // forward_ton_amount:(VarUInteger 16) = 1 nanoTON (triggers notification with memo)
  writeUint(0n, 1); // forward_payload:(Either Cell ^Cell) = 0 (inline Cell)
  writeUint(0n, 32); // TextComment op = 0x00000000
  writeBytes(memoBuf); // UTF-8 memo bytes ("MAXIMA PAYOUT")

  const bitLen = bits.length;
  const fullBytes = Math.floor(bitLen / 8);
  const dataByteLen = Math.ceil(bitLen / 8);
  const d1 = 0; // 0 refs, ordinary cell
  const d2 = fullBytes + dataByteLen;

  let paddedBits = bits;
  if (bitLen % 8 !== 0) {
    paddedBits += '1';
    while (paddedBits.length % 8 !== 0) paddedBits += '0';
  }

  const cellData = Buffer.alloc(dataByteLen);
  for (let i = 0; i < dataByteLen; i++) {
    cellData[i] = parseInt(paddedBits.slice(i * 8, i * 8 + 8), 2);
  }

  const totCellsSize = 2 + dataByteLen;
  const header = Buffer.from([
    0xb5, 0xee, 0x9c, 0x72, // serialized_boc#b5ee9c72
    0x01, // flags=0, size_bytes=1
    0x01, // off_bytes=1
    0x01, // cells=1
    0x01, // roots=1
    0x00, // absent=0
    totCellsSize, // tot_cells_size
    0x00, // root_list=[0]
    d1,
    d2,
  ]);

  return Buffer.concat([header, cellData]).toString('base64');
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
let creatorTxCache = { time: 0, txs: [], fetchedOnce: false };
let creatorTxInFlight = null;

function buildTonApiHeaders() {
  const headers = { Accept: 'application/json' };
  const apiKey = String(process.env.TONAPI_KEY || '').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function fetchOnChainJettonBalance(cfg, walletRaw) {
  const rawWallet = parseTonAddressToRaw(walletRaw);
  const rawContract =
    parseTonAddressToRaw(cfg.token?.rawAddress) ||
    parseTonAddressToRaw(cfg.token?.contractAddress);
  if (!rawWallet || !rawContract) return null;

  const now = Date.now();
  const cached = jettonBalanceCache.get(rawWallet);
  if (cached && now - cached.time < 25000) {
    return cached.balance;
  }

  const parseRawAmount = (rawAmount, dec) => {
    const rawBal = rawAmount ? BigInt(String(rawAmount)) : 0n;
    const decimals = Number(dec ?? cfg.token?.decimals ?? 9);
    const divisor = 10n ** BigInt(decimals);
    const whole = rawBal / divisor;
    const rem = rawBal % divisor;
    return Number(whole) + Number(rem) / 10 ** decimals;
  };

  // 1. Primary: TonAPI v2 (menggunakan Raw Address untuk wallet & contract)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(
      `https://tonapi.io/v2/accounts/${encodeURIComponent(rawWallet)}/jettons/${encodeURIComponent(rawContract)}`,
      { headers: buildTonApiHeaders(), signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const balance = parseRawAmount(data.balance, data.jetton?.decimals);
      jettonBalanceCache.set(rawWallet, { balance, time: now });
      return balance;
    }
    if (res.status === 404) {
      jettonBalanceCache.set(rawWallet, { balance: 0, time: now });
      return 0;
    }
  } catch (_) {}

  // 2. Fallback Otomatis: Toncenter API v3 (jika TonAPI terkena rate-limit 429 di Render)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(
      `https://toncenter.com/api/v3/jetton/wallets?owner_address=${encodeURIComponent(rawWallet)}&jetton_address=${encodeURIComponent(rawContract)}&limit=5`,
      { headers: { Accept: 'application/json' }, signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const wallets = Array.isArray(data.jetton_wallets) ? data.jetton_wallets : [];
      let totalRaw = 0n;
      for (const w of wallets) {
        if (w && w.balance) totalRaw += BigInt(String(w.balance));
      }
      const balance = parseRawAmount(totalRaw.toString(), cfg.token?.decimals);
      jettonBalanceCache.set(rawWallet, { balance, time: now });
      return balance;
    }
  } catch (_) {}

  return cached ? cached.balance : null;
}

const jettonWalletAddrCache = new Map();
const KNOWN_CREATOR_RAW = '0:d47bf3fbe9b8c727d108524f0a2e71554616c77fdfe0ee52571d781c858a59cb';
const KNOWN_CREATOR_JETTON_WALLET_RAW = '0:d42c46fe3257dc2dd8dde9e06784abe12722429805d3c8835a6b77143a8b4f47';

async function resolveOwnerJettonWalletAddress(cfg, ownerWalletRaw) {
  const rawWallet = parseTonAddressToRaw(ownerWalletRaw);
  const rawContract =
    parseTonAddressToRaw(cfg.token?.rawAddress) ||
    parseTonAddressToRaw(cfg.token?.contractAddress);
  if (!rawWallet || !rawContract) return null;

  const cacheKey = `${rawWallet}_${rawContract}`;
  const cached = jettonWalletAddrCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 10 * 60 * 1000) {
    return cached;
  }

  // 1. Primary: TonAPI v2
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(
      `https://tonapi.io/v2/accounts/${encodeURIComponent(rawWallet)}/jettons/${encodeURIComponent(rawContract)}`,
      { headers: buildTonApiHeaders(), signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const jwRaw = parseTonAddressToRaw(data.wallet_address?.address || data.wallet_address);
      if (jwRaw) {
        const result = {
          raw: jwRaw,
          friendlyBounceable: rawToFriendlyTon(jwRaw, true),
          time: Date.now(),
        };
        jettonWalletAddrCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (_) {}

  // 2. Fallback: Toncenter API v3
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(
      `https://toncenter.com/api/v3/jetton/wallets?owner_address=${encodeURIComponent(rawWallet)}&jetton_address=${encodeURIComponent(rawContract)}&limit=5`,
      { headers: { Accept: 'application/json' }, signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const first = Array.isArray(data.jetton_wallets) ? data.jetton_wallets[0] : null;
      const jwRaw = parseTonAddressToRaw(first && first.address);
      if (jwRaw) {
        const result = {
          raw: jwRaw,
          friendlyBounceable: rawToFriendlyTon(jwRaw, true),
          time: Date.now(),
        };
        jettonWalletAddrCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (_) {}

  // 3. Built-in fallback for official creator wallet
  if (rawWallet === KNOWN_CREATOR_RAW) {
    const result = {
      raw: KNOWN_CREATOR_JETTON_WALLET_RAW,
      friendlyBounceable: rawToFriendlyTon(KNOWN_CREATOR_JETTON_WALLET_RAW, true),
      time: Date.now(),
    };
    jettonWalletAddrCache.set(cacheKey, result);
    return result;
  }

  return cached || null;
}

async function fetchRecentCreatorTransactions(cfg, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && creatorTxCache.fetchedOnce && now - creatorTxCache.time < 30000) {
    return creatorTxCache.txs;
  }
  if (creatorTxInFlight && !forceRefresh) {
    return creatorTxInFlight;
  }
  const creatorRaw =
    parseTonAddressToRaw(cfg.wallet?.creatorRawAddress) ||
    parseTonAddressToRaw(cfg.wallet?.creatorTonWallet);
  if (!creatorRaw) return [];

  creatorTxInFlight = (async () => {
    try {
      const allTxs = [];
      let beforeLt = '';
      const maxPages = creatorTxCache.fetchedOnce ? 1 : 4;
      for (let page = 0; page < maxPages; page++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const ltQuery = beforeLt ? `&before_lt=${encodeURIComponent(beforeLt)}` : '';
        const res = await fetch(
          `https://tonapi.io/v2/blockchain/accounts/${encodeURIComponent(creatorRaw)}/transactions?limit=100${ltQuery}`,
          { headers: buildTonApiHeaders(), signal: ctrl.signal }
        );
        clearTimeout(timer);
        if (!res.ok) break;
        const data = await res.json();
        const batch = Array.isArray(data.transactions) ? data.transactions : [];
        if (!batch.length) break;
        allTxs.push(...batch);
        beforeLt = batch[batch.length - 1].lt;
        if (batch.length < 100) break;
      }
      if (allTxs.length) {
        if (creatorTxCache.fetchedOnce && creatorTxCache.txs.length > allTxs.length) {
          const seen = new Set(allTxs.map((t) => t && t.hash));
          for (const oldTx of creatorTxCache.txs) {
            if (oldTx && oldTx.hash && !seen.has(oldTx.hash)) allTxs.push(oldTx);
          }
        }
        creatorTxCache = { time: Date.now(), txs: allTxs, fetchedOnce: true };
        return allTxs;
      }
    } catch (_) {}
    return creatorTxCache.txs;
  })().finally(() => {
    creatorTxInFlight = null;
  });

  return creatorTxInFlight;
}

// Automatically detect if connected wallet sent 0.1 TON to creator wallet on-chain
async function tryAutoVerifyFromChain(cfg, user, forceRefresh = false) {
  if (!user.walletRaw) return false;
  // Strictly block auto-verification if this wallet belongs to another Telegram account
  if (findWalletOwnerUserId(user.walletRaw, user.userId)) {
    return false;
  }
  if (user.verifiedWallets && user.verifiedWallets[user.walletRaw]) {
    user.walletVerified = true;
    return false;
  }
  const feeTon = Number(cfg.wallet?.verificationFeeTon || 0.1);
  const minNano = Math.round(feeTon * 1e9 * 0.85); // allow network fwd/gas fee tolerance around 0.1 TON
  const maxNano = Math.round(feeTon * 1e9 * 5.0); // distinguish 0.1 TON verification from 2-100 TON presale
  const txs = await fetchRecentCreatorTransactions(cfg, forceRefresh);
  for (const tx of txs) {
    if (!tx || !tx.hash || !tx.in_msg) continue;
    const srcRaw = parseTonAddressToRaw(tx.in_msg.source?.address || tx.in_msg.source);
    const val = Number(tx.in_msg.value || 0);
    const refKey = `chain_${tx.hash}`;
    if (srcRaw === user.walletRaw && val >= minNano && val <= maxNano && !db.usedTxRefs[refKey]) {
      // Never reuse a verification tx if this wallet was already verified by another user
      if (findWalletOwnerUserId(srcRaw, user.userId)) continue;
      const txTimeMs = tx.utime ? tx.utime * 1000 : Date.now();
      const isRecentTx = Date.now() - txTimeMs < 30 * 60 * 1000;
      db.usedTxRefs[refKey] = { type: 'verify', userId: user.userId, walletRaw: user.walletRaw, at: txTimeMs };
      if (!user.verifiedWallets) user.verifiedWallets = {};
      user.verifiedWallets[user.walletRaw] = {
        verifiedAt: txTimeMs,
        txRef: tx.hash,
        source: 'onchain-auto',
      };
      user.walletVerified = true;
      user.everVerifiedWallet = true;
      user.verifiedAt = txTimeMs;
      if (!db.walletOwners || typeof db.walletOwners !== 'object') db.walletOwners = {};
      db.walletOwners[user.walletRaw] = String(user.userId);
      user.boundWalletRaw = user.walletRaw;
      checkAndActivateReferral(cfg, user);
      saveDB(true);
      if (isRecentTx) {
        notifyTelegramUser(
          cfg,
          user.userId,
          `✅ *Wallet Automatically Verified (On-Chain)!*\n\nYour *${feeTon} GRAM* verification payment was detected on-chain. *Withdraw ${cfg.token.symbol}* is now unlocked!`
        ).catch(() => {});
        notifyAdminsWalletVerified(cfg, user).catch(() => {});
      }
      return true;
    }
  }
  return false;
}

// Automatically detect if connected wallet sent 2, 4, 6, 8, 10, 20, or 100 TON for Presale on-chain
async function tryAutoPresaleFromChain(cfg, user, forceRefresh = false) {
  if (!user.walletRaw) return null;
  const ownerOfWallet = findWalletOwnerUserId(user.walletRaw, user.userId);
  if (ownerOfWallet) return null;
  const presaleEndsAtMs = Date.parse(cfg.presale?.endsAt || '2026-11-10T23:59:59Z');
  if (Number.isFinite(presaleEndsAtMs) && Date.now() >= presaleEndsAtMs) return null;

  const packages = Array.isArray(cfg.presale?.packages) ? cfg.presale.packages : [];
  if (!packages.length) return null;

  const maxTonWallet = Number(cfg.presale?.maxTonPerWallet || 100);
  const maxTotalCoins = Number(cfg.presale?.maxTotalPresaleCoins || 20000000);
  const txs = await fetchRecentCreatorTransactions(cfg, forceRefresh);

  let creditedPkg = null;

  for (const tx of txs) {
    if (!tx || !tx.hash || !tx.in_msg) continue;
    const srcRaw = parseTonAddressToRaw(tx.in_msg.source?.address || tx.in_msg.source);
    if (srcRaw !== user.walletRaw) continue;

    const refKey = `chain_ps_${tx.hash}`;
    if (db.usedTxRefs[refKey]) continue;

    const valNano = Number(tx.in_msg.value || 0);
    if (valNano < 1.85 * 1e9) continue;

    const matchedPkg = packages.find((p) => {
      const targetNano = p.ton * 1e9;
      return Math.abs(valNano - targetNano) <= targetNano * 0.04;
    });
    if (!matchedPkg) continue;

    const txTimeMs = tx.utime ? tx.utime * 1000 : Date.now();
    ensureUserSchema(user);

    // Check if this transaction was already credited via immediate TON Connect BOC within 60 minutes (across user & global presale receipts)
    const allReceipts = [
      ...(user.presalePurchases || []),
      ...((db.presale && Array.isArray(db.presale.purchases)) ? db.presale.purchases : []),
    ];
    const existingBocReceipt = allReceipts.find(
      (p) =>
        p &&
        Number(p.tonPaid) === Number(matchedPkg.ton) &&
        !p.txHash &&
        (String(p.userId) === String(user.userId) || parseTonAddressToRaw(p.walletAddress) === user.walletRaw) &&
        Math.abs(Number(p.createdAt || 0) - txTimeMs) < 60 * 60 * 1000
    );
    if (existingBocReceipt) {
      existingBocReceipt.txHash = tx.hash;
      db.usedTxRefs[refKey] = {
        type: 'presale',
        userId: existingBocReceipt.userId || user.userId,
        ton: matchedPkg.ton,
        at: txTimeMs,
        linkedReceipt: existingBocReceipt.id,
      };
      saveDB(true);
      continue;
    }

    const currentWalletTon = Number(db.presale.walletTonSpent[user.walletRaw] || 0);
    if (currentWalletTon + matchedPkg.ton > maxTonWallet + 1e-9) continue;
    if ((db.presale.totalCoinsSold || 0) + matchedPkg.coins > maxTotalCoins) continue;

    accruePendingMining(cfg, user);
    db.usedTxRefs[refKey] = {
      type: 'presale',
      userId: user.userId,
      ton: matchedPkg.ton,
      at: Date.now(),
    };
    db.presale.walletTonSpent[user.walletRaw] = +(currentWalletTon + matchedPkg.ton).toFixed(4);
    db.presale.totalTonRaised = +((db.presale.totalTonRaised || 0) + matchedPkg.ton).toFixed(4);
    db.presale.totalCoinsSold = (db.presale.totalCoinsSold || 0) + matchedPkg.coins;
    user.balance = +(user.balance + matchedPkg.coins).toFixed(6);

    const receipt = {
      id: `PS-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      userId: user.userId,
      username: user.username,
      firstName: user.firstName,
      walletAddress: user.walletFriendly,
      tonPaid: matchedPkg.ton,
      coinsReceived: matchedPkg.coins,
      txHash: tx.hash,
      createdAt: txTimeMs,
    };
    user.presalePurchases.push(receipt);
    db.presale.purchases.push(receipt);
    saveDB(true);

    if (Date.now() - txTimeMs < 30 * 60 * 1000) {
      notifyTelegramUser(
        cfg,
        user.userId,
        `🚀 *Presale Purchase Automatically Detected (On-Chain)!*\n\n• *Paid:* ${matchedPkg.ton} GRAM\n• *Coins Received:* +${matchedPkg.coins.toLocaleString('en-US')} ${cfg.token.symbol}\n• *Wallet Quota Used:* ${db.presale.walletTonSpent[user.walletRaw]} / ${maxTonWallet} GRAM`
      ).catch(() => {});
      notifyAdminsNewPresale(cfg, user, receipt).catch(() => {});
    }

    creditedPkg = matchedPkg;
  }

  return creditedPkg;
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
  saveDB(true);

  notifyTelegramUser(
    cfg,
    inviter.userId,
    `🎉 *New Active Referral!*\n\nYour friend *${user.firstName || user.username}* has completed *3 Consecutive Days of Check-In* & *Wallet Verification*!\n💰 You earned a *+${bonus} ${cfg.token.symbol}* bonus + *10%* commission from every mining claim they make!`
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

  // Link referral on creation or first sync with refBy (supports out-of-order restoration if friend syncs before inviter!)
  const cleanRefBy = refBy ? String(refBy).trim().replace(/^ref_/i, '') : '';
  if (cleanRefBy && cleanRefBy !== id && !user.referredBy) {
    user.referredBy = cleanRefBy;
  }
  if (user.referredBy && db.users[String(user.referredBy)]) {
    const inviter = db.users[String(user.referredBy)];
    ensureUserSchema(inviter);
    const already = inviter.referrals.some((r) => String(r.userId) === id);
    if (!already) {
      inviter.referrals.push({
        userId: id,
        name: user.firstName || user.username,
        joinedAt: user.createdAt || Date.now(),
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

  saveDB(isNew);

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
    walletPresaleTonRemaining: Math.max(0, (cfg.presale?.maxTonPerWallet || 100) - walletPresaleTon),
    checkIn: computeCheckInPreview(cfg, user),
    dailyChannels: computeDailyChannelsStatus(cfg, user),
    referralStats: computeReferralDetails(cfg, user),
    referredBy: user.referredBy,
    isSelfActiveReferral: isUserActiveReferral(user),
    referralLink,
    browserConnectUrl: buildBrowserConnectUrl(cfg, user),
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
  const adminFlag = isAdminUser(cfg, userView && userView.userId);
  const pendingWdCount = adminFlag
    ? (Array.isArray(db.withdrawals) ? db.withdrawals.filter(isWithdrawPending).length : 0)
    : 0;
  return {
    serverTime: Date.now(),
    isAdmin: adminFlag,
    pendingWithdrawCount: pendingWdCount,
    adminPanelUrl: adminFlag ? buildAdminPanelUrl(cfg, userView.userId) : undefined,
    user: userView,
    config: {
      appName: cfg.appName || 'MAXIMA MINING APP',
      botUsername: cfg.botUsername || 'MAXIMAMININGBOT',
      publicAppUrl: cfg.publicAppUrl || '',
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
      endsAtMs: Date.parse(cfg.presale?.endsAt || '2026-11-10T23:59:59Z'),
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

async function sendJson(res, status, data) {
  if (status === 200 && res._flushCloud) {
    await flushCloudDB();
  } else if (status === 200 && process.env.VERCEL && Date.now() - lastCloudWriteAt > 25000) {
    lastCloudWriteAt = Date.now();
    await flushCloudDB();
  }
  const bodyBuf = Buffer.from(JSON.stringify(data), 'utf8');
  const acceptEncoding = String((res._reqHeaders && res._reqHeaders['accept-encoding']) || '');
  const canGzip = bodyBuf.length > 512 && /\bgzip\b/i.test(acceptEncoding);
  const outBuf = canGzip ? zlib.gzipSync(bodyBuf, { level: 6 }) : bodyBuf;
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Cache-Control': 'no-store',
    'Content-Length': outBuf.length,
  };
  if (canGzip) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }
  res.writeHead(status, headers);
  res.end(outBuf);
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

const staticAssetCache = new Map();

const server = http.createServer(async (req, res) => {
  res._reqHeaders = req.headers || {};
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  const cfg = loadConfig();
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Healthcheck for Render / Railway Cloud Hosting & UptimeRobot Anti-Sleep + Upstash Keep-Alive
  if (req.method === 'GET' && pathname === '/healthz') {
    await ensureCloudDBLoaded();
    const creds = getUpstashCreds();
    if (creds && cloudDbLoaded && Date.now() - lastCloudPingAt > 6 * 3600 * 1000) {
      upstashCommand(creds, ['PING'])
        .then(() => {
          lastCloudPingAt = Date.now();
        })
        .catch(() => {});
    }
    return sendJson(res, 200, {
      ok: true,
      app: cfg.appName || 'MAXIMA MINING APP',
      cloudDb: creds ? (cloudDbLoaded ? 'connected' : 'error') : 'not_configured',
    });
  }

  // Telegram Bot Webhook Endpoint (Used automatically when deployed with HTTPS publicAppUrl)
  if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
    await ensureCloudDBLoaded();
    const update = await parseBody(req);
    if (cfg.botToken && update && typeof update === 'object') {
      await handleTelegramUpdate(cfg, update).catch(() => {});
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
      termsOfUseUrl: origin,
      privacyPolicyUrl: origin,
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
    await ensureCloudDBLoaded();
    res._flushCloud = pathname !== '/api/user/sync';
    const body = await parseBody(req);
    getOrCreateUser(cfg, body);
    const rawUser = db.users[String(body.userId || 'guest_demo').trim()];
    ensureUserSchema(rawUser);

    // Enforce 1 Wallet = 1 Account on every API request in case of legacy duplicate state
    if (rawUser.walletRaw) {
      const conflictOwnerId = findWalletOwnerUserId(rawUser.walletRaw, rawUser.userId);
      if (conflictOwnerId) {
        const dupRaw = rawUser.walletRaw;
        rawUser.walletRaw = '';
        rawUser.walletFriendly = '';
        rawUser.walletAddress = '';
        rawUser.walletAppName = '';
        rawUser.onChainHolding = 0;
        if (rawUser.boundWalletRaw === dupRaw) rawUser.boundWalletRaw = '';
        if (rawUser.verifiedWallets && rawUser.verifiedWallets[dupRaw]) {
          delete rawUser.verifiedWallets[dupRaw];
        }
        rawUser.walletVerified = false;
        rawUser.everVerifiedWallet = Boolean(
          rawUser.verifiedWallets && Object.keys(rawUser.verifiedWallets).length > 0
        );
        if (!rawUser.everVerifiedWallet) rawUser.verifiedAt = null;
        saveDB(true);
      } else {
        if (!db.walletOwners || typeof db.walletOwners !== 'object') db.walletOwners = {};
        db.walletOwners[rawUser.walletRaw] = String(rawUser.userId);
      }
    }

    // Sync on-chain MAXIMA Jetton balance & check on-chain 0.1 TON verification / presale if wallet connected
    if (rawUser.walletRaw) {
      const onChainBal = await fetchOnChainJettonBalance(cfg, rawUser.walletRaw);
      if (!rawUser.walletVerified) {
        await tryAutoVerifyFromChain(cfg, rawUser, false);
      }
      await tryAutoPresaleFromChain(cfg, rawUser, false);
      if (onChainBal !== null && rawUser.onChainHolding !== onChainBal) {
        accruePendingMining(cfg, rawUser);
        rawUser.onChainHolding = onChainBal;
        saveDB(true);
      }
    }

    // 1. User Sync
    if (pathname === '/api/user/sync') {
      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, { ok: true, data: buildSyncPayload(cfg, view) });
    }

    // 2. Connect Personal TON Wallet (Strictly via TON Connect SDK - 1 Wallet = 1 Account!)
    if (pathname === '/api/wallet/connect') {
      const rawAddr = parseTonAddressToRaw(body.walletAddress);
      const appName = String(body.walletAppName || '').trim();
      if (!rawAddr || !appName) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Invalid wallet connection! Please connect your personal wallet automatically via TON Connect.',
        });
      }

      // Strictly enforce 1 Wallet = 1 Telegram Account (cannot be connected to multiple accounts)
      const existingOwnerId = findWalletOwnerUserId(rawAddr, rawUser.userId);
      if (existingOwnerId) {
        if (rawUser.walletRaw === rawAddr) {
          accruePendingMining(cfg, rawUser);
          rawUser.walletRaw = '';
          rawUser.walletFriendly = '';
          rawUser.walletAddress = '';
          rawUser.walletAppName = '';
          rawUser.onChainHolding = 0;
          rawUser.walletVerified = false;
          saveDB(true);
        }
        const view = getOrCreateUser(cfg, body);
        return sendJson(res, 409, {
          ok: false,
          code: 'WALLET_ALREADY_BOUND',
          error:
            '⛔ Wallet ini sudah terhubung pada akun Telegram lain! 1 Wallet hanya dapat dihubungkan ke 1 akun. / This wallet is already linked to another Telegram account!',
          data: buildSyncPayload(cfg, view),
        });
      }

      accruePendingMining(cfg, rawUser);
      const wasDisconnected = !rawUser.walletRaw;
      rawUser.walletRaw = rawAddr;
      rawUser.boundWalletRaw = rawAddr;
      rawUser.walletFriendly = rawToFriendlyTon(rawAddr, false);
      rawUser.walletAddress = rawUser.walletFriendly;
      rawUser.walletAppName = appName;
      if (!rawUser.walletConnectedAt) rawUser.walletConnectedAt = Date.now();
      if (!db.walletOwners || typeof db.walletOwners !== 'object') db.walletOwners = {};
      db.walletOwners[rawAddr] = String(rawUser.userId);
      rawUser.walletVerified = Boolean(rawUser.verifiedWallets && rawUser.verifiedWallets[rawAddr]);

      const now = Date.now();
      if (wasDisconnected) {
        rawUser.lastAccruedAt = now;
        if (!rawUser.accruedMined || rawUser.accruedMined <= 0) {
          rawUser.shiftStartedAt = now;
        }
      }

      const onChainBal = await fetchOnChainJettonBalance(cfg, rawAddr);
      if (onChainBal !== null) {
        rawUser.onChainHolding = onChainBal;
      }
      if (!rawUser.walletVerified) {
        await tryAutoVerifyFromChain(cfg, rawUser, true);
      }
      await tryAutoPresaleFromChain(cfg, rawUser, true);
      checkAndActivateReferral(cfg, rawUser);

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: `👛 ${appName} Wallet Connected! Mining Level ${view.level} (${view.activePowerThs} TH/s) Active.`,
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
      saveDB(true);

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: '🔒 Wallet disconnected. Mining is paused until you reconnect your personal wallet.',
        data: buildSyncPayload(cfg, view),
      });
    }

    // 4. Claim Mining Reward (Anytime once accrued >= 0.1 MAXIMA, requires connected wallet)
    if (pathname === '/api/mine/claim') {
      if (!rawUser.walletRaw) {
        return sendJson(res, 403, {
          ok: false,
          error: '🔒 Please connect your personal wallet first to start mining and claim rewards!',
        });
      }

      const now = Date.now();
      accruePendingMining(cfg, rawUser, now);
      const minClaim = Number(cfg.mining?.minClaimCoins ?? 0.1);
      const pending = Number(rawUser.accruedMined || 0);

      if (pending + 1e-9 < minClaim) {
        return sendJson(res, 400, {
          ok: false,
          error: `Minimum mining claim is ${minClaim} ${cfg.token.symbol} (Current: ${pending.toFixed(4)} ${cfg.token.symbol}).`,
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
          ? `🎉 Claimed +${pending.toFixed(3)} ${cfg.token.symbol}! Leveled up to Level ${view.level} (${view.activePowerThs} TH/s)!`
          : `⛏️ Successfully claimed +${pending.toFixed(3)} ${cfg.token.symbol} to your in-app balance!`,
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
          error: 'You have already checked in today! Next reset is at 00:00 UTC.',
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
        message: `📅 Day ${rawUser.checkInCycleDay} Check-In Complete! +${reward} ${cfg.token.symbol} (Streak: ${rawUser.consecutiveCheckInDays}d)`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 6a. Visit Daily Repeatable Channel (@MAXIMAANN / @MAXIMAPAYOUT)
    if (pathname === '/api/missions/visit') {
      const missionId = String(body.missionId || '').trim();
      const mission = (cfg.missions?.dailyChannels || []).find((m) => m.id === missionId);
      if (!mission) {
        return sendJson(res, 400, { ok: false, error: 'Mission not found!' });
      }
      const todayUtc = getUtcDateStr();
      rawUser.dailyMissionVisits[missionId] = todayUtc;
      saveDB(true);
      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, { ok: true, data: buildSyncPayload(cfg, view) });
    }

    // 6b. Claim Daily Repeatable Channel Mission (+20 MAXIMA, resets daily at 00:00 UTC)
    if (pathname === '/api/missions/claim-daily') {
      const missionId = String(body.missionId || '').trim();
      const mission = (cfg.missions?.dailyChannels || []).find((m) => m.id === missionId);
      if (!mission) {
        return sendJson(res, 400, { ok: false, error: 'Mission not found!' });
      }

      const todayUtc = getUtcDateStr();
      if (rawUser.dailyMissionClaims[missionId] === todayUtc) {
        return sendJson(res, 400, {
          ok: false,
          error: 'This mission reward has already been claimed today! Repeatable again after 00:00 UTC.',
        });
      }
      if (rawUser.dailyMissionVisits[missionId] !== todayUtc) {
        return sendJson(res, 400, {
          ok: false,
          error: `Please open and join channel ${mission.channelHandle} first!`,
        });
      }

      // Strict Telegram Bot API membership verification when botToken is configured
      if (cfg.botToken && mission.channelHandle) {
        if (!/^\d+$/.test(String(rawUser.userId))) {
          return sendJson(res, 400, {
            ok: false,
            error: `Please open the app via Telegram @${cfg.botUsername || 'MAXIMAMININGBOT'} to verify membership in ${mission.channelHandle}!`,
          });
        }
        const memberRes = await tgCall(cfg.botToken, 'getChatMember', {
          chat_id: mission.channelHandle,
          user_id: Number(rawUser.userId),
        }).catch(() => null);

        if (!memberRes || !memberRes.ok || !memberRes.result) {
          const desc = String((memberRes && memberRes.description) || '').toLowerCase();
          if (desc.includes('inaccessible') || desc.includes('chat not found') || desc.includes('forbidden')) {
            return sendJson(res, 400, {
              ok: false,
              error: `Bot @${cfg.botUsername || 'MAXIMAMININGBOT'} must be added as an Admin in channel ${mission.channelHandle}!`,
            });
          }
          return sendJson(res, 400, {
            ok: false,
            error: `You have not joined channel ${mission.channelHandle} yet. Please join first!`,
          });
        }

        const st = memberRes.result.status;
        const isNotMember =
          st === 'left' ||
          st === 'kicked' ||
          (st === 'restricted' && memberRes.result.is_member === false);
        if (isNotMember) {
          return sendJson(res, 400, {
            ok: false,
            error: `You have not joined channel ${mission.channelHandle} yet. Please join first!`,
          });
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
        message: `🎁 Mission ${mission.channelHandle} Completed! +${mission.rewardCoins} ${cfg.token.symbol}`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 7. Presale Purchase (2/4/6/8/10/20/100 TON -> 4K/8K/12K/16K/20K/40K/200K MAXIMA; Max 100 TON/wallet; Max 20,000,000 MAXIMA total)
    if (pathname === '/api/presale/buy') {
      if (!rawUser.walletRaw) {
        return sendJson(res, 403, {
          ok: false,
          error: '🔒 Please connect your personal wallet via TON Connect first!',
        });
      }

      const presaleEndsAtMs = Date.parse(cfg.presale?.endsAt || '2026-11-10T23:59:59Z');
      if (Number.isFinite(presaleEndsAtMs) && Date.now() >= presaleEndsAtMs) {
        return sendJson(res, 400, {
          ok: false,
          error: '⏳ MAXIMA Presale has ended (November 10, 2026)!',
        });
      }

      const packageId = String(body.packageId || '').trim();
      const txBoc = String(body.txBoc || '').trim();
      const prevLevel = rawUser.level || 1;

      // Support on-chain auto-detection if txBoc callback was dropped by Telegram Desktop / WebView
      if (!txBoc || txBoc.length < 20) {
        const autoPkg = await tryAutoPresaleFromChain(cfg, rawUser, true);
        if (autoPkg) {
          const view = getOrCreateUser(cfg, body);
          const leveledUp = view.level > prevLevel;
          return sendJson(res, 200, {
            ok: true,
            leveledUp,
            message: leveledUp
              ? `🚀 ${autoPkg.ton} GRAM Payment Detected On-Chain! +${autoPkg.coins.toLocaleString('en-US')} ${cfg.token.symbol} · Leveled up to Level ${view.level}!`
              : `🚀 ${autoPkg.ton} GRAM Payment Detected On-Chain! +${autoPkg.coins.toLocaleString('en-US')} ${cfg.token.symbol} credited!`,
            data: buildSyncPayload(cfg, view),
          });
        }
        return sendJson(res, 400, {
          ok: false,
          error: 'GRAM presale payment not detected on-chain yet. Please make sure the transaction was confirmed from your connected wallet!',
        });
      }

      const pkg = (cfg.presale?.packages || []).find((p) => p.id === packageId);
      if (!pkg) {
        return sendJson(res, 400, { ok: false, error: 'Invalid presale package!' });
      }

      const bocKey = `boc_${hashTxRef(txBoc)}`;
      if (db.usedTxRefs[bocKey]) {
        return sendJson(res, 400, { ok: false, error: 'This transaction has already been processed!' });
      }

      const maxTonWallet = Number(cfg.presale?.maxTonPerWallet || 100);
      const maxTotalCoins = Number(cfg.presale?.maxTotalPresaleCoins || 20000000);
      const currentWalletTon = Number(db.presale.walletTonSpent[rawUser.walletRaw] || 0);

      if (currentWalletTon + pkg.ton > maxTonWallet + 1e-9) {
        return sendJson(res, 400, {
          ok: false,
          error: `Maximum presale limit is ${maxTonWallet} GRAM per wallet! Remaining quota for this wallet: ${Math.max(0, maxTonWallet - currentWalletTon)} GRAM.`,
        });
      }

      if ((db.presale.totalCoinsSold || 0) + pkg.coins > maxTotalCoins) {
        return sendJson(res, 400, {
          ok: false,
          error: `Insufficient global presale supply (${maxTotalCoins.toLocaleString('en-US')} ${cfg.token.symbol})!`,
        });
      }

      accruePendingMining(cfg, rawUser);

      db.usedTxRefs[bocKey] = { type: 'presale', userId: rawUser.userId, ton: pkg.ton, at: Date.now() };
      db.presale.walletTonSpent[rawUser.walletRaw] = +(currentWalletTon + pkg.ton).toFixed(4);
      db.presale.totalTonRaised = +((db.presale.totalTonRaised || 0) + pkg.ton).toFixed(4);
      db.presale.totalCoinsSold = (db.presale.totalCoinsSold || 0) + pkg.coins;

      rawUser.balance = +(rawUser.balance + pkg.coins).toFixed(6);

      const receipt = {
        id: `PS-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        userId: rawUser.userId,
        username: rawUser.username,
        firstName: rawUser.firstName,
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
        `🚀 *Presale Purchase Successful!*\n\n• *Paid:* ${pkg.ton} GRAM\n• *Coins Received:* +${pkg.coins.toLocaleString('en-US')} ${cfg.token.symbol}\n• *Wallet Quota Used:* ${db.presale.walletTonSpent[rawUser.walletRaw]} / ${maxTonWallet} GRAM`
      ).catch(() => {});
      notifyAdminsNewPresale(cfg, rawUser, receipt).catch(() => {});

      const view = getOrCreateUser(cfg, body);
      const leveledUp = view.level > prevLevel;
      return sendJson(res, 200, {
        ok: true,
        leveledUp,
        message: leveledUp
          ? `🚀 Presale +${pkg.coins.toLocaleString('en-US')} ${cfg.token.symbol} Successful! Leveled up to Level ${view.level} (${view.activePowerThs} TH/s)!`
          : `🚀 Presale +${pkg.coins.toLocaleString('en-US')} ${cfg.token.symbol} credited!`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 8. Wallet Verification (0.1 TON sent to UQDUe_P76bjHJ9EIUk8KLnFVRhbHf9_g7lJXHXgchYpZy4R1)
    if (pathname === '/api/wallet/verify') {
      if (!rawUser.walletRaw) {
        return sendJson(res, 400, { ok: false, error: 'Wallet is not connected!' });
      }
      if (findWalletOwnerUserId(rawUser.walletRaw, rawUser.userId)) {
        return sendJson(res, 409, {
          ok: false,
          code: 'WALLET_ALREADY_BOUND',
          error:
            '⛔ Wallet ini sudah terhubung pada akun Telegram lain! 1 Wallet hanya dapat digunakan pada 1 akun.',
        });
      }
      const txBoc = String(body.txBoc || '').trim();
      if (!txBoc || txBoc.length < 20) {
        // Force fresh on-chain scan if user clicked "Check Verification" after sending 0.1 TON
        const foundOnChain = await tryAutoVerifyFromChain(cfg, rawUser, true);
        if (foundOnChain || rawUser.walletVerified) {
          const view = getOrCreateUser(cfg, body);
          return sendJson(res, 200, {
            ok: true,
            message: '✅ 0.1 GRAM payment detected on-chain! Your wallet is now verified.',
            data: buildSyncPayload(cfg, view),
          });
        }
        return sendJson(res, 400, {
          ok: false,
          error: '0.1 GRAM verification transaction not found yet. Please make sure you sent 0.1 GRAM from your connected wallet!',
        });
      }

      const bocKey = `boc_${hashTxRef(txBoc)}`;
      if (db.usedTxRefs[bocKey]) {
        return sendJson(res, 400, { ok: false, error: 'This transaction proof has already been used!' });
      }

      db.usedTxRefs[bocKey] = { type: 'verify', userId: rawUser.userId, walletRaw: rawUser.walletRaw, at: Date.now() };
      rawUser.verifiedWallets[rawUser.walletRaw] = {
        verifiedAt: Date.now(),
        txRef: bocKey.slice(0, 20),
        source: 'tonconnect',
      };
      rawUser.walletVerified = true;
      rawUser.everVerifiedWallet = true;
      rawUser.verifiedAt = Date.now();
      if (!db.walletOwners || typeof db.walletOwners !== 'object') db.walletOwners = {};
      db.walletOwners[rawUser.walletRaw] = String(rawUser.userId);
      rawUser.boundWalletRaw = rawUser.walletRaw;

      checkAndActivateReferral(cfg, rawUser);

      notifyTelegramUser(
        cfg,
        rawUser.userId,
        `✅ *Wallet Verified Automatically!*\n\nYour *${cfg.wallet.verificationFeeTon} GRAM* verification payment has been confirmed. *Withdraw ${cfg.token.symbol}* is now unlocked!`
      ).catch(() => {});
      notifyAdminsWalletVerified(cfg, rawUser).catch(() => {});

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: `✅ ${cfg.wallet.verificationFeeTon} GRAM Verification Complete! Your wallet is now verified for Withdraw.`,
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
          error: '🔒 Please connect your personal wallet via TON Connect first!',
        });
      }
      if (findWalletOwnerUserId(rawUser.walletRaw, rawUser.userId)) {
        return sendJson(res, 409, {
          ok: false,
          code: 'WALLET_ALREADY_BOUND',
          error:
            '⛔ Wallet ini sudah terdaftar pada akun Telegram lain! Withdraw ditolak karena 1 wallet hanya dapat digunakan pada 1 akun.',
        });
      }
      if (!rawUser.walletVerified) {
        return sendJson(res, 403, {
          ok: false,
          error: `🛡️ Please complete wallet verification (${feeTon} GRAM) first before withdrawing!`,
        });
      }
      if (!Number.isFinite(amount) || amount < minW) {
        return sendJson(res, 400, {
          ok: false,
          error: `Minimum withdrawal amount is ${minW.toLocaleString('en-US')} ${cfg.token.symbol}!`,
        });
      }
      if (rawUser.balance + 1e-9 < amount) {
        return sendJson(res, 400, {
          ok: false,
          error: `Insufficient in-app balance (Available: ${rawUser.balance.toFixed(2)} ${cfg.token.symbol}).`,
        });
      }

      accruePendingMining(cfg, rawUser);
      const netReceived = +(amount - feeCoins).toFixed(4);
      rawUser.balance = Math.max(0, +(rawUser.balance - amount).toFixed(6));

      const wdRecord = {
        id: `WD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        userId: rawUser.userId,
        username: rawUser.username,
        firstName: rawUser.firstName,
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
        `💸 *Withdrawal Request Received!*\n\n• *Withdrawal Amount:* ${amount.toLocaleString('en-US')} ${cfg.token.symbol}\n• *Withdrawal Fee:* -${feeCoins} ${cfg.token.symbol}\n• *Net Payout:* ${netReceived.toLocaleString('en-US')} ${cfg.token.symbol}\n• *Recipient Wallet:* \`${rawUser.walletFriendly}\`\n• *Jetton Contract:* \`${cfg.token.contractAddress}\``
      ).catch(() => {});
      notifyAdminsNewWithdraw(cfg, rawUser, wdRecord).catch(() => {});

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: `💸 Withdrawal of ${amount.toLocaleString('en-US')} ${cfg.token.symbol} submitted! (Fee: ${feeCoins} • Net: ${netReceived.toLocaleString('en-US')} ${cfg.token.symbol})`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 10. ADMIN AUTO-WITHDRAW PANEL ENDPOINTS (1-Click & Batch TON Connect Jetton Transfer with Memo "MAXIMA PAYOUT")
    if (pathname.startsWith('/api/admin/')) {
      const callerId = String(body.userId || rawUser.userId || '').trim();
      const callerSig = String(body.tgSig || '').trim();
      const isAllowedAdmin =
        isAdminUser(cfg, callerId) ||
        (callerSig && isAdminUser(cfg, callerId) && callerSig === signBrowserAuth(cfg, callerId));
      if (!isAllowedAdmin) {
        return sendJson(res, 403, {
          ok: false,
          error: '⛔ Admin access only (ID: ' + callerId + ').',
        });
      }

      if (pathname === '/api/admin/withdrawals') {
        return sendJson(res, 200, {
          ok: true,
          adminData: buildAdminWithdrawalsApiPayload(cfg, callerId),
        });
      }

      if (pathname === '/api/admin/withdraw/prepare-tx') {
        const wdIds = Array.isArray(body.wdIds)
          ? body.wdIds.map((x) => String(x || '').trim()).filter(Boolean)
          : [];
        if (!wdIds.length) {
          return sendJson(res, 400, { ok: false, error: 'Pilih minimal 1 permintaan withdraw terlebih dahulu!' });
        }

        const memo = String(body.memo || 'MAXIMA PAYOUT').trim() || 'MAXIMA PAYOUT';
        const senderRaw =
          parseTonAddressToRaw(body.senderWalletAddress) ||
          rawUser.walletRaw ||
          parseTonAddressToRaw(cfg.wallet?.creatorRawAddress) ||
          parseTonAddressToRaw(cfg.wallet?.creatorTonWallet);

        if (!senderRaw) {
          return sendJson(res, 400, {
            ok: false,
            error: '🔒 Silakan hubungkan dompet TON Admin melalui TON Connect terlebih dahulu!',
          });
        }

        const jwInfo = await resolveOwnerJettonWalletAddress(cfg, senderRaw);
        if (!jwInfo || !jwInfo.friendlyBounceable) {
          return sendJson(res, 400, {
            ok: false,
            error:
              '⚠️ Jetton Wallet MAXIMA tidak ditemukan pada dompet yang sedang terhubung! Pastikan dompet TON yang Anda hubungkan memiliki saldo token MAXIMA.',
          });
        }

        const decimals = Number(cfg.token?.decimals ?? 9);
        const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
        const baseQid = BigInt(Date.now()) * 1000n;
        const preparedItems = [];

        for (let i = 0; i < wdIds.length; i++) {
          const id = wdIds[i];
          const wd = allWds.find((w) => w && w.id === id);
          if (!wd || !isWithdrawPending(wd)) continue;

          const destRaw = parseTonAddressToRaw(wd.walletRaw || wd.walletAddress);
          if (!destRaw) continue;

          const netCoins = Number(wd.netAmount || 0);
          if (!Number.isFinite(netCoins) || netCoins <= 0) continue;

          const jettonAmountNano = BigInt(Math.round(netCoins * 10)) * 10n ** BigInt(Math.max(0, decimals - 1));
          const bocBase64 = buildJettonTransferBocBase64({
            queryId: baseQid + BigInt(i + 1),
            jettonAmountNano,
            destinationRaw: destRaw,
            responseDestinationRaw: senderRaw,
            memo,
          });

          preparedItems.push({
            wdId: wd.id,
            userId: wd.userId,
            memberName: wd.firstName || wd.username || wd.userId,
            netAmount: netCoins,
            recipientAddress: wd.walletAddress,
            message: {
              address: jwInfo.friendlyBounceable,
              amount: '50000000', // 0.05 TON gas (sisa gas otomatis dikembalikan ke dompet Admin)
              payload: bocBase64,
            },
          });
        }

        if (!preparedItems.length) {
          return sendJson(res, 400, {
            ok: false,
            error: 'Tidak ada withdraw berstatus PENDING yang valid dari pilihan tersebut.',
          });
        }

        return sendJson(res, 200, {
          ok: true,
          memo,
          senderWalletRaw: senderRaw,
          jettonWalletAddress: jwInfo.friendlyBounceable,
          items: preparedItems,
        });
      }

      if (pathname === '/api/admin/withdraw/confirm-paid') {
        const wdIds = Array.isArray(body.wdIds)
          ? body.wdIds.map((x) => String(x || '').trim()).filter(Boolean)
          : [];
        if (!wdIds.length) {
          return sendJson(res, 400, { ok: false, error: 'Tidak ada ID withdraw yang dipilih!' });
        }

        const memo = String(body.memo || 'MAXIMA PAYOUT').trim() || 'MAXIMA PAYOUT';
        const txBoc = String(body.txBoc || '').trim();
        const now = Date.now();
        const sym = escHtml(cfg.token.symbol || 'MAXIMA');
        const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
        const processed = [];

        for (const wdId of wdIds) {
          const wd = allWds.find((w) => w && w.id === wdId);
          if (!wd || !isWithdrawPending(wd)) continue;

          wd.status = 'PAID ✅';
          wd.paidAt = now;
          wd.payoutMemo = memo;
          if (txBoc) wd.payoutTxBoc = txBoc.slice(0, 120);

          const u = db.users[String(wd.userId)];
          if (u && Array.isArray(u.withdrawals)) {
            const uw = u.withdrawals.find((x) => x && x.id === wdId);
            if (uw) {
              uw.status = 'PAID ✅';
              uw.paidAt = now;
              uw.payoutMemo = memo;
            }
          }
          processed.push({ wd, u });
        }

        if (processed.length) {
          saveDB(true);
          await flushCloudDB();

          for (const { wd, u } of processed) {
            await notifyTelegramUserHtml(
              cfg,
              wd.userId,
              [
                `✅ <b>${sym} Withdrawal Sent!</b>`,
                `━━━━━━━━━━━━━━━━━━━━━━`,
                `• <b>ID:</b> <code>${escHtml(wd.id)}</code>`,
                `• <b>Net Amount Sent:</b> <b>${Number(wd.netAmount).toLocaleString('en-US')} ${sym}</b>`,
                `• <b>Recipient Wallet:</b> <code>${escHtml(wd.walletAddress)}</code>`,
                `• <b>Memo:</b> <code>${escHtml(memo)}</code>`,
                `• <b>Status:</b> <b>PAID ✅</b>`,
              ].join('\n')
            ).catch(() => null);

            await postPayoutToChannel(cfg, wd, u).catch(() => null);
          }
        }

        const view = getOrCreateUser(cfg, body);
        return sendJson(res, 200, {
          ok: true,
          paidCount: processed.length,
          message: `✅ ${processed.length} Withdraw berhasil ditandai PAID & diumumkan ke ${getPayoutChannel(cfg)}!`,
          adminData: buildAdminWithdrawalsApiPayload(cfg, callerId),
          data: buildSyncPayload(cfg, view),
        });
      }

      if (pathname === '/api/admin/withdraw/action') {
        const wdIds = Array.isArray(body.wdIds)
          ? body.wdIds.map((x) => String(x || '').trim()).filter(Boolean)
          : [];
        const action = String(body.action || '').trim().toLowerCase(); // 'burn' | 'wipe' | 'refund'
        if (!wdIds.length || !['burn', 'wipe', 'refund'].includes(action)) {
          return sendJson(res, 400, { ok: false, error: 'Parameter action atau wdIds tidak valid!' });
        }

        const now = Date.now();
        const sym = escHtml(cfg.token.symbol || 'MAXIMA');
        const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
        let count = 0;

        for (const wdId of wdIds) {
          const wd = allWds.find((w) => w && w.id === wdId);
          if (!wd || !isWithdrawPending(wd)) continue;
          const u = db.users[String(wd.userId)];

          if (action === 'burn') {
            wd.status = 'BURNED (BUG/NO REFUND) 🔥';
            wd.burnedAt = now;
            if (u) {
              ensureUserSchema(u);
              if (Array.isArray(u.withdrawals)) {
                const uw = u.withdrawals.find((x) => x && x.id === wdId);
                if (uw) {
                  uw.status = 'BURNED (BUG/NO REFUND) 🔥';
                  uw.burnedAt = now;
                }
              }
              if (findWalletOwnerUserId(u.walletRaw || u.walletAddress, u.userId)) {
                u.onChainHolding = 0;
              }
              u.level = computeLevelFromHolding(Number(u.balance || 0) + Number(u.onChainHolding || 0));
              u.peakLevel = u.level;
            }
            notifyTelegramUserHtml(
              cfg,
              wd.userId,
              `🔥 <b>Withdrawal Rejected (Multi-Account / Bug Violation)</b>\n\nYour withdrawal request <code>${escHtml(wd.id)}</code> of <b>${Number(wd.requestedAmount).toLocaleString('en-US')} ${sym}</b> was rejected due to multi-account wallet policy violation. Fraudulent balance has been confiscated (No Refund).`
            ).catch(() => null);
          } else if (action === 'wipe') {
            wd.status = 'CONFISCATED (BUG WIPE) 🚫';
            wd.burnedAt = now;
            if (u) {
              ensureUserSchema(u);
              u.balance = 0;
              u.accruedMined = 0;
              u.onChainHolding = 0;
              u.level = 1;
              u.peakLevel = 1;
              const rawW = parseTonAddressToRaw(u.walletRaw || u.walletAddress || wd.walletRaw || wd.walletAddress || '');
              const otherOwner = rawW ? findWalletOwnerUserId(rawW, u.userId) : null;
              if (otherOwner) {
                u.walletRaw = '';
                u.walletFriendly = '';
                u.walletAddress = '';
                u.boundWalletRaw = '';
                u.walletVerified = false;
                u.everVerifiedWallet = false;
                if (u.verifiedWallets && rawW) delete u.verifiedWallets[rawW];
              }
              if (Array.isArray(u.withdrawals)) {
                const uw = u.withdrawals.find((x) => x && x.id === wdId);
                if (uw) {
                  uw.status = 'CONFISCATED (BUG WIPE) 🚫';
                  uw.burnedAt = now;
                }
              }
            }
            notifyTelegramUserHtml(
              cfg,
              wd.userId,
              `🚫 <b>Account Sanctioned (Multi-Account / Bug Violation)</b>\n\nYour withdrawal request <code>${escHtml(wd.id)}</code> was rejected and your illegitimate balance has been confiscated &amp; reset to 0 ${sym} due to exploiting the multi-account wallet bug.`
            ).catch(() => null);
          } else if (action === 'refund') {
            wd.status = 'REFUNDED ❌';
            wd.refundedAt = now;
            if (u) {
              ensureUserSchema(u);
              u.balance = +(Number(u.balance || 0) + Number(wd.requestedAmount || 0)).toFixed(6);
              if (Array.isArray(u.withdrawals)) {
                const uw = u.withdrawals.find((x) => x && x.id === wdId);
                if (uw) {
                  uw.status = 'REFUNDED ❌';
                  uw.refundedAt = now;
                }
              }
            }
            notifyTelegramUserHtml(
              cfg,
              wd.userId,
              `❌ <b>Withdrawal Cancelled & Balance Refunded</b>\n\nYour withdrawal request <code>${escHtml(wd.id)}</code> was cancelled by Admin and the full amount of <b>+${Number(wd.requestedAmount).toLocaleString('en-US')} ${sym}</b> has been refunded to your in-app balance.`
            ).catch(() => null);
          }
          count++;
        }

        if (count > 0) {
          saveDB(true);
          await flushCloudDB();
        }

        const actionLabel =
          action === 'burn'
            ? `🔥 ${count} Withdraw ditolak & saldo bug dihanguskan (No Refund)!`
            : action === 'wipe'
            ? `🚫 ${count} Withdraw ditolak, saldo akun di-reset 0 & wallet duplikat diputus!`
            : `🔄 ${count} Withdraw dibatalkan & saldo dikembalikan (Refund)!`;

        const view = getOrCreateUser(cfg, body);
        return sendJson(res, 200, {
          ok: true,
          processedCount: count,
          message: actionLabel,
          adminData: buildAdminWithdrawalsApiPayload(cfg, callerId),
          data: buildSyncPayload(cfg, view),
        });
      }
    }
  }

  // Static files from public/ (with Gzip compression & ETag caching to save ~90% Render bandwidth)
  const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relPath);
  if (!filePath.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        ETag: etag,
        'Cache-Control': ext === '.html' ? 'public, max-age=60, must-revalidate' : 'public, max-age=604800',
      });
      return res.end();
    }

    let cached = staticAssetCache.get(filePath);
    if (!cached || cached.etag !== etag) {
      const rawBuf = fs.readFileSync(filePath);
      const isCompressible = ['.html', '.css', '.js', '.json', '.svg'].includes(ext);
      const gzBuf = isCompressible ? zlib.gzipSync(rawBuf, { level: 9 }) : null;
      cached = { etag, rawBuf, gzBuf };
      staticAssetCache.set(filePath, cached);
    }

    const acceptEncoding = String(req.headers['accept-encoding'] || '');
    const useGzip = Boolean(cached.gzBuf && /\bgzip\b/i.test(acceptEncoding));
    const bodyBuf = useGzip ? cached.gzBuf : cached.rawBuf;

    const headers = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      ETag: etag,
      'Cache-Control': ext === '.html' ? 'public, max-age=60, must-revalidate' : 'public, max-age=604800',
      'Content-Length': bodyBuf.length,
    };
    if (useGzip) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
    }
    res.writeHead(200, headers);
    return res.end(bodyBuf);
  }

  res.writeHead(404);
  res.end('Not Found');
});

// ================= TELEGRAM BOT & ADMIN PANEL INTEGRATION =================
const DEFAULT_ADMIN_IDS = ['8464908276'];
const DEFAULT_PAYOUT_CHANNEL = '@MAXIMAPAYOUT';

function escHtml(val) {
  return String(val == null ? '' : val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtUtcTime(ts) {
  const d = new Date(ts || Date.now());
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function maskWalletShort(addr) {
  const s = String(addr || '').trim();
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}...${s.slice(-6)}`;
}

function maskMinerDisplay(firstName, username) {
  const base = String(firstName || username || 'Miner').trim();
  if (base.length <= 3) return `${base[0] || 'M'}***`;
  return `${base.slice(0, 3)}***`;
}

function getAdminIds(cfg) {
  const set = new Set(DEFAULT_ADMIN_IDS);
  const fromCfg = cfg && cfg.admin && Array.isArray(cfg.admin.telegramIds) ? cfg.admin.telegramIds : [];
  for (const id of fromCfg) {
    if (id) set.add(String(id).trim());
  }
  if (process.env.ADMIN_TELEGRAM_IDS) {
    for (const id of String(process.env.ADMIN_TELEGRAM_IDS).split(',')) {
      if (id.trim()) set.add(id.trim());
    }
  }
  return Array.from(set);
}

function isAdminUser(cfg, userId) {
  if (!userId) return false;
  return getAdminIds(cfg).includes(String(userId).trim());
}

function getPayoutChannel(cfg) {
  return String(
    process.env.PAYOUT_CHANNEL ||
      (cfg && cfg.admin && cfg.admin.payoutChannel) ||
      DEFAULT_PAYOUT_CHANNEL
  ).trim();
}

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

async function notifyTelegramUserHtml(cfg, chatId, htmlText, inlineKeyboard) {
  if (!cfg.botToken || !chatId || !/^\d+$/.test(String(chatId))) return null;
  const payload = {
    chat_id: chatId,
    text: htmlText,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (inlineKeyboard) {
    payload.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  return tgCall(cfg.botToken, 'sendMessage', payload);
}

async function notifyAdminsHtml(cfg, htmlText, inlineKeyboard) {
  if (!cfg.botToken) return;
  const adminIds = getAdminIds(cfg);
  for (const adminId of adminIds) {
    await notifyTelegramUserHtml(cfg, adminId, htmlText, inlineKeyboard).catch(() => null);
  }
}

function formatMemberLabelHtml(u, fallbackId) {
  const name = escHtml((u && (u.firstName || u.username)) || `Miner ${fallbackId || ''}`);
  const uname = u && u.username && !String(u.username).startsWith('Miner_') ? ` (@${escHtml(u.username)})` : '';
  const uid = escHtml((u && u.userId) || fallbackId || '-');
  return `${name}${uname} · ID: <code>${uid}</code>`;
}

function auditWithdrawalLegitimacy(cfg, wd, userObj) {
  const uid = String((wd && wd.userId) || (userObj && userObj.userId) || '');
  const u = userObj || (db.users && db.users[uid]) || {};
  const rawAddr = parseTonAddressToRaw((wd && (wd.walletRaw || wd.walletAddress)) || u.walletRaw || u.walletAddress || '');
  const reasons = [];
  let severity = 'SAFE'; // 'SAFE' | 'WARN' | 'FRAUD'

  // 1. Check if this wallet is owned by or shared with other userIds
  const otherUsersWithSameWallet = [];
  if (rawAddr) {
    const regOwner = findWalletOwnerUserId(rawAddr, uid);
    if (regOwner && !otherUsersWithSameWallet.includes(String(regOwner))) {
      otherUsersWithSameWallet.push(String(regOwner));
    }
    for (const [otherId, otherU] of Object.entries((db && db.users) || {})) {
      if (!otherU || String(otherId) === uid) continue;
      const oRaw = parseTonAddressToRaw(otherU.walletRaw || otherU.walletAddress || '');
      const oBound = parseTonAddressToRaw(otherU.boundWalletRaw || '');
      const hasInVerified = Boolean(otherU.verifiedWallets && otherU.verifiedWallets[rawAddr]);
      const hasInWd = Array.isArray(otherU.withdrawals) && otherU.withdrawals.some(
        (x) => x && parseTonAddressToRaw(x.walletRaw || x.walletAddress || '') === rawAddr
      );
      if (oRaw === rawAddr || oBound === rawAddr || hasInVerified || hasInWd) {
        if (!otherUsersWithSameWallet.includes(String(otherId))) {
          otherUsersWithSameWallet.push(String(otherId));
        }
      }
    }
  }
  if (otherUsersWithSameWallet.length > 0) {
    severity = 'FRAUD';
    reasons.push(`Wallet dipakai di >1 akun (ID lain: ${otherUsersWithSameWallet.join(', ')})`);
  }

  // 2. Check if this account ever verified multiple different wallets
  const verifiedWalletKeys = u.verifiedWallets && typeof u.verifiedWallets === 'object'
    ? Object.keys(u.verifiedWallets)
    : [];
  if (verifiedWalletKeys.length > 1) {
    if (severity !== 'FRAUD') severity = 'WARN';
    reasons.push(`Akun pernah gonta-ganti ${verifiedWalletKeys.length} wallet berbeda`);
  }

  // 3. Calculate Presale Coins & Check on-chain txHash
  const purchases = Array.isArray(u.presalePurchases) ? u.presalePurchases : [];
  let presaleCoins = 0;
  let presaleTon = 0;
  let unhashedPresaleCount = 0;
  for (const p of purchases) {
    if (!p) continue;
    presaleCoins += Number(p.coinsReceived || 0);
    presaleTon += Number(p.tonPaid || 0);
    if (!p.txHash) unhashedPresaleCount++;
  }
  if (unhashedPresaleCount > 0) {
    if (severity === 'SAFE') severity = 'WARN';
    reasons.push(`${unhashedPresaleCount} transaksi Presale belum memiliki txHash on-chain`);
  }

  // 4. Calculate total withdrawals by this user & by this wallet across all accounts
  const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
  let userTotalWithdrawn = 0;
  let walletTotalWithdrawn = 0;
  const walletWdUsers = new Set();
  for (const item of allWds) {
    if (!item) continue;
    const st = String(item.status || '').toUpperCase();
    if (st.startsWith('REFUNDED') || st.startsWith('REJECT') || st.startsWith('BURNED') || st.startsWith('CONFISCATED')) continue;
    const reqAmt = Number(item.requestedAmount || 0);
    if (String(item.userId) === uid) {
      userTotalWithdrawn += reqAmt;
    }
    const itemRaw = parseTonAddressToRaw(item.walletRaw || item.walletAddress || '');
    if (rawAddr && itemRaw === rawAddr) {
      walletTotalWithdrawn += reqAmt;
      if (item.userId) walletWdUsers.add(String(item.userId));
    }
  }
  if (walletWdUsers.size > 1) {
    severity = 'FRAUD';
    reasons.push(`Wallet ini dipakai withdraw oleh ${walletWdUsers.size} akun berbeda (${Array.from(walletWdUsers).join(', ')})`);
  }

  // 5. Calculate Mining, Referrals, and Source-of-Funds Balance Audit
  const totalMined = Number(u.totalMined || 0);
  const refCoins = Number(u.referralCoinsEarned || 0);
  const refList = Array.isArray(u.referrals) ? u.referrals : [];
  const currentBal = Number(u.balance || 0);
  const missionAllowance = 350; // check-in + daily missions buffer
  const maxExplainable = presaleCoins + totalMined + refCoins + missionAllowance;
  const totalUsedByUser = currentBal + userTotalWithdrawn;
  const unexplainedDiff = +(totalUsedByUser - maxExplainable).toFixed(2);

  if (unexplainedDiff > 300) {
    severity = 'FRAUD';
    reasons.push(`Saldo/Withdraw melebihi sumber wajar sebesar +${unexplainedDiff.toLocaleString('en-US')} MAXIMA`);
  }
  if (walletTotalWithdrawn > maxExplainable + 300) {
    severity = 'FRAUD';
    reasons.push(`Total withdraw ke wallet ini (${walletTotalWithdrawn.toLocaleString('en-US')}) melebihi kuota wajar akun (${Math.round(maxExplainable).toLocaleString('en-US')})`);
  }

  // Check if user has 0 presale but withdrawing >= 2000
  if (presaleCoins === 0 && Number((wd && wd.requestedAmount) || 0) >= 2000) {
    if (severity === 'SAFE') severity = 'WARN';
    reasons.push(`Withdraw tanpa Presale (Murni dari Mining=${totalMined.toFixed(1)} / Referral=${refCoins.toFixed(1)}) — cek keaslian referral & holding`);
  }

  const badge =
    severity === 'FRAUD'
      ? '🚨 <b>TERDETEKSI BUG / MULTI-AKUN (JANGAN BAYAR!)</b>'
      : severity === 'WARN'
      ? '⚠️ <b>PERLU CEK MANUAL (LIHAT RINCIAN)</b>'
      : '✅ <b>AMAN / ASLI (TERVERIFIKASI)</b>';

  return {
    severity,
    badge,
    reasons,
    presaleCoins,
    presaleTon,
    totalMined,
    refCoins,
    refCount: refList.length,
    userTotalWithdrawn,
    walletTotalWithdrawn,
    currentBal,
    otherUsersWithSameWallet,
  };
}

function buildWithdrawAdminCardHtml(cfg, wd, userObj) {
  const sym = escHtml(cfg.token.symbol || 'MAXIMA');
  const memberStr = formatMemberLabelHtml(userObj || wd, wd.userId);
  const audit = auditWithdrawalLegitimacy(cfg, wd, userObj);
  const reasonLines = audit.reasons.length
    ? audit.reasons.map((r) => `  • ⚠️ ${escHtml(r)}`)
    : [`  • ✅ 1 Wallet = 1 Akun &amp; Saldo sesuai pembelian Presale / Mining wajar.`];

  return [
    `💸 <b>MEMBER WITHDRAWAL REQUEST</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🆔 <b>ID:</b> <code>${escHtml(wd.id)}</code>`,
    `👤 <b>Member:</b> ${memberStr}`,
    `💰 <b>Requested Amount:</b> ${Number(wd.requestedAmount).toLocaleString('en-US')} ${sym}`,
    `🧾 <b>Fee:</b> -${Number(wd.feeCoins).toLocaleString('en-US')} ${sym}`,
    `✅ <b>NET PAYOUT:</b> <code>${wd.netAmount}</code> <b>${sym}</b>`,
    ``,
    `👛 <b>Recipient TON Wallet (Tap to Copy):</b>`,
    `<code>${escHtml(wd.walletAddress)}</code>`,
    ``,
    `🕵️ <b>HASIL AUDIT KEASLIAN (ANTI-BUG DETECTOR):</b>`,
    `• <b>Status Audit:</b> ${audit.badge}`,
    `• <b>Beli Presale:</b> <b>${audit.presaleCoins.toLocaleString('en-US')} ${sym}</b> (${audit.presaleTon} GRAM)`,
    `• <b>Hasil Mining:</b> ${audit.totalMined.toFixed(2)} ${sym} · <b>Referral:</b> ${audit.refCoins.toFixed(2)} ${sym} (${audit.refCount} ref)`,
    `• <b>Total WD Akun Ini:</b> ${audit.userTotalWithdrawn.toLocaleString('en-US')} ${sym} · <b>Total WD Wallet Ini:</b> ${audit.walletTotalWithdrawn.toLocaleString('en-US')} ${sym}`,
    ...reasonLines,
    ``,
    `🕒 <b>Time:</b> ${fmtUtcTime(wd.createdAt)}`,
    `📋 <b>Status:</b> ${escHtml(wd.status)}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `<i>After transferring ${Number(wd.netAmount).toLocaleString('en-US')} ${sym} to the wallet above, tap PAID to automatically announce it on ${escHtml(getPayoutChannel(cfg))}:</i>`,
  ].join('\n');
}

function buildWithdrawAdminKeyboard(wdId) {
  return [
    [{ text: '✅ Mark PAID & Post @MAXIMAPAYOUT', callback_data: `wd_paid:${wdId}` }],
    [{ text: '🔥 Tolak & Hanguskan Saldo Bug (No Refund)', callback_data: `wd_burn:${wdId}` }],
    [{ text: '🚫 Sita Semua Saldo + Putus Wallet Bug', callback_data: `wd_wipe:${wdId}` }],
    [{ text: '🔄 Reject & Refund (Kembalikan Saldo)', callback_data: `wd_rej:${wdId}` }],
  ];
}

async function notifyAdminsNewWithdraw(cfg, rawUser, wdRecord) {
  const html = buildWithdrawAdminCardHtml(cfg, wdRecord, rawUser);
  const kb = buildWithdrawAdminKeyboard(wdRecord.id);
  await notifyAdminsHtml(cfg, html, kb);
}

async function notifyAdminsNewPresale(cfg, rawUser, receipt) {
  const sym = escHtml(cfg.token.symbol || 'MAXIMA');
  const maxPool = Number(cfg.presale?.maxTotalPresaleCoins || 20000000);
  const totalTon = Number(db.presale?.totalTonRaised || 0);
  const totalSold = Number(db.presale?.totalCoinsSold || 0);
  const html = [
    `🚀 <b>NEW PRESALE PURCHASE!</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🆔 <b>Presale ID:</b> <code>${escHtml(receipt.id)}</code>`,
    `👤 <b>Member:</b> ${formatMemberLabelHtml(rawUser, receipt.userId)}`,
    `💎 <b>Package Paid:</b> <b>${receipt.tonPaid} GRAM</b>`,
    `🪙 <b>Coins Received:</b> +${Number(receipt.coinsReceived).toLocaleString('en-US')} ${sym}`,
    `👛 <b>Buyer Wallet:</b>`,
    `<code>${escHtml(receipt.walletAddress)}</code>`,
    `🕒 <b>Time:</b> ${fmtUtcTime(receipt.createdAt)}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 <b>Total Presale Raised:</b> <b>${totalTon} GRAM</b> (${totalSold.toLocaleString('en-US')} / ${maxPool.toLocaleString('en-US')} ${sym})`,
  ].join('\n');
  await notifyAdminsHtml(cfg, html, [[{ text: '🚀 View All Presale Data', callback_data: 'adm:presale' }]]);
}

async function notifyAdminsWalletVerified(cfg, rawUser) {
  const feeTon = cfg.wallet?.verificationFeeTon ?? 0.1;
  const html = [
    `🛡️ <b>NEW WALLET VERIFICATION (${feeTon} GRAM)!</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `👤 <b>Member:</b> ${formatMemberLabelHtml(rawUser, rawUser.userId)}`,
    `👛 <b>Verified Wallet:</b>`,
    `<code>${escHtml(rawUser.walletFriendly || rawUser.walletAddress)}</code>`,
    `🕒 <b>Time:</b> ${fmtUtcTime(rawUser.verifiedAt)}`,
  ].join('\n');
  await notifyAdminsHtml(cfg, html);
}

function isWithdrawPending(w) {
  const st = String((w && w.status) || '').toUpperCase();
  return (
    !st.startsWith('PAID') &&
    !st.startsWith('REFUNDED') &&
    !st.startsWith('BURNED') &&
    !st.startsWith('CONFISCATED') &&
    !st.startsWith('REJECTED')
  );
}

function buildAdminWithdrawalsApiPayload(cfg, adminUserId) {
  const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
  const enrich = (w) => {
    const u = db.users && db.users[String(w.userId)];
    const audit = auditWithdrawalLegitimacy(cfg, w, u);
    return {
      id: w.id,
      userId: w.userId,
      username: (u && u.username) || w.username || '',
      firstName: (u && u.firstName) || w.firstName || `Miner ${w.userId}`,
      requestedAmount: Number(w.requestedAmount || 0),
      feeCoins: Number(w.feeCoins || 0),
      netAmount: Number(w.netAmount || 0),
      walletAddress: w.walletAddress || (u && u.walletFriendly) || '',
      walletRaw: w.walletRaw || (u && u.walletRaw) || '',
      status: w.status || 'QUEUED FOR ON-CHAIN PAYOUT',
      createdAt: w.createdAt || Date.now(),
      paidAt: w.paidAt || null,
      payoutMemo: w.payoutMemo || 'MAXIMA PAYOUT',
      userBalance: u ? Number(u.balance || 0) : 0,
      userLevel: u ? Number(u.level || 1) : 1,
      audit: {
        severity: audit.severity, // 'SAFE' | 'WARN' | 'FRAUD'
        reasons: audit.reasons,
        presaleCoins: audit.presaleCoins,
        presaleTon: audit.presaleTon,
        totalMined: +Number(audit.totalMined || 0).toFixed(2),
        refCoins: +Number(audit.refCoins || 0).toFixed(2),
        refCount: audit.refCount,
        userTotalWithdrawn: audit.userTotalWithdrawn,
        walletTotalWithdrawn: audit.walletTotalWithdrawn,
        otherUsersWithSameWallet: audit.otherUsersWithSameWallet,
      },
    };
  };

  const pending = allWds.filter(isWithdrawPending).map(enrich);
  const history = allWds
    .filter((w) => !isWithdrawPending(w))
    .slice(-30)
    .reverse()
    .map(enrich);

  const safePending = pending.filter((x) => x.audit.severity === 'SAFE');
  const warnPending = pending.filter((x) => x.audit.severity === 'WARN');
  const fraudPending = pending.filter((x) => x.audit.severity === 'FRAUD');
  const totalPendingNetCoins = +pending.reduce((s, x) => s + x.netAmount, 0).toFixed(2);
  const safePendingNetCoins = +safePending.reduce((s, x) => s + x.netAmount, 0).toFixed(2);

  return {
    pending,
    history,
    stats: {
      totalPending: pending.length,
      safePendingCount: safePending.length,
      warnPendingCount: warnPending.length,
      fraudPendingCount: fraudPending.length,
      totalPendingNetCoins,
      safePendingNetCoins,
      defaultMemo: 'MAXIMA PAYOUT',
      creatorWallet: cfg.wallet?.creatorTonWallet || '',
      adminBrowserUrl: buildAdminPanelUrl(cfg, adminUserId),
    },
  };
}

function buildAdminDashboardPayload(cfg) {
  const sym = escHtml(cfg.token.symbol || 'MAXIMA');
  const usersArr = Object.values(db.users || {});
  const connectedCount = usersArr.filter((u) => Boolean(u.walletRaw)).length;
  const verifiedCount = usersArr.filter((u) => Boolean(u.walletVerified || u.everVerifiedWallet)).length;

  const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
  const pendingWds = allWds.filter(isWithdrawPending);
  const paidWds = allWds.filter((w) => String(w.status || '').toUpperCase().startsWith('PAID'));
  const pendingNetSum = pendingWds.reduce((acc, w) => acc + Number(w.netAmount || 0), 0);
  const paidNetSum = paidWds.reduce((acc, w) => acc + Number(w.netAmount || 0), 0);

  const purchases = (db.presale && Array.isArray(db.presale.purchases)) ? db.presale.purchases : [];
  const totalTon = Number(db.presale?.totalTonRaised || 0);
  const totalSold = Number(db.presale?.totalCoinsSold || 0);
  const uniquePresaleWallets = Object.keys((db.presale && db.presale.walletTonSpent) || {}).length;

  const html = [
    `🛠️ <b>ADMIN PANEL · MAXIMA MINING APP</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `👥 <b>Total Members:</b> ${usersArr.length.toLocaleString('en-US')} accounts`,
    `👛 <b>Connected Wallets:</b> ${connectedCount.toLocaleString('en-US')} members`,
    `🛡️ <b>Verified Wallets (0.1 GRAM):</b> ${verifiedCount.toLocaleString('en-US')} members`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🚀 <b>PRESALE SUMMARY</b>`,
    `• <b>Presale Transactions:</b> ${purchases.length.toLocaleString('en-US')} purchases (${uniquePresaleWallets} wallets)`,
    `• <b>Total GRAM Raised:</b> <b>${totalTon} GRAM</b>`,
    `• <b>Total Coins Sold:</b> ${totalSold.toLocaleString('en-US')} ${sym}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `💸 <b>WITHDRAWAL SUMMARY</b>`,
    `• <b>Pending Withdrawals:</b> <b>${pendingWds.length} queued</b> (${pendingNetSum.toLocaleString('en-US')} ${sym})`,
    `• <b>Completed Withdrawals (Paid):</b> <b>${paidWds.length} paid</b> (${paidNetSum.toLocaleString('en-US')} ${sym})`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `<i>Quick commands: /admin · /audit · /withdrawals · /presale · /stats</i>`,
  ].join('\n');

  const adminPanelWebUrl = buildAdminPanelUrl(cfg, getAdminIds(cfg)[0]);
  const isHttps = adminPanelWebUrl.startsWith('https://');
  const keyboard = [];
  if (isHttps) {
    keyboard.push([
      {
        text: `⚡ Panel Auto-Withdraw 1-Click & Batch (${pendingWds.length} Queued)`,
        web_app: { url: adminPanelWebUrl },
      },
    ]);
  }
  keyboard.push(
    [{ text: `💸 Pending Withdrawals (${pendingWds.length} Queued)`, callback_data: 'adm:wd_pending' }],
    [{ text: `🕵️ Audit Withdrawals & Deteksi Bug`, callback_data: 'adm:audit' }],
    [{ text: `🚀 Presale Buyers (${purchases.length})`, callback_data: 'adm:presale' }],
    [{ text: `✅ Paid Withdrawals (${paidWds.length})`, callback_data: 'adm:wd_paid' }],
    [{ text: '🔄 Refresh Stats', callback_data: 'adm:stats' }]
  );

  return { html, keyboard };
}

async function sendAdminAuditReport(cfg, chatId) {
  const sym = escHtml(cfg.token.symbol || 'MAXIMA');
  const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
  if (!allWds.length) {
    await notifyTelegramUserHtml(
      cfg,
      chatId,
      `🕵️ <b>AUDIT WITHDRAWAL:</b> Belum ada data permintaan withdraw.`,
      [[{ text: '⬅️ Back to Admin Panel', callback_data: 'adm:stats' }]]
    );
    return;
  }

  const recentWds = allWds.slice(-20).reverse();
  const lines = [
    `🕵️ <b>LAPORAN AUDIT WITHDRAWAL &amp; DETEKSI BUG (20 TERBARU)</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  recentWds.forEach((w, idx) => {
    const u = db.users && db.users[String(w.userId)];
    const audit = auditWithdrawalLegitimacy(cfg, w, u);
    const icon = audit.severity === 'FRAUD' ? '🚨' : audit.severity === 'WARN' ? '⚠️' : '✅';
    const label = audit.severity === 'FRAUD' ? 'BUG/MULTI-AKUN' : audit.severity === 'WARN' ? 'CEK MANUAL' : 'ASLI/AMAN';
    const name = escHtml((u && (u.username ? `@${u.username}` : u.firstName)) || w.username || w.firstName || w.userId);
    const note = audit.reasons.length ? `\n   └─ <i>${escHtml(audit.reasons.join('; '))}</i>` : '';
    lines.push(
      `<b>${idx + 1}. ${icon} [${label}] ${name}</b> (ID: <code>${escHtml(w.userId)}</code>)\n   • Req: <b>${Number(w.requestedAmount).toLocaleString('en-US')} ${sym}</b> (${escHtml(w.status)}) · Presale: <b>${audit.presaleCoins.toLocaleString('en-US')} ${sym}</b> (${audit.presaleTon} GRAM)\n   • Wallet: <code>${escHtml(maskWalletShort(w.walletAddress))}</code>${note}`
    );
  });

  await notifyTelegramUserHtml(cfg, chatId, lines.join('\n'), [
    [{ text: '💸 Buka Pending Withdrawals', callback_data: 'adm:wd_pending' }],
    [{ text: '⬅️ Back to Admin Panel', callback_data: 'adm:stats' }],
  ]);
}

async function sendAdminPendingWithdrawals(cfg, chatId) {
  const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
  const pendingWds = allWds.filter(isWithdrawPending);

  if (!pendingWds.length) {
    await notifyTelegramUserHtml(
      cfg,
      chatId,
      `✅ <b>There are no pending withdrawal requests right now.</b>\nAll member withdrawal requests have been processed.`,
      [[{ text: '⬅️ Back to Admin Panel', callback_data: 'adm:stats' }]]
    );
    return;
  }

  const batch = pendingWds.slice(0, 10);
  await notifyTelegramUserHtml(
    cfg,
    chatId,
    `⏳ <b>PENDING WITHDRAWAL QUEUE (${pendingWds.length} Pending)</b>\nShowing top ${batch.length} queued requests. Tap the wallet address to copy, then click <b>PAID</b> after sending the coins:`
  );

  for (const wd of batch) {
    const u = db.users[String(wd.userId)];
    await notifyTelegramUserHtml(
      cfg,
      chatId,
      buildWithdrawAdminCardHtml(cfg, wd, u),
      buildWithdrawAdminKeyboard(wd.id)
    );
  }
}

async function sendAdminPaidWithdrawals(cfg, chatId) {
  const sym = escHtml(cfg.token.symbol || 'MAXIMA');
  const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
  const paidWds = allWds
    .filter((w) => String(w.status || '').toUpperCase().startsWith('PAID'))
    .slice(-15)
    .reverse();

  if (!paidWds.length) {
    await notifyTelegramUserHtml(
      cfg,
      chatId,
      `📭 <b>No PAID withdrawal history yet.</b>`,
      [[{ text: '⬅️ Back to Admin Panel', callback_data: 'adm:stats' }]]
    );
    return;
  }

  const lines = [
    `✅ <b>LAST 15 PAID WITHDRAWALS</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];
  paidWds.forEach((w, idx) => {
    const u = db.users[String(w.userId)];
    const name = escHtml((u && (u.firstName || u.username)) || w.firstName || w.username || w.userId);
    lines.push(
      `<b>${idx + 1}. ${name}</b> (ID: <code>${escHtml(w.userId)}</code>)\n   • Net: <b>${Number(w.netAmount).toLocaleString('en-US')} ${sym}</b> ➔ <code>${escHtml(maskWalletShort(w.walletAddress))}</code>\n   • Paid: ${fmtUtcTime(w.paidAt || w.createdAt)}`
    );
  });

  await notifyTelegramUserHtml(cfg, chatId, lines.join('\n'), [
    [{ text: '⬅️ Back to Admin Panel', callback_data: 'adm:stats' }],
  ]);
}

async function sendAdminPresaleList(cfg, chatId) {
  const sym = escHtml(cfg.token.symbol || 'MAXIMA');
  const purchases = (db.presale && Array.isArray(db.presale.purchases)) ? db.presale.purchases : [];
  const totalTon = Number(db.presale?.totalTonRaised || 0);
  const totalSold = Number(db.presale?.totalCoinsSold || 0);
  const uniqueWallets = Object.keys((db.presale && db.presale.walletTonSpent) || {}).length;

  if (!purchases.length) {
    await notifyTelegramUserHtml(
      cfg,
      chatId,
      `🚀 <b>MAXIMA PRESALE BUYERS</b>\n━━━━━━━━━━━━━━━━━━━━━━\nNo presale purchase transactions yet.`,
      [[{ text: '⬅️ Back to Admin Panel', callback_data: 'adm:stats' }]]
    );
    return;
  }

  const recent = purchases.slice(-20).reverse();
  const lines = [
    `🚀 <b>MAXIMA PRESALE BUYERS LIST</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `💎 <b>Total Raised:</b> <b>${totalTon} GRAM</b>`,
    `🪙 <b>Total Coins Sold:</b> <b>${totalSold.toLocaleString('en-US')} ${sym}</b>`,
    `👥 <b>Total Transactions:</b> ${purchases.length} (${uniqueWallets} unique wallets)`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `<b>Latest ${recent.length} Presale Purchases:</b>`,
    ``,
  ];

  recent.forEach((p, idx) => {
    const u = db.users[String(p.userId)];
    const memberStr = formatMemberLabelHtml(u || p, p.userId);
    lines.push(
      `<b>${idx + 1}.</b> ${memberStr}\n   • Package: <b>${p.tonPaid} GRAM</b> ➔ +${Number(p.coinsReceived).toLocaleString('en-US')} ${sym}\n   • Wallet: <code>${escHtml(p.walletAddress)}</code>\n   • Time: ${fmtUtcTime(p.createdAt)}`
    );
  });

  await notifyTelegramUserHtml(cfg, chatId, lines.join('\n'), [
    [{ text: '⬅️ Back to Admin Panel', callback_data: 'adm:stats' }],
  ]);
}

async function postPayoutToChannel(cfg, wd, userObj) {
  const payoutChannel = getPayoutChannel(cfg);
  if (!cfg.botToken || !payoutChannel) return { ok: false, description: 'No payout channel' };

  const sym = escHtml(cfg.token.symbol || 'MAXIMA');
  const botUsername = cfg.botUsername || 'MAXIMAMININGBOT';
  const minerMasked = escHtml(
    maskMinerDisplay(
      (userObj && userObj.firstName) || wd.firstName,
      (userObj && userObj.username) || wd.username
    )
  );
  const walletMasked = escHtml(maskWalletShort(wd.walletAddress));

  const postHtml = [
    `💸 <b>MAXIMA PAYOUT COMPLETED</b> ✅`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `👤 <b>Miner:</b> ${minerMasked}`,
    `🪙 <b>Amount Sent:</b> <b>${Number(wd.netAmount).toLocaleString('en-US')} ${sym}</b>`,
    `👛 <b>Recipient Wallet:</b> <code>${walletMasked}</code>`,
    `⛓️ <b>Network:</b> TON Blockchain (Jetton)`,
    `📋 <b>Status:</b> <b>PAID ON-CHAIN ✅</b>`,
    `🕒 <b>Time:</b> ${fmtUtcTime(wd.paidAt || Date.now())}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ].join('\n');

  const keyboard = [
    [
      { text: '⛏️ Mine MAXIMA Now', url: `https://t.me/${botUsername}` },
      { text: '🔎 Jetton Contract', url: cfg.token.explorerUrl || 'https://tonviewer.com' },
    ],
  ];

  return tgCall(cfg.botToken, 'sendMessage', {
    chat_id: payoutChannel,
    text: postHtml,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleAdminCallbackQuery(cfg, cq) {
  const fromId = cq.from && cq.from.id;
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  const msgId = cq.message && cq.message.message_id;
  const data = String(cq.data || '');

  if (!isAdminUser(cfg, fromId)) {
    await tgCall(cfg.botToken, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: '⛔ Admin access only.',
      show_alert: true,
    }).catch(() => null);
    return;
  }

  if (data === 'adm:stats') {
    const dash = buildAdminDashboardPayload(cfg);
    if (chatId && msgId) {
      const editRes = await tgCall(cfg.botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: dash.html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: dash.keyboard },
      }).catch(() => null);
      if (!editRes || !editRes.ok) {
        await notifyTelegramUserHtml(cfg, chatId || fromId, dash.html, dash.keyboard);
      }
    } else {
      await notifyTelegramUserHtml(cfg, fromId, dash.html, dash.keyboard);
    }
    await tgCall(cfg.botToken, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => null);
    return;
  }

  if (data === 'adm:wd_pending') {
    await tgCall(cfg.botToken, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => null);
    await sendAdminPendingWithdrawals(cfg, chatId || fromId);
    return;
  }

  if (data === 'adm:wd_paid') {
    await tgCall(cfg.botToken, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => null);
    await sendAdminPaidWithdrawals(cfg, chatId || fromId);
    return;
  }

  if (data === 'adm:presale') {
    await tgCall(cfg.botToken, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => null);
    await sendAdminPresaleList(cfg, chatId || fromId);
    return;
  }

  if (data === 'adm:audit') {
    await tgCall(cfg.botToken, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => null);
    await sendAdminAuditReport(cfg, chatId || fromId);
    return;
  }

  if (data.startsWith('wd_paid:')) {
    const wdId = data.slice('wd_paid:'.length).trim();
    const wd = (db.withdrawals || []).find((w) => w.id === wdId);
    if (!wd) {
      await tgCall(cfg.botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Withdrawal record not found!',
        show_alert: true,
      }).catch(() => null);
      return;
    }
    if (!isWithdrawPending(wd)) {
      await tgCall(cfg.botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `This withdrawal has already been processed (${wd.status})!`,
        show_alert: true,
      }).catch(() => null);
      return;
    }

    const now = Date.now();
    wd.status = 'PAID ✅';
    wd.paidAt = now;

    const u = db.users[String(wd.userId)];
    if (u && Array.isArray(u.withdrawals)) {
      const uw = u.withdrawals.find((x) => x.id === wdId);
      if (uw) {
        uw.status = 'PAID ✅';
        uw.paidAt = now;
      }
    }

    saveDB(true);
    await flushCloudDB();

    // 1. Notify Member
    const sym = escHtml(cfg.token.symbol || 'MAXIMA');
    await notifyTelegramUserHtml(
      cfg,
      wd.userId,
      [
        `✅ <b>${sym} Withdrawal Sent!</b>`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `• <b>ID:</b> <code>${escHtml(wd.id)}</code>`,
        `• <b>Net Amount Sent:</b> <b>${Number(wd.netAmount).toLocaleString('en-US')} ${sym}</b>`,
        `• <b>Recipient Wallet:</b> <code>${escHtml(wd.walletAddress)}</code>`,
        `• <b>Status:</b> <b>PAID ✅</b>`,
      ].join('\n')
    ).catch(() => null);

    // 2. Auto-post payout proof to @MAXIMAPAYOUT
    const chRes = await postPayoutToChannel(cfg, wd, u).catch((e) => ({ ok: false, description: e.message }));
    const payoutCh = escHtml(getPayoutChannel(cfg));
    const postNote =
      chRes && chRes.ok
        ? `✅ <b>COMPLETED:</b> Marked <b>PAID ✅</b> & automatically posted to <b>${payoutCh}</b>!`
        : `✅ Marked <b>PAID ✅</b> (Failed to post to ${payoutCh}: ${escHtml((chRes && chRes.description) || 'check bot permissions')})`;

    if (chatId && msgId) {
      await tgCall(cfg.botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `${buildWithdrawAdminCardHtml(cfg, wd, u)}\n\n${postNote}`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }).catch(() => null);
    }

    await tgCall(cfg.botToken, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: chRes && chRes.ok ? '✅ PAID & Posted to @MAXIMAPAYOUT!' : '✅ Marked PAID!',
    }).catch(() => null);
    return;
  }

  if (data.startsWith('wd_rej:')) {
    const wdId = data.slice('wd_rej:'.length).trim();
    const wd = (db.withdrawals || []).find((w) => w.id === wdId);
    if (!wd) {
      await tgCall(cfg.botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Withdrawal record not found!',
        show_alert: true,
      }).catch(() => null);
      return;
    }
    if (!isWithdrawPending(wd)) {
      await tgCall(cfg.botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `This withdrawal has already been processed (${wd.status})!`,
        show_alert: true,
      }).catch(() => null);
      return;
    }

    const now = Date.now();
    wd.status = 'REFUNDED ❌';
    wd.refundedAt = now;

    const u = db.users[String(wd.userId)];
    if (u) {
      ensureUserSchema(u);
      u.balance = +(Number(u.balance || 0) + Number(wd.requestedAmount || 0)).toFixed(6);
      if (Array.isArray(u.withdrawals)) {
        const uw = u.withdrawals.find((x) => x.id === wdId);
        if (uw) {
          uw.status = 'REFUNDED ❌';
          uw.refundedAt = now;
        }
      }
    }

    saveDB(true);
    await flushCloudDB();

    const sym = escHtml(cfg.token.symbol || 'MAXIMA');
    await notifyTelegramUserHtml(
      cfg,
      wd.userId,
      `❌ <b>Withdrawal Cancelled & Balance Refunded</b>\n\nYour withdrawal request <code>${escHtml(wd.id)}</code> was cancelled by Admin and the full amount of <b>+${Number(wd.requestedAmount).toLocaleString('en-US')} ${sym}</b> has been refunded to your in-app balance.`
    ).catch(() => null);

    if (chatId && msgId) {
      await tgCall(cfg.botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `${buildWithdrawAdminCardHtml(cfg, wd, u)}\n\n❌ <b>CANCELLED:</b> Balance +${Number(wd.requestedAmount).toLocaleString('en-US')} ${sym} has been refunded to the member.`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }).catch(() => null);
    }

    await tgCall(cfg.botToken, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: '❌ Withdrawal rejected & balance refunded to member.',
    }).catch(() => null);
    return;
  }

  // Reject WITHOUT Refund (Burn Fraudulent / Bugged Withdrawal Amount)
  if (data.startsWith('wd_burn:')) {
    const wdId = data.slice('wd_burn:'.length).trim();
    const wd = (db.withdrawals || []).find((w) => w.id === wdId);
    if (!wd) {
      await tgCall(cfg.botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Withdrawal record not found!',
        show_alert: true,
      }).catch(() => null);
      return;
    }
    if (!isWithdrawPending(wd)) {
      await tgCall(cfg.botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `This withdrawal has already been processed (${wd.status})!`,
        show_alert: true,
      }).catch(() => null);
      return;
    }

    const now = Date.now();
    wd.status = 'BURNED (BUG/NO REFUND) 🔥';
    wd.burnedAt = now;

    const u = db.users[String(wd.userId)];
    if (u) {
      ensureUserSchema(u);
      // Do NOT refund wd.requestedAmount back to u.balance!
      if (Array.isArray(u.withdrawals)) {
        const uw = u.withdrawals.find((x) => x.id === wdId);
        if (uw) {
          uw.status = 'BURNED (BUG/NO REFUND) 🔥';
          uw.burnedAt = now;
        }
      }
      // Recalculate level cleanly based on remaining real balance
      const conflictOwner = findWalletOwnerUserId(u.walletRaw || u.walletAddress, u.userId);
      if (conflictOwner) {
        u.onChainHolding = 0;
      }
      u.level = computeLevelFromHolding(Number(u.balance || 0) + Number(u.onChainHolding || 0));
      u.peakLevel = u.level;
    }

    saveDB(true);
    await flushCloudDB();

    const sym = escHtml(cfg.token.symbol || 'MAXIMA');
    await notifyTelegramUserHtml(
      cfg,
      wd.userId,
      `🔥 <b>Withdrawal Rejected (Multi-Account / Bug Violation)</b>\n\nYour withdrawal request <code>${escHtml(wd.id)}</code> of <b>${Number(wd.requestedAmount).toLocaleString('en-US')} ${sym}</b> was rejected due to multi-account wallet policy violation. Fraudulent balance has been confiscated (No Refund).`
    ).catch(() => null);

    if (chatId && msgId) {
      await tgCall(cfg.botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `${buildWithdrawAdminCardHtml(cfg, wd, u)}\n\n🔥 <b>BURNED (NO REFUND):</b> Permintaan withdraw ditolak &amp; saldo sebesar <b>${Number(wd.requestedAmount).toLocaleString('en-US')} ${sym}</b> telah <b>DIHANGUSKAN (Tidak dikembalikan ke user)</b>.`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }).catch(() => null);
    }

    await tgCall(cfg.botToken, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: '🔥 Withdraw ditolak & saldo bug berhasil dihanguskan (No Refund)!',
    }).catch(() => null);
    return;
  }

  // Reject + Wipe All Account Balance & Unbind Duplicate Wallet
  if (data.startsWith('wd_wipe:')) {
    const wdId = data.slice('wd_wipe:'.length).trim();
    const wd = (db.withdrawals || []).find((w) => w.id === wdId);
    if (!wd) {
      await tgCall(cfg.botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Withdrawal record not found!',
        show_alert: true,
      }).catch(() => null);
      return;
    }
    if (!isWithdrawPending(wd)) {
      await tgCall(cfg.botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `This withdrawal has already been processed (${wd.status})!`,
        show_alert: true,
      }).catch(() => null);
      return;
    }

    const now = Date.now();
    wd.status = 'CONFISCATED (BUG WIPE) 🚫';
    wd.burnedAt = now;

    const u = db.users[String(wd.userId)];
    if (u) {
      ensureUserSchema(u);
      // Zero out all balances and reset level to 1
      u.balance = 0;
      u.accruedMined = 0;
      u.onChainHolding = 0;
      u.level = 1;
      u.peakLevel = 1;

      // If wallet belongs to another user, unbind it from this account; even if not, clear duplicate state
      const rawW = parseTonAddressToRaw(u.walletRaw || u.walletAddress || wd.walletRaw || wd.walletAddress || '');
      const otherOwner = rawW ? findWalletOwnerUserId(rawW, u.userId) : null;
      if (otherOwner) {
        u.walletRaw = '';
        u.walletFriendly = '';
        u.walletAddress = '';
        u.boundWalletRaw = '';
        u.walletVerified = false;
        u.everVerifiedWallet = false;
        if (u.verifiedWallets && rawW) {
          delete u.verifiedWallets[rawW];
        }
      }

      if (Array.isArray(u.withdrawals)) {
        const uw = u.withdrawals.find((x) => x.id === wdId);
        if (uw) {
          uw.status = 'CONFISCATED (BUG WIPE) 🚫';
          uw.burnedAt = now;
        }
      }
    }

    saveDB(true);
    await flushCloudDB();

    const sym = escHtml(cfg.token.symbol || 'MAXIMA');
    await notifyTelegramUserHtml(
      cfg,
      wd.userId,
      `🚫 <b>Account Sanctioned (Multi-Account / Bug Violation)</b>\n\nYour withdrawal request <code>${escHtml(wd.id)}</code> was rejected and your illegitimate balance has been confiscated &amp; reset to 0 ${sym} due to exploiting the multi-account wallet bug.`
    ).catch(() => null);

    if (chatId && msgId) {
      await tgCall(cfg.botToken, 'editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `${buildWithdrawAdminCardHtml(cfg, wd, u)}\n\n🚫 <b>CONFISCATED &amp; RESET TO 0:</b> Withdraw ditolak tanpa refund, seluruh sisa saldo akun di-reset ke <b>0 ${sym} (Level 1)</b>, dan wallet duplikat telah diputus!`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }).catch(() => null);
    }

    await tgCall(cfg.botToken, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: '🚫 Saldo akun bug berhasil disita (Reset 0) & wallet duplikat diputus!',
    }).catch(() => null);
    return;
  }
}

async function handleTelegramUpdate(cfg, u) {
  if (!u) return;
  await ensureCloudDBLoaded();

  if (u.callback_query) {
    await handleAdminCallbackQuery(cfg, u.callback_query);
    return;
  }

  if (!u.message || !u.message.text) return;

  const msg = u.message;
  const chatId = msg.chat.id;
  const from = msg.from || {};
  const senderId = from.id || chatId;
  const text = msg.text.trim();
  const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();

  // Admin-Only Commands (/admin, /stats, /withdrawals, /wd, /presale, /audit)
  if (['/admin', '/stats', '/withdrawals', '/wd', '/presale', '/audit'].includes(cmd)) {
    if (!isAdminUser(cfg, senderId)) {
      await notifyTelegramUserHtml(cfg, chatId, '⛔ This command is for Admins only.');
      return;
    }
    if (cmd === '/withdrawals' || cmd === '/wd') {
      await sendAdminPendingWithdrawals(cfg, chatId);
      return;
    }
    if (cmd === '/presale') {
      await sendAdminPresaleList(cfg, chatId);
      return;
    }
    if (cmd === '/audit') {
      await sendAdminAuditReport(cfg, chatId);
      return;
    }
    const dash = buildAdminDashboardPayload(cfg);
    await notifyTelegramUserHtml(cfg, chatId, dash.html, dash.keyboard);
    return;
  }

  if (cmd === '/start') {
    const parts = text.split(/\s+/);
    const refParam = parts[1] ? parts[1].replace(/^ref_/i, '') : '';
    const view = getOrCreateUser(cfg, {
      userId: senderId,
      username: from.username,
      firstName: from.first_name,
      refBy: refParam,
    });
    await flushCloudDB();

    const sym = escHtml(cfg.token.symbol);
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

    if (isAdminUser(cfg, senderId)) {
      keyboard.push([{ text: '🛠️ Admin Panel (Withdrawals & Presale)', callback_data: 'adm:stats' }]);
    }

    await tgCall(cfg.botToken, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      text: [
        `⛏️ <b>Welcome to MAXIMA MINING APP!</b>`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `🪙 <b>Token:</b> ${sym} (TON Jetton)`,
        `📋 <b>Contract:</b> <code>${escHtml(cfg.token.contractAddress)}</code>`,
        `👤 <b>Miner:</b> ${escHtml(view.firstName)}`,
        `🏆 <b>Road:</b> Level ${view.level} / 1,000 (${escHtml(view.currentLevelSpec.rankName)})`,
        `⚡ <b>Mining Power:</b> ${view.activePowerThs} TH/s (${view.activeDailyCoins} ${sym}/24h)`,
        `💼 <b>Combined Holding:</b> ${view.combinedHolding.toFixed(2)} ${sym}`,
        `  ├─ <b>In-App Holding:</b> ${view.inAppHolding.toFixed(2)} ${sym}`,
        `  └─ <b>On-Chain Wallet:</b> ${view.onChainHolding.toFixed(2)} ${sym}`,
        `👥 <b>Active Referrals:</b> ${view.referralStats.activeCount} (+200 ${sym}/active + 10% mining)`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `🔗 <b>Referral Link:</b>`,
        `<code>${escHtml(view.referralLink)}</code>`,
      ].join('\n'),
      reply_markup: { inline_keyboard: keyboard },
    });
  } else if (cmd === '/contract' || cmd === '/token') {
    await tgCall(cfg.botToken, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: [
        `💎 <b>MAXIMA TON JETTON CONTRACT</b>`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `• <b>App:</b> MAXIMA MINING APP`,
        `• <b>Coin:</b> ${escHtml(cfg.token.name)} (${escHtml(cfg.token.symbol)})`,
        `• <b>Decimals:</b> ${cfg.token.decimals}`,
        `• <b>Contract Address:</b>`,
        `<code>${escHtml(cfg.token.contractAddress)}</code>`,
        `• <b>Tonviewer:</b> ${escHtml(cfg.token.explorerUrl)}`,
      ].join('\n'),
    });
  }
}

async function registerBotCommandsForAdmins(cfg) {
  if (!cfg.botToken) return;
  const adminCommands = [
    { command: 'admin', description: '🛠️ Open Admin Panel (Withdrawals & Presale)' },
    { command: 'audit', description: '🕵️ Audit Withdrawals & Anti-Bug Detector' },
    { command: 'withdrawals', description: '💸 Pending Member Withdrawals' },
    { command: 'presale', description: '🚀 MAXIMA Presale Buyers List' },
    { command: 'stats', description: '📊 App Statistics Summary' },
    { command: 'start', description: '⛏️ Open MAXIMA MINING APP' },
    { command: 'contract', description: '💎 Official MAXIMA TON Jetton Contract' },
  ];
  for (const adminId of getAdminIds(cfg)) {
    if (/^\d+$/.test(adminId)) {
      await tgCall(cfg.botToken, 'setMyCommands', {
        commands: adminCommands,
        scope: { type: 'chat', chat_id: Number(adminId) },
      }).catch(() => null);
    }
  }
}

async function startTelegramBotPolling(cfg) {
  if (!cfg.botToken) return;

  const me = await tgCall(cfg.botToken, 'getMe').catch(() => null);
  if (!me || !me.ok) {
    console.log('⚠️  [Telegram Bot] botToken not configured/valid. Web App mode is running.');
    return;
  }

  cfg.botUsername = me.result.username;
  saveBotUsernameToConfig(me.result.username);
  console.log(`🤖 [Telegram Bot] Active as @${cfg.botUsername}`);

  await registerBotCommandsForAdmins(cfg).catch(() => null);

  const cleanPublicUrl = String(cfg.publicAppUrl || '').trim().replace(/\/+$/, '');
  if (cleanPublicUrl.startsWith('https://')) {
    await tgCall(cfg.botToken, 'setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: '⛏️ MAXIMA APP',
        web_app: { url: cleanPublicUrl },
      },
    }).catch(() => null);
    console.log(`📲 [Telegram Mini App] Menu Button automatically set to ${cleanPublicUrl}`);

    const whUrl = `${cleanPublicUrl}/api/telegram/webhook`;
    const whRes = await tgCall(cfg.botToken, 'setWebhook', {
      url: whUrl,
      allowed_updates: ['message', 'callback_query'],
    }).catch(() => null);
    if (whRes && whRes.ok) {
      console.log(`🔗 [Telegram Webhook] Active at ${whUrl}`);
      return;
    }
  } else {
    const whInfo = await tgCall(cfg.botToken, 'getWebhookInfo').catch(() => null);
    const activeWhUrl = whInfo && whInfo.ok && whInfo.result ? String(whInfo.result.url || '') : '';
    if (activeWhUrl.startsWith('https://')) {
      console.log(`🌐 [Telegram Bot] Cloud Webhook active at ${activeWhUrl} (local server will not overwrite cloud webhook).`);
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

let vercelWebhookInitialized = false;

async function ensureServerlessWebhook(cfg, req) {
  if (vercelWebhookInitialized || !cfg.botToken) return;
  vercelWebhookInitialized = true;
  try {
    const host = String((req && req.headers && req.headers.host) || '').trim();
    const baseUrl = String(
      process.env.PUBLIC_APP_URL ||
        (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
        (host ? `https://${host}` : cfg.publicAppUrl || '')
    )
      .trim()
      .replace(/\/+$/, '');
    if (!baseUrl.startsWith('https://')) return;
    await tgCall(cfg.botToken, 'setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: '⛏️ MAXIMA APP',
        web_app: { url: baseUrl },
      },
    }).catch(() => null);
    await tgCall(cfg.botToken, 'setWebhook', {
      url: `${baseUrl}/api/telegram/webhook`,
      allowed_updates: ['message', 'callback_query'],
    }).catch(() => null);
    await registerBotCommandsForAdmins(cfg).catch(() => null);
  } catch (_) {}
}

const initialCfg = loadConfig();
const PORT = initialCfg.port || 3000;

if (require.main === module) {
  ensureCloudDBLoaded().catch(() => {});
  server.listen(PORT, '0.0.0.0', () => {
    console.log('========================================================================================');
    console.log(`  ⛏️  ${initialCfg.appName} (${initialCfg.token.symbol} · 1,000 LEVELS) SERVER RUNNING!`);
    console.log('========================================================================================');
    console.log(`  🪙 TON Jetton Contract : ${initialCfg.token.contractAddress}`);
    console.log(`  🌐 Web / TMA URL       : ${initialCfg.publicAppUrl || `http://localhost:${PORT}`}`);
    console.log('========================================================================================');
    startTelegramBotPolling(initialCfg);
  });
}

const requestHandler = (req, res) => {
  if (process.env.VERCEL && !vercelWebhookInitialized) {
    ensureServerlessWebhook(loadConfig(), req).catch(() => {});
  }
  return server.emit('request', req, res);
};

Object.assign(requestHandler, {
  server,
  db,
  ensureCloudDBLoaded,
  flushCloudDB,
  requiredHolding,
  miningSpeed,
  dailyOutput,
  computeLevelFromHolding,
  parseTonAddressToRaw,
  rawToFriendlyTon,
  findWalletOwnerUserId,
  deduplicateWalletsInDB,
});

module.exports = requestHandler;

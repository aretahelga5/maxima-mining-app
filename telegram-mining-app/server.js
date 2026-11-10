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
  if (!cfg.nftSale || typeof cfg.nftSale !== 'object') {
    cfg.nftSale = { enabled: true };
  }
  if (process.env.NFT_COLLECTION_ADDRESS) {
    cfg.nftSale.collectionAddress = String(process.env.NFT_COLLECTION_ADDRESS).trim();
  }
  if (process.env.NFT_DIRECT_CONTRACT_MINT !== undefined && process.env.NFT_DIRECT_CONTRACT_MINT !== '') {
    cfg.nftSale.directContractMint = /^(1|true|yes)$/i.test(String(process.env.NFT_DIRECT_CONTRACT_MINT).trim());
  }
  if (process.env.NFT_IPFS_IMAGES_CID) {
    cfg.nftSale.ipfsImagesCid = String(process.env.NFT_IPFS_IMAGES_CID).trim();
  }
  if (process.env.NFT_IPFS_METADATA_CID) {
    cfg.nftSale.ipfsMetadataCid = String(process.env.NFT_IPFS_METADATA_CID).trim();
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

function createEmptyNftRegistry() {
  return {
    nextMintIndex: 0,
    mintedByIndex: {},
    firstMintBonusClaimed: {},
    userMintCounts: {},
    walletMintCounts: {},
    marketNetCoinsByUser: {},
    pendingTxIntents: {},
  };
}

function createEmptyDB() {
  return {
    schemaVersion: 2,
    users: {},
    walletOwners: {},
    withdrawals: [],
    processedWithdrawIds: {},
    usedTxRefs: {},
    notifiedAdminRefs: {},
    presale: {
      totalCoinsSold: 0,
      totalTonRaised: 0,
      walletTonSpent: {},
      purchases: [],
    },
    nftRegistry: createEmptyNftRegistry(),
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

// Automatically deduplicate any double-credited presale receipts (e.g. race between TON Connect txBoc and on-chain auto-poll)
function deduplicatePresalePurchasesInDB(base) {
  if (!base || typeof base !== 'object') return;
  if (!base.users || typeof base.users !== 'object') base.users = {};
  if (!base.usedTxRefs || typeof base.usedTxRefs !== 'object') base.usedTxRefs = {};
  if (!base.presale || typeof base.presale !== 'object') {
    base.presale = { totalCoinsSold: 0, totalTonRaised: 0, walletTonSpent: {}, purchases: [] };
  }
  if (!Array.isArray(base.presale.purchases)) base.presale.purchases = [];

  const knownHistoricalHashes = {
    'PS-1793424586445-796': 'aa39a436bf6a96a525e90be0e126ae719699b06e6967f0fae7080f4594c272cb',
    'PS-1793540304853-210': '343a8b77a5f564af7ce794df731816c4409ca5c8efbdd33fe8c7baa90255226a',
    'PS-1793614698108-903': 'c8698c9ec7c148b33da8370adea616948314dcca53c352375860105610095c33',
    'PS-1793615590844-633': '48fee973858aa9a59bad216d01f498ccc132c706b613607be30fc911d22d0551',
  };
  const affected20GramRaw = '0:e24980f8e83a157f5e082c49928d9781c345760752c26c05d3f09948e6e87b56';
  const affected20GramHash = 'ba3cd4354d791cfb45790e24c2a017b61b76f1c699cbc155c0780dfb373c4883';

  // 1. Sync txHash and bocKey by receipt ID across global and user purchase arrays
  const hashById = new Map();
  const bocById = new Map();
  for (const [rid, h] of Object.entries(knownHistoricalHashes)) {
    hashById.set(rid, h);
  }
  for (const p of base.presale.purchases) {
    if (!p || !p.id) continue;
    if (p.txHash) hashById.set(p.id, p.txHash);
    if (p.bocKey) bocById.set(p.id, p.bocKey);
  }
  for (const u of Object.values(base.users)) {
    if (!u || !Array.isArray(u.presalePurchases)) continue;
    for (const p of u.presalePurchases) {
      if (!p || !p.id) continue;
      if (p.txHash) hashById.set(p.id, p.txHash);
      if (p.bocKey) bocById.set(p.id, p.bocKey);
    }
  }
  for (const p of base.presale.purchases) {
    if (!p || !p.id) continue;
    if (!p.txHash && hashById.has(p.id)) p.txHash = hashById.get(p.id);
    if (!p.bocKey && bocById.has(p.id)) p.bocKey = bocById.get(p.id);
  }
  for (const u of Object.values(base.users)) {
    if (!u || !Array.isArray(u.presalePurchases)) continue;
    for (const p of u.presalePurchases) {
      if (!p || !p.id) continue;
      if (!p.txHash && hashById.has(p.id)) p.txHash = hashById.get(p.id);
      if (!p.bocKey && bocById.has(p.id)) p.bocKey = bocById.get(p.id);
    }
  }

  // 2. Deduplicate each user's presalePurchases and adjust balance & level if duplicate credits existed
  for (const u of Object.values(base.users)) {
    if (!u || typeof u !== 'object') continue;
    if (!Array.isArray(u.presalePurchases) || u.presalePurchases.length === 0) continue;

    const uWalletRaw =
      parseTonAddressToRaw(u.walletRaw) ||
      parseTonAddressToRaw(u.boundWalletRaw) ||
      (u.verifiedWallets && Object.keys(u.verifiedWallets)[0]) ||
      '';

    // Prioritize receipts that have an on-chain txHash, then chronological order
    const sorted = [...u.presalePurchases].filter(Boolean).sort((a, b) => {
      const aHasHash = a.txHash ? 1 : 0;
      const bHasHash = b.txHash ? 1 : 0;
      if (aHasHash !== bHasHash) return bHasHash - aHasHash;
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    });

    const kept = [];
    let removedCoins = 0;

    for (const p of sorted) {
      const pRaw = parseTonAddressToRaw(p.walletAddress) || uWalletRaw;
      if (pRaw === affected20GramRaw && Number(p.tonPaid) === 20 && !p.txHash) {
        const alreadyHas20 = kept.some((k) => Number(k.tonPaid) === 20);
        if (!alreadyHas20) {
          p.txHash = affected20GramHash;
        }
      }

      // Exact same receipt object/ID pushed twice
      if (p.id && kept.some((k) => k.id === p.id)) {
        continue;
      }

      // Duplicate on-chain txHash
      if (p.txHash && kept.some((k) => k.txHash === p.txHash)) {
        removedCoins += Number(p.coinsReceived || 0);
        continue;
      }

      // Specific guard for wallet UQDiSYD46DoVf14ILEmSjZeBw0V2B1LCbAXT8JlI5uh7VoiX (only 1 on-chain 20 GRAM tx exists)
      if (pRaw === affected20GramRaw && Number(p.tonPaid) === 20) {
        const existing20 = kept.find((k) => Number(k.tonPaid) === 20);
        if (existing20 && (!p.txHash || p.txHash === existing20.txHash || p.txHash === affected20GramHash)) {
          if (p.bocKey && !existing20.bocKey) existing20.bocKey = p.bocKey;
          removedCoins += Number(p.coinsReceived || 0);
          continue;
        }
      }

      // Unhashed BOC receipt that duplicates an on-chain hashed receipt of the same TON package within 60 minutes
      if (!p.txHash) {
        const matchHashed = kept.find(
          (k) =>
            k.txHash &&
            !k._matchedUnhashedDup &&
            Number(k.tonPaid) === Number(p.tonPaid) &&
            Math.abs(Number(k.createdAt || 0) - Number(p.createdAt || 0)) < 60 * 60 * 1000
        );
        if (matchHashed) {
          matchHashed._matchedUnhashedDup = true;
          if (p.bocKey && !matchHashed.bocKey) matchHashed.bocKey = p.bocKey;
          removedCoins += Number(p.coinsReceived || 0);
          continue;
        }

        // Two unhashed BOC receipts for the same TON package within 120 seconds
        const matchUnhashed = kept.find(
          (k) =>
            !k.txHash &&
            Number(k.tonPaid) === Number(p.tonPaid) &&
            Math.abs(Number(k.createdAt || 0) - Number(p.createdAt || 0)) < 120 * 1000
        );
        if (matchUnhashed) {
          removedCoins += Number(p.coinsReceived || 0);
          continue;
        }
      }

      kept.push(p);
    }

    for (const k of kept) {
      delete k._matchedUnhashedDup;
    }
    kept.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    u.presalePurchases = kept;

    if (removedCoins > 0) {
      u.balance = Math.max(0, +(Number(u.balance || 0) - removedCoins).toFixed(6));
      const combined =
        Math.max(0, Number(u.balance || 0)) +
        (u.walletRaw ? Math.max(0, Number(u.onChainHolding || 0)) : 0);
      const correctedLevel = computeLevelFromHolding(combined);
      u.level = correctedLevel;
      u.peakLevel = correctedLevel;
    }
  }

  // 3. Rebuild global presale purchases & totals cleanly from deduplicated user receipts
  const rebuiltPurchases = [];
  const seenGlobalIds = new Set();
  for (const u of Object.values(base.users)) {
    if (!u || !Array.isArray(u.presalePurchases)) continue;
    for (const p of u.presalePurchases) {
      if (!p) continue;
      if (p.id && seenGlobalIds.has(p.id)) continue;
      if (p.id) seenGlobalIds.add(p.id);
      rebuiltPurchases.push(p);
      if (p.txHash) {
        const refKey = `chain_ps_${p.txHash}`;
        if (!base.usedTxRefs[refKey]) {
          base.usedTxRefs[refKey] = {
            type: 'presale',
            userId: p.userId || u.userId,
            ton: Number(p.tonPaid || 0),
            at: Number(p.createdAt || Date.now()),
            linkedReceipt: p.id,
          };
        }
      }
    }
  }

  rebuiltPurchases.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  base.presale.purchases = rebuiltPurchases;

  const newWalletTonSpent = {};
  let newTotalTon = 0;
  let newTotalCoins = 0;
  for (const p of rebuiltPurchases) {
    const ton = Number(p.tonPaid || 0);
    const coins = Number(p.coinsReceived || 0);
    newTotalTon = +(newTotalTon + ton).toFixed(4);
    newTotalCoins += coins;
    const ownerUser = p.userId && base.users[String(p.userId).trim()];
    const wRaw =
      parseTonAddressToRaw(p.walletAddress) ||
      (ownerUser && (parseTonAddressToRaw(ownerUser.walletRaw) || parseTonAddressToRaw(ownerUser.boundWalletRaw))) ||
      '';
    if (wRaw) {
      newWalletTonSpent[wRaw] = +((newWalletTonSpent[wRaw] || 0) + ton).toFixed(4);
    }
  }
  base.presale.walletTonSpent = newWalletTonSpent;
  base.presale.totalTonRaised = newTotalTon;
  base.presale.totalCoinsSold = newTotalCoins;
}

function isWithdrawStatusPending(statusStr) {
  const st = String(statusStr || '').toUpperCase();
  return (
    !st.startsWith('PAID') &&
    !st.startsWith('REFUNDED') &&
    !st.startsWith('BURNED') &&
    !st.startsWith('CONFISCATED') &&
    !st.startsWith('REJECTED')
  );
}

function recordProcessedWithdrawal(base, wd) {
  if (!base || typeof base !== 'object' || !wd || !wd.id) return;
  if (isWithdrawStatusPending(wd.status)) return;
  if (!base.processedWithdrawIds || typeof base.processedWithdrawIds !== 'object') {
    base.processedWithdrawIds = {};
  }
  const id = String(wd.id).trim();
  if (!id) return;
  const existing = base.processedWithdrawIds[id];
  const nextIsPaid = String(wd.status || '').toUpperCase().startsWith('PAID');
  const existingIsPaid = existing && String(existing.status || '').toUpperCase().startsWith('PAID');
  if (existingIsPaid && !nextIsPaid) {
    return;
  }
  base.processedWithdrawIds[id] = {
    status: wd.status,
    paidAt: wd.paidAt || (existing && existing.paidAt) || null,
    burnedAt: wd.burnedAt || (existing && existing.burnedAt) || null,
    refundedAt: wd.refundedAt || (existing && existing.refundedAt) || null,
    payoutMemo: wd.payoutMemo || (existing && existing.payoutMemo) || 'MAXIMA PAYOUT',
    payoutTxBoc: wd.payoutTxBoc || (existing && existing.payoutTxBoc) || '',
    payoutEventId: wd.payoutEventId || (existing && existing.payoutEventId) || '',
    updatedAt: Date.now(),
  };
}

function deduplicateWithdrawalsInDB(base) {
  if (!base || typeof base !== 'object') return;
  if (!Array.isArray(base.withdrawals)) base.withdrawals = [];
  if (!base.users || typeof base.users !== 'object') base.users = {};
  if (!base.notifiedAdminRefs || typeof base.notifiedAdminRefs !== 'object') {
    base.notifiedAdminRefs = {};
  }
  if (!base.processedWithdrawIds || typeof base.processedWithdrawIds !== 'object') {
    base.processedWithdrawIds = {};
  }

  // 1. Collect all withdrawals from global list and per-user lists, preferring finalized status for identical IDs
  const byId = new Map();
  const absorbWd = (w, fallbackUid = '') => {
    if (!w || typeof w !== 'object') return;
    const id = String(w.id || '').trim();
    if (!id) return;
    const uid = String(w.userId || fallbackUid || '').trim();
    const copy = { ...w, id, userId: uid };
    if (!isWithdrawStatusPending(copy.status)) {
      recordProcessedWithdrawal(base, copy);
    }
    const lockedFinal = base.processedWithdrawIds[id];
    if (lockedFinal && !isWithdrawStatusPending(lockedFinal.status)) {
      const lockedIsPaid = String(lockedFinal.status || '').toUpperCase().startsWith('PAID');
      const copyIsPaid = String(copy.status || '').toUpperCase().startsWith('PAID');
      if (isWithdrawStatusPending(copy.status) || (lockedIsPaid && !copyIsPaid)) {
        copy.status = lockedFinal.status;
        if (lockedFinal.paidAt) copy.paidAt = lockedFinal.paidAt;
        if (lockedFinal.burnedAt) copy.burnedAt = lockedFinal.burnedAt;
        if (lockedFinal.refundedAt) copy.refundedAt = lockedFinal.refundedAt;
        if (lockedFinal.payoutMemo) copy.payoutMemo = lockedFinal.payoutMemo;
        if (lockedFinal.payoutTxBoc) copy.payoutTxBoc = lockedFinal.payoutTxBoc;
        if (lockedFinal.payoutEventId) copy.payoutEventId = lockedFinal.payoutEventId;
      }
    }
    if (!byId.has(id)) {
      byId.set(id, copy);
      return;
    }
    const existing = byId.get(id);
    const existingPending = isWithdrawStatusPending(existing.status);
    const copyPending = isWithdrawStatusPending(copy.status);
    const existingPaid = String(existing.status || '').toUpperCase().startsWith('PAID');
    const copyPaid = String(copy.status || '').toUpperCase().startsWith('PAID');
    if ((existingPending && !copyPending) || (!existingPaid && copyPaid)) {
      byId.set(id, { ...existing, ...copy });
    }
  };

  for (const w of base.withdrawals) {
    absorbWd(w);
  }
  for (const [uid, u] of Object.entries(base.users)) {
    if (!u || !Array.isArray(u.withdrawals)) continue;
    for (const w of u.withdrawals) {
      absorbWd(w, uid);
    }
  }

  const allMerged = Array.from(byId.values()).sort(
    (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)
  );

  // 2. Enforce at most 1 PENDING withdrawal per user and per wallet; remove duplicate pending requests
  const activePendingByUser = new Map();
  const activePendingByWallet = new Map();
  const keptWithdrawals = [];

  for (const w of allMerged) {
    if (w.id) {
      base.notifiedAdminRefs[`wd_id_${w.id}`] = Number(w.createdAt || Date.now());
    }
    if (!isWithdrawStatusPending(w.status)) {
      keptWithdrawals.push(w);
      continue;
    }

    const uid = String(w.userId || '').trim();
    const wRaw = parseTonAddressToRaw(w.walletRaw || w.walletAddress || '') || '';
    const hasPendingForUser = uid && activePendingByUser.has(uid);
    const hasPendingForWallet = wRaw && activePendingByWallet.has(wRaw);

    if (hasPendingForUser || hasPendingForWallet) {
      // Duplicate pending withdrawal from the same user/wallet
      const u = uid ? base.users[uid] : null;
      if (u && !hasPendingForWallet) {
        // Restore balance only up to legitimate explainable earnings ceiling
        const psList = Array.isArray(u.presalePurchases) ? u.presalePurchases : [];
        const presaleCoins = psList.reduce((acc, p) => acc + Number((p && p.coinsReceived) || 0), 0);
        const totalMined = Number(u.totalMined || 0);
        const refCoins = Number(u.referralCoinsEarned || 0);
        const nftBonus = Number(u.nftFirstMintCoinsEarned || 0);
        const maxExplainable = presaleCoins + totalMined + refCoins + nftBonus + 350;
        const paidSum = allMerged
          .filter(
            (x) =>
              x &&
              String(x.userId) === uid &&
              String(x.status || '').toUpperCase().startsWith('PAID')
          )
          .reduce((acc, x) => acc + Number(x.requestedAmount || 0), 0);
        const firstPending = activePendingByUser.get(uid);
        const keptPendingAmt = firstPending ? Number(firstPending.requestedAmount || 0) : 0;
        const legitimateRemaining = Math.max(0, maxExplainable - paidSum - keptPendingAmt);
        const curBal = Number(u.balance || 0);
        if (curBal < legitimateRemaining) {
          const refundAmt = Math.min(Number(w.requestedAmount || 0), legitimateRemaining - curBal);
          if (refundAmt > 0) {
            u.balance = +(curBal + refundAmt).toFixed(6);
          }
        }
      }
      continue;
    }

    if (uid) activePendingByUser.set(uid, w);
    if (wRaw) activePendingByWallet.set(wRaw, w);
    keptWithdrawals.push(w);
  }

  base.withdrawals = keptWithdrawals;

  // Rebuild per-user withdrawals arrays cleanly from keptWithdrawals
  const perUserMap = new Map();
  for (const w of keptWithdrawals) {
    const uid = String(w.userId || '').trim();
    if (!uid) continue;
    if (!perUserMap.has(uid)) perUserMap.set(uid, []);
    perUserMap.get(uid).push({ ...w });
  }
  for (const [uid, u] of Object.entries(base.users)) {
    if (!u || typeof u !== 'object') continue;
    u.withdrawals = perUserMap.get(String(uid).trim()) || [];
  }
}

function normalizeNftRegistryInDB(base) {
  if (!base || typeof base !== 'object') return;
  if (!base.nftRegistry || typeof base.nftRegistry !== 'object') {
    base.nftRegistry = createEmptyNftRegistry();
  }
  const reg = base.nftRegistry;
  if (typeof reg.nextMintIndex !== 'number' || reg.nextMintIndex < 0) reg.nextMintIndex = 0;
  if (!reg.mintedByIndex || typeof reg.mintedByIndex !== 'object') reg.mintedByIndex = {};
  if (!reg.firstMintBonusClaimed || typeof reg.firstMintBonusClaimed !== 'object') reg.firstMintBonusClaimed = {};
  if (!reg.userMintCounts || typeof reg.userMintCounts !== 'object') reg.userMintCounts = {};
  if (!reg.walletMintCounts || typeof reg.walletMintCounts !== 'object') reg.walletMintCounts = {};
  if (!reg.marketNetCoinsByUser || typeof reg.marketNetCoinsByUser !== 'object') reg.marketNetCoinsByUser = {};
  if (!reg.pendingTxIntents || typeof reg.pendingTxIntents !== 'object') reg.pendingTxIntents = {};

  const cfgForNft = loadConfig();
  const collectionContractActive = Boolean(
    cfgForNft.nftSale && cfgForNft.nftSale.collectionAddress
  );

  // Build map of verified on-chain NFTs from users' onChainNfts and registry entries that have onChainAddress
  const verifiedOnChainByIndex = new Map();
  const verifiedOnChainBySerial = new Map();
  for (const [k, entry] of Object.entries(reg.mintedByIndex)) {
    if (entry && entry.onChainAddress) {
      const idx0 = Number(entry.index ?? k);
      verifiedOnChainByIndex.set(idx0, entry);
      if (entry.serialCode) verifiedOnChainBySerial.set(entry.serialCode, entry);
    }
  }
  for (const u of Object.values(base.users || {})) {
    if (!u || !Array.isArray(u.onChainNfts)) continue;
    for (const oc of u.onChainNfts) {
      if (!oc || !oc.onChainAddress) continue;
      const serialNum = Number(oc.serialNum || String(oc.serialCode || '').replace(/[^0-9]/g, '') || 0);
      if (serialNum >= 1 && serialNum <= 1000) {
        const idx0 = serialNum - 1;
        verifiedOnChainByIndex.set(idx0, oc);
        if (oc.serialCode) verifiedOnChainBySerial.set(oc.serialCode, oc);
      }
    }
  }

  // If on-chain collection contract is active and we have verified on-chain state, purge any phantom off-chain NFT entries
  if (collectionContractActive && verifiedOnChainByIndex.size > 0) {
    for (const [k, entry] of Object.entries(reg.mintedByIndex)) {
      const idx0 = Number(entry?.index ?? k);
      if (!verifiedOnChainByIndex.has(idx0) && (!entry || !entry.onChainAddress)) {
        // Relink txHash/minter info to the same wallet's verified on-chain NFT if it was unlinked
        const phantomWallet = entry && (entry.firstMinterWalletRaw || entry.currentOwnerWalletRaw);
        if (entry && entry.txHash && phantomWallet) {
          for (const [realIdx, realEntry] of Object.entries(reg.mintedByIndex)) {
            if (
              realEntry &&
              realEntry.onChainAddress &&
              !realEntry.txHash &&
              (realEntry.currentOwnerWalletRaw === phantomWallet || realEntry.firstMinterWalletRaw === phantomWallet)
            ) {
              realEntry.txHash = entry.txHash;
              realEntry.bocKey = entry.bocKey || realEntry.bocKey || '';
              realEntry.firstMinterUserId = entry.firstMinterUserId || realEntry.currentOwnerUserId || '';
              realEntry.firstMinterWalletRaw = phantomWallet;
              if (entry.mintedAt) realEntry.mintedAt = entry.mintedAt;
              const txRefKey = `chain_nft_${entry.txHash}`;
              if (base.usedTxRefs && base.usedTxRefs[txRefKey]) {
                base.usedTxRefs[txRefKey].nftIndex = Number(realIdx);
                base.usedTxRefs[txRefKey].serialCode = realEntry.serialCode;
              }
              break;
            }
          }
        }
        delete reg.mintedByIndex[k];
        delete reg.firstMintBonusClaimed[k];
      }
    }

    for (const u of Object.values(base.users || {})) {
      if (!u || !Array.isArray(u.nftPurchases)) continue;
      u.nftPurchases = u.nftPurchases.filter((p) => {
        if (!p) return false;
        const serialNum = Number(p.serialNum || String(p.serialCode || '').replace(/[^0-9]/g, '') || 0);
        const idx0 = serialNum - 1;
        if (p.onChainAddress || verifiedOnChainByIndex.has(idx0) || verifiedOnChainBySerial.has(p.serialCode)) {
          const v = verifiedOnChainByIndex.get(idx0) || verifiedOnChainBySerial.get(p.serialCode);
          if (v && v.onChainAddress && !p.onChainAddress) {
            p.onChainAddress = v.onChainAddress;
            p.isOnChainMinted = true;
          }
          return true;
        }
        // Phantom off-chain duplicate (no onChainAddress and not in verified on-chain set)
        return false;
      });
    }
  }

  // Reconcile any valid in-app NFT purchases into nftRegistry
  for (const u of Object.values(base.users || {})) {
    if (!u || !Array.isArray(u.nftPurchases)) continue;
    for (const p of u.nftPurchases) {
      if (!p) continue;
      if (collectionContractActive && verifiedOnChainByIndex.size > 0 && !p.onChainAddress) continue;
      const serialNum = Number(p.serialNum || String(p.serialCode || '').replace(/[^0-9]/g, '') || 0);
      if (serialNum >= 1 && serialNum <= 1000) {
        const idx0 = serialNum - 1;
        const key = String(idx0);
        if (!reg.mintedByIndex[key]) {
          const minterUid = String(p.firstMinterUserId || p.userId || u.userId || '');
          const minterWallet = parseTonAddressToRaw(p.firstMinterWalletRaw || u.walletRaw || u.boundWalletRaw || '') || '';
          reg.mintedByIndex[key] = {
            index: idx0,
            serialNum,
            serialCode: p.serialCode || `#${String(serialNum).padStart(4, '0')}`,
            tier: p.tier || 'COMMON',
            firstMinterUserId: minterUid,
            firstMinterWalletRaw: minterWallet,
            mintedAt: Number(p.createdAt || Date.now()),
            txHash: p.txHash || '',
            bocKey: p.bocKey || '',
            onChainAddress: p.onChainAddress || '',
            currentOwnerUserId: String(u.userId || ''),
            currentOwnerWalletRaw: parseTonAddressToRaw(u.walletRaw || '') || '',
          };
        }
        if (Number(p.instantCoins || 0) > 0 && !reg.firstMintBonusClaimed[key]) {
          reg.firstMintBonusClaimed[key] = {
            userId: String(p.firstMinterUserId || p.userId || u.userId || ''),
            walletRaw: parseTonAddressToRaw(p.firstMinterWalletRaw || u.walletRaw || '') || '',
            coins: Number(p.instantCoins || 0),
            at: Number(p.createdAt || Date.now()),
          };
        }
      }
    }
  }

  // Recalculate nextMintIndex, userMintCounts, walletMintCounts, and u.nftMintCount strictly from reg.mintedByIndex
  let calcNextIndex = 0;
  const newUserMintCounts = {};
  const newWalletMintCounts = {};
  for (const [k, entry] of Object.entries(reg.mintedByIndex)) {
    if (!entry) continue;
    const idx0 = Number(entry.index ?? k);
    if (Number.isFinite(idx0) && idx0 + 1 > calcNextIndex) {
      calcNextIndex = idx0 + 1;
    }
    const uid = String(entry.firstMinterUserId || entry.currentOwnerUserId || '').trim();
    const wRaw = String(entry.firstMinterWalletRaw || entry.currentOwnerWalletRaw || '').trim();
    if (uid) newUserMintCounts[uid] = (newUserMintCounts[uid] || 0) + 1;
    if (wRaw) newWalletMintCounts[wRaw] = (newWalletMintCounts[wRaw] || 0) + 1;
  }
  reg.nextMintIndex = calcNextIndex;
  reg.userMintCounts = newUserMintCounts;
  reg.walletMintCounts = newWalletMintCounts;
  for (const [uid, u] of Object.entries(base.users || {})) {
    if (!u || typeof u !== 'object') continue;
    const wRaw = parseTonAddressToRaw(u.walletRaw || '') || '';
    const cnt = Math.max(newUserMintCounts[uid] || 0, wRaw ? newWalletMintCounts[wRaw] || 0 : 0);
    u.nftMintCount = cnt;
    u.everMintedNft = cnt > 0;
  }
}

function normalizeParsedDB(parsed) {
  const base = parsed && typeof parsed === 'object' ? parsed : createEmptyDB();
  if (!base.schemaVersion) base.schemaVersion = 2;
  if (!base.users || typeof base.users !== 'object') base.users = {};
  if (!base.walletOwners || typeof base.walletOwners !== 'object') base.walletOwners = {};
  if (!Array.isArray(base.withdrawals)) base.withdrawals = [];
  if (!base.processedWithdrawIds || typeof base.processedWithdrawIds !== 'object') {
    base.processedWithdrawIds = {};
  }
  if (!base.usedTxRefs || typeof base.usedTxRefs !== 'object') base.usedTxRefs = {};
  if (!base.notifiedAdminRefs || typeof base.notifiedAdminRefs !== 'object') base.notifiedAdminRefs = {};
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
  deduplicatePresalePurchasesInDB(base);
  for (const p of base.presale.purchases) {
    if (!p) continue;
    const ts = Number(p.createdAt || Date.now());
    if (p.id) base.notifiedAdminRefs[`ps_id_${p.id}`] = ts;
    if (p.txHash) base.notifiedAdminRefs[`ps_tx_${p.txHash}`] = ts;
    if (p.bocKey) base.notifiedAdminRefs[`ps_boc_${p.bocKey}`] = ts;
  }
  deduplicateWithdrawalsInDB(base);
  normalizeNftRegistryInDB(base);
  return base;
}

// Monotonically merges finalized withdrawal statuses, notification locks, and used tx refs from sourceDb into targetDb
// so no concurrent or warm serverless container can ever downgrade a PAID/BURNED/REFUNDED withdrawal back to PENDING!
function mergeMonotonicCloudState(targetDb, sourceDb) {
  if (!targetDb || !sourceDb || typeof targetDb !== 'object' || typeof sourceDb !== 'object') return;
  if (!targetDb.processedWithdrawIds || typeof targetDb.processedWithdrawIds !== 'object') {
    targetDb.processedWithdrawIds = {};
  }
  if (!targetDb.notifiedAdminRefs || typeof targetDb.notifiedAdminRefs !== 'object') {
    targetDb.notifiedAdminRefs = {};
  }
  if (!targetDb.usedTxRefs || typeof targetDb.usedTxRefs !== 'object') {
    targetDb.usedTxRefs = {};
  }

  for (const [k, v] of Object.entries(sourceDb.notifiedAdminRefs || {})) {
    if (v && !targetDb.notifiedAdminRefs[k]) {
      targetDb.notifiedAdminRefs[k] = v;
    }
  }
  for (const [k, v] of Object.entries(sourceDb.usedTxRefs || {})) {
    if (v && !targetDb.usedTxRefs[k]) {
      targetDb.usedTxRefs[k] = v;
    }
  }
  for (const [id, rec] of Object.entries(sourceDb.processedWithdrawIds || {})) {
    if (rec && !isWithdrawStatusPending(rec.status)) {
      recordProcessedWithdrawal(targetDb, { id, ...rec });
    }
  }
  if (Array.isArray(sourceDb.withdrawals)) {
    for (const w of sourceDb.withdrawals) {
      if (w && w.id && !isWithdrawStatusPending(w.status)) {
        recordProcessedWithdrawal(targetDb, w);
      }
    }
  }
  deduplicateWithdrawalsInDB(targetDb);
}

function loadDB() {
  const candidates = [DB_PATH, path.join(__dirname, 'data', 'database.json')];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        const rawStr = fs.readFileSync(candidate, 'utf8').replace(/^\uFEFF/, '');
        const parsed = normalizeParsedDB(JSON.parse(rawStr));
        const nextStr = JSON.stringify(parsed, null, 2);
        if (candidate === DB_PATH && nextStr !== rawStr && !process.env.VERCEL) {
          try {
            fs.writeFileSync(DB_PATH, nextStr, 'utf8');
          } catch (_) {}
        }
        return parsed;
      }
    } catch (_) {}
  }
  return createEmptyDB();
}

const db = loadDB();

// ================= FREE PERMANENT CLOUD DB (UPSTASH REDIS REST API) =================
const CLOUD_DB_KEY = process.env.CLOUD_DB_KEY || 'maxima_mining_db_v2';
let cloudDbLoaded = false;
let lastCloudLoadAt = 0;
let dbDirty = false;
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

async function ensureCloudDBLoaded(forceRefresh = false) {
  const creds = getUpstashCreds();
  if (!creds) return;

  // If this container has un-flushed local mutations, flush them first instead of overwriting them
  if (dbDirty && cloudDbLoaded) {
    await flushCloudDB().catch(() => {});
  }

  const now = Date.now();
  if (cloudDbLoaded && !forceRefresh && now - lastCloudLoadAt < 2000) {
    return;
  }
  if (cloudLoadInFlight) return cloudLoadInFlight;

  cloudLoadInFlight = (async () => {
    try {
      const data = await upstashCommand(creds, ['GET', CLOUD_DB_KEY]);
      lastCloudPingAt = Date.now();
      lastCloudLoadAt = Date.now();
      if (data && typeof data.result === 'string' && data.result.trim().startsWith('{')) {
        const cleanRaw = data.result.replace(/^\uFEFF/, '');
        if (cloudDbLoaded && cleanRaw === lastCloudJson) {
          return;
        }
        const parsed = normalizeParsedDB(JSON.parse(cleanRaw));
        mergeMonotonicCloudState(parsed, db);
        db.schemaVersion = parsed.schemaVersion;
        db.users = parsed.users;
        db.walletOwners = parsed.walletOwners || {};
        db.withdrawals = parsed.withdrawals;
        db.processedWithdrawIds = parsed.processedWithdrawIds || {};
        db.usedTxRefs = parsed.usedTxRefs;
        db.notifiedAdminRefs = parsed.notifiedAdminRefs || {};
        db.presale = parsed.presale;
        db.nftRegistry = parsed.nftRegistry || createEmptyNftRegistry();
        const normalizedSnap = JSON.stringify(db);
        lastCloudJson = cleanRaw;
        cloudDbLoaded = true;
        if (!process.env.VERCEL) {
          try {
            fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
          } catch (_) {}
        }
        if (normalizedSnap !== cleanRaw) {
          dbDirty = true;
          await flushCloudDB().catch(() => {});
        }
        console.log(`☁️  [Cloud DB] Synced ${Object.keys(db.users).length} permanent member accounts from Upstash!`);
      } else if (data && data.result === null) {
        cloudDbLoaded = true;
        dbDirty = true;
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
      // Pre-flush monotonic merge: if more than 600ms passed since last Upstash read (e.g., slow TonAPI scan),
      // pull finalized withdrawals/refs from Upstash first so we NEVER overwrite a concurrent Admin payout back to PENDING!
      if (Date.now() - lastCloudLoadAt > 600) {
        try {
          const latest = await upstashCommand(creds, ['GET', CLOUD_DB_KEY]);
          if (latest && typeof latest.result === 'string' && latest.result.trim().startsWith('{')) {
            const latestClean = latest.result.replace(/^\uFEFF/, '');
            if (latestClean !== lastCloudJson) {
              const latestParsed = JSON.parse(latestClean);
              mergeMonotonicCloudState(db, latestParsed);
            }
          }
        } catch (_) {}
      }
      deduplicateWithdrawalsInDB(db);
      const snapshot = JSON.stringify(db);
      if (snapshot === lastCloudJson) {
        dbDirty = false;
        break;
      }
      try {
        const res = await upstashCommand(creds, ['SET', CLOUD_DB_KEY, snapshot]);
        if (res && res.result === 'OK') {
          lastCloudJson = snapshot;
          lastCloudPingAt = Date.now();
          lastCloudWriteAt = Date.now();
          lastCloudLoadAt = Date.now();
          if (!cloudFlushPendingAgain) {
            dbDirty = false;
          }
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
  dbDirty = true;
  if (!process.env.VERCEL) {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    } catch (_) {}
  }

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

function serializeSingleCellBitsToBocBase64(bits) {
  const bitLen = bits.length;
  if (bitLen > 1023) {
    throw new Error(`TON single cell overflow (${bitLen} > 1023 bits)`);
  }
  const fullBytes = Math.floor(bitLen / 8);
  const dataByteLen = Math.ceil(bitLen / 8);
  const d1 = 0;
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
    0xb5, 0xee, 0x9c, 0x72,
    0x01,
    0x01,
    0x01,
    0x01,
    0x00,
    totCellsSize,
    0x00,
    d1,
    d2,
  ]);
  return Buffer.concat([header, cellData]).toString('base64');
}

function createBitBuilder() {
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
    writeUint(0n, 1); // anycast = 0
    writeUint(BigInt(wc), 8);
    writeBytes(Buffer.from(hashHex, 'hex'));
  };
  return {
    writeUint,
    writeBytes,
    writeCoins,
    writeAddress,
    toBocBase64: () => serializeSingleCellBitsToBocBase64(bits),
  };
}

// Pure-JS TextComment BOC Builder (op = 0x00000000 + UTF-8 string) for Presale / NFT Mint / Verify memos
function buildTextCommentBocBase64(commentText) {
  const clean = String(commentText || '').trim();
  if (!clean) return '';
  const b = createBitBuilder();
  b.writeUint(0n, 32);
  b.writeBytes(Buffer.from(clean, 'utf8').subarray(0, 96));
  return b.toBocBase64();
}

// Pure-JS TEP-62 NFT Transfer BOC Builder (op = 0x5fcc3d14) for On-Chain Wallet-to-Wallet NFT Transfers
function buildTep62NftTransferBocBase64({
  queryId,
  newOwnerRaw,
  responseDestinationRaw,
  forwardTonAmountNano = 1n,
  memo = 'MAXIMA NFT TRANSFER',
}) {
  const b = createBitBuilder();
  const qid =
    queryId !== undefined
      ? BigInt(queryId)
      : BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const memoBuf = Buffer.from(String(memo || 'MAXIMA NFT').trim(), 'utf8').subarray(0, 28);

  b.writeUint(0x5fcc3d14n, 32); // transfer#5fcc3d14
  b.writeUint(qid, 64); // query_id:uint64
  b.writeAddress(newOwnerRaw); // new_owner:MsgAddress
  b.writeAddress(responseDestinationRaw || newOwnerRaw); // response_destination:MsgAddress
  b.writeUint(0n, 1); // custom_payload:(Maybe ^Cell) = 0
  b.writeCoins(BigInt(forwardTonAmountNano)); // forward_amount:(VarUInteger 16)
  b.writeUint(0n, 1); // forward_payload:(Either Cell ^Cell) = 0 (inline)
  b.writeUint(0n, 32); // TextComment op = 0
  b.writeBytes(memoBuf);
  return b.toBocBase64();
}

// Pure-JS AdminMintTo (op = 0x4d494e54) BOC Builder for MAXIMA Tact NFT Collection Contract
function buildAdminContractMintBocBase64({ queryId, itemIndex, ownerRaw }) {
  const b = createBitBuilder();
  const qid =
    queryId !== undefined
      ? BigInt(queryId)
      : BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  b.writeUint(0x4d494e54n, 32); // op = 0x4d494e54 ("MINT")
  b.writeUint(qid, 64); // queryId:uint64
  b.writeUint(BigInt(Math.max(0, Math.min(999, Number(itemIndex) || 0))), 32); // itemIndex:uint32
  b.writeAddress(ownerRaw); // owner:Address
  return b.toBocBase64();
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
  if (level >= 1000) return 3875968992;
  const seg = (a, b, lo, hi, e) => Math.round(lo + (hi - lo) * Math.pow((level - a) / (b - a), e));
  if (level <= 203) return seg(1, 203, 100, 10000, 1.8);
  if (level <= 450) return seg(203, 450, 10000, 250000, 2.0);
  if (level <= 650) return seg(450, 650, 250000, 27131780, 2.2);
  if (level <= 850) return seg(650, 850, 27131780, 348837200, 2.5);
  return seg(850, 1000, 348837200, 3875968992, 2.6);
}

function miningSpeed(level) {
  if (level <= 0) return 0;
  if (level === 1) return 0.2;
  if (level >= 1000) return 5000;
  if (level <= 203) return +(0.2 + (level - 1) * ((7.56 - 0.2) / 202)).toFixed(2);
  return +(7.56 + (5000 - 7.56) * Math.pow((level - 203) / (1000 - 203), 2.1)).toFixed(2);
}

function dailyOutput(level) {
  if (level <= 0) return 0;
  return level === 1 ? 5 : +(miningSpeed(level) * 25).toFixed(2);
}

function getTierForLevel(level) {
  const L = Math.max(1, Math.min(1000, Math.floor(level || 1)));
  const idx = Math.min(9, Math.floor((L - 1) / 100));
  return WORLD_TIERS[idx];
}

function getLevelSpec(level) {
  const L = Math.max(1, Math.min(1000, Math.floor(level || 1)));
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
  let hi = 1000;
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
const accountTxCacheMap = new Map();
const accountTxInFlightMap = new Map();

function buildTonApiHeaders() {
  const headers = { Accept: 'application/json' };
  const apiKey = String(process.env.TONAPI_KEY || '').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function buildToncenterHeaders() {
  const headers = { Accept: 'application/json' };
  const apiKey = String(process.env.TONCENTER_API_KEY || '').trim();
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}

async function fetchJsonWithTimeout(url, timeoutMs = 5000, headers = { Accept: 'application/json' }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTxHashHex(rawHash) {
  const s = String(rawHash || '').trim();
  if (!s) return '';
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 32) return buf.toString('hex').toLowerCase();
  } catch (_) {}
  return s.toLowerCase();
}

function tryDecodeBocCommentText(bodyB64) {
  if (!bodyB64 || typeof bodyB64 !== 'string') return '';
  try {
    const buf = Buffer.from(bodyB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (buf.length < 16 || buf[0] !== 0xb5 || buf[1] !== 0xee || buf[2] !== 0x9c || buf[3] !== 0x72) {
      return '';
    }
    // Find 4 zero bytes (op = 0x00000000 TextComment) after BOC header
    for (let i = 8; i <= Math.min(20, buf.length - 5); i++) {
      if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 0) {
        let slice = buf.subarray(i + 4);
        // Strip trailing bit-padding byte if non-printable
        while (slice.length > 0 && (slice[slice.length - 1] === 0x80 || slice[slice.length - 1] === 0x00)) {
          slice = slice.subarray(0, slice.length - 1);
        }
        const txt = slice.toString('utf8').replace(/[^\x20-\x7E]/g, '').trim();
        if (txt.length >= 2) return txt;
      }
    }
  } catch (_) {}
  return '';
}

function normalizeTonApiTx(tx) {
  if (!tx || !tx.hash) return null;
  if (tx.aborted === true || tx.success === false) return null;
  const inMsg = tx.in_msg || null;
  if (inMsg && inMsg.bounced === true) return null;
  const comment = String(
    (inMsg &&
      ((inMsg.decoded_body && inMsg.decoded_body.text) ||
        (inMsg.msg_data && inMsg.msg_data.text))) ||
      tryDecodeBocCommentText(inMsg && inMsg.raw_body) ||
      ''
  ).trim();
  return {
    hash: normalizeTxHashHex(tx.hash),
    lt: String(tx.lt || ''),
    utime: Number(tx.utime || 0),
    in_msg: inMsg
      ? {
          source: inMsg.source?.address || inMsg.source || '',
          destination: inMsg.destination?.address || inMsg.destination || '',
          value: Number(inMsg.value || 0),
          comment,
          opCode: String(inMsg.op_code || ''),
        }
      : null,
  };
}

function normalizeToncenterV3Tx(tx) {
  if (!tx || !tx.hash) return null;
  if (tx.description && tx.description.aborted === true) return null;
  const inMsg = tx.in_msg || null;
  if (inMsg && inMsg.bounced === true) return null;
  const comment = String(
    (inMsg &&
      inMsg.message_content &&
      inMsg.message_content.decoded &&
      (inMsg.message_content.decoded.comment || inMsg.message_content.decoded.text)) ||
      tryDecodeBocCommentText(inMsg && inMsg.message_content && inMsg.message_content.body) ||
      ''
  ).trim();
  return {
    hash: normalizeTxHashHex(tx.hash),
    lt: String(tx.lt || ''),
    utime: Number(tx.now || tx.utime || 0),
    in_msg: inMsg
      ? {
          source: inMsg.source || '',
          destination: inMsg.destination || '',
          value: Number(inMsg.value || 0),
          comment,
          opCode: String(inMsg.opcode || ''),
        }
      : null,
  };
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

  // 1. Primary: TonAPI v2 (using Raw Address for wallet & contract)
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

  // 2. Automatic Fallback: Toncenter API v3 (if TonAPI hits HTTP 429 rate-limit)
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

async function fetchRecentAccountTransactions(accountAddrOrRaw, forceRefresh = false) {
  const accountRaw = parseTonAddressToRaw(accountAddrOrRaw);
  if (!accountRaw) return [];

  const now = Date.now();
  const cached = accountTxCacheMap.get(accountRaw) || { time: 0, txs: [], fetchedOnce: false };
  if (!forceRefresh && cached.fetchedOnce && now - cached.time < 15000) {
    return cached.txs;
  }
  const existingInFlight = accountTxInFlightMap.get(accountRaw);
  if (existingInFlight && !forceRefresh) {
    return existingInFlight;
  }

  const job = (async () => {
    const collected = [];
    let primaryOk = false;

    // 1. Primary: TonAPI v2
    try {
      let beforeLt = '';
      const maxPages = cached.fetchedOnce ? 1 : 3;
      for (let page = 0; page < maxPages; page++) {
        const ltQuery = beforeLt ? `&before_lt=${encodeURIComponent(beforeLt)}` : '';
        const data = await fetchJsonWithTimeout(
          `https://tonapi.io/v2/blockchain/accounts/${encodeURIComponent(accountRaw)}/transactions?limit=100${ltQuery}`,
          5500,
          buildTonApiHeaders()
        );
        const batch = Array.isArray(data && data.transactions) ? data.transactions : [];
        primaryOk = true;
        if (!batch.length) break;
        for (const rawTx of batch) {
          const norm = normalizeTonApiTx(rawTx);
          if (norm && norm.hash) collected.push(norm);
        }
        beforeLt = batch[batch.length - 1].lt;
        if (batch.length < 100) break;
      }
    } catch (_) {}

    // 2. Automatic Fallback: Toncenter API v3 (eliminates HTTP 429 / timeout payment stalls!)
    if (!primaryOk || collected.length === 0) {
      try {
        const data = await fetchJsonWithTimeout(
          `https://toncenter.com/api/v3/transactions?account=${encodeURIComponent(accountRaw)}&limit=100&sort=desc`,
          6000,
          buildToncenterHeaders()
        );
        const batch = Array.isArray(data && data.transactions) ? data.transactions : [];
        const existingHashes = new Set(collected.map((t) => t.hash));
        for (const rawTx of batch) {
          const norm = normalizeToncenterV3Tx(rawTx);
          if (norm && norm.hash && !existingHashes.has(norm.hash)) {
            collected.push(norm);
            existingHashes.add(norm.hash);
          }
        }
      } catch (_) {}
    }

    if (collected.length) {
      const seen = new Set(collected.map((t) => t.hash));
      for (const oldTx of cached.txs) {
        if (oldTx && oldTx.hash && !seen.has(oldTx.hash) && collected.length < 400) {
          collected.push(oldTx);
          seen.add(oldTx.hash);
        }
      }
      collected.sort((a, b) => Number(b.utime || 0) - Number(a.utime || 0));
      const updated = { time: Date.now(), txs: collected, fetchedOnce: true };
      accountTxCacheMap.set(accountRaw, updated);
      return collected;
    }
    return cached.txs;
  })().finally(() => {
    accountTxInFlightMap.delete(accountRaw);
  });

  accountTxInFlightMap.set(accountRaw, job);
  return job;
}

async function fetchRecentCreatorTransactions(cfg, forceRefresh = false) {
  const creatorRaw =
    parseTonAddressToRaw(cfg.wallet?.creatorRawAddress) ||
    parseTonAddressToRaw(cfg.wallet?.creatorTonWallet);
  if (!creatorRaw) return [];
  return fetchRecentAccountTransactions(creatorRaw, forceRefresh);
}

async function fetchNftPaymentTransactions(cfg, forceRefresh = false) {
  const creatorRaw =
    parseTonAddressToRaw(cfg.nftSale?.recipientWallet) ||
    parseTonAddressToRaw(cfg.wallet?.creatorRawAddress) ||
    parseTonAddressToRaw(cfg.wallet?.creatorTonWallet);
  const colRaw = parseTonAddressToRaw(cfg.nftSale?.collectionAddress);

  const lists = [];
  if (creatorRaw) {
    lists.push(await fetchRecentAccountTransactions(creatorRaw, forceRefresh));
  }
  if (colRaw && colRaw !== creatorRaw) {
    lists.push(await fetchRecentAccountTransactions(colRaw, forceRefresh));
  }
  if (lists.length === 1) return lists[0];
  const merged = [];
  const seen = new Set();
  for (const arr of lists) {
    for (const tx of arr || []) {
      if (tx && tx.hash && !seen.has(tx.hash)) {
        seen.add(tx.hash);
        merged.push(tx);
      }
    }
  }
  merged.sort((a, b) => Number(b.utime || 0) - Number(a.utime || 0));
  return merged;
}

function isChainTxHashUsed(txHash) {
  const h = normalizeTxHashHex(txHash);
  if (!h) return true;
  if (!db.usedTxRefs || typeof db.usedTxRefs !== 'object') db.usedTxRefs = {};
  return Boolean(
    db.usedTxRefs[`chain_${h}`] ||
      db.usedTxRefs[`chain_ps_${h}`] ||
      db.usedTxRefs[`chain_nft_${h}`]
  );
}

function recordPendingWalletTxIntent(walletRaw, mode, extra = {}) {
  const wRaw = parseTonAddressToRaw(walletRaw);
  if (!wRaw) return;
  if (!db.nftRegistry || typeof db.nftRegistry !== 'object') {
    db.nftRegistry = createEmptyNftRegistry();
  }
  if (!db.nftRegistry.pendingTxIntents || typeof db.nftRegistry.pendingTxIntents !== 'object') {
    db.nftRegistry.pendingTxIntents = {};
  }
  db.nftRegistry.pendingTxIntents[wRaw] = {
    mode: String(mode || '').toLowerCase(),
    packageId: extra.packageId ? String(extra.packageId) : '',
    userId: extra.userId ? String(extra.userId) : '',
    createdAt: Date.now(),
  };
}

function getActivePendingWalletTxIntent(walletRaw) {
  const wRaw = parseTonAddressToRaw(walletRaw);
  if (!wRaw || !db.nftRegistry || !db.nftRegistry.pendingTxIntents) return null;
  const entry = db.nftRegistry.pendingTxIntents[wRaw];
  if (!entry || !entry.mode) return null;
  if (Date.now() - Number(entry.createdAt || 0) > 45 * 60 * 1000) {
    delete db.nftRegistry.pendingTxIntents[wRaw];
    return null;
  }
  return entry;
}

function clearPendingWalletTxIntent(walletRaw, expectedMode = null) {
  const wRaw = parseTonAddressToRaw(walletRaw);
  if (!wRaw || !db.nftRegistry || !db.nftRegistry.pendingTxIntents) return;
  const entry = db.nftRegistry.pendingTxIntents[wRaw];
  if (!entry) return;
  if (!expectedMode || entry.mode === expectedMode) {
    delete db.nftRegistry.pendingTxIntents[wRaw];
  }
}

// Disambiguates incoming TON transactions (especially 10 GRAM Presale pkg_10 vs 10 GRAM NFT Mint!)
function classifyIncomingTonTx(cfg, tx, userWalletRaw, explicitCallerMode = null) {
  if (!tx || !tx.in_msg) return 'unknown';
  const destRaw = parseTonAddressToRaw(tx.in_msg.destination);
  const colRaw = parseTonAddressToRaw(cfg.nftSale?.collectionAddress);
  if (colRaw && destRaw === colRaw) return 'nft';

  const commentUpper = String(tx.in_msg.comment || '').trim().toUpperCase();
  if (commentUpper) {
    if (
      commentUpper.includes('NFT') ||
      commentUpper === 'MINT' ||
      commentUpper.startsWith('MINT ') ||
      commentUpper.includes('RIG')
    ) {
      return 'nft';
    }
    if (commentUpper.includes('PRESALE') || commentUpper.includes('PKG_')) {
      return 'presale';
    }
    if (commentUpper.includes('VERIFY')) {
      return 'verify';
    }
  }

  const intent = getActivePendingWalletTxIntent(userWalletRaw);
  if (intent && intent.mode) {
    return intent.mode;
  }
  if (explicitCallerMode) {
    return explicitCallerMode;
  }
  return 'presale';
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
    if (srcRaw === user.walletRaw && val >= minNano && val <= maxNano && !isChainTxHashUsed(tx.hash)) {
      if (findWalletOwnerUserId(srcRaw, user.userId)) continue;
      const txTimeMs = tx.utime ? tx.utime * 1000 : Date.now();
      const isRecentTx = Date.now() - txTimeMs < 30 * 60 * 1000;
      const refKey = `chain_${tx.hash}`;
      db.usedTxRefs[refKey] = { type: 'verify', userId: user.userId, walletRaw: user.walletRaw, at: txTimeMs };
      clearPendingWalletTxIntent(user.walletRaw, 'verify');
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
      await flushCloudDB().catch(() => {});
      if (isRecentTx) {
        await Promise.allSettled([
          notifyTelegramUser(
            cfg,
            user.userId,
            `✅ *Wallet Automatically Verified (On-Chain)!*\n\nYour *${feeTon} GRAM* verification payment was detected on-chain. *Withdraw ${cfg.token.symbol}* is now unlocked!`
          ),
          notifyAdminsWalletVerified(cfg, user, tx.hash),
        ]);
      }
      return true;
    }
  }
  return false;
}

// Per-user/wallet async mutex to prevent race conditions between on-chain polling and TON Connect txBoc callbacks
const userTxLocks = new Map();
async function withUserTxLock(key, fn) {
  const lockKey = String(key || 'global');
  const prev = userTxLocks.get(lockKey) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  const chain = prev.then(
    () => next,
    () => next
  );
  userTxLocks.set(lockKey, chain);
  try {
    await prev.catch(() => {});
    return await fn();
  } finally {
    release();
    if (userTxLocks.get(lockKey) === chain) {
      userTxLocks.delete(lockKey);
    }
  }
}

// Automatically detect if connected wallet sent 2, 4, 6, 8, 10, 20, or 100 TON for Presale on-chain
async function tryAutoPresaleFromChainUnlocked(cfg, user, forceRefresh = false, explicitCaller = false) {
  if (!user.walletRaw) return null;
  const ownerOfWallet = findWalletOwnerUserId(user.walletRaw, user.userId);
  if (ownerOfWallet) return null;
  // Presale tetap dibuka dan tetap otomatis terdeteksi meskipun waktu presale telah berakhir (Ended)
  // const presaleEndsAtMs = Date.parse(cfg.presale?.endsAt || '2026-11-10T23:59:59Z');
  // if (Number.isFinite(presaleEndsAtMs) && Date.now() >= presaleEndsAtMs) return null;

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

    if (isChainTxHashUsed(tx.hash)) continue;

    const valNano = Number(tx.in_msg.value || 0);
    if (valNano < 1.85 * 1e9) continue;

    const matchedPkg = packages.find((p) => {
      const targetNano = p.ton * 1e9;
      return Math.abs(valNano - targetNano) <= targetNano * 0.04;
    });
    if (!matchedPkg) continue;

    // Prevent 10 GRAM NFT Mint from ever being misclassified as 10 GRAM Presale!
    const txClass = classifyIncomingTonTx(cfg, tx, user.walletRaw, explicitCaller ? 'presale' : null);
    if (txClass === 'nft' || txClass === 'verify') continue;

    const refKey = `chain_ps_${tx.hash}`;
    const txTimeMs = tx.utime ? tx.utime * 1000 : Date.now();
    ensureUserSchema(user);

    // Check if this transaction was already credited via immediate TON Connect BOC within 60 minutes
    const userReceipts = Array.isArray(user.presalePurchases) ? user.presalePurchases : [];
    const globalReceipts = db.presale && Array.isArray(db.presale.purchases) ? db.presale.purchases : [];
    const allReceipts = [...userReceipts, ...globalReceipts];

    if (allReceipts.some((p) => p && p.txHash === tx.hash)) {
      db.usedTxRefs[refKey] = {
        type: 'presale',
        userId: user.userId,
        ton: matchedPkg.ton,
        at: txTimeMs,
      };
      saveDB(true);
      await flushCloudDB().catch(() => {});
      continue;
    }

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
      for (const r of userReceipts) {
        if (r && r.id === existingBocReceipt.id) r.txHash = tx.hash;
      }
      for (const r of globalReceipts) {
        if (r && r.id === existingBocReceipt.id) r.txHash = tx.hash;
      }
      db.usedTxRefs[refKey] = {
        type: 'presale',
        userId: existingBocReceipt.userId || user.userId,
        ton: matchedPkg.ton,
        at: txTimeMs,
        linkedReceipt: existingBocReceipt.id,
      };
      if (!db.notifiedAdminRefs || typeof db.notifiedAdminRefs !== 'object') db.notifiedAdminRefs = {};
      db.notifiedAdminRefs[`ps_tx_${tx.hash}`] = txTimeMs;
      if (existingBocReceipt.id) db.notifiedAdminRefs[`ps_id_${existingBocReceipt.id}`] = txTimeMs;
      clearPendingWalletTxIntent(user.walletRaw, 'presale');
      saveDB(true);
      await flushCloudDB().catch(() => {});
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
    clearPendingWalletTxIntent(user.walletRaw, 'presale');
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
    db.presale.purchases.push({ ...receipt });
    saveDB(true);
    await flushCloudDB().catch(() => {});

    if (Date.now() - txTimeMs < 30 * 60 * 1000) {
      await Promise.allSettled([
        notifyTelegramUser(
          cfg,
          user.userId,
          `🚀 *Presale Purchase Automatically Detected (On-Chain)!*\n\n• *Paid:* ${matchedPkg.ton} GRAM\n• *Coins Received:* +${matchedPkg.coins.toLocaleString('en-US')} ${cfg.token.symbol}\n• *Wallet Quota Used:* ${db.presale.walletTonSpent[user.walletRaw]} / ${maxTonWallet} GRAM`
        ),
        notifyAdminsNewPresale(cfg, user, receipt),
      ]);
    }

    creditedPkg = matchedPkg;
  }

  return creditedPkg;
}

async function tryAutoPresaleFromChain(cfg, user, forceRefresh = false) {
  if (!user || !user.walletRaw) return null;
  return withUserTxLock(`tx_${user.walletRaw || user.userId}`, () =>
    tryAutoPresaleFromChainUnlocked(cfg, user, forceRefresh, false)
  );
}

// ================= PRIMARY NFT MINT QUOTA, FIRST-MINT JACKPOT & ON-CHAIN AUTO-DETECTION =================
function ensureNftRegistry() {
  if (!db.nftRegistry || typeof db.nftRegistry !== 'object') {
    db.nftRegistry = createEmptyNftRegistry();
  }
  const r = db.nftRegistry;
  if (typeof r.nextMintIndex !== 'number' || r.nextMintIndex < 0) r.nextMintIndex = 0;
  if (!r.mintedByIndex || typeof r.mintedByIndex !== 'object') r.mintedByIndex = {};
  if (!r.firstMintBonusClaimed || typeof r.firstMintBonusClaimed !== 'object') r.firstMintBonusClaimed = {};
  if (!r.userMintCounts || typeof r.userMintCounts !== 'object') r.userMintCounts = {};
  if (!r.walletMintCounts || typeof r.walletMintCounts !== 'object') r.walletMintCounts = {};
  if (!r.marketNetCoinsByUser || typeof r.marketNetCoinsByUser !== 'object') r.marketNetCoinsByUser = {};
  if (!r.pendingTxIntents || typeof r.pendingTxIntents !== 'object') r.pendingTxIntents = {};
  return r;
}

function getUserPrimaryMintCount(user) {
  if (!user) return 0;
  const reg = ensureNftRegistry();
  const uid = String(user.userId || '').trim();
  const byUid = uid ? Number(reg.userMintCounts[uid] || 0) : 0;
  const wRaw = parseTonAddressToRaw(user.walletRaw || '');
  const byWallet = wRaw ? Number(reg.walletMintCounts[wRaw] || 0) : 0;
  const fromUserField = Number(user.nftMintCount || 0);
  return Math.max(byUid, byWallet, fromUserField);
}

function executePrimaryNftMintUnlocked(
  cfg,
  user,
  { txHash = '', bocKey = '', tonPaid = 10, createdAt = Date.now(), onChainAddress = '', targetIndex = null }
) {
  ensureUserSchema(user);
  const reg = ensureNftRegistry();
  const maxTotalSupply = Number(cfg.nftSale?.maxTotalSupply || 1000);
  const maxMintPerUser = Number(cfg.nftSale?.maxMintPerUser || cfg.nftSale?.maxPerWallet || 5);
  const maxMintPerWallet = Number(cfg.nftSale?.maxMintPerWallet || cfg.nftSale?.maxPerWallet || 5);

  const uid = String(user.userId || '').trim();
  const wRaw = parseTonAddressToRaw(user.walletRaw || '') || '';

  let idx0;
  const hasExplicitTarget =
    typeof targetIndex === 'number' &&
    Number.isInteger(targetIndex) &&
    targetIndex >= 0 &&
    targetIndex < maxTotalSupply;

  if (hasExplicitTarget) {
    idx0 = targetIndex;
  } else {
    const usedByUser = uid ? Number(reg.userMintCounts[uid] || 0) : 0;
    const usedByWallet = wRaw ? Number(reg.walletMintCounts[wRaw] || 0) : 0;
    if (usedByUser >= maxMintPerUser || usedByWallet >= maxMintPerWallet) {
      return {
        ok: false,
        error: `⚠️ Maximum primary mint limit (${maxMintPerUser} NFTs per user/wallet) reached! You can still buy or receive NFTs from other users.`,
      };
    }

    idx0 = Math.max(0, Math.floor(reg.nextMintIndex || 0));
    while (idx0 < maxTotalSupply && reg.mintedByIndex[String(idx0)]) {
      idx0++;
    }
    if (idx0 >= maxTotalSupply) {
      return {
        ok: false,
        error: `⛔ Sold Out! All ${maxTotalSupply.toLocaleString('en-US')} Genesis NFTs have been minted!`,
      };
    }
  }

  const spec = getManifestNftByIndex(idx0);
  const key = String(idx0);
  if (idx0 + 1 > reg.nextMintIndex) {
    reg.nextMintIndex = idx0 + 1;
  }

  const existingRegEntry = reg.mintedByIndex[key] || null;
  const resolvedOnChainAddress =
    onChainAddress || (existingRegEntry && existingRegEntry.onChainAddress) || '';

  // EXCLUSIVE FIRST-MINT BONUS: ONLY Legendary (+10,000 MAXIMA) & Mythic (+20,000 MAXIMA) on very first primary mint of this NFT item!
  const alreadyClaimedBonus = Boolean(reg.firstMintBonusClaimed[key]);
  const isLegendaryOrMythic = spec.tier === 'LEGENDARY' || spec.tier === 'MYTHIC';
  const awardedMaxima = !alreadyClaimedBonus && isLegendaryOrMythic ? Number(spec.firstMintMaxima || 0) : 0;

  if (!alreadyClaimedBonus) {
    reg.firstMintBonusClaimed[key] = {
      userId: uid,
      walletRaw: wRaw,
      tier: spec.tier,
      coins: awardedMaxima,
      at: createdAt,
    };
  }

  accruePendingMining(cfg, user);
  if (awardedMaxima > 0) {
    user.balance = +(user.balance + awardedMaxima).toFixed(6);
    user.nftFirstMintCoinsEarned = +(Number(user.nftFirstMintCoinsEarned || 0) + awardedMaxima).toFixed(6);
  }

  const cleanTxHash = txHash ? normalizeTxHashHex(txHash) : (existingRegEntry && existingRegEntry.txHash) || '';
  const cleanBocKey = bocKey || (existingRegEntry && existingRegEntry.bocKey) || '';

  if (cleanTxHash) {
    db.usedTxRefs[`chain_nft_${cleanTxHash}`] = {
      type: 'nft',
      userId: uid,
      walletRaw: wRaw,
      nftIndex: idx0,
      serialCode: spec.serialCode,
      ton: tonPaid,
      at: createdAt,
    };
  }
  if (cleanBocKey) {
    db.usedTxRefs[cleanBocKey] = {
      type: 'nft',
      userId: uid,
      walletRaw: wRaw,
      nftIndex: idx0,
      serialCode: spec.serialCode,
      ton: tonPaid,
      at: createdAt,
    };
  }
  clearPendingWalletTxIntent(wRaw, 'nft');

  const receipt = {
    id: `NFT-${createdAt}-${idx0}-${Math.floor(100 + Math.random() * 900)}`,
    index: idx0,
    userId: uid,
    firstMinterUserId: uid,
    firstMinterWalletRaw: wRaw,
    ownerWalletRaw: wRaw,
    onChainAddress: resolvedOnChainAddress,
    isOnChainMinted: Boolean(resolvedOnChainAddress),
    isOnChainSynced: Boolean(resolvedOnChainAddress),
    nftId: spec.nftId,
    name: spec.name,
    fullTitle: spec.fullTitle,
    tier: spec.tier,
    icon: spec.icon,
    image: `/nft/art/${idx0}.svg`,
    tonPaid,
    powerBoostPct: spec.powerBoostPct,
    firstMintMaxima: spec.firstMintMaxima,
    instantCoins: awardedMaxima,
    wasFirstMint: true,
    theme: spec.theme,
    serialNum: spec.serialNum,
    serialCode: spec.serialCode,
    dnaHash: spec.dnaHash,
    bgAura: spec.bgAura,
    coreGeometry: spec.coreGeometry,
    emblemFinish: spec.emblemFinish,
    overclockPct: spec.overclockPct,
    txHash: cleanTxHash,
    bocKey: cleanBocKey,
    createdAt,
  };

  reg.mintedByIndex[key] = {
    index: idx0,
    serialNum: spec.serialNum,
    serialCode: spec.serialCode,
    tier: spec.tier,
    powerBoostPct: spec.powerBoostPct,
    firstMinterUserId: (existingRegEntry && existingRegEntry.firstMinterUserId) || uid,
    firstMinterWalletRaw: (existingRegEntry && existingRegEntry.firstMinterWalletRaw) || wRaw,
    mintedAt: (existingRegEntry && existingRegEntry.mintedAt) || createdAt,
    txHash: cleanTxHash,
    bocKey: cleanBocKey,
    onChainAddress: resolvedOnChainAddress,
    currentOwnerUserId: uid,
    currentOwnerWalletRaw: wRaw,
  };

  // Upsert into user.nftPurchases by serialCode so the same NFT index is never added twice
  if (!Array.isArray(user.nftPurchases)) user.nftPurchases = [];
  const existingPurchaseIdx = user.nftPurchases.findIndex(
    (p) => p && (p.serialCode === spec.serialCode || Number(p.index) === idx0)
  );
  if (existingPurchaseIdx >= 0) {
    user.nftPurchases[existingPurchaseIdx] = {
      ...user.nftPurchases[existingPurchaseIdx],
      ...receipt,
      id: user.nftPurchases[existingPurchaseIdx].id || receipt.id,
    };
  } else {
    user.nftPurchases.push(receipt);
  }

  // Recalculate mint counts strictly from reg.mintedByIndex so 1 NFT = 1 Mint Count
  let userCount = 0;
  let walletCount = 0;
  for (const entry of Object.values(reg.mintedByIndex)) {
    if (!entry) continue;
    const eUid = String(entry.firstMinterUserId || entry.currentOwnerUserId || '').trim();
    const eWal = String(entry.firstMinterWalletRaw || entry.currentOwnerWalletRaw || '').trim();
    if (uid && eUid === uid) userCount++;
    if (wRaw && eWal === wRaw) walletCount++;
  }
  if (uid) reg.userMintCounts[uid] = Math.max(1, userCount);
  if (wRaw) reg.walletMintCounts[wRaw] = Math.max(1, walletCount);
  user.nftMintCount = Math.max(reg.userMintCounts[uid] || 1, reg.walletMintCounts[wRaw] || 1);
  user.everMintedNft = true;

  saveDB(true);

  const bonusNote =
    awardedMaxima > 0
      ? `\n🎁 *1st-Mint Exclusive Bonus:* +${awardedMaxima.toLocaleString('en-US')} ${cfg.token.symbol}`
      : '';
  notifyTelegramUser(
    cfg,
    user.userId,
    `💎 *Genesis NFT Minted!*\n\n• *NFT:* ${spec.name} ${spec.serialCode} (${spec.tier})\n• *Mining Power Boost:* +${spec.powerBoostPct}%${bonusNote}\n• *Mint Quota Used:* ${getUserPrimaryMintCount(user)} / ${maxMintPerUser}`
  ).catch(() => {});

  return { ok: true, receipt, awardedMaxima, spec };
}

async function tryAutoNftMintFromChainUnlocked(cfg, user, forceRefresh = false, explicitCaller = false) {
  if (!user || !user.walletRaw) return null;
  if (findWalletOwnerUserId(user.walletRaw, user.userId)) return null;

  const startsAtMs = Date.parse(cfg.nftSale?.startsAt || '2026-11-04T00:00:00Z');
  if (Number.isFinite(startsAtMs) && Date.now() < startsAtMs) return null;

  const colAddrRaw = parseTonAddressToRaw(cfg.nftSale?.collectionAddress || '');
  const contractMintMode = Boolean(colAddrRaw);

  // Always reconcile on-chain collection & user wallet NFTs BEFORE matching payment transactions
  if (contractMintMode) {
    await reconcileCollectionOnChainOwnership(cfg, forceRefresh).catch(() => false);
    await syncOnChainNftsForUser(cfg, user, forceRefresh).catch(() => false);
  }

  const boxPriceTon = Number(cfg.nftSale?.boxPriceTon || 10);
  const gasTon = isDirectContractMintActive(cfg) ? Number(cfg.nftSale?.contractMintGasTon || 0.08) : 0;
  const minTargetNano = Math.round(boxPriceTon * 1e9 * 0.95);
  const maxTargetNano = Math.round((boxPriceTon + Math.max(0.25, gasTon + 0.15)) * 1e9 * 1.04);

  const txs = await fetchNftPaymentTransactions(cfg, forceRefresh);
  let lastMintedReceipt = null;

  for (const tx of txs) {
    if (!tx || !tx.hash || !tx.in_msg) continue;
    const srcRaw = parseTonAddressToRaw(tx.in_msg.source?.address || tx.in_msg.source);
    if (srcRaw !== user.walletRaw) continue;
    if (isChainTxHashUsed(tx.hash)) continue;

    const valNano = Number(tx.in_msg.value || 0);
    if (valNano < minTargetNano || valNano > maxTargetNano) continue;

    const txClass = classifyIncomingTonTx(cfg, tx, user.walletRaw, explicitCaller ? 'nft' : null);
    if (txClass !== 'nft') continue;

    const txTimeMs = tx.utime ? tx.utime * 1000 : Date.now();
    // Ignore very old historical 10 TON transactions from before NFT Minting launch!
    if (Number.isFinite(startsAtMs) && txTimeMs < startsAtMs - 3600 * 1000) continue;

    ensureUserSchema(user);
    const reg = ensureNftRegistry();

    // 1. Check if an unhashed receipt in user.nftPurchases already recorded this exact mint
    const userNftList = Array.isArray(user.nftPurchases) ? user.nftPurchases : [];
    const existingUnhashedNft = userNftList.find(
      (n) =>
        n &&
        !n.txHash &&
        (n.firstMinterUserId === String(user.userId) || n.ownerWalletRaw === user.walletRaw) &&
        (!contractMintMode || Boolean(n.onChainAddress))
    );
    if (existingUnhashedNft) {
      existingUnhashedNft.txHash = tx.hash;
      const idxKey = String(existingUnhashedNft.index ?? (Number(existingUnhashedNft.serialNum || 1) - 1));
      if (reg.mintedByIndex[idxKey]) {
        reg.mintedByIndex[idxKey].txHash = tx.hash;
        if (!reg.mintedByIndex[idxKey].firstMinterUserId) {
          reg.mintedByIndex[idxKey].firstMinterUserId = String(user.userId);
        }
        if (!reg.mintedByIndex[idxKey].firstMinterWalletRaw) {
          reg.mintedByIndex[idxKey].firstMinterWalletRaw = user.walletRaw;
        }
      }
      db.usedTxRefs[`chain_nft_${tx.hash}`] = {
        type: 'nft',
        userId: user.userId,
        walletRaw: user.walletRaw,
        nftIndex: Number(idxKey),
        serialCode: existingUnhashedNft.serialCode,
        ton: boxPriceTon,
        at: txTimeMs,
        linkedReceipt: existingUnhashedNft.id,
      };
      clearPendingWalletTxIntent(user.walletRaw, 'nft');
      saveDB(true);
      await flushCloudDB().catch(() => {});
      lastMintedReceipt = existingUnhashedNft;
      continue;
    }

    // 2. When on-chain collection contract is active, match this payment tx directly to the user's on-chain minted NFT item!
    if (contractMintMode) {
      const onChainList = Array.isArray(user.onChainNfts) ? user.onChainNfts : [];
      let matchedOnChainIdx = null;
      let matchedOnChainAddr = '';

      // First look in user.onChainNfts for an item whose reg.mintedByIndex entry has no txHash yet
      for (const oc of onChainList) {
        if (!oc) continue;
        const idx0 = typeof oc.index === 'number' ? oc.index : Number(oc.serialNum || 1) - 1;
        const rEntry = reg.mintedByIndex[String(idx0)];
        if (!rEntry || !rEntry.txHash || rEntry.txHash === tx.hash) {
          matchedOnChainIdx = idx0;
          matchedOnChainAddr = oc.onChainAddress || (rEntry && rEntry.onChainAddress) || '';
          break;
        }
      }

      // Fallback: look in reg.mintedByIndex for any on-chain item owned by this wallet without a txHash
      if (matchedOnChainIdx === null) {
        for (const [k, rEntry] of Object.entries(reg.mintedByIndex)) {
          if (
            rEntry &&
            rEntry.onChainAddress &&
            (!rEntry.txHash || rEntry.txHash === tx.hash) &&
            (rEntry.currentOwnerWalletRaw === user.walletRaw || rEntry.firstMinterWalletRaw === user.walletRaw)
          ) {
            matchedOnChainIdx = Number(rEntry.index ?? k);
            matchedOnChainAddr = rEntry.onChainAddress;
            break;
          }
        }
      }

      if (matchedOnChainIdx !== null) {
        const mintRes = executePrimaryNftMintUnlocked(cfg, user, {
          txHash: tx.hash,
          bocKey: '',
          tonPaid: boxPriceTon,
          createdAt: txTimeMs,
          onChainAddress: matchedOnChainAddr,
          targetIndex: matchedOnChainIdx,
        });
        await flushCloudDB().catch(() => {});
        if (mintRes && mintRes.ok && mintRes.receipt) {
          lastMintedReceipt = mintRes.receipt;
        }
      }
      // Never fabricate an off-chain phantom NFT when contractMintMode is active!
      continue;
    }

    const mintRes = executePrimaryNftMintUnlocked(cfg, user, {
      txHash: tx.hash,
      bocKey: '',
      tonPaid: boxPriceTon,
      createdAt: txTimeMs,
    });
    await flushCloudDB().catch(() => {});
    if (mintRes && mintRes.ok && mintRes.receipt) {
      lastMintedReceipt = mintRes.receipt;
    } else {
      break;
    }
  }

  return lastMintedReceipt;
}

async function tryAutoNftMintFromChain(cfg, user, forceRefresh = false, explicitCaller = false) {
  if (!user || !user.walletRaw) return null;
  return withUserTxLock(`tx_${user.walletRaw || user.userId}`, () =>
    tryAutoNftMintFromChainUnlocked(cfg, user, forceRefresh, explicitCaller)
  );
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

  // Referrals & Presale & NFTs & Withdrawals
  if (!Array.isArray(u.referrals)) u.referrals = [];
  if (typeof u.referralBonusPaid !== 'boolean') u.referralBonusPaid = false;
  if (typeof u.referralCoinsEarned !== 'number') u.referralCoinsEarned = 0;
  if (typeof u.referralMiningEarned !== 'number') u.referralMiningEarned = 0;
  if (!Array.isArray(u.presalePurchases)) u.presalePurchases = [];
  if (!Array.isArray(u.nftPurchases)) u.nftPurchases = [];
  if (!Array.isArray(u.onChainNfts)) u.onChainNfts = [];
  if (typeof u.nftMintCount !== 'number' || Number.isNaN(u.nftMintCount)) u.nftMintCount = 0;
  if (typeof u.nftFirstMintCoinsEarned !== 'number' || Number.isNaN(u.nftFirstMintCoinsEarned)) {
    u.nftFirstMintCoinsEarned = 0;
  }
  if (!Array.isArray(u.withdrawals)) u.withdrawals = [];
}

// ================= 1,000-NFT MANIFEST (TEP-64 ON-CHAIN METADATA & TRAIT ENGINE) =================
let cachedNft1000Manifest = null;

function parseCsvRow(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function loadNft1000Manifest() {
  if (cachedNft1000Manifest) return cachedNft1000Manifest;
  cachedNft1000Manifest = [];
  try {
    const csvPath = path.join(PUBLIC_DIR, 'nft', 'manifest-1000-nfts.csv');
    if (fs.existsSync(csvPath)) {
      const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvRow(lines[i]);
        if (cols.length < 11) continue;
        const idx = Number(cols[0]);
        const tier = String(cols[3] || 'COMMON').toUpperCase();
        const boostPct =
          Number(String(cols[4] || '').replace(/[^0-9.]/g, '')) ||
          (tier === 'MYTHIC' ? 10 : tier === 'LEGENDARY' ? 8 : tier === 'EPIC' ? 6 : tier === 'RARE' ? 4 : 2);
        const firstMintMaxima =
          tier === 'MYTHIC' ? 20000 : tier === 'LEGENDARY' ? 10000 : 0;
        const nftId =
          tier === 'MYTHIC'
            ? 'nft_mythic'
            : tier === 'LEGENDARY'
            ? 'nft_diamond'
            : tier === 'EPIC'
            ? 'nft_gold'
            : tier === 'RARE'
            ? 'nft_silver'
            : 'nft_bronze';
        const theme =
          tier === 'MYTHIC'
            ? 'mythic'
            : tier === 'LEGENDARY'
            ? 'diamond'
            : tier === 'EPIC'
            ? 'gold'
            : tier === 'RARE'
            ? 'silver'
            : 'bronze';
        const icon =
          tier === 'MYTHIC'
            ? '👑'
            : tier === 'LEGENDARY'
            ? '💎'
            : tier === 'EPIC'
            ? '⚡'
            : tier === 'RARE'
            ? '⚙️'
            : '⛏️';
        const image =
          tier === 'MYTHIC'
            ? 'nft/mythic.svg'
            : tier === 'LEGENDARY'
            ? 'nft/legendary.svg'
            : tier === 'EPIC'
            ? 'nft/epic.svg'
            : tier === 'RARE'
            ? 'nft/rare.svg'
            : 'nft/common.svg';
        cachedNft1000Manifest[idx] = {
          index: idx,
          serialNum: idx + 1,
          serialCode: cols[1] || `#${String(idx + 1).padStart(4, '0')}`,
          fullTitle: cols[2] || `MAXIMA Rig #${String(idx + 1).padStart(4, '0')}`,
          name:
            tier === 'MYTHIC'
              ? 'CEO Crown Mythic NFT'
              : tier === 'LEGENDARY'
              ? 'Plasma Core Genesis NFT'
              : tier === 'EPIC'
              ? 'Golden Reactor Rig NFT'
              : tier === 'RARE'
              ? 'Cyber Drill Rig NFT'
              : 'Bronze Pickaxe Rig NFT',
          nftId,
          tier,
          theme,
          icon,
          image,
          powerBoostPct: boostPct,
          firstMintMaxima,
          bgAura: cols[6] || 'Genesis Core',
          coreGeometry: cols[7] || 'Vortex Singularity',
          emblemFinish: cols[8] || '24K Sovereign Gold',
          overclockPct: cols[9] || '95.00%',
          dnaHash: cols[10] || `0xMAX${String(idx + 1).padStart(4, '0')}`,
        };
      }
    }
  } catch (err) {
    console.warn('Manifest load warning:', err.message);
  }
  return cachedNft1000Manifest;
}

function getManifestNftByIndex(index0) {
  const list = loadNft1000Manifest();
  const clamped = Math.max(0, Math.min(999, Number(index0) || 0));
  if (list[clamped]) return list[clamped];
  const serialCode = `#${String(clamped + 1).padStart(4, '0')}`;
  return {
    index: clamped,
    serialNum: clamped + 1,
    serialCode,
    fullTitle: `Bronze Pickaxe Rig ${serialCode}`,
    name: 'Bronze Pickaxe Rig NFT',
    nftId: 'nft_bronze',
    tier: 'COMMON',
    theme: 'bronze',
    icon: '⛏️',
    image: 'nft/common.svg',
    powerBoostPct: 2,
    firstMintMaxima: 0,
    bgAura: 'Ember Forge',
    coreGeometry: 'Hexagonal Matrix Core',
    emblemFinish: '24K Sovereign Gold',
    overclockPct: '88.50%',
    dnaHash: `0xMAX${String(clamped + 1).padStart(4, '0')}`,
  };
}

function buildTep64CollectionMetadataJson(cfg, origin) {
  const cleanOrigin = String(origin || cfg.publicAppUrl || 'https://maxima-mining-app.vercel.app').replace(/\/+$/, '');
  const ipfsImgCid = String(cfg.nftSale?.ipfsImagesCid || '').trim();
  const coverUrl = ipfsImgCid
    ? `https://gateway.pinata.cloud/ipfs/${ipfsImgCid}/124.png`
    : `${cleanOrigin}/nft/mythic.png`;
  return {
    name: cfg.nftSale?.collectionName || 'MAXIMA Genesis Mining Rigs',
    description:
      'Official Limited 1,000 MAXIMA Genesis Mining Rig NFT Collection (#0001 to #1000) on The Open Network (TON). Transferable On-Chain Mining Power Boost by Rarity: Common +2% (500), Rare +4% (280), Epic +6% (140), Legendary +8% (60), and Mythic +10% (20). Active boost applies to the Top 10 highest-rarity NFTs held in each connected TON wallet. Exclusive First-Mint Reward: Legendary grants +10,000 MAXIMA and Mythic grants +20,000 MAXIMA once only to the initial minter.',
    image: coverUrl,
    cover_image: `${cleanOrigin}/nft/legendary.png`,
    external_url: `https://t.me/${cfg.botUsername || 'MAXIMAMININGBOT'}`,
    social_links: [
      `https://t.me/${cfg.botUsername || 'MAXIMAMININGBOT'}`,
      'https://t.me/MAXIMAANN',
      'https://t.me/MAXIMAPAYOUT',
    ],
  };
}

function buildTep64ItemMetadataJson(cfg, origin, index0) {
  const cleanOrigin = String(origin || cfg.publicAppUrl || 'https://maxima-mining-app.vercel.app').replace(/\/+$/, '');
  const spec = getManifestNftByIndex(index0);
  const ipfsImgCid = String(cfg.nftSale?.ipfsImagesCid || '').trim();
  const imageUrl = ipfsImgCid
    ? `https://gateway.pinata.cloud/ipfs/${ipfsImgCid}/${spec.index}.png`
    : `${cleanOrigin}/nft/art/${spec.index}.svg`;
  const firstMintTxt =
    spec.firstMintMaxima > 0
      ? `${spec.firstMintMaxima.toLocaleString('en-US')} MAXIMA (1st Minter Exclusive Only)`
      : 'None (Mining Power Boost Only)';
  return {
    name: `${spec.fullTitle}`,
    description: `Official 1-of-1 MAXIMA Genesis Mining Rig NFT (${spec.tier} Rarity | Edition ${spec.serialCode} of 1,000 Max Supply | DNA ${spec.dnaHash}). Grants +${spec.powerBoostPct}% transferable Mining Power Boost to the current on-chain wallet holder in @${cfg.botUsername || 'MAXIMAMININGBOT'} (Top 10 highest-rarity NFTs active per wallet)${spec.firstMintMaxima > 0 ? `. Exclusive First-Mint Reward of +${spec.firstMintMaxima.toLocaleString('en-US')} MAXIMA is awarded once only to the first minter` : ''}.`,
    image: imageUrl,
    external_url: `https://t.me/${cfg.botUsername || 'MAXIMAMININGBOT'}`,
    attributes: [
      { trait_type: 'Rarity', value: spec.tier },
      { trait_type: 'Edition', value: `${spec.serialCode} / 1000` },
      { trait_type: 'Mining Power Boost', value: `+${spec.powerBoostPct}%` },
      { trait_type: 'Benefit Transferable', value: 'Yes (Follows On-Chain Wallet Owner · Top 10 Rarity Cap)' },
      { trait_type: 'First-Mint MAXIMA Bonus', value: firstMintTxt },
      { trait_type: 'Background Aura', value: spec.bgAura },
      { trait_type: 'Reactor Core Geometry', value: spec.coreGeometry },
      { trait_type: 'MAXIMA Emblem Finish', value: spec.emblemFinish },
      { trait_type: 'Overclock Efficiency', value: spec.overclockPct },
      { trait_type: 'DNA Hash', value: spec.dnaHash },
    ],
  };
}

function buildNftCardSvg(index0) {
  const spec = getManifestNftByIndex(index0);
  const tier = spec.tier;
  const pal =
    tier === 'MYTHIC'
      ? { c1: '#881337', c2: '#090207', border: '#f43f5e', accent: '#fde047' }
      : tier === 'LEGENDARY'
      ? { c1: '#065f73', c2: '#050511', border: '#67e8f9', accent: '#c084fc' }
      : tier === 'EPIC'
      ? { c1: '#6b4408', c2: '#0a0602', border: '#f5c451', accent: '#fde047' }
      : tier === 'RARE'
      ? { c1: '#0f3f5c', c2: '#05080f', border: '#38bdf8', accent: '#7dd3fc' }
      : { c1: '#5c2d16', c2: '#090604', border: '#f59e0b', accent: '#fbbf24' };

  const bonusLine =
    spec.firstMintMaxima > 0
      ? `MINING POWER: +${spec.powerBoostPct}%  |  1ST MINT ONLY: +${spec.firstMintMaxima.toLocaleString('en-US')} MAXIMA`
      : `MINING POWER BOOST: +${spec.powerBoostPct}%  |  CORE: ${spec.coreGeometry.toUpperCase()}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
  <defs>
    <radialGradient id="bg" cx="50%" cy="44%" r="70%">
      <stop offset="0%" stop-color="${pal.c1}"/>
      <stop offset="100%" stop-color="${pal.c2}"/>
    </radialGradient>
    <linearGradient id="mGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="${pal.accent}"/>
      <stop offset="100%" stop-color="${pal.border}"/>
    </linearGradient>
  </defs>
  <rect width="1000" height="1000" fill="url(#bg)"/>
  <rect x="28" y="28" width="944" height="944" rx="36" fill="none" stroke="${pal.border}" stroke-width="10"/>
  <circle cx="500" cy="450" r="340" fill="none" stroke="${pal.border}" stroke-opacity="0.28" stroke-width="3"/>
  <circle cx="500" cy="450" r="290" fill="none" stroke="${pal.accent}" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="12 8"/>
  <rect x="130" y="60" width="740" height="64" rx="16" fill="#080a12" fill-opacity="0.9" stroke="${pal.accent}" stroke-width="3.5"/>
  <text x="500" y="100" fill="${pal.accent}" font-family="Arial, sans-serif" font-weight="900" font-size="22" text-anchor="middle">${escHtml(tier)}  |  EDITION ${escHtml(spec.serialCode)} / 1000  |  +${spec.powerBoostPct}% MINING POWER</text>
  <circle cx="500" cy="450" r="245" fill="#070910" fill-opacity="0.92" stroke="${pal.accent}" stroke-width="8"/>
  <g transform="translate(500,450) scale(1.36) translate(-256,-248)" fill="url(#mGrad)">
    <polygon points="155,140 248,220 248,274 155,194"/>
    <polygon points="357,140 264,220 264,274 357,194"/>
    <polygon points="155,210 184,235 184,356 155,331"/>
    <polygon points="357,210 328,235 328,356 357,331"/>
    <polygon points="196,245 248,290 248,335 196,290"/>
    <polygon points="316,245 264,290 264,335 316,290"/>
  </g>
  <rect x="70" y="758" width="860" height="174" rx="22" fill="#070910" fill-opacity="0.93" stroke="${pal.border}" stroke-width="4.5"/>
  <text x="500" y="806" fill="#ffffff" font-family="Arial, sans-serif" font-weight="900" font-size="30" text-anchor="middle">${escHtml(spec.fullTitle.toUpperCase())}</text>
  <text x="500" y="846" fill="${pal.accent}" font-family="Arial, sans-serif" font-weight="800" font-size="18" text-anchor="middle">AURA: ${escHtml(spec.bgAura)}  ·  DNA: ${escHtml(spec.dnaHash)}  ·  OVERCLOCK: ${escHtml(spec.overclockPct)}</text>
  <text x="500" y="884" fill="#10e899" font-family="Arial, sans-serif" font-weight="800" font-size="18" text-anchor="middle">${escHtml(bonusLine)}</text>
  <text x="500" y="914" fill="#94a3b8" font-family="Arial, sans-serif" font-weight="700" font-size="14" text-anchor="middle">OFFICIAL MAXIMA GENESIS NFT COLLECTION (LIMITED 1,000 SUPPLY) · TON</text>
</svg>`;
}

// ================= CONTINUOUS ON-CHAIN NFT OWNERSHIP SYNC & TOP-10 RARITY CAP ENGINE =================
const onChainNftCache = new Map();
let lastCollectionReconcileAt = 0;
let collectionReconcileInFlight = null;

function getTierRankScore(tier) {
  const t = String(tier || 'COMMON').toUpperCase();
  if (t === 'MYTHIC') return 5;
  if (t === 'LEGENDARY') return 4;
  if (t === 'EPIC') return 3;
  if (t === 'RARE') return 2;
  return 1;
}

function parseNftIndexFromChainItem(rawIndex, itemName) {
  if (rawIndex !== undefined && rawIndex !== null && rawIndex !== '' && Number.isFinite(Number(rawIndex))) {
    const n = Number(rawIndex);
    if (n >= 0 && n < 1000) return n;
  }
  const m = String(itemName || '').match(/#0*(\d{1,4})\b/);
  if (m) {
    const serial = parseInt(m[1], 10);
    if (serial >= 1 && serial <= 1000) return serial - 1;
  }
  return 0;
}

function isMaximaNftMetadataMatch(colAddrRaw, itemColRaw, colName, itemName) {
  if (colAddrRaw && itemColRaw && itemColRaw === colAddrRaw) return true;
  if (colAddrRaw && itemColRaw && itemColRaw !== colAddrRaw) return false;
  const cn = String(colName || '').toUpperCase();
  const nm = String(itemName || '').toUpperCase();
  if (cn.includes('MAXIMA GENESIS') || cn.includes('MAXIMA MINING RIG')) return true;
  if (
    nm.includes('RIG #') &&
    (nm.includes('BRONZE PICKAXE') ||
      nm.includes('CYBER DRILL') ||
      nm.includes('GOLDEN REACTOR') ||
      nm.includes('PLASMA CORE') ||
      nm.includes('CEO CROWN') ||
      nm.includes('MAXIMA'))
  ) {
    return true;
  }
  return false;
}

function buildOnChainNftViewFromIndex(idx0, itemAddressRawOrFriendly, ownerWalletRaw) {
  const spec = getManifestNftByIndex(idx0);
  const itemRaw = parseTonAddressToRaw(itemAddressRawOrFriendly);
  const friendlyBounceable = itemRaw ? rawToFriendlyTon(itemRaw, true) : String(itemAddressRawOrFriendly || '');
  return {
    id: `ONCHAIN-${friendlyBounceable || idx0}`,
    index: spec.index,
    onChainAddress: friendlyBounceable,
    onChainRawAddress: itemRaw || '',
    ownerWalletRaw: ownerWalletRaw || '',
    nftId: spec.nftId,
    name: spec.name,
    fullTitle: spec.fullTitle,
    tier: spec.tier,
    icon: spec.icon,
    image: `/nft/art/${spec.index}.svg`,
    powerBoostPct: spec.powerBoostPct,
    firstMintMaxima: spec.firstMintMaxima,
    instantCoins: 0, // Secondary / on-chain ownership sync NEVER re-awards 1st-mint MAXIMA jackpot
    wasFirstMint: false,
    theme: spec.theme,
    serialNum: spec.serialNum,
    serialCode: spec.serialCode,
    dnaHash: spec.dnaHash,
    bgAura: spec.bgAura,
    coreGeometry: spec.coreGeometry,
    emblemFinish: spec.emblemFinish,
    overclockPct: spec.overclockPct,
    isOnChainMinted: true,
    isOnChainSynced: true,
  };
}

async function fetchWalletMaximaNftsOnChain(cfg, walletRaw) {
  const cleanWallet = parseTonAddressToRaw(walletRaw);
  if (!cleanWallet) return { ok: false, items: [] };
  const colAddrRaw = parseTonAddressToRaw(cfg.nftSale?.collectionAddress || '');

  // 1. Primary: TonAPI v2 (indirect_ownership=true includes items still owned by the user via Getgems sale escrow)
  try {
    const url = colAddrRaw
      ? `https://tonapi.io/v2/accounts/${encodeURIComponent(cleanWallet)}/nfts?collection=${encodeURIComponent(colAddrRaw)}&limit=200&indirect_ownership=true`
      : `https://tonapi.io/v2/accounts/${encodeURIComponent(cleanWallet)}/nfts?limit=200&indirect_ownership=true`;
    const data = await fetchJsonWithTimeout(url, 4500, buildTonApiHeaders());
    const nftItems = Array.isArray(data && data.nft_items) ? data.nft_items : [];
    const matched = [];
    const seenSerials = new Set();

    for (const item of nftItems) {
      if (!item) continue;
      const liveOwnerRaw = parseTonAddressToRaw(
        (item.sale && item.sale.owner && (item.sale.owner.address || item.sale.owner)) ||
          (item.owner && (item.owner.address || item.owner))
      );
      if (liveOwnerRaw && liveOwnerRaw !== cleanWallet) continue;

      const itemColRaw = parseTonAddressToRaw(item.collection && item.collection.address);
      const colName = (item.collection && item.collection.name) || '';
      const itemName = (item.metadata && item.metadata.name) || '';
      if (!isMaximaNftMetadataMatch(colAddrRaw, itemColRaw, colName, itemName)) continue;

      const idx = parseNftIndexFromChainItem(item.index, itemName);
      const built = buildOnChainNftViewFromIndex(idx, item.address, cleanWallet);
      if (!seenSerials.has(built.serialCode)) {
        seenSerials.add(built.serialCode);
        matched.push(built);
      }
    }
    return { ok: true, items: matched, provider: 'tonapi' };
  } catch (_) {}

  // 2. Automatic Fallback: Toncenter API v3
  try {
    const url = colAddrRaw
      ? `https://toncenter.com/api/v3/nft/items?collection_address=${encodeURIComponent(colAddrRaw)}&limit=1000`
      : `https://toncenter.com/api/v3/nft/items?owner_address=${encodeURIComponent(cleanWallet)}&limit=200`;
    const data = await fetchJsonWithTimeout(url, 5000, buildToncenterHeaders());
    const nftItems = Array.isArray(data && data.nft_items) ? data.nft_items : [];
    const metaMap = (data && data.metadata) || {};
    const matched = [];
    const seenSerials = new Set();

    for (const item of nftItems) {
      if (!item) continue;
      const liveOwnerRaw = parseTonAddressToRaw(item.real_owner || item.owner_address);
      if (!liveOwnerRaw || liveOwnerRaw !== cleanWallet) continue;

      const itemColRaw = parseTonAddressToRaw(item.collection_address);
      const itemAddrKey = String(item.address || '');
      const colAddrKey = String(item.collection_address || '');
      const itemMeta =
        (metaMap[itemAddrKey] &&
          Array.isArray(metaMap[itemAddrKey].token_info) &&
          metaMap[itemAddrKey].token_info[0]) ||
        {};
      const colMeta =
        (metaMap[colAddrKey] &&
          Array.isArray(metaMap[colAddrKey].token_info) &&
          metaMap[colAddrKey].token_info[0]) ||
        {};
      const itemName = itemMeta.name || (item.content && item.content.uri) || '';
      const colName = colMeta.name || '';

      if (!isMaximaNftMetadataMatch(colAddrRaw, itemColRaw, colName, itemName)) continue;
      const idx = parseNftIndexFromChainItem(item.index, itemName);
      const built = buildOnChainNftViewFromIndex(idx, item.address, cleanWallet);
      if (!seenSerials.has(built.serialCode)) {
        seenSerials.add(built.serialCode);
        matched.push(built);
      }
    }
    return { ok: true, items: matched, provider: 'toncenter' };
  } catch (_) {}

  return { ok: false, items: [] };
}

function applyWalletOnChainNftSnapshot(cfg, user, onChainItems) {
  if (!user || !user.walletRaw) return false;
  ensureUserSchema(user);
  const reg = ensureNftRegistry();
  const cleanWallet = parseTonAddressToRaw(user.walletRaw);
  if (!cleanWallet) return false;

  const colAddrRaw = parseTonAddressToRaw(cfg.nftSale?.collectionAddress || '');
  const contractMintMode = Boolean(colAddrRaw);

  let dbChanged = false;
  const onChainBySerial = new Map();
  for (const oc of onChainItems || []) {
    if (oc && oc.serialCode) onChainBySerial.set(oc.serialCode, oc);
  }

  // 1. For every NFT verified on-chain in THIS wallet: strip it immediately from any PREVIOUS owner in DB!
  for (const oc of onChainItems || []) {
    if (!oc || !oc.serialCode) continue;
    const idxKey = String(oc.index ?? (Number(oc.serialNum || 1) - 1));
    if (reg.mintedByIndex[idxKey]) {
      if (oc.onChainAddress && reg.mintedByIndex[idxKey].onChainAddress !== oc.onChainAddress) {
        reg.mintedByIndex[idxKey].onChainAddress = oc.onChainAddress;
        dbChanged = true;
      }
      if (
        reg.mintedByIndex[idxKey].currentOwnerWalletRaw !== cleanWallet ||
        reg.mintedByIndex[idxKey].currentOwnerUserId !== String(user.userId)
      ) {
        reg.mintedByIndex[idxKey].currentOwnerWalletRaw = cleanWallet;
        reg.mintedByIndex[idxKey].currentOwnerUserId = String(user.userId);
        dbChanged = true;
      }
      if (!reg.mintedByIndex[idxKey].firstMinterUserId) {
        reg.mintedByIndex[idxKey].firstMinterUserId = String(user.userId);
        dbChanged = true;
      }
      if (!reg.mintedByIndex[idxKey].firstMinterWalletRaw) {
        reg.mintedByIndex[idxKey].firstMinterWalletRaw = cleanWallet;
        dbChanged = true;
      }
    } else {
      reg.mintedByIndex[idxKey] = {
        index: Number(idxKey),
        serialNum: oc.serialNum,
        serialCode: oc.serialCode,
        tier: oc.tier,
        powerBoostPct: oc.powerBoostPct,
        firstMinterUserId: String(user.userId),
        firstMinterWalletRaw: cleanWallet,
        mintedAt: Date.now(),
        onChainAddress: oc.onChainAddress || '',
        currentOwnerUserId: String(user.userId),
        currentOwnerWalletRaw: cleanWallet,
      };
      if (Number(idxKey) + 1 > reg.nextMintIndex) reg.nextMintIndex = Number(idxKey) + 1;
      dbChanged = true;
    }

    for (const otherU of Object.values(db.users || {})) {
      if (!otherU || otherU.userId === user.userId) continue;
      const hadInPurchases =
        Array.isArray(otherU.nftPurchases) &&
        otherU.nftPurchases.some((p) => p && p.serialCode === oc.serialCode);
      const hadInOnChain =
        Array.isArray(otherU.onChainNfts) &&
        otherU.onChainNfts.some((p) => p && p.serialCode === oc.serialCode);
      if (hadInPurchases || hadInOnChain) {
        accruePendingMining(cfg, otherU);
        if (hadInPurchases) {
          otherU.nftPurchases = otherU.nftPurchases.filter((p) => !p || p.serialCode !== oc.serialCode);
        }
        if (hadInOnChain) {
          otherU.onChainNfts = otherU.onChainNfts.filter((p) => !p || p.serialCode !== oc.serialCode);
        }
        if (otherU.walletRaw) onChainNftCache.delete(otherU.walletRaw);
        dbChanged = true;
      }
    }
  }

  // 2. Evict any NFTs from THIS user's nftPurchases if they are NOT in this user's on-chain wallet!
  // When contractMintMode is active, ALL valid NFTs must exist on-chain in the user's wallet (evicts phantom off-chain duplicates like #0002).
  if (Array.isArray(user.nftPurchases) && user.nftPurchases.length > 0) {
    const keptPurchases = [];
    let evictedAny = false;
    const seenPurchaseSerials = new Set();
    for (const p of user.nftPurchases) {
      if (!p) continue;
      const idxKey = String(p.index ?? (Number(p.serialNum || 1) - 1));
      const regEntry = reg.mintedByIndex[idxKey];
      const hasOnChainIdentity = Boolean(
        contractMintMode ||
          p.isOnChainMinted ||
          p.onChainAddress ||
          (regEntry && regEntry.onChainAddress)
      );

      if ((hasOnChainIdentity && !onChainBySerial.has(p.serialCode)) || seenPurchaseSerials.has(p.serialCode)) {
        if (!evictedAny) {
          accruePendingMining(cfg, user);
          evictedAny = true;
        }
        if (regEntry) {
          if (!regEntry.onChainAddress && contractMintMode) {
            delete reg.mintedByIndex[idxKey];
            delete reg.firstMintBonusClaimed[idxKey];
          } else if (regEntry.currentOwnerWalletRaw === cleanWallet && !onChainBySerial.has(p.serialCode)) {
            regEntry.currentOwnerWalletRaw = '';
            regEntry.currentOwnerUserId = '';
          }
        }
        dbChanged = true;
        continue;
      }

      if (onChainBySerial.has(p.serialCode)) {
        const oc = onChainBySerial.get(p.serialCode);
        if (oc.onChainAddress && p.onChainAddress !== oc.onChainAddress) {
          p.onChainAddress = oc.onChainAddress;
          p.isOnChainMinted = true;
          p.isOnChainSynced = true;
          dbChanged = true;
        }
      }
      if (p.serialCode) seenPurchaseSerials.add(p.serialCode);
      keptPurchases.push(p);
    }
    if (evictedAny) {
      user.nftPurchases = keptPurchases;
    }
  }

  const prevSerials = Array.isArray(user.onChainNfts)
    ? user.onChainNfts.map((x) => x && x.serialCode).join(',')
    : '';
  const nextSerials = (onChainItems || []).map((x) => x && x.serialCode).join(',');
  if (prevSerials !== nextSerials) {
    accruePendingMining(cfg, user);
    user.onChainNfts = onChainItems || [];
    dbChanged = true;
  } else {
    user.onChainNfts = onChainItems || [];
  }
  user.lastNftOnChainSyncAt = Date.now();

  if (dbChanged) {
    normalizeNftRegistryInDB(db);
    saveDB(true);
  }
  return dbChanged;
}

async function syncOnChainNftsForUser(cfg, user, forceRefresh = false) {
  if (!user || !user.walletRaw) return false;
  const cleanWallet = parseTonAddressToRaw(user.walletRaw);
  if (!cleanWallet) return false;

  const now = Date.now();
  const cached = onChainNftCache.get(cleanWallet);
  // Continuous automatic check: 12s TTL on normal sync, 3s coalescing window on forceRefresh
  if (cached && now - cached.time < (forceRefresh ? 3000 : 12000)) {
    user.onChainNfts = cached.items;
    return applyWalletOnChainNftSnapshot(cfg, user, cached.items);
  }

  const scan = await fetchWalletMaximaNftsOnChain(cfg, cleanWallet);
  if (!scan.ok) {
    if (cached) user.onChainNfts = cached.items;
    return false;
  }

  onChainNftCache.set(cleanWallet, { time: now, items: scan.items });
  return applyWalletOnChainNftSnapshot(cfg, user, scan.items);
}

// Collection-wide on-chain ownership reconciliation: detects wallet-to-wallet transfers & purges any phantom off-chain NFTs across ALL 1,000 items automatically!
async function reconcileCollectionOnChainOwnership(cfg, forceRefresh = false) {
  const colAddrRaw = parseTonAddressToRaw(cfg.nftSale?.collectionAddress || '');
  if (!colAddrRaw) return false;

  const now = Date.now();
  if (now - lastCollectionReconcileAt < (forceRefresh ? 3000 : 20000)) return false;
  if (collectionReconcileInFlight) return collectionReconcileInFlight;

  collectionReconcileInFlight = (async () => {
    let items = null;

    // 1. Primary: TonAPI v2 collection items
    try {
      const data = await fetchJsonWithTimeout(
        `https://tonapi.io/v2/nfts/collections/${encodeURIComponent(colAddrRaw)}/items?limit=1000`,
        6500,
        buildTonApiHeaders()
      );
      if (data && Array.isArray(data.nft_items)) {
        items = data.nft_items.map((it) => ({
          index: parseNftIndexFromChainItem(it.index, it.metadata && it.metadata.name),
          address: it.address || '',
          ownerRaw:
            parseTonAddressToRaw(
              (it.sale && it.sale.owner && (it.sale.owner.address || it.sale.owner)) ||
                (it.owner && (it.owner.address || it.owner))
            ) || '',
          inSale: Boolean(it.sale),
        }));
      }
    } catch (_) {}

    // 2. Fallback: Toncenter v3 collection items
    if (!items) {
      try {
        const data = await fetchJsonWithTimeout(
          `https://toncenter.com/api/v3/nft/items?collection_address=${encodeURIComponent(colAddrRaw)}&limit=1000`,
          7000,
          buildToncenterHeaders()
        );
        if (data && Array.isArray(data.nft_items)) {
          items = data.nft_items.map((it) => ({
            index: parseNftIndexFromChainItem(it.index, ''),
            address: it.address || '',
            ownerRaw: parseTonAddressToRaw(it.real_owner || it.owner_address) || '',
            inSale: Boolean(it.on_sale),
          }));
        }
      } catch (_) {}
    }

    if (!items) return false;
    lastCollectionReconcileAt = Date.now();

    const reg = ensureNftRegistry();
    const userByWallet = new Map();
    for (const u of Object.values(db.users || {})) {
      if (u && u.walletRaw) {
        userByWallet.set(u.walletRaw, u);
      }
    }

    const onChainIndexMap = new Map();
    const onChainSerialToOwner = new Map();
    const walletItemsMap = new Map();
    let changed = false;

    for (const ci of items) {
      if (!ci || ci.index < 0 || ci.index >= 1000) continue;
      onChainIndexMap.set(ci.index, ci);
      const spec = getManifestNftByIndex(ci.index);
      onChainSerialToOwner.set(spec.serialCode, ci.ownerRaw || '');
      const idxKey = String(ci.index);
      const itemRaw = parseTonAddressToRaw(ci.address);
      const friendlyItemAddr = itemRaw ? rawToFriendlyTon(itemRaw, true) : ci.address;
      const ownerUserId = (ci.ownerRaw && userByWallet.get(ci.ownerRaw)?.userId) || '';

      if (!reg.mintedByIndex[idxKey]) {
        reg.mintedByIndex[idxKey] = {
          index: ci.index,
          serialNum: spec.serialNum,
          serialCode: spec.serialCode,
          tier: spec.tier,
          powerBoostPct: spec.powerBoostPct,
          firstMinterUserId: ownerUserId,
          firstMinterWalletRaw: ci.ownerRaw || '',
          mintedAt: Date.now(),
          onChainAddress: friendlyItemAddr,
          currentOwnerUserId: ownerUserId,
          currentOwnerWalletRaw: ci.ownerRaw || '',
        };
        changed = true;
      } else {
        const rec = reg.mintedByIndex[idxKey];
        if (friendlyItemAddr && rec.onChainAddress !== friendlyItemAddr) {
          rec.onChainAddress = friendlyItemAddr;
          changed = true;
        }
        if (rec.currentOwnerWalletRaw !== ci.ownerRaw || rec.currentOwnerUserId !== ownerUserId) {
          rec.currentOwnerWalletRaw = ci.ownerRaw || '';
          rec.currentOwnerUserId = ownerUserId;
          changed = true;
        }
        if (!rec.firstMinterWalletRaw && ci.ownerRaw) {
          rec.firstMinterWalletRaw = ci.ownerRaw;
          changed = true;
        }
        if (!rec.firstMinterUserId && ownerUserId) {
          rec.firstMinterUserId = ownerUserId;
          changed = true;
        }
      }

      if (ci.ownerRaw) {
        if (!walletItemsMap.has(ci.ownerRaw)) walletItemsMap.set(ci.ownerRaw, []);
        walletItemsMap.get(ci.ownerRaw).push(buildOnChainNftViewFromIndex(ci.index, friendlyItemAddr, ci.ownerRaw));
      }
    }

    // 3. Purge any phantom off-chain indices from reg.mintedByIndex that do NOT exist on-chain in the collection!
    for (const [k, entry] of Object.entries(reg.mintedByIndex)) {
      const idx0 = Number(entry?.index ?? k);
      if (!onChainIndexMap.has(idx0)) {
        // Relink txHash/minter info to the same wallet's real on-chain NFT if it was unlinked
        const phantomWallet = entry && (entry.firstMinterWalletRaw || entry.currentOwnerWalletRaw);
        if (entry && entry.txHash && phantomWallet) {
          for (const [realIdx, realCi] of onChainIndexMap.entries()) {
            const realEntry = reg.mintedByIndex[String(realIdx)];
            if (
              realEntry &&
              !realEntry.txHash &&
              (realCi.ownerRaw === phantomWallet || realEntry.firstMinterWalletRaw === phantomWallet)
            ) {
              realEntry.txHash = entry.txHash;
              realEntry.bocKey = entry.bocKey || realEntry.bocKey || '';
              if (entry.firstMinterUserId) realEntry.firstMinterUserId = entry.firstMinterUserId;
              if (entry.mintedAt) realEntry.mintedAt = entry.mintedAt;
              const txRefKey = `chain_nft_${entry.txHash}`;
              if (db.usedTxRefs && db.usedTxRefs[txRefKey]) {
                db.usedTxRefs[txRefKey].nftIndex = realIdx;
                db.usedTxRefs[txRefKey].serialCode = realEntry.serialCode;
              }
              break;
            }
          }
        }
        delete reg.mintedByIndex[k];
        delete reg.firstMintBonusClaimed[k];
        changed = true;
      }
    }

    // 4. Remove any NFT from any user's nftPurchases or onChainNfts if it does not exist on-chain OR its on-chain owner is not that user's wallet!
    for (const u of Object.values(db.users || {})) {
      if (!u || typeof u !== 'object') continue;
      if (Array.isArray(u.nftPurchases) && u.nftPurchases.length > 0) {
        const filteredPurchases = u.nftPurchases.filter((p) => {
          if (!p || !p.serialCode) return false;
          if (!onChainSerialToOwner.has(p.serialCode)) return false;
          const trueOwnerWallet = onChainSerialToOwner.get(p.serialCode);
          return Boolean(u.walletRaw && trueOwnerWallet && u.walletRaw === trueOwnerWallet);
        });
        if (filteredPurchases.length !== u.nftPurchases.length) {
          accruePendingMining(cfg, u);
          u.nftPurchases = filteredPurchases;
          if (u.walletRaw) onChainNftCache.delete(u.walletRaw);
          changed = true;
        }
      }
      if (!u.walletRaw && Array.isArray(u.onChainNfts) && u.onChainNfts.length > 0) {
        accruePendingMining(cfg, u);
        u.onChainNfts = [];
        changed = true;
      }
    }

    // 5. Update onChainNfts for every connected wallet user in DB
    for (const [wRaw, u] of userByWallet.entries()) {
      const nextList = walletItemsMap.get(wRaw) || [];
      onChainNftCache.set(wRaw, { time: Date.now(), items: nextList });
      if (applyWalletOnChainNftSnapshot(cfg, u, nextList)) {
        changed = true;
      }
    }

    // 6. Recalculate nextMintIndex, userMintCounts, walletMintCounts, and u.nftMintCount strictly from on-chain registry
    let trueNextMintIndex = 0;
    const newUserMintCounts = {};
    const newWalletMintCounts = {};
    for (const [k, entry] of Object.entries(reg.mintedByIndex)) {
      if (!entry) continue;
      const idx0 = Number(entry.index ?? k);
      if (Number.isFinite(idx0) && idx0 + 1 > trueNextMintIndex) {
        trueNextMintIndex = idx0 + 1;
      }
      const uid = String(entry.firstMinterUserId || entry.currentOwnerUserId || '').trim();
      const wRaw = String(entry.firstMinterWalletRaw || entry.currentOwnerWalletRaw || '').trim();
      if (uid) newUserMintCounts[uid] = (newUserMintCounts[uid] || 0) + 1;
      if (wRaw) newWalletMintCounts[wRaw] = (newWalletMintCounts[wRaw] || 0) + 1;
    }
    if (reg.nextMintIndex !== trueNextMintIndex) {
      reg.nextMintIndex = trueNextMintIndex;
      changed = true;
    }
    reg.userMintCounts = newUserMintCounts;
    reg.walletMintCounts = newWalletMintCounts;
    for (const [uid, u] of Object.entries(db.users || {})) {
      if (!u || typeof u !== 'object') continue;
      const wRaw = parseTonAddressToRaw(u.walletRaw || '') || '';
      const cnt = Math.max(newUserMintCounts[uid] || 0, wRaw ? newWalletMintCounts[wRaw] || 0 : 0);
      if (u.nftMintCount !== cnt) {
        u.nftMintCount = cnt;
        u.everMintedNft = cnt > 0;
        changed = true;
      }
    }

    if (changed) {
      saveDB(true);
    }
    return changed;
  })().finally(() => {
    collectionReconcileInFlight = null;
  });

  return collectionReconcileInFlight;
}

function getEffectiveUserNfts(user) {
  const inAppList = Array.isArray(user && user.nftPurchases) ? user.nftPurchases : [];
  const onChainList = user && user.walletRaw && Array.isArray(user.onChainNfts) ? user.onChainNfts : [];
  const cfgForNft = loadConfig();
  const contractMintMode = Boolean(cfgForNft.nftSale && cfgForNft.nftSale.collectionAddress);
  const hasOnChainSync = Boolean(
    contractMintMode && user && (user.lastNftOnChainSyncAt > 0 || onChainList.length > 0)
  );
  const onChainSerials = new Set(onChainList.map((oc) => oc && oc.serialCode).filter(Boolean));
  const bySerial = new Map();
  const combined = [];

  for (const item of inAppList) {
    if (!item) continue;
    // When on-chain collection contract is active, ignore any unbacked off-chain phantom item
    if (hasOnChainSync && !onChainSerials.has(item.serialCode) && !item.onChainAddress) {
      continue;
    }
    if (contractMintMode && !item.onChainAddress && !onChainSerials.has(item.serialCode)) {
      continue;
    }
    if (item.serialCode && bySerial.has(item.serialCode)) continue;
    const copy = { ...item };
    if (copy.serialCode) bySerial.set(copy.serialCode, copy);
    combined.push(copy);
  }
  for (const oc of onChainList) {
    if (!oc) continue;
    if (oc.serialCode && bySerial.has(oc.serialCode)) {
      const existing = bySerial.get(oc.serialCode);
      if (oc.onChainAddress && !existing.onChainAddress) {
        existing.onChainAddress = oc.onChainAddress;
      }
      existing.isOnChainMinted = true;
      existing.isOnChainSynced = true;
    } else {
      const copy = { ...oc };
      if (copy.serialCode) bySerial.set(copy.serialCode, copy);
      combined.push(copy);
    }
  }
  return combined;
}

// Ranks all owned NFTs by Rarity (MYTHIC +10% > LEGENDARY +8% > EPIC +6% > RARE +4% > COMMON +2%)
// and enforces the Top-10 Active Benefit Cap per connected wallet!
function getRankedUserNfts(user, maxActiveBenefitNfts = 10) {
  const cap = Math.max(1, Number(maxActiveBenefitNfts || 10));
  const rawList = getEffectiveUserNfts(user);
  const walletConnected = Boolean(user && user.walletRaw);

  if (!walletConnected) {
    return {
      maxActiveBenefitNfts: cap,
      totalOwnedCount: rawList.length,
      activeBenefitCount: 0,
      standbyCount: rawList.length,
      boostPct: 0,
      items: rawList.map((n) => ({
        ...n,
        benefitActive: false,
        benefitRank: null,
        standbyReason: 'WALLET_DISCONNECTED',
      })),
    };
  }

  const eligible = [];
  const listed = [];
  for (const n of rawList) {
    if (!n) continue;
    if (n.listedForSale) {
      listed.push({
        ...n,
        benefitActive: false,
        benefitRank: null,
        standbyReason: 'LISTED_ON_MARKET',
      });
    } else {
      eligible.push({ ...n });
    }
  }

  eligible.sort((a, b) => {
    const boostDiff = Number(b.powerBoostPct || 0) - Number(a.powerBoostPct || 0);
    if (boostDiff !== 0) return boostDiff;
    const tierDiff = getTierRankScore(b.tier) - getTierRankScore(a.tier);
    if (tierDiff !== 0) return tierDiff;
    return Number(a.serialNum || 9999) - Number(b.serialNum || 9999);
  });

  let boostPct = 0;
  let activeBenefitCount = 0;
  const annotatedEligible = eligible.map((n, idx) => {
    const rank = idx + 1;
    const isActive = rank <= cap;
    if (isActive) {
      boostPct += Number(n.powerBoostPct || 0);
      activeBenefitCount++;
    }
    return {
      ...n,
      benefitActive: isActive,
      benefitRank: rank,
      standbyReason: isActive ? null : 'CAP_TOP_10',
    };
  });

  const allAnnotated = [...annotatedEligible, ...listed];
  return {
    maxActiveBenefitNfts: cap,
    totalOwnedCount: allAnnotated.length,
    activeBenefitCount,
    standbyCount: Math.max(0, allAnnotated.length - activeBenefitCount),
    boostPct: +boostPct.toFixed(2),
    items: allAnnotated,
  };
}

function getNftBoostStats(user, lvl = null, maxActiveBenefitNfts = 10) {
  const ranked = getRankedUserNfts(user, maxActiveBenefitNfts);
  const boostPct = ranked.boostPct;
  const effLvl = lvl !== null ? lvl : computeLevelFromHolding(getCombinedHolding(user).combinedHolding);
  const baseSpeed = miningSpeed(effLvl);
  const baseDaily = dailyOutput(effLvl);
  const bonusThs = baseSpeed * (boostPct / 100);
  const dailyBonusCoins = baseDaily * (boostPct / 100);
  return {
    nftBoostPct: +boostPct.toFixed(2),
    nftBonusThs: +bonusThs.toFixed(2),
    nftDailyBonusCoins: +dailyBonusCoins.toFixed(2),
    nftActiveBenefitCount: ranked.activeBenefitCount,
    nftStandbyCount: ranked.standbyCount,
    nftTotalOwnedCount: ranked.totalOwnedCount,
    nftMaxActiveBenefit: ranked.maxActiveBenefitNfts,
    rankedNfts: ranked.items,
  };
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
  const maxActiveBenefitNfts = Number(cfg.nftSale?.maxActiveBenefitNfts || 10);
  const { nftDailyBonusCoins } = getNftBoostStats(user, lvl, maxActiveBenefitNfts);

  const shiftEnd = user.shiftStartedAt + shiftMs;
  const effectiveNow = Math.min(now, shiftEnd);
  if (effectiveNow > user.lastAccruedAt) {
    const dtSec = (effectiveNow - user.lastAccruedAt) / 1000;
    const coinsPerSec = (dailyOutput(lvl) + nftDailyBonusCoins) / 86400;
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
  const maxActiveBenefitNfts = Number(cfg.nftSale?.maxActiveBenefitNfts || 10);
  const maxMintPerUser = Number(cfg.nftSale?.maxMintPerUser || cfg.nftSale?.maxPerWallet || 5);
  const {
    nftBoostPct,
    nftBonusThs,
    nftDailyBonusCoins,
    nftActiveBenefitCount,
    nftStandbyCount,
    nftMaxActiveBenefit,
    rankedNfts,
  } = getNftBoostStats(user, unlockedLevel, maxActiveBenefitNfts);
  const totalPowerThs = +(currentSpec.powerThs + nftBonusThs).toFixed(2);
  const totalDailyCoins = +(currentSpec.dailyCoins + nftDailyBonusCoins).toFixed(2);
  const nftMintCount = getUserPrimaryMintCount(user);
  const nftMintRemaining = Math.max(0, maxMintPerUser - nftMintCount);

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
    activePowerThs: isWalletConnected ? totalPowerThs : 0,
    activeDailyCoins: isWalletConnected ? totalDailyCoins : 0,
    activeCoinsPerSec: isWalletConnected ? totalDailyCoins / 86400 : 0,
    nftBoostPct,
    nftBonusThs,
    nftDailyBonusCoins,
    nftActiveBenefitCount,
    nftStandbyCount,
    nftMaxActiveBenefit,
    nftMintCount,
    nftMaxMintPerUser: maxMintPerUser,
    nftMintRemaining,
    nftFirstMintCoinsEarned: Number(user.nftFirstMintCoinsEarned || 0),
    lastNftOnChainSyncAt: user.lastNftOnChainSyncAt || null,
    nftPurchases: rankedNfts,
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
    const { nftBonusThs } = getNftBoostStats(u, lvl);
    return {
      userId: u.userId,
      name: u.firstName || u.username,
      combinedHolding: h.combinedHolding,
      totalMined: +(u.totalMined || 0).toFixed(2),
      level: lvl,
      rankName: spec.rankName,
      zone: spec.zone,
      icon: spec.icon,
      powerThs: u.walletRaw ? +(spec.powerThs + nftBonusThs).toFixed(2) : 0,
    };
  });
  all.sort((a, b) => b.combinedHolding - a.combinedHolding || b.totalMined - a.totalMined);
  return all.slice(0, 15);
}

function getGlobalNftMintStats(cfg) {
  const maxTotalSupply = Number(cfg.nftSale?.maxTotalSupply || 1000);
  const startsAtMs = Date.parse(cfg.nftSale?.startsAt || '2026-11-04T00:00:00Z');
  const reg = ensureNftRegistry();
  const countsById = {};
  const marketListings = [];
  const countedSerials = new Set();

  for (const rec of Object.values(reg.mintedByIndex || {})) {
    if (!rec) continue;
    const spec = getManifestNftByIndex(rec.index ?? 0);
    countsById[spec.nftId] = (countsById[spec.nftId] || 0) + 1;
    if (rec.serialCode) countedSerials.add(rec.serialCode);
  }

  for (const u of Object.values(db.users)) {
    if (Array.isArray(u.nftPurchases)) {
      for (const p of u.nftPurchases) {
        if (!p) continue;
        if (p.nftId && (!p.serialCode || !countedSerials.has(p.serialCode))) {
          countsById[p.nftId] = (countsById[p.nftId] || 0) + 1;
          if (p.serialCode) countedSerials.add(p.serialCode);
        }
        if (p.listedForSale && Number(p.listedPriceMaxima) > 0) {
          marketListings.push({
            ...p,
            sellerUserId: u.userId,
            sellerName: u.firstName || u.username || u.userId,
          });
        }
      }
    }
  }

  const totalMinted = Math.min(
    maxTotalSupply,
    Math.max(Number(reg.nextMintIndex || 0), countedSerials.size)
  );
  marketListings.sort((a, b) => (b.listedAt || 0) - (a.listedAt || 0));
  return {
    startsAtMs,
    totalMinted,
    maxTotalSupply,
    remainingSupply: Math.max(0, maxTotalSupply - totalMinted),
    countsById,
    marketListings,
  };
}

let lastColActiveCheckAt = 0;
let cachedColActiveRaw = '';
let cachedColIsActive = false;

function isDirectContractMintActive(cfg) {
  const colRaw = parseTonAddressToRaw(cfg.nftSale?.collectionAddress || '');
  if (!colRaw) return false;
  if (cfg.nftSale?.directContractMint) return true;
  if (db.nftRegistry && db.nftRegistry.collectionContractDeployed && db.nftRegistry.deployedCollectionRaw === colRaw) {
    return true;
  }
  return cachedColIsActive && cachedColActiveRaw === colRaw;
}

async function checkNftCollectionActiveOnChain(cfg, force = false) {
  const colRaw = parseTonAddressToRaw(cfg.nftSale?.collectionAddress || '');
  if (!colRaw) return false;
  if (isDirectContractMintActive(cfg) && !force) return true;
  const now = Date.now();
  if (!force && now - lastColActiveCheckAt < 15000 && cachedColActiveRaw === colRaw) {
    return cachedColIsActive;
  }
  lastColActiveCheckAt = now;
  cachedColActiveRaw = colRaw;

  let active = false;
  try {
    const acc = await fetchJsonWithTimeout(
      `https://tonapi.io/v2/accounts/${encodeURIComponent(colRaw)}`,
      5000,
      buildTonApiHeaders()
    );
    if (acc && String(acc.status || '').toLowerCase() === 'active') {
      active = true;
    }
  } catch (_) {}

  if (!active) {
    try {
      const tc = await fetchJsonWithTimeout(
        `https://toncenter.com/api/v3/accountStates?address=${encodeURIComponent(colRaw)}`,
        5000,
        buildToncenterHeaders()
      );
      const st = tc && Array.isArray(tc.accounts) && tc.accounts[0] ? String(tc.accounts[0].status || '') : '';
      if (st.toLowerCase() === 'active') {
        active = true;
      }
    } catch (_) {}
  }

  if (active) {
    cachedColIsActive = true;
    const reg = ensureNftRegistry();
    if (!reg.collectionContractDeployed || reg.deployedCollectionRaw !== colRaw) {
      reg.collectionContractDeployed = true;
      reg.deployedCollectionRaw = colRaw;
      saveDB(true);
    }
  }
  return active;
}

function buildPrecomputedTxPayloads(cfg) {
  const presaleMap = {};
  for (const pkg of cfg.presale?.packages || []) {
    if (pkg && pkg.id) {
      presaleMap[pkg.id] = buildTextCommentBocBase64(`MAXIMA PRESALE ${pkg.id}`);
    }
  }
  const colRaw = parseTonAddressToRaw(cfg.nftSale?.collectionAddress || '');
  const isDirectContract = isDirectContractMintActive(cfg);
  const boxPriceTon = Number(cfg.nftSale?.boxPriceTon || 10);
  const gasTon = isDirectContract ? Number(cfg.nftSale?.contractMintGasTon || 0.08) : 0;
  const nftTargetAddress = isDirectContract
    ? rawToFriendlyTon(colRaw, true)
    : cfg.nftSale?.recipientWallet || cfg.wallet?.creatorTonWallet || '';
  const nftMintComment = isDirectContract
    ? String(cfg.nftSale?.mintPayloadComment || 'MAXIMA NFT MINT')
    : 'MAXIMA NFT MINT';

  return {
    verifyBoc: buildTextCommentBocBase64('MAXIMA VERIFY'),
    nftMintBoc: buildTextCommentBocBase64(nftMintComment),
    presaleBocs: presaleMap,
    nftMintTarget: {
      address: nftTargetAddress,
      totalTon: +(boxPriceTon + gasTon).toFixed(4),
      boxPriceTon,
      gasTon,
      isDirectContract,
      collectionAddress: colRaw ? rawToFriendlyTon(colRaw, true) : '',
    },
  };
}

function buildSyncPayload(cfg, userView) {
  const maxPresaleCoins = cfg.presale?.maxTotalPresaleCoins || 20000000;
  const soldCoins = db.presale.totalCoinsSold || 0;
  const resolvedLogo = resolveAppLogoUrl(cfg);
  const nftStats = getGlobalNftMintStats(cfg);
  const adminFlag = isAdminUser(cfg, userView && userView.userId);
  const pendingWdCount = adminFlag
    ? (Array.isArray(db.withdrawals) ? db.withdrawals.filter(isWithdrawPending).length : 0)
    : 0;
  const txPayloads = buildPrecomputedTxPayloads(cfg);
  return {
    serverTime: Date.now(),
    isAdmin: adminFlag,
    pendingWithdrawCount: pendingWdCount,
    adminPanelUrl: adminFlag ? buildAdminPanelUrl(cfg, userView.userId) : undefined,
    txPayloads,
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
      nftSale: cfg.nftSale,
    },
    worldTiers: WORLD_TIERS,
    nftState: {
      startsAtMs: nftStats.startsAtMs,
      totalMinted: nftStats.totalMinted,
      maxTotalSupply: nftStats.maxTotalSupply,
      remainingSupply: nftStats.remainingSupply,
      countsById: nftStats.countsById,
      marketListings: nftStats.marketListings,
      collectionAddress: txPayloads.nftMintTarget.collectionAddress,
      isDirectContractActive: txPayloads.nftMintTarget.isDirectContract,
    },
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
  if (dbDirty || (status === 200 && res._flushCloud)) {
    await flushCloudDB().catch(() => {});
  } else if (status === 200 && process.env.VERCEL && Date.now() - lastCloudWriteAt > 25000) {
    lastCloudWriteAt = Date.now();
    await flushCloudDB().catch(() => {});
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
    await ensureCloudDBLoaded(true);
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

  // Dynamic TON TEP-64 NFT Collection & Item Metadata + Dynamic 1-of-1 SVG Artwork (0..999)
  if (req.method === 'GET' && pathname === '/nft/metadata/collection.json') {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const proto = forwardedProto === 'https' ? 'https' : 'http';
    const origin = (cfg.publicAppUrl || `${proto}://${req.headers.host || `localhost:${cfg.port}`}`).replace(/\/+$/, '');
    return sendJson(res, 200, buildTep64CollectionMetadataJson(cfg, origin));
  }

  const nftMetaMatch = req.method === 'GET' && pathname.match(/^\/nft\/metadata\/(\d+)\.json$/);
  if (nftMetaMatch) {
    const idx = Number(nftMetaMatch[1]);
    if (idx >= 0 && idx < 1000) {
      const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      const proto = forwardedProto === 'https' ? 'https' : 'http';
      const origin = (cfg.publicAppUrl || `${proto}://${req.headers.host || `localhost:${cfg.port}`}`).replace(/\/+$/, '');
      return sendJson(res, 200, buildTep64ItemMetadataJson(cfg, origin, idx));
    }
  }

  const nftArtMatch = req.method === 'GET' && pathname.match(/^\/nft\/art\/(\d+)\.svg$/);
  if (nftArtMatch) {
    const idx = Number(nftArtMatch[1]);
    if (idx >= 0 && idx < 1000) {
      const svgBody = Buffer.from(buildNftCardSvg(idx), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=604800',
        'Content-Length': svgBody.length,
      });
      return res.end(svgBody);
    }
  }

  const nftPngMatch = req.method === 'GET' && pathname.match(/^\/nft\/images\/(\d+)\.png$/);
  if (nftPngMatch) {
    const idx = Number(nftPngMatch[1]);
    if (idx >= 0 && idx < 1000) {
      const ipfsCid = String(cfg.nftSale?.ipfsImagesCid || '').trim();
      if (ipfsCid) {
        res.writeHead(302, {
          Location: `https://gateway.pinata.cloud/ipfs/${ipfsCid}/${idx}.png`,
          'Access-Control-Allow-Origin': '*',
        });
        return res.end();
      }
      const localColPng = path.resolve(__dirname, '..', 'MAXIMA-NFT-COLLECTION-1000', 'images', `${idx}.png`);
      if (fs.existsSync(localColPng)) {
        const pngBuf = fs.readFileSync(localColPng);
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=604800',
          'Content-Length': pngBuf.length,
        });
        return res.end(pngBuf);
      }
      res.writeHead(302, {
        Location: `/nft/art/${idx}.svg`,
        'Access-Control-Allow-Origin': '*',
      });
      return res.end();
    }
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
    const isMutatingEndpoint = pathname !== '/api/user/sync';
    await ensureCloudDBLoaded(isMutatingEndpoint);
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

    // Record explicit transaction intent BEFORE sending TON tx (eliminates 10 GRAM Presale vs 10 GRAM NFT Mint ambiguity!)
    if (pathname === '/api/tx/intent') {
      if (rawUser.walletRaw) {
        recordPendingWalletTxIntent(rawUser.walletRaw, body.mode, {
          packageId: body.packageId,
          userId: rawUser.userId,
        });
        saveDB(false);
      }
      return sendJson(res, 200, { ok: true });
    }

    // Continuous background collection reconciliation (cached 20s) + live per-wallet on-chain sync
    checkNftCollectionActiveOnChain(cfg, false).catch(() => {});
    reconcileCollectionOnChainOwnership(cfg, false).catch(() => {});

    // Sync on-chain MAXIMA Jetton balance, on-chain NFTs & check on-chain 0.1 TON verification / presale / NFT mint if wallet connected
    if (rawUser.walletRaw) {
      const onChainBal = await fetchOnChainJettonBalance(cfg, rawUser.walletRaw);
      await syncOnChainNftsForUser(cfg, rawUser, false);
      if (!rawUser.walletVerified && pathname !== '/api/wallet/verify') {
        await tryAutoVerifyFromChain(cfg, rawUser, false);
      }
      if (pathname !== '/api/presale/buy' && pathname !== '/api/nft/buy') {
        await tryAutoPresaleFromChain(cfg, rawUser, false);
        await tryAutoNftMintFromChain(cfg, rawUser, false, false);
      }
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

    // 1b. Force Live On-Chain NFT Ownership & Mint Sync
    if (pathname === '/api/nft/sync-onchain') {
      const colActive = await checkNftCollectionActiveOnChain(cfg, true).catch(() => false);
      if (String(body.userId || '') === 'admin_deploy_ping') {
        return sendJson(res, 200, { ok: true, collectionActive: colActive });
      }
      if (!rawUser.walletRaw) {
        return sendJson(res, 400, {
          ok: false,
          error: '🔒 Please connect your personal TON wallet first to sync on-chain NFTs!',
        });
      }
      await reconcileCollectionOnChainOwnership(cfg, true).catch(() => {});
      await syncOnChainNftsForUser(cfg, rawUser, true);
      const mintedFromChain = await tryAutoNftMintFromChain(cfg, rawUser, true, false);
      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        pulledNft: mintedFromChain || null,
        message: mintedFromChain
          ? `💎 10 GRAM payment detected on-chain! Successfully minted ${mintedFromChain.name} ${mintedFromChain.serialCode}!`
          : `⛓️ On-Chain NFT ownership synced (${view.nftActiveBenefitCount}/${view.nftMaxActiveBenefit} Top Rarity Active: +${view.nftBoostPct}% Power)!`,
        data: buildSyncPayload(cfg, view),
      });
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
            '⛔ This wallet is already linked to another Telegram account! Only 1 wallet is allowed per account.',
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
      await syncOnChainNftsForUser(cfg, rawUser, true);
      if (!rawUser.walletVerified) {
        await tryAutoVerifyFromChain(cfg, rawUser, true);
      }
      await tryAutoPresaleFromChain(cfg, rawUser, true);
      await tryAutoNftMintFromChain(cfg, rawUser, true, false);
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
      if (findWalletOwnerUserId(rawUser.walletRaw, rawUser.userId)) {
        return sendJson(res, 409, {
          ok: false,
          code: 'WALLET_ALREADY_BOUND',
          error:
            '⛔ This wallet is already linked to another Telegram account! Only 1 wallet is allowed per account.',
        });
      }

      // Presale tetap bisa dibeli oleh user meskipun waktu presale telah berakhir (Ended)
      // const presaleEndsAtMs = Date.parse(cfg.presale?.endsAt || '2026-11-10T23:59:59Z');

      const packageId = String(body.packageId || '').trim();
      const txBoc = String(body.txBoc || '').trim();
      const prevLevel = rawUser.level || 1;

      return withUserTxLock(`tx_${rawUser.walletRaw || rawUser.userId}`, async () => {
        await ensureCloudDBLoaded(true);
        // Support on-chain auto-detection if txBoc callback was dropped by Telegram Desktop / WebView
        if (!txBoc || txBoc.length < 20) {
          const autoPkg = await tryAutoPresaleFromChainUnlocked(cfg, rawUser, true, true);
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
          const view = getOrCreateUser(cfg, body);
          const leveledUp = view.level > prevLevel;
          return sendJson(res, 200, {
            ok: true,
            leveledUp,
            message: `🚀 Presale +${pkg.coins.toLocaleString('en-US')} ${cfg.token.symbol} credited!`,
            data: buildSyncPayload(cfg, view),
          });
        }

        // First scan on-chain so any already-indexed transaction is detected before checking receipts
        await tryAutoPresaleFromChainUnlocked(cfg, rawUser, true, true);

        const userReceipts = Array.isArray(rawUser.presalePurchases) ? rawUser.presalePurchases : [];
        const globalReceipts = db.presale && Array.isArray(db.presale.purchases) ? db.presale.purchases : [];
        const allReceipts = [...userReceipts, ...globalReceipts];
        const nowMs = Date.now();
        const existingChainOrRecentReceipt = allReceipts.find(
          (p) =>
            p &&
            Number(p.tonPaid) === Number(pkg.ton) &&
            (String(p.userId) === String(rawUser.userId) || parseTonAddressToRaw(p.walletAddress) === rawUser.walletRaw) &&
            Math.abs(nowMs - Number(p.createdAt || 0)) < 60 * 60 * 1000 &&
            ((p.txHash && !p.bocKey) || p.bocKey === bocKey || Math.abs(nowMs - Number(p.createdAt || 0)) < 90 * 1000)
        );

        if (existingChainOrRecentReceipt) {
          existingChainOrRecentReceipt.bocKey = bocKey;
          for (const r of userReceipts) {
            if (r && r.id === existingChainOrRecentReceipt.id) r.bocKey = bocKey;
          }
          for (const r of globalReceipts) {
            if (r && r.id === existingChainOrRecentReceipt.id) r.bocKey = bocKey;
          }
          db.usedTxRefs[bocKey] = {
            type: 'presale',
            userId: rawUser.userId,
            ton: pkg.ton,
            at: nowMs,
            linkedReceipt: existingChainOrRecentReceipt.id,
          };
          if (!db.notifiedAdminRefs || typeof db.notifiedAdminRefs !== 'object') db.notifiedAdminRefs = {};
          db.notifiedAdminRefs[`ps_boc_${bocKey}`] = nowMs;
          if (existingChainOrRecentReceipt.id) {
            db.notifiedAdminRefs[`ps_id_${existingChainOrRecentReceipt.id}`] = nowMs;
          }
          clearPendingWalletTxIntent(rawUser.walletRaw, 'presale');
          saveDB(true);
          await flushCloudDB().catch(() => {});

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

        db.usedTxRefs[bocKey] = { type: 'presale', userId: rawUser.userId, ton: pkg.ton, at: nowMs };
        clearPendingWalletTxIntent(rawUser.walletRaw, 'presale');
        db.presale.walletTonSpent[rawUser.walletRaw] = +(currentWalletTon + pkg.ton).toFixed(4);
        db.presale.totalTonRaised = +((db.presale.totalTonRaised || 0) + pkg.ton).toFixed(4);
        db.presale.totalCoinsSold = (db.presale.totalCoinsSold || 0) + pkg.coins;

        rawUser.balance = +(rawUser.balance + pkg.coins).toFixed(6);

        const receipt = {
          id: `PS-${nowMs}-${Math.floor(100 + Math.random() * 900)}`,
          userId: rawUser.userId,
          username: rawUser.username,
          firstName: rawUser.firstName,
          walletAddress: rawUser.walletFriendly,
          tonPaid: pkg.ton,
          coinsReceived: pkg.coins,
          bocKey,
          createdAt: nowMs,
        };
        rawUser.presalePurchases.push(receipt);
        db.presale.purchases.push({ ...receipt });
        saveDB(true);
        await flushCloudDB().catch(() => {});

        await Promise.allSettled([
          notifyTelegramUser(
            cfg,
            rawUser.userId,
            `🚀 *Presale Purchase Successful!*\n\n• *Paid:* ${pkg.ton} GRAM\n• *Coins Received:* +${pkg.coins.toLocaleString('en-US')} ${cfg.token.symbol}\n• *Wallet Quota Used:* ${db.presale.walletTonSpent[rawUser.walletRaw]} / ${maxTonWallet} GRAM`
          ),
          notifyAdminsNewPresale(cfg, rawUser, receipt),
        ]);

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
      });
    }

    // 7b. Genesis NFT Mint (10 GRAM per Mint · Max 5 Mints per User/Wallet · 1,000 Supply · Legendary 10K & Mythic 20K 1st-Mint Exclusive)
    if (pathname === '/api/nft/buy') {
      if (!rawUser.walletRaw) {
        return sendJson(res, 403, {
          ok: false,
          error: '🔒 Please connect your personal TON wallet via TON Connect first!',
        });
      }
      if (findWalletOwnerUserId(rawUser.walletRaw, rawUser.userId)) {
        return sendJson(res, 409, {
          ok: false,
          code: 'WALLET_ALREADY_BOUND',
          error:
            '⛔ This wallet is already linked to another Telegram account! Only 1 wallet is allowed per account.',
        });
      }

      const maxMintPerUser = Number(cfg.nftSale?.maxMintPerUser || cfg.nftSale?.maxPerWallet || 5);
      const boxPriceTon = Number(cfg.nftSale?.boxPriceTon || 10);
      const nftStats = getGlobalNftMintStats(cfg);
      if (Number.isFinite(nftStats.startsAtMs) && Date.now() < nftStats.startsAtMs) {
        return sendJson(res, 400, {
          ok: false,
          error: '⏳ Genesis NFT Minting is not open yet!',
        });
      }

      const txBoc = String(body.txBoc || '').trim();
      const prevLevel = rawUser.level || 1;
      const contractMintMode = Boolean(parseTonAddressToRaw(cfg.nftSale?.collectionAddress || ''));

      return withUserTxLock(`tx_${rawUser.walletRaw || rawUser.userId}`, async () => {
        await ensureCloudDBLoaded(true);

        // 1. On-chain auto-detection fallback (when Telegram WebView / mobile wallet drops txBoc callback)
        if (!txBoc || txBoc.length < 20) {
          const autoReceipt = await tryAutoNftMintFromChainUnlocked(cfg, rawUser, true, true);
          await syncOnChainNftsForUser(cfg, rawUser, true);
          if (autoReceipt) {
            const view = getOrCreateUser(cfg, body);
            const leveledUp = view.level > prevLevel;
            const awarded = Number(autoReceipt.instantCoins || 0);
            const bonusTxt =
              awarded > 0
                ? ` + 1ST MINT JACKPOT +${awarded.toLocaleString('en-US')} ${cfg.token.symbol}!`
                : '';
            return sendJson(res, 200, {
              ok: true,
              leveledUp,
              pulledNft: autoReceipt,
              message: `💎 MINTED ON-CHAIN [${autoReceipt.tier}]! ${autoReceipt.name} ${autoReceipt.serialCode} (+${autoReceipt.powerBoostPct}% Mining Power)${bonusTxt}`,
              data: buildSyncPayload(cfg, view),
            });
          }
          return sendJson(res, 400, {
            ok: false,
            error:
              '10 GRAM NFT Mint payment not detected on-chain yet. Please make sure the transaction was confirmed in your TON wallet!',
          });
        }

        const bocKey = `boc_nft_${hashTxRef(txBoc)}`;
        if (db.usedTxRefs[bocKey]) {
          const existing = (rawUser.nftPurchases || []).find((n) => n && n.bocKey === bocKey) || null;
          const view = getOrCreateUser(cfg, body);
          return sendJson(res, 200, {
            ok: true,
            leveledUp: view.level > prevLevel,
            pulledNft: existing,
            message: existing
              ? `💎 MINTED [${existing.tier}]! ${existing.name} ${existing.serialCode} (+${existing.powerBoostPct}% Mining Power)`
              : `💎 NFT Mint processed successfully!`,
            data: buildSyncPayload(cfg, view),
          });
        }

        // Scan on-chain first so if the payment already indexed, we link bocKey without double-minting!
        let chainAuto = await tryAutoNftMintFromChainUnlocked(cfg, rawUser, true, true);
        if (!chainAuto && contractMintMode) {
          // Wait briefly for TON blockchain indexer to finalize the new NFT item before returning
          await new Promise((resolve) => setTimeout(resolve, 2500));
          chainAuto = await tryAutoNftMintFromChainUnlocked(cfg, rawUser, true, true);
        }

        if (chainAuto) {
          chainAuto.bocKey = bocKey;
          db.usedTxRefs[bocKey] = {
            type: 'nft',
            userId: rawUser.userId,
            walletRaw: rawUser.walletRaw,
            serialCode: chainAuto.serialCode,
            ton: boxPriceTon,
            at: Date.now(),
            linkedReceipt: chainAuto.id,
          };
          saveDB(true);
          await flushCloudDB().catch(() => {});
          const view = getOrCreateUser(cfg, body);
          const leveledUp = view.level > prevLevel;
          const awarded = Number(chainAuto.instantCoins || 0);
          const bonusTxt =
            awarded > 0
              ? ` + 1ST MINT JACKPOT +${awarded.toLocaleString('en-US')} ${cfg.token.symbol}!`
              : '';
          return sendJson(res, 200, {
            ok: true,
            leveledUp,
            pulledNft: chainAuto,
            message: `💎 MINTED [${chainAuto.tier}]! ${chainAuto.name} ${chainAuto.serialCode} (+${chainAuto.powerBoostPct}% Mining Power)${bonusTxt}`,
            data: buildSyncPayload(cfg, view),
          });
        }

        // CRITICAL: When on-chain NFT collection contract is active, NEVER mint a phantom off-chain NFT from an unindexed txBoc!
        // The TON smart contract assigns the exact item index on-chain; our 3.5s auto-poll will detect it as soon as the block confirms.
        if (contractMintMode) {
          recordPendingWalletTxIntent(rawUser.walletRaw, 'nft', {
            userId: rawUser.userId,
          });
          saveDB(true);
          await flushCloudDB().catch(() => {});
          const view = getOrCreateUser(cfg, body);
          return sendJson(res, 200, {
            ok: true,
            pendingConfirmation: true,
            leveledUp: false,
            pulledNft: null,
            message:
              '⏳ NFT Mint transaction broadcast to TON blockchain! Waiting for on-chain NFT confirmation (3-10 seconds)...',
            data: buildSyncPayload(cfg, view),
          });
        }

        if (getUserPrimaryMintCount(rawUser) >= maxMintPerUser) {
          return sendJson(res, 400, {
            ok: false,
            error: `⚠️ Maximum primary mint limit (${maxMintPerUser} NFTs per user/wallet) reached!`,
          });
        }

        const mintRes = executePrimaryNftMintUnlocked(cfg, rawUser, {
          txHash: '',
          bocKey,
          tonPaid: boxPriceTon,
          createdAt: Date.now(),
        });
        if (!mintRes || !mintRes.ok) {
          return sendJson(res, 400, {
            ok: false,
            error: (mintRes && mintRes.error) || 'Failed to mint NFT.',
          });
        }

        await flushCloudDB().catch(() => {});
        const receipt = mintRes.receipt;
        const awardedMaxima = mintRes.awardedMaxima || 0;
        const spec = mintRes.spec;
        const view = getOrCreateUser(cfg, body);
        const leveledUp = view.level > prevLevel;
        const bonusTxt =
          awardedMaxima > 0
            ? ` + FIRST MINT JACKPOT +${awardedMaxima.toLocaleString('en-US')} ${cfg.token.symbol}!`
            : '';
        return sendJson(res, 200, {
          ok: true,
          leveledUp,
          pulledNft: receipt,
          message: `💎 MINTED [${spec.tier}]! ${spec.name} ${spec.serialCode} (+${spec.powerBoostPct}% Mining Power)${bonusTxt}`,
          data: buildSyncPayload(cfg, view),
        });
      });
    }

    // 7c-1. Prepare On-Chain TEP-62 NFT Transfer Transaction (via TON Connect)
    if (pathname === '/api/nft/prepare-onchain-transfer') {
      if (!rawUser.walletRaw) {
        return sendJson(res, 403, {
          ok: false,
          error: '🔒 Please connect your personal TON wallet first!',
        });
      }
      const nftId = String(body.nftId || '').trim();
      const recipientRaw = String(body.recipient || '').trim();
      const effectiveList = getEffectiveUserNfts(rawUser);
      const nft = effectiveList.find((n) => n && (n.id === nftId || n.serialCode === body.serialCode));
      if (!nft || !nft.onChainAddress) {
        return sendJson(res, 400, {
          ok: false,
          error: 'This NFT does not have an on-chain item contract address yet. Please use standard P2P transfer.',
        });
      }
      if (nft.listedForSale) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Please unlist this NFT from the P2P Market first before transferring!',
        });
      }

      let destWalletRaw = parseTonAddressToRaw(recipientRaw);
      let targetUser = null;
      const cleanRec = recipientRaw.replace(/^@/, '').toLowerCase();
      if (!destWalletRaw) {
        targetUser = Object.values(db.users).find((u) => {
          if (!u || u.userId === rawUser.userId) return false;
          if (String(u.userId).toLowerCase() === cleanRec) return true;
          if (u.username && String(u.username).toLowerCase() === cleanRec) return true;
          return false;
        });
        if (targetUser && targetUser.walletRaw) {
          destWalletRaw = targetUser.walletRaw;
        }
      } else {
        targetUser = Object.values(db.users).find((u) => u && u.walletRaw === destWalletRaw) || null;
      }

      if (!destWalletRaw) {
        return sendJson(res, 400, {
          ok: false,
          error:
            'Please enter a valid recipient TON Wallet Address (UQ... / EQ...) or a Miner ID with a connected TON wallet!',
        });
      }
      if (destWalletRaw === rawUser.walletRaw) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Cannot transfer an NFT to your own wallet!',
        });
      }

      const nftContractRaw = parseTonAddressToRaw(nft.onChainAddress);
      if (!nftContractRaw) {
        return sendJson(res, 400, { ok: false, error: 'Invalid NFT contract address!' });
      }

      const payloadBoc = buildTep62NftTransferBocBase64({
        newOwnerRaw: destWalletRaw,
        responseDestinationRaw: rawUser.walletRaw,
        forwardTonAmountNano: 1n,
        memo: `MAXIMA ${nft.serialCode || 'NFT'}`,
      });

      return sendJson(res, 200, {
        ok: true,
        nftId: nft.id,
        serialCode: nft.serialCode,
        destWalletRaw,
        destWalletFriendly: rawToFriendlyTon(destWalletRaw, false),
        recipientName: targetUser ? targetUser.firstName || targetUser.username || targetUser.userId : '',
        message: {
          address: rawToFriendlyTon(nftContractRaw, true),
          amount: '55000000', // 0.055 TON gas (excess gas refunded to sender via response_destination)
          payload: payloadBoc,
        },
      });
    }

    // 7c-2. Confirm On-Chain TEP-62 NFT Transfer & Immediately Move Benefit to New Wallet Owner
    if (pathname === '/api/nft/confirm-onchain-transfer') {
      const serialCode = String(body.serialCode || '').trim();
      const destWalletRaw = parseTonAddressToRaw(body.destWalletRaw || body.recipient || '');
      if (!serialCode || !destWalletRaw) {
        return sendJson(res, 400, { ok: false, error: 'Incomplete transfer confirmation data!' });
      }

      accruePendingMining(cfg, rawUser);
      if (Array.isArray(rawUser.nftPurchases)) {
        rawUser.nftPurchases = rawUser.nftPurchases.filter((n) => !n || n.serialCode !== serialCode);
      }
      if (Array.isArray(rawUser.onChainNfts)) {
        rawUser.onChainNfts = rawUser.onChainNfts.filter((n) => !n || n.serialCode !== serialCode);
      }
      if (rawUser.walletRaw) onChainNftCache.delete(rawUser.walletRaw);
      onChainNftCache.delete(destWalletRaw);

      const reg = ensureNftRegistry();
      const idxNum = Math.max(0, (Number(serialCode.replace(/[^0-9]/g, '')) || 1) - 1);
      const idxKey = String(idxNum);
      const targetUser = Object.values(db.users).find((u) => u && u.walletRaw === destWalletRaw) || null;

      if (reg.mintedByIndex[idxKey]) {
        reg.mintedByIndex[idxKey].currentOwnerWalletRaw = destWalletRaw;
        reg.mintedByIndex[idxKey].currentOwnerUserId = targetUser ? String(targetUser.userId) : '';
      }

      if (targetUser) {
        ensureUserSchema(targetUser);
        accruePendingMining(cfg, targetUser);
        const itemAddr = (reg.mintedByIndex[idxKey] && reg.mintedByIndex[idxKey].onChainAddress) || '';
        const transferredView = buildOnChainNftViewFromIndex(idxNum, itemAddr, destWalletRaw);
        if (!targetUser.onChainNfts.some((x) => x && x.serialCode === serialCode)) {
          targetUser.onChainNfts.push(transferredView);
        }
      }
      saveDB(true);

      // Schedule automatic blockchain confirmation refresh 6s & 15s later once block finalizes
      setTimeout(() => {
        reconcileCollectionOnChainOwnership(cfg, true).catch(() => {});
        if (rawUser.walletRaw) syncOnChainNftsForUser(cfg, rawUser, true).catch(() => {});
        if (targetUser) syncOnChainNftsForUser(cfg, targetUser, true).catch(() => {});
      }, 6000);

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: `⛓️ NFT ${serialCode} transferred on-chain to ${rawToFriendlyTon(destWalletRaw, false).slice(0, 8)}...! Boost removed from previous wallet & activated on new owner.`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 7c-3. P2P NFT Transfer to another Player (by Wallet Address, @username, or Miner ID — NO 5-NFT holding cap on recipient; Top-10 Rarity Benefit applies!)
    if (pathname === '/api/nft/transfer') {
      const nftId = String(body.nftId || '').trim();
      const recipientRaw = String(body.recipient || '').trim();
      if (!nftId || !recipientRaw) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Please specify the NFT and recipient Wallet Address or Miner ID!',
        });
      }

      const list = Array.isArray(rawUser.nftPurchases) ? rawUser.nftPurchases : [];
      const nftIdx = list.findIndex((n) => n && n.id === nftId);
      if (nftIdx === -1) {
        return sendJson(res, 404, { ok: false, error: 'NFT not found in your inventory!' });
      }
      const nft = list[nftIdx];
      if (nft.listedForSale) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Please unlist this NFT from the P2P Market before transferring!',
        });
      }

      const cleanRec = recipientRaw.replace(/^@/, '').toLowerCase();
      const parsedRawAddr = parseTonAddressToRaw(recipientRaw);
      const targetUser = Object.values(db.users).find((u) => {
        if (!u || u.userId === rawUser.userId) return false;
        if (String(u.userId).toLowerCase() === cleanRec) return true;
        if (u.username && String(u.username).toLowerCase() === cleanRec) return true;
        if (u.walletFriendly && String(u.walletFriendly).toLowerCase() === cleanRec) return true;
        if (parsedRawAddr && u.walletRaw === parsedRawAddr) return true;
        return false;
      });

      if (!targetUser) {
        return sendJson(res, 404, {
          ok: false,
          error:
            'Recipient Miner ID or connected TON Wallet not found in MAXIMA! Ask the recipient to open the app & connect their TON wallet first.',
        });
      }

      ensureUserSchema(targetUser);

      // Lock in pending mining BEFORE ownership changes so old owner loses benefit immediately & new owner gains benefit (up to Top 10 Rarity cap)!
      accruePendingMining(cfg, rawUser);
      accruePendingMining(cfg, targetUser);

      list.splice(nftIdx, 1);
      nft.userId = targetUser.userId;
      nft.ownerWalletRaw = targetUser.walletRaw || '';
      nft.wasFirstMint = false; // Secondary transfer NEVER re-awards 1st-mint MAXIMA jackpot!
      nft.instantCoins = 0;
      nft.listedForSale = false;
      delete nft.listedPriceMaxima;
      targetUser.nftPurchases.push(nft);

      const reg = ensureNftRegistry();
      const idxKey = String(nft.index ?? Math.max(0, (Number(nft.serialNum || 1) - 1)));
      if (reg.mintedByIndex[idxKey]) {
        reg.mintedByIndex[idxKey].currentOwnerUserId = String(targetUser.userId);
        reg.mintedByIndex[idxKey].currentOwnerWalletRaw = targetUser.walletRaw || '';
      }
      saveDB(true);

      notifyTelegramUser(
        cfg,
        targetUser.userId,
        `📥 *NFT Received!*\n\nYou received *${nft.name} ${nft.serialCode}* (${nft.tier} · +${nft.powerBoostPct || 2}% Mining Power) from *${rawUser.firstName || rawUser.username}*!\n⚡ Top 10 highest-rarity NFTs in your connected wallet automatically boost your mining power.`
      ).catch(() => {});

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: `📤 Transferred ${nft.name} ${nft.serialCode} (+${nft.powerBoostPct || 2}% Mining Power) to ${targetUser.firstName || targetUser.username || targetUser.userId}! Your active mining boost has been updated.`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 7d. List Owned NFT for Sale on P2P Market
    if (pathname === '/api/nft/market/list') {
      const nftId = String(body.nftId || '').trim();
      const priceMaxima = Math.floor(Number(body.priceMaxima || 0));
      if (!Number.isFinite(priceMaxima) || priceMaxima < 500 || priceMaxima > 50000000) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Selling price must be between 500 and 50,000,000 MAXIMA!',
        });
      }
      const list = Array.isArray(rawUser.nftPurchases) ? rawUser.nftPurchases : [];
      const nft = list.find((n) => n && n.id === nftId);
      if (!nft) {
        return sendJson(res, 404, { ok: false, error: 'NFT not found in your inventory!' });
      }
      accruePendingMining(cfg, rawUser);
      nft.listedForSale = true;
      nft.listedPriceMaxima = priceMaxima;
      nft.listedAt = Date.now();
      saveDB(true);

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: `🏷️ Listed ${nft.name} ${nft.serialCode} on P2P Market for ${priceMaxima.toLocaleString('en-US')} ${cfg.token.symbol}!`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 7e. Unlist Owned NFT from P2P Market
    if (pathname === '/api/nft/market/unlist') {
      const nftId = String(body.nftId || '').trim();
      const list = Array.isArray(rawUser.nftPurchases) ? rawUser.nftPurchases : [];
      const nft = list.find((n) => n && n.id === nftId);
      if (!nft) {
        return sendJson(res, 404, { ok: false, error: 'NFT not found in your inventory!' });
      }
      accruePendingMining(cfg, rawUser);
      nft.listedForSale = false;
      delete nft.listedPriceMaxima;
      saveDB(true);

      const view = getOrCreateUser(cfg, body);
      return sendJson(res, 200, {
        ok: true,
        message: `✅ Removed ${nft.name} ${nft.serialCode} from P2P Market. Top-10 Rarity Mining Power recalculated!`,
        data: buildSyncPayload(cfg, view),
      });
    }

    // 7f. Buy Listed NFT from P2P Market (Transfers NFT & Trait Mining Power to Buyer; NO 1st-mint bonus on resale; Top-10 Rarity Cap applies!)
    if (pathname === '/api/nft/market/buy') {
      if (!rawUser.walletRaw) {
        return sendJson(res, 403, {
          ok: false,
          error: '🔒 Please connect your personal TON wallet first!',
        });
      }
      const nftId = String(body.nftId || '').trim();
      const sellerUserId = String(body.sellerUserId || '').trim();
      const seller = db.users[sellerUserId];
      if (!seller || !Array.isArray(seller.nftPurchases)) {
        return sendJson(res, 404, { ok: false, error: 'Seller or NFT listing no longer available!' });
      }
      if (seller.userId === rawUser.userId) {
        return sendJson(res, 400, { ok: false, error: 'You already own this NFT!' });
      }

      const nftIdx = seller.nftPurchases.findIndex((n) => n && n.id === nftId && n.listedForSale);
      if (nftIdx === -1) {
        return sendJson(res, 404, { ok: false, error: 'This NFT has already been sold or unlisted!' });
      }
      const nft = seller.nftPurchases[nftIdx];
      const priceMaxima = Math.floor(Number(nft.listedPriceMaxima || 0));
      if (rawUser.balance < priceMaxima) {
        return sendJson(res, 400, {
          ok: false,
          error: `Insufficient in-app ${cfg.token.symbol} balance! Need ${priceMaxima.toLocaleString('en-US')} ${cfg.token.symbol}.`,
        });
      }

      const prevLevel = rawUser.level || 1;
      accruePendingMining(cfg, rawUser);
      accruePendingMining(cfg, seller);

      rawUser.balance = +(rawUser.balance - priceMaxima).toFixed(6);
      seller.balance = +(seller.balance + priceMaxima).toFixed(6);

      const reg = ensureNftRegistry();
      reg.marketNetCoinsByUser[String(seller.userId)] =
        Number(reg.marketNetCoinsByUser[String(seller.userId)] || 0) + priceMaxima;
      reg.marketNetCoinsByUser[String(rawUser.userId)] =
        Number(reg.marketNetCoinsByUser[String(rawUser.userId)] || 0) - priceMaxima;

      seller.nftPurchases.splice(nftIdx, 1);
      nft.userId = rawUser.userId;
      nft.ownerWalletRaw = rawUser.walletRaw || '';
      nft.wasFirstMint = false; // Secondary purchase NEVER awards Legendary/Mythic 1st-mint MAXIMA bonus!
      nft.instantCoins = 0;
      nft.listedForSale = false;
      delete nft.listedPriceMaxima;
      rawUser.nftPurchases.push(nft);

      const idxKey = String(nft.index ?? Math.max(0, (Number(nft.serialNum || 1) - 1)));
      if (reg.mintedByIndex[idxKey]) {
        reg.mintedByIndex[idxKey].currentOwnerUserId = String(rawUser.userId);
        reg.mintedByIndex[idxKey].currentOwnerWalletRaw = rawUser.walletRaw || '';
      }
      saveDB(true);

      notifyTelegramUser(
        cfg,
        seller.userId,
        `💰 *P2P NFT Sold!*\n\nYour *${nft.name} ${nft.serialCode}* was purchased for *+${priceMaxima.toLocaleString('en-US')} ${cfg.token.symbol}*! Mining boost for that NFT has moved to the buyer.`
      ).catch(() => {});

      const view = getOrCreateUser(cfg, body);
      const leveledUp = view.level > prevLevel;
      return sendJson(res, 200, {
        ok: true,
        leveledUp,
        message: `🎉 Purchased ${nft.name} ${nft.serialCode} for ${priceMaxima.toLocaleString('en-US')} ${cfg.token.symbol}! Top-10 Rarity Mining Power active (+${view.nftBoostPct}% Total)!`,
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
            '⛔ This wallet is already linked to another Telegram account! Only 1 wallet is allowed per account.',
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
      const alreadyVerified = Boolean(
        rawUser.walletVerified || (rawUser.verifiedWallets && rawUser.verifiedWallets[rawUser.walletRaw])
      );
      if (db.usedTxRefs[bocKey] || alreadyVerified) {
        db.usedTxRefs[bocKey] = db.usedTxRefs[bocKey] || {
          type: 'verify',
          userId: rawUser.userId,
          walletRaw: rawUser.walletRaw,
          at: Date.now(),
        };
        rawUser.walletVerified = true;
        rawUser.everVerifiedWallet = true;
        saveDB(true);
        const view = getOrCreateUser(cfg, body);
        return sendJson(res, 200, {
          ok: true,
          message: `✅ ${cfg.wallet.verificationFeeTon} GRAM Verification Complete! Your wallet is now verified for Withdraw.`,
          data: buildSyncPayload(cfg, view),
        });
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
      saveDB(true);
      await flushCloudDB().catch(() => {});

      await Promise.allSettled([
        notifyTelegramUser(
          cfg,
          rawUser.userId,
          `✅ *Wallet Verified Automatically!*\n\nYour *${cfg.wallet.verificationFeeTon} GRAM* verification payment has been confirmed. *Withdraw ${cfg.token.symbol}* is now unlocked!`
        ),
        notifyAdminsWalletVerified(cfg, rawUser, bocKey),
      ]);

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

      return withUserTxLock(`wd_${rawUser.walletRaw || rawUser.userId}`, async () => {
        await ensureCloudDBLoaded(true);
        const freshUser = db.users[String(body.userId || rawUser.userId).trim()] || rawUser;
        ensureUserSchema(freshUser);

        if (!freshUser.walletRaw) {
          return sendJson(res, 403, {
            ok: false,
            error: '🔒 Please connect your personal wallet via TON Connect first!',
          });
        }
        if (findWalletOwnerUserId(freshUser.walletRaw, freshUser.userId)) {
          return sendJson(res, 409, {
            ok: false,
            code: 'WALLET_ALREADY_BOUND',
            error:
              '⛔ This wallet is already registered on another Telegram account! Withdrawal rejected because only 1 wallet is allowed per account.',
          });
        }
        if (!freshUser.walletVerified) {
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

        // Enforce 1 active PENDING withdrawal per user/wallet and 60s anti-spam cooldown
        const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
        const existingPending = allWds.find(
          (w) =>
            w &&
            isWithdrawPending(w) &&
            (String(w.userId) === String(freshUser.userId) ||
              (freshUser.walletRaw && parseTonAddressToRaw(w.walletRaw || w.walletAddress) === freshUser.walletRaw))
        );
        if (existingPending) {
          return sendJson(res, 400, {
            ok: false,
            error:
              '⏳ You already have a pending withdrawal request in the payout queue. Please wait until your current withdrawal is processed before submitting another one.',
          });
        }

        const recentWd = allWds.find(
          (w) =>
            w &&
            (String(w.userId) === String(freshUser.userId) ||
              (freshUser.walletRaw && parseTonAddressToRaw(w.walletRaw || w.walletAddress) === freshUser.walletRaw)) &&
            Date.now() - Number(w.createdAt || 0) < 60000
        );
        if (recentWd) {
          return sendJson(res, 429, {
            ok: false,
            error: '⏳ Please wait at least 60 seconds between withdrawal requests.',
          });
        }

        accruePendingMining(cfg, freshUser);
        if (freshUser.balance + 1e-9 < amount) {
          return sendJson(res, 400, {
            ok: false,
            error: `Insufficient in-app balance (Available: ${freshUser.balance.toFixed(2)} ${cfg.token.symbol}).`,
          });
        }

        const netReceived = +(amount - feeCoins).toFixed(4);
        freshUser.balance = Math.max(0, +(freshUser.balance - amount).toFixed(6));

        const wdRecord = {
          id: `WD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
          userId: freshUser.userId,
          username: freshUser.username,
          firstName: freshUser.firstName,
          requestedAmount: amount,
          feeCoins,
          netAmount: netReceived,
          walletAddress: freshUser.walletFriendly,
          walletRaw: freshUser.walletRaw,
          contractAddress: cfg.token.contractAddress,
          status: 'QUEUED FOR ON-CHAIN PAYOUT',
          createdAt: Date.now(),
        };
        freshUser.withdrawals.push(wdRecord);
        db.withdrawals.push(wdRecord);
        saveDB(true);
        await flushCloudDB().catch(() => {});

        await Promise.allSettled([
          notifyTelegramUser(
            cfg,
            freshUser.userId,
            `💸 *Withdrawal Request Received!*\n\n• *Withdrawal Amount:* ${amount.toLocaleString('en-US')} ${cfg.token.symbol}\n• *Withdrawal Fee:* -${feeCoins} ${cfg.token.symbol}\n• *Net Payout:* ${netReceived.toLocaleString('en-US')} ${cfg.token.symbol}\n• *Recipient Wallet:* \`${freshUser.walletFriendly}\`\n• *Jetton Contract:* \`${cfg.token.contractAddress}\``
          ),
          notifyAdminsNewWithdraw(cfg, freshUser, wdRecord),
        ]);

        const view = getOrCreateUser(cfg, body);
        return sendJson(res, 200, {
          ok: true,
          message: `💸 Withdrawal of ${amount.toLocaleString('en-US')} ${cfg.token.symbol} submitted! (Fee: ${feeCoins} • Net: ${netReceived.toLocaleString('en-US')} ${cfg.token.symbol})`,
          data: buildSyncPayload(cfg, view),
        });
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
        await reconcileAdminOnChainPayouts(cfg, false);
        const admPayload = buildAdminWithdrawalsApiPayload(cfg, callerId);
        return sendJson(res, 200, {
          ok: true,
          adminData: admPayload,
          data: admPayload,
        });
      }

      if (pathname === '/api/admin/withdraw/prepare-tx') {
        const wdIds = Array.isArray(body.wdIds)
          ? body.wdIds.map((x) => String(x || '').trim()).filter(Boolean)
          : [];
        if (!wdIds.length) {
          return sendJson(res, 400, { ok: false, error: 'Please select at least 1 withdrawal request first!' });
        }

        await reconcileAdminOnChainPayouts(cfg, true);

        const memo = String(body.memo || 'MAXIMA PAYOUT').trim() || 'MAXIMA PAYOUT';
        const senderRaw =
          parseTonAddressToRaw(body.senderWalletAddress) ||
          rawUser.walletRaw ||
          parseTonAddressToRaw(cfg.wallet?.creatorRawAddress) ||
          parseTonAddressToRaw(cfg.wallet?.creatorTonWallet);

        if (!senderRaw) {
          return sendJson(res, 400, {
            ok: false,
            error: '🔒 Please connect your Admin TON Wallet via TON Connect first!',
          });
        }

        const jwInfo = await resolveOwnerJettonWalletAddress(cfg, senderRaw);
        if (!jwInfo || !jwInfo.friendlyBounceable) {
          return sendJson(res, 400, {
            ok: false,
            error:
              '⚠️ MAXIMA Jetton Wallet not found on the connected wallet! Make sure your connected TON wallet holds MAXIMA tokens.',
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
              amount: '50000000', // 0.05 TON gas (excess gas automatically refunded to Admin wallet)
              payload: bocBase64,
            },
          });
        }

        if (!preparedItems.length) {
          return sendJson(res, 400, {
            ok: false,
            error: 'No valid PENDING withdrawals found in the selection.',
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
          return sendJson(res, 400, { ok: false, error: 'No withdrawal IDs selected!' });
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
          recordProcessedWithdrawal(db, wd);

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
          message: `✅ ${processed.length} Withdrawals marked PAID & announced on ${getPayoutChannel(cfg)}!`,
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
          return sendJson(res, 400, { ok: false, error: 'Invalid action or wdIds parameter!' });
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
          recordProcessedWithdrawal(db, wd);
          count++;
        }

        if (count > 0) {
          saveDB(true);
          await flushCloudDB();
        }

        const actionLabel =
          action === 'burn'
            ? `🔥 ${count} Withdrawals rejected & bugged balance burned (No Refund)!`
            : action === 'wipe'
            ? `🚫 ${count} Withdrawals rejected, account balance reset to 0 & duplicate wallet unlinked!`
            : `🔄 ${count} Withdrawals cancelled & balance refunded!`;

        const view = getOrCreateUser(cfg, body);
        return sendJson(res, 200, {
          ok: true,
          processedCount: count,
          message: actionLabel,
          adminData: buildAdminWithdrawalsApiPayload(cfg, callerId),
          data: buildSyncPayload(cfg, view),
        });
      }

      // Admin 1-Click Batch On-Chain NFT Deployment (mints any un-deployed Genesis NFTs directly to owners' wallets on MAXIMA Tact Collection Contract)
      if (pathname === '/api/admin/nft/prepare-mint-tx') {
        const colRaw = parseTonAddressToRaw(cfg.nftSale?.collectionAddress || body.collectionAddress || '');
        if (!colRaw) {
          return sendJson(res, 400, {
            ok: false,
            error: 'Please set collectionAddress in config.json or NFT_COLLECTION_ADDRESS env var after deploying the NFT contract!',
          });
        }
        const colFriendly = rawToFriendlyTon(colRaw, true);
        const reg = ensureNftRegistry();
        const pendingItems = Object.values(reg.mintedByIndex || {})
          .filter((r) => r && !r.onChainAddress && r.currentOwnerWalletRaw)
          .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
          .slice(0, 4);

        if (!pendingItems.length) {
          return sendJson(res, 200, {
            ok: true,
            items: [],
            message: '✅ All minted Genesis NFTs are already deployed on-chain!',
          });
        }

        const baseQid = BigInt(Date.now()) * 1000n;
        const prepared = pendingItems.map((r, i) => ({
          index: r.index,
          serialCode: r.serialCode,
          ownerWalletRaw: r.currentOwnerWalletRaw,
          ownerWalletFriendly: rawToFriendlyTon(r.currentOwnerWalletRaw, false),
          message: {
            address: colFriendly,
            amount: '60000000', // 0.06 TON deploy gas per NFT item (excess returned)
            payload: buildAdminContractMintBocBase64({
              queryId: baseQid + BigInt(i + 1),
              itemIndex: r.index,
              ownerRaw: r.currentOwnerWalletRaw,
            }),
          },
        }));

        return sendJson(res, 200, {
          ok: true,
          collectionAddress: colFriendly,
          items: prepared,
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

    if (ext !== '.html' && req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        ETag: etag,
        'Cache-Control': 'public, max-age=604800',
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
      'Cache-Control': ext === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=604800',
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
    reasons.push(`Wallet used across >1 accounts (Other IDs: ${otherUsersWithSameWallet.join(', ')})`);
  }

  // 2. Check if this account ever verified multiple different wallets
  const verifiedWalletKeys = u.verifiedWallets && typeof u.verifiedWallets === 'object'
    ? Object.keys(u.verifiedWallets)
    : [];
  if (verifiedWalletKeys.length > 1) {
    if (severity !== 'FRAUD') severity = 'WARN';
    reasons.push(`Account previously verified ${verifiedWalletKeys.length} different wallets`);
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
    reasons.push(`${unhashedPresaleCount} Presale transactions do not have an on-chain txHash yet`);
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
    reasons.push(`This wallet was used for withdrawals by ${walletWdUsers.size} different accounts (${Array.from(walletWdUsers).join(', ')})`);
  }

  // 5. Calculate Mining, Referrals, NFT First-Mint Jackpots, P2P NFT Sales, and Source-of-Funds Balance Audit
  const totalMined = Number(u.totalMined || 0);
  const refCoins = Number(u.referralCoinsEarned || 0);
  const refList = Array.isArray(u.referrals) ? u.referrals : [];
  const currentBal = Number(u.balance || 0);
  const reg = ensureNftRegistry();
  let nftFirstMintCoins = Number(u.nftFirstMintCoinsEarned || 0);
  let regBonusSum = 0;
  for (const b of Object.values(reg.firstMintBonusClaimed || {})) {
    if (b && String(b.userId) === uid) {
      regBonusSum += Number(b.coins || 0);
    }
  }
  if (regBonusSum > nftFirstMintCoins) nftFirstMintCoins = regBonusSum;
  const nftMarketNetCoins = Math.max(0, Number((reg.marketNetCoinsByUser && reg.marketNetCoinsByUser[uid]) || 0));

  const missionAllowance = 350; // check-in + daily missions buffer
  const maxExplainable = presaleCoins + totalMined + refCoins + nftFirstMintCoins + nftMarketNetCoins + missionAllowance;
  const totalUsedByUser = currentBal + userTotalWithdrawn;
  const unexplainedDiff = +(totalUsedByUser - maxExplainable).toFixed(2);

  if (unexplainedDiff > 300) {
    severity = 'FRAUD';
    reasons.push(`Balance/Withdrawal exceeds legitimate sources by +${unexplainedDiff.toLocaleString('en-US')} MAXIMA`);
  }
  if (walletTotalWithdrawn > maxExplainable + 300) {
    severity = 'FRAUD';
    reasons.push(`Total withdrawn to this wallet (${walletTotalWithdrawn.toLocaleString('en-US')}) exceeds legitimate quota (${Math.round(maxExplainable).toLocaleString('en-US')})`);
  }

  // Check if user has 0 presale but withdrawing >= 2000
  if (presaleCoins === 0 && Number((wd && wd.requestedAmount) || 0) >= 2000) {
    if (severity === 'SAFE') severity = 'WARN';
    reasons.push(`Withdrawal without Presale (Pure Mining=${totalMined.toFixed(1)} / Referral=${refCoins.toFixed(1)}) — verify referrals & holdings`);
  }

  const badge =
    severity === 'FRAUD'
      ? '🚨 <b>FLAGGED BUG / MULTI-ACCOUNT (DO NOT PAY!)</b>'
      : severity === 'WARN'
      ? '⚠️ <b>MANUAL REVIEW NEEDED (SEE DETAILS)</b>'
      : '✅ <b>SAFE / VERIFIED LEGITIMATE</b>';

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
    : [`  • ✅ 1 Wallet = 1 Account &amp; Balance matches legitimate Presale / Mining / NFT sources.`];

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
    `🕵️ <b>LEGITIMACY AUDIT (ANTI-BUG DETECTOR):</b>`,
    `• <b>Audit Status:</b> ${audit.badge}`,
    `• <b>Presale Bought:</b> <b>${audit.presaleCoins.toLocaleString('en-US')} ${sym}</b> (${audit.presaleTon} GRAM)`,
    `• <b>Mined:</b> ${audit.totalMined.toFixed(2)} ${sym} · <b>Referral:</b> ${audit.refCoins.toFixed(2)} ${sym} (${audit.refCount} ref)`,
    `• <b>Account Total WD:</b> ${audit.userTotalWithdrawn.toLocaleString('en-US')} ${sym} · <b>Wallet Total WD:</b> ${audit.walletTotalWithdrawn.toLocaleString('en-US')} ${sym}`,
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
    [{ text: '🔥 Reject & Burn Bugged Balance (No Refund)', callback_data: `wd_burn:${wdId}` }],
    [{ text: '🚫 Confiscate All Balance + Unlink Duplicate Wallet', callback_data: `wd_wipe:${wdId}` }],
    [{ text: '🔄 Reject & Refund Balance', callback_data: `wd_rej:${wdId}` }],
  ];
}

async function notifyAdminsNewWithdraw(cfg, rawUser, wdRecord) {
  if (!wdRecord || !wdRecord.id) return;
  if (!db.notifiedAdminRefs || typeof db.notifiedAdminRefs !== 'object') db.notifiedAdminRefs = {};
  const idKey = `wd_id_${wdRecord.id}`;
  if (db.notifiedAdminRefs[idKey]) return;
  db.notifiedAdminRefs[idKey] = Date.now();
  saveDB(true);
  await flushCloudDB().catch(() => {});

  const html = buildWithdrawAdminCardHtml(cfg, wdRecord, rawUser);
  const kb = buildWithdrawAdminKeyboard(wdRecord.id);
  await notifyAdminsHtml(cfg, html, kb);
}

async function notifyAdminsNewPresale(cfg, rawUser, receipt) {
  if (!receipt) return;
  if (!db.notifiedAdminRefs || typeof db.notifiedAdminRefs !== 'object') db.notifiedAdminRefs = {};
  const idKey = receipt.id ? `ps_id_${receipt.id}` : '';
  const txKey = receipt.txHash ? `ps_tx_${normalizeTxHashHex(receipt.txHash)}` : '';
  const bocKey = receipt.bocKey ? `ps_boc_${receipt.bocKey}` : '';
  const bucketTs = Math.floor(Number(receipt.createdAt || Date.now()) / 90000);
  const bucketKey = `ps_u_${receipt.userId || (rawUser && rawUser.userId) || ''}_${receipt.tonPaid}_${bucketTs}`;

  if (
    (idKey && db.notifiedAdminRefs[idKey]) ||
    (txKey && db.notifiedAdminRefs[txKey]) ||
    (bocKey && db.notifiedAdminRefs[bocKey]) ||
    db.notifiedAdminRefs[bucketKey]
  ) {
    return;
  }

  const now = Date.now();
  if (idKey) db.notifiedAdminRefs[idKey] = now;
  if (txKey) db.notifiedAdminRefs[txKey] = now;
  if (bocKey) db.notifiedAdminRefs[bocKey] = now;
  db.notifiedAdminRefs[bucketKey] = now;
  saveDB(true);
  await flushCloudDB().catch(() => {});

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

async function notifyAdminsWalletVerified(cfg, rawUser, txRef = '') {
  if (!rawUser) return;
  if (!db.notifiedAdminRefs || typeof db.notifiedAdminRefs !== 'object') db.notifiedAdminRefs = {};
  const walletKey = `ver_w_${rawUser.walletRaw || rawUser.userId || ''}`;
  const txKey = txRef ? `ver_tx_${txRef}` : '';
  if (db.notifiedAdminRefs[walletKey] || (txKey && db.notifiedAdminRefs[txKey])) {
    return;
  }
  const now = Date.now();
  db.notifiedAdminRefs[walletKey] = now;
  if (txKey) db.notifiedAdminRefs[txKey] = now;
  saveDB(true);
  await flushCloudDB().catch(() => {});

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
  if (w && w.id && db && db.processedWithdrawIds && db.processedWithdrawIds[w.id]) {
    const locked = db.processedWithdrawIds[w.id];
    if (locked && !isWithdrawStatusPending(locked.status)) {
      w.status = locked.status;
      if (locked.paidAt && !w.paidAt) w.paidAt = locked.paidAt;
      if (locked.burnedAt && !w.burnedAt) w.burnedAt = locked.burnedAt;
      if (locked.refundedAt && !w.refundedAt) w.refundedAt = locked.refundedAt;
      if (locked.payoutEventId && !w.payoutEventId) w.payoutEventId = locked.payoutEventId;
      return false;
    }
  }
  const st = String((w && w.status) || '').toUpperCase();
  return (
    !st.startsWith('PAID') &&
    !st.startsWith('REFUNDED') &&
    !st.startsWith('BURNED') &&
    !st.startsWith('CONFISCATED') &&
    !st.startsWith('REJECTED')
  );
}

let lastAdminPayoutReconcileAt = 0;
let adminPayoutReconcileInFlight = null;

// Automatically verifies on-chain MAXIMA Jetton transfers sent by the Admin/Creator wallet on TON
// so any withdrawal already paid on-chain is automatically marked PAID ✅ and can NEVER reappear as PENDING!
async function reconcileAdminOnChainPayouts(cfg, forceRefresh = false) {
  const creatorRaw = parseTonAddressToRaw(
    (cfg && cfg.wallet && (cfg.wallet.creatorRawAddress || cfg.wallet.creatorTonWallet)) || ''
  );
  if (!creatorRaw) return false;

  const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
  if (!allWds.length) return false;

  const now = Date.now();
  if (now - lastAdminPayoutReconcileAt < (forceRefresh ? 2500 : 12000)) {
    return false;
  }
  if (adminPayoutReconcileInFlight) return adminPayoutReconcileInFlight;

  adminPayoutReconcileInFlight = (async () => {
    try {
      const url = `https://tonapi.io/v2/accounts/${encodeURIComponent(creatorRaw)}/events?limit=80`;
      const data = await fetchJsonWithTimeout(url, 5500, buildTonApiHeaders());
      const events = Array.isArray(data && data.events) ? data.events : [];
      if (!events.length) return false;
      lastAdminPayoutReconcileAt = Date.now();

      const decimals = Number(cfg.token?.decimals ?? 9);
      const divisor = 10 ** decimals;
      const onChainTransfers = [];

      for (const ev of events) {
        if (!ev || ev.in_progress) continue;
        const tsMs = Number(ev.timestamp || 0) * 1000;
        const evId = String(ev.event_id || '').trim();
        const actions = Array.isArray(ev.actions) ? ev.actions : [];
        for (let i = 0; i < actions.length; i++) {
          const act = actions[i];
          if (!act || act.type !== 'JettonTransfer' || act.status !== 'ok' || !act.JettonTransfer) continue;
          const jt = act.JettonTransfer;
          const senderRaw = parseTonAddressToRaw(jt.sender && (jt.sender.address || jt.sender));
          if (senderRaw && senderRaw !== creatorRaw) continue;
          const recipientRaw = parseTonAddressToRaw(jt.recipient && (jt.recipient.address || jt.recipient));
          if (!recipientRaw) continue;
          const amountCoins = Number(jt.amount || 0) / divisor;
          if (!Number.isFinite(amountCoins) || amountCoins <= 0) continue;
          const comment = String(jt.comment || '').trim();
          onChainTransfers.push({
            actionKey: `${evId || ev.lt}_${i}`,
            eventId: evId,
            recipientRaw,
            amountCoins,
            comment,
            timestampMs: tsMs,
          });
        }
      }

      if (!onChainTransfers.length) return false;

      // Sort transfers chronologically (oldest first)
      onChainTransfers.sort((a, b) => a.timestampMs - b.timestampMs);
      const usedActionKeys = new Set();
      let changed = false;

      // 1. Reserve transfers already corresponding to existing PAID withdrawals
      const paidWds = allWds
        .filter((w) => w && String(w.status || '').toUpperCase().startsWith('PAID'))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

      for (const w of paidWds) {
        recordProcessedWithdrawal(db, w);
        const wRaw = parseTonAddressToRaw(w.walletRaw || w.walletAddress || '');
        const net = Number(w.netAmount || 0);
        if (!wRaw || net <= 0) continue;

        const match = onChainTransfers.find(
          (tr) =>
            !usedActionKeys.has(tr.actionKey) &&
            tr.recipientRaw === wRaw &&
            Math.abs(tr.amountCoins - net) < 0.01 &&
            tr.timestampMs >= Number(w.createdAt || 0) - 180000
        );
        if (match) {
          usedActionKeys.add(match.actionKey);
          if (!w.payoutEventId && match.eventId) {
            w.payoutEventId = match.eventId;
            recordProcessedWithdrawal(db, w);
            changed = true;
          }
        }
      }

      // 2. Auto-reconcile any PENDING withdrawal (or BURNED withdrawal that was actually paid on-chain with MAXIMA PAYOUT)
      const candidates = allWds
        .filter((w) => {
          if (!w) return false;
          if (isWithdrawPending(w)) return true;
          const st = String(w.status || '').toUpperCase();
          return st.startsWith('BURNED');
        })
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

      for (const w of candidates) {
        const wRaw = parseTonAddressToRaw(w.walletRaw || w.walletAddress || '');
        const net = Number(w.netAmount || 0);
        if (!wRaw || net <= 0) continue;

        const match = onChainTransfers.find(
          (tr) =>
            !usedActionKeys.has(tr.actionKey) &&
            tr.recipientRaw === wRaw &&
            Math.abs(tr.amountCoins - net) < 0.01 &&
            tr.timestampMs >= Number(w.createdAt || 0) - 180000
        );
        if (!match) continue;

        usedActionKeys.add(match.actionKey);
        w.status = 'PAID ✅';
        w.paidAt = match.timestampMs || Date.now();
        w.payoutMemo = match.comment || w.payoutMemo || 'MAXIMA PAYOUT';
        w.payoutEventId = match.eventId;
        recordProcessedWithdrawal(db, w);

        const u = db.users && db.users[String(w.userId)];
        if (u && Array.isArray(u.withdrawals)) {
          const uw = u.withdrawals.find((x) => x && x.id === w.id);
          if (uw) {
            uw.status = 'PAID ✅';
            uw.paidAt = w.paidAt;
            uw.payoutMemo = w.payoutMemo;
            uw.payoutEventId = w.payoutEventId;
          }
        }
        changed = true;
      }

      if (changed) {
        deduplicateWithdrawalsInDB(db);
        saveDB(true);
      }
      return changed;
    } catch (_) {
      return false;
    } finally {
      adminPayoutReconcileInFlight = null;
    }
  })();

  return adminPayoutReconcileInFlight;
}

function buildAdminWithdrawalsApiPayload(cfg, adminUserId) {
  const allWds = Array.isArray(db.withdrawals) ? db.withdrawals : [];
  const enrich = (w) => {
    const u = db.users && db.users[String(w.userId)];
    const audit = auditWithdrawalLegitimacy(cfg, w, u);
    const defaultReasons = audit.reasons.length
      ? audit.reasons
      : ['1 Wallet = 1 Account & Balance matches legitimate Presale / Mining / NFT sources.'];
    return {
      id: w.id,
      wdId: w.id,
      userId: w.userId,
      username: (u && (u.username || u.firstName)) || w.username || w.firstName || `Miner_${w.userId}`,
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
      userCurrentInApp: u ? +Number(u.balance || 0).toFixed(2) : 0,
      userMinedTotal: +Number(audit.totalMined || 0).toFixed(2),
      userPresaleCoins: Number(audit.presaleCoins || 0),
      userLevel: u ? Number(u.level || 1) : 1,
      riskLevel: audit.severity,
      reasons: defaultReasons,
      audit: {
        severity: audit.severity, // 'SAFE' | 'WARN' | 'FRAUD'
        reasons: defaultReasons,
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
    recentHistory: history,
    counts: {
      totalPending: pending.length,
      safeCount: safePending.length,
      warnCount: warnPending.length,
      fraudCount: fraudPending.length,
      totalPendingNetMaxima: totalPendingNetCoins,
    },
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
        text: `⚡ 1-Click & Batch Auto-Withdraw Panel (${pendingWds.length} Queued)`,
        web_app: { url: adminPanelWebUrl },
      },
    ]);
  }
  keyboard.push(
    [{ text: `💸 Pending Withdrawals (${pendingWds.length} Queued)`, callback_data: 'adm:wd_pending' }],
    [{ text: `🕵️ Audit Withdrawals & Bug Detector`, callback_data: 'adm:audit' }],
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
      `🕵️ <b>WITHDRAWAL AUDIT:</b> No withdrawal requests recorded yet.`,
      [[{ text: '⬅️ Back to Admin Panel', callback_data: 'adm:stats' }]]
    );
    return;
  }

  const recentWds = allWds.slice(-20).reverse();
  const lines = [
    `🕵️ <b>WITHDRAWAL AUDIT &amp; ANTI-BUG REPORT (LATEST 20)</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  recentWds.forEach((w, idx) => {
    const u = db.users && db.users[String(w.userId)];
    const audit = auditWithdrawalLegitimacy(cfg, w, u);
    const icon = audit.severity === 'FRAUD' ? '🚨' : audit.severity === 'WARN' ? '⚠️' : '✅';
    const label = audit.severity === 'FRAUD' ? 'BUG/MULTI-ACCT' : audit.severity === 'WARN' ? 'MANUAL CHECK' : 'SAFE/LEGIT';
    const name = escHtml((u && (u.username ? `@${u.username}` : u.firstName)) || w.username || w.firstName || w.userId);
    const note = audit.reasons.length ? `\n   └─ <i>${escHtml(audit.reasons.join('; '))}</i>` : '';
    lines.push(
      `<b>${idx + 1}. ${icon} [${label}] ${name}</b> (ID: <code>${escHtml(w.userId)}</code>)\n   • Req: <b>${Number(w.requestedAmount).toLocaleString('en-US')} ${sym}</b> (${escHtml(w.status)}) · Presale: <b>${audit.presaleCoins.toLocaleString('en-US')} ${sym}</b> (${audit.presaleTon} GRAM)\n   • Wallet: <code>${escHtml(maskWalletShort(w.walletAddress))}</code>${note}`
    );
  });

  await notifyTelegramUserHtml(cfg, chatId, lines.join('\n'), [
    [{ text: '💸 Open Pending Withdrawals', callback_data: 'adm:wd_pending' }],
    [{ text: '⬅️ Back to Admin Panel', callback_data: 'adm:stats' }],
  ]);
}

async function sendAdminPendingWithdrawals(cfg, chatId) {
  await reconcileAdminOnChainPayouts(cfg, false);
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
    recordProcessedWithdrawal(db, wd);

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
    recordProcessedWithdrawal(db, wd);

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
    recordProcessedWithdrawal(db, wd);

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
        text: `${buildWithdrawAdminCardHtml(cfg, wd, u)}\n\n🔥 <b>BURNED (NO REFUND):</b> Withdrawal request rejected &amp; <b>${Number(wd.requestedAmount).toLocaleString('en-US')} ${sym}</b> has been <b>BURNED (Not refunded to user)</b>.`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }).catch(() => null);
    }

    await tgCall(cfg.botToken, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: '🔥 Withdrawal rejected & bugged balance burned (No Refund)!',
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
    recordProcessedWithdrawal(db, wd);

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
        text: `${buildWithdrawAdminCardHtml(cfg, wd, u)}\n\n🚫 <b>CONFISCATED &amp; RESET TO 0:</b> Withdrawal rejected without refund, remaining account balance reset to <b>0 ${sym} (Level 1)</b>, and duplicate wallet unlinked!`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }).catch(() => null);
    }

    await tgCall(cfg.botToken, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: '🚫 Bugged account balance confiscated (Reset 0) & duplicate wallet unlinked!',
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

let nftWatcherRunning = false;
function startBackgroundOnChainNftWatcher() {
  const timer = setInterval(async () => {
    if (nftWatcherRunning) return;
    nftWatcherRunning = true;
    try {
      await ensureCloudDBLoaded();
      const liveCfg = loadConfig();
      await reconcileCollectionOnChainOwnership(liveCfg, false);
      // Continuously verify wallets of users who hold NFTs so transfers immediately update mining boost!
      const nftUsers = Object.values(db.users || {}).filter(
        (u) =>
          u &&
          u.walletRaw &&
          ((Array.isArray(u.nftPurchases) && u.nftPurchases.length > 0) ||
            (Array.isArray(u.onChainNfts) && u.onChainNfts.length > 0))
      );
      for (const u of nftUsers.slice(0, 12)) {
        await syncOnChainNftsForUser(liveCfg, u, false).catch(() => {});
      }
    } catch (_) {
    } finally {
      nftWatcherRunning = false;
    }
  }, 25000);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

if (require.main === module) {
  ensureCloudDBLoaded().catch(() => {});
  startBackgroundOnChainNftWatcher();
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

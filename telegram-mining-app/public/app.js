(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor('#080a0e');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#080a0e');
    } catch (_) {}
  }

  // ================= 10 MOST WIDELY USED GLOBAL LANGUAGES =================
  const LANGUAGES = [
    { code: 'en', flag: '🇬🇧', native: 'English', global: 'English' },
    { code: 'zh', flag: '🇨🇳', native: '中文', global: 'Mandarin' },
    { code: 'hi', flag: '🇮🇳', native: 'हिन्दी', global: 'Hindi' },
    { code: 'es', flag: '🇪🇸', native: 'Español', global: 'Spanish' },
    { code: 'ar', flag: '🇸🇦', native: 'العربية', global: 'Arabic' },
    { code: 'fr', flag: '🇫🇷', native: 'Français', global: 'French' },
    { code: 'ru', flag: '🇷🇺', native: 'Русский', global: 'Russian' },
    { code: 'pt', flag: '🇵🇹', native: 'Português', global: 'Portuguese' },
    { code: 'id', flag: '🇮🇩', native: 'Bahasa Indonesia', global: 'Indonesian' },
    { code: 'ja', flag: '🇯🇵', native: '日本語', global: 'Japanese' },
  ];

  const I18N = {
    id: {
      btn_copy_short: '📋 Salin',
      mining_paused_title: 'Mining Berhenti (Wallet Belum Terkoneksi)',
      mining_paused_desc: 'Hubungkan wallet pribadi secara otomatis via TON Connect agar mesin mining berjalan!',
      btn_connect_auto: 'Hubungkan',
      lbl_rank: 'PANGKAT',
      lbl_level: 'LEVEL',
      lbl_mining_power: 'Mining Power',
      lbl_daily_output: 'Output / 24j',
      combined_holding_kicker: 'PROOF-OF-HOLDING (WALLET + IN-APP DIGABUNG)',
      inapp_holding_lbl: '🏦 Hold di Mining App',
      onchain_holding_lbl: '👛 Hold di Wallet Terkoneksi',
      live_mining_cart_lbl: 'HASIL MINING BERJALAN',
      shift_remaining_lbl: 'Shift 24 Jam',
      claim_min_note: 'Dapat diklaim kapan saja minimal {min} MAXIMA',
      btn_connect_to_mine: '🔗 Hubungkan Wallet Pribadi untuk Mulai Mining',
      btn_claim_wait: '⏳ Minimal Klaim {min} MAXIMA ({cur} / {min})',
      btn_claim_ready: '⛏️ Klaim Hasil Mining (+{amt} MAXIMA)',
      next_lv_title: 'Berikutnya: Level {lvl} ({ths} TH/s)',
      next_lv_hint: 'Butuh {req} MAXIMA gabungan (Kurang {rem} MAXIMA)',
      max_lv_title: '👑 Level Maksimal 1,000 Tercapai!',
      max_lv_hint: 'Anda telah mencapai Rank 10 · CEO (5,000 TH/s)!',
      road_1000_title: '🗺️ 1,000 Level Mining',
      btn_my_level: '📍 Level Saya',
      road_1000_desc: '10 Rank (TRAINEE s/d CEO) & 1,000 Level Mining berdasarkan gabungan koin di Wallet terkoneksi + di dalam Mining App.',
      lbl_holding_needed: 'Holding Dibutuhkan',
      lbl_tool_crew: 'Alat · Kru',
      btn_all_1000: 'Semua (1–1000)',
      search_lv_placeholder: '🔍 Cari Level (1 - 1000)...',
      levels_heading_range: 'Daftar Level {a} – {b} ({count} Level)',
      levels_heading_search: 'Hasil Pencarian Level "{q}" ({count} Level)',
      status_current: '⚡ AKTIF',
      status_unlocked: '✓ TERBUKA',
      status_free_lv1: 'GRATIS (Wallet Connect)',
      presale_title: '🚀 Presale Resmi MAXIMA',
      presale_desc: 'Swap GRAM for MAXIMA to boost your Level & Mining Power instantly!',
      presale_ends_lbl: '⏳ PRESALE BERAKHIR DALAM',
      cd_days: 'HARI',
      cd_hours: 'JAM',
      cd_mins: 'MENIT',
      cd_secs: 'DETIK',
      presale_ended_btn: 'Presale Berakhir',
      presale_sold_lbl: 'Terjual Saat Presale',
      presale_remaining_lbl: 'Sisa Kuota Global',
      wallet_presale_quota_lbl: 'Kuota Wallet Anda (Maks 100 GRAM):',
      choose_presale_pkg: 'Pilih Paket Presale (Maks 100 GRAM / Wallet)',
      presale_history_heading: 'Riwayat Pembelian Presale',
      no_presale_yet: 'Belum ada pembelian presale.',
      btn_buy_presale: 'Beli {ton} GRAM',
      pkg_quota_exceeded: 'Melebihi Sisa Kuota ({rem} GRAM)',
      pkg_reach_level: 'Estimasi Naik ke Level {lvl} ({ths} TH/s)',
      missions_tab_title: '📋 Misi & Referral',
      checkin_title: 'Daily Check-In',
      day_short: 'H{d}',
      btn_checkin_now: '📅 Check-In Hari ke-{d} (+{amt} MAXIMA)',
      btn_checkin_done: '✅ Sudah Check-In Hari Ini',
      daily_channels_heading: '📢 Daily Channel Missions',
      btn_open_channel: 'Buka Channel',
      btn_claim_mission: 'Klaim',
      mission_done_today: '✓ Selesai Hari Ini',
      referral_section_heading: '👥 Referral Teman Aktif (+200 MAXIMA & +10% Mining)',
      ref_perk1_sub: 'Per Referral Teman Aktif',
      ref_perk2_sub: 'Dari Hasil Mining Referral Aktif',
      ref_strict_title: '⚠️ Syarat Wajib Referral Terhitung Aktif:',
      ref_cond_1: '1. Melakukan absensi Check-In 3 hari berturut-turut.',
      ref_cond_2: '2. Butuh verifikasi wallet untuk referensi.',
      ref_cond_3: 'Tanpa KEDUA syarat di atas, referral tidak dihitung & tidak mendapat reward.',
      btn_share_tg: '📤 Bagikan Telegram',
      btn_copy_link: '📋 Salin Link',
      ref_active_lbl: 'Referral Aktif',
      ref_pending_lbl: 'Belum Aktif',
      ref_earned_lbl: 'Bonus MAXIMA',
      friends_progress_heading: 'Daftar & Status Syarat Teman',
      no_referrals_yet: 'Belum ada teman bergabung. Bagikan link referral Anda!',
      ref_tag_active: '✅ AKTIF (+200)',
      ref_tag_pending: '⏳ BELUM DIHITUNG',
      wallet_tab_title: '👛 Wallet & Withdraw',
      wallet_tab_desc: 'Connect your personal TON wallet via TON Connect and verify your wallet to unlock Withdraw.',
      jetton_contract_lbl: 'ALAMAT KONTRAK TON JETTON MAXIMA:',
      btn_copy_contract: '📋 Salin Kontrak',
      step1_auto_wallet: '1. Koneksi Otomatis Wallet Pribadi',
      wallet_disconnected_box: 'Belum ada wallet terkoneksi. Gunakan tombol koneksi otomatis TON Connect di bawah.',
      wallet_connected_box: 'Terkoneksi ({app}): {addr}',
      btn_connect_wallet: '🔗 Hubungkan Wallet Pribadi (TON Connect)',
      btn_disconnect_wallet: '🔌 Putuskan Koneksi Wallet',
      step2_verify_ton: '2. Verifikasi Wallet (0.1 GRAM)',
      verify_explain: 'Complete 0.1 GRAM verification wallet to unlock Withdraw.',
      btn_verify_ton: '🛡️ Verifikasi 0.1 GRAM',
      btn_verified_ok: '✅ Wallet Terverifikasi',
      btn_check_onchain: '🔄 Cek On-Chain',
      step3_withdraw_title: '3. Withdraw Koin MAXIMA',
      wd_chk1_txt: '1. Wallet Pribadi Terkoneksi Otomatis',
      wd_chk2_txt: '2. Verifikasi Wallet 0.1 GRAM Selesai',
      wd_chk3_txt: '3. Minimal Saldo 2,000 MAXIMA (Saat ini: {bal})',
      wd_placeholder: 'Jumlah Withdraw (Minimal 2000 MAXIMA)...',
      wd_preview_html: 'Fee Withdraw: <b>-100 MAXIMA</b> · Bersih Diterima: <b style="color:#2ee59d">{net} MAXIMA</b>',
      btn_withdraw_now: '💸 Withdraw MAXIMA Sekarang',
      wd_history_title: '📜 Riwayat Withdraw',
      no_wd_yet: 'Belum ada riwayat withdraw.',
      leaderboard_title: '🏆 Top Miners MAXIMA',
      settings_tab_title: '⚙️ Pengaturan',
      settings_lang_heading: '🌐 Language',
      btn_open_lang_popup: '🌍 Buka Pop-up Pilihan Bahasa',
      settings_sound_heading: '🔊 Pengaturan Suara & Musik',
      sfx_toggle_lbl: '🎵 Efek Suara (SFX)',
      sfx_toggle_sub: 'Bunyi saat klaim mining, check-in, presale & naik level',
      bgm_toggle_lbl: '🎶 Musik Latar Tambang (BGM)',
      bgm_toggle_sub: 'Suara musik ambient tambang MAXIMA',
      haptic_toggle_lbl: '📳 Getaran Haptic',
      haptic_toggle_sub: 'Getaran saat menekan tombol aksi',
      volume_lbl: '🔉 Volume Suara',
      btn_test_sound: '🔔 Tes Efek Suara',
      account_info_heading: '👤 Informasi Akun & Kontrak',
      nav_mining: 'Mining',
      nav_levels: 'MAP',
      nav_presale: 'Presale',
      nav_missions: 'Misi',
      nav_wallet: 'Wallet',
      nav_settings: 'Setelan',
      copied_toast: '📋 Berhasil disalin!',
      nft_win_title: 'MAXIMA GENESIS NFT MINT',
      nft_owned_lbl: 'Kuota Wallet',
      nft_power_boost_lbl: 'Boost Power NFT',
      nft_daily_bonus_lbl: 'Bonus Mint Pertama',
      nft_box_name: 'MAXIMA Genesis Rig NFT',
      nft_win_desc: 'Mint 1 Genesis NFT seharga 10 GRAM (#0001–#1000) untuk mendapat +2% s/d +10% Mining Power permanen sesuai Trait Rarity! Mint pertama yang mendapat Legendary menerima +10.000 MAXIMA, atau Mythic +20.000 MAXIMA. NFT bisa ditransfer & dijual antar pemain!',
      nft_odds_heading: '🏛️ Daftar Koleksi 1.000 Genesis NFT & Mining Power',
      nft_inventory_heading: '🎒 Koleksi NFT Anda (Transfer & Jual)',
      no_nft_owned_yet: 'Belum memiliki NFT. Mint Genesis NFT atau beli dari P2P Market untuk menambah Mining Power Anda!',
      btn_spin_gacha: '💎 Mint Genesis NFT · {ton} GRAM ({used}/{max})',
      btn_gacha_spinning: '💎 Memproses Minting NFT...',
      btn_gacha_limit_full: '✅ Kuota Mint Wallet Penuh ({max} / {max} NFT)',
      nft_owned_badge: 'DIMILIKI ×{count}',
    },
    en: {
      btn_copy_short: '📋 Copy',
      mining_paused_title: 'Mining Paused (Wallet Not Connected)',
      mining_paused_desc: 'Connect your personal TON wallet automatically via TON Connect to start mining!',
      btn_connect_auto: 'Connect',
      lbl_rank: 'RANK',
      lbl_level: 'LEVEL',
      lbl_mining_power: 'Mining Power',
      lbl_daily_output: 'Output / 24h',
      combined_holding_kicker: 'PROOF-OF-HOLDING (WALLET + IN-APP COMBINED)',
      inapp_holding_lbl: '🏦 Held in Mining App',
      onchain_holding_lbl: '👛 Held in Connected Wallet',
      live_mining_cart_lbl: 'LIVE MINING REWARD',
      shift_remaining_lbl: '24h Shift',
      claim_min_note: 'Claimable anytime once reaching {min} MAXIMA',
      btn_connect_to_mine: '🔗 Connect Personal TON Wallet to Start Mining',
      btn_claim_wait: '⏳ Min Claim {min} MAXIMA ({cur} / {min})',
      btn_claim_ready: '⛏️ Claim Mining Reward (+{amt} MAXIMA)',
      next_lv_title: 'Next: Level {lvl} ({ths} TH/s)',
      next_lv_hint: 'Need {req} combined MAXIMA ({rem} more needed)',
      max_lv_title: '👑 Max Level 1,000 Reached!',
      max_lv_hint: 'You have reached Rank 10 · CEO (5,000 TH/s)!',
      road_1000_title: '🗺️ 1,000 Mining Levels',
      btn_my_level: '📍 My Level',
      road_1000_desc: '10 Ranks (TRAINEE to CEO) & 1,000 Mining Levels powered by combined MAXIMA held in your connected Wallet + Mining App.',
      lbl_holding_needed: 'Holding Needed',
      lbl_tool_crew: 'Tool · Crew',
      btn_all_1000: 'All (1–1000)',
      search_lv_placeholder: '🔍 Search Level (1 - 1000)...',
      levels_heading_range: 'Levels {a} – {b} ({count} Levels)',
      levels_heading_search: 'Search Results for "{q}" ({count} Levels)',
      status_current: '⚡ ACTIVE',
      status_unlocked: '✓ UNLOCKED',
      status_free_lv1: 'FREE (Wallet Connect)',
      presale_title: '🚀 MAXIMA Official Presale',
      presale_desc: 'Swap GRAM for MAXIMA to boost your Level & Mining Power instantly!',
      presale_ends_lbl: '⏳ PRESALE ENDS IN',
      cd_days: 'DAYS',
      cd_hours: 'HOURS',
      cd_mins: 'MINS',
      cd_secs: 'SECS',
      presale_ended_btn: 'Presale Ended',
      presale_sold_lbl: 'Total Presale Sold',
      presale_remaining_lbl: 'Remaining Supply',
      wallet_presale_quota_lbl: 'Your Wallet Limit (Max 100 GRAM):',
      choose_presale_pkg: 'Select Presale Package (Max 100 GRAM / Wallet)',
      presale_history_heading: 'Your Presale Purchases',
      no_presale_yet: 'No presale purchases yet.',
      btn_buy_presale: 'Buy {ton} GRAM',
      pkg_quota_exceeded: 'Exceeds Wallet Limit ({rem} GRAM left)',
      pkg_reach_level: 'Boosts to Level {lvl} ({ths} TH/s)',
      missions_tab_title: '📋 Missions & Referrals',
      checkin_title: 'Daily Check-In',
      day_short: 'D{d}',
      btn_checkin_now: '📅 Check-In Day {d} (+{amt} MAXIMA)',
      btn_checkin_done: '✅ Checked In Today',
      daily_channels_heading: '📢 Daily Channel Missions',
      btn_open_channel: 'Join Channel',
      btn_claim_mission: 'Claim',
      mission_done_today: '✓ Claimed Today',
      referral_section_heading: '👥 Active Referral Crew (+200 MAXIMA & +10% Mining)',
      ref_perk1_sub: 'Per Active Referral',
      ref_perk2_sub: 'From Active Referral Mining',
      ref_strict_title: '⚠️ Mandatory Active Referral Conditions:',
      ref_cond_1: '1. Friend completes 3 consecutive days of Daily Check-In.',
      ref_cond_2: '2. Wallet verification is required for referral.',
      ref_cond_3: 'Without BOTH conditions above, referral is NOT counted and earns no reward.',
      btn_share_tg: '📤 Share on Telegram',
      btn_copy_link: '📋 Copy Link',
      ref_active_lbl: 'Active Referrals',
      ref_pending_lbl: 'Pending',
      ref_earned_lbl: 'MAXIMA Earned',
      friends_progress_heading: 'Invited Friends & Qualification Status',
      no_referrals_yet: 'No friends invited yet. Share your link!',
      ref_tag_active: '✅ ACTIVE (+200)',
      ref_tag_pending: '⏳ NOT COUNTED',
      wallet_tab_title: '👛 Wallet & Withdraw',
      wallet_tab_desc: 'Connect your personal TON wallet via TON Connect and verify your wallet to unlock Withdraw.',
      jetton_contract_lbl: 'MAXIMA TON JETTON CONTRACT:',
      btn_copy_contract: '📋 Copy Contract',
      step1_auto_wallet: '1. Automatic Personal Wallet Connection',
      wallet_disconnected_box: 'No wallet connected. Connect your personal TON wallet using the button below.',
      wallet_connected_box: 'Connected ({app}): {addr}',
      btn_connect_wallet: '🔗 Connect Personal Wallet (TON Connect)',
      btn_disconnect_wallet: '🔌 Disconnect Wallet',
      step2_verify_ton: '2. Wallet Verification (0.1 GRAM)',
      verify_explain: 'Complete 0.1 GRAM verification wallet to unlock Withdraw.',
      btn_verify_ton: '🛡️ Verify 0.1 GRAM',
      btn_verified_ok: '✅ Wallet Verified',
      btn_check_onchain: '🔄 Check On-Chain',
      step3_withdraw_title: '3. Withdraw MAXIMA',
      wd_chk1_txt: '1. Personal Wallet Connected Automatically',
      wd_chk2_txt: '2. 0.1 GRAM Wallet Verification Completed',
      wd_chk3_txt: '3. Min Balance 2,000 MAXIMA (Current: {bal})',
      wd_placeholder: 'Withdraw Amount (Min 2000 MAXIMA)...',
      wd_preview_html: 'Withdraw Fee: <b>-100 MAXIMA</b> · Net Payout: <b style="color:#2ee59d">{net} MAXIMA</b>',
      btn_withdraw_now: '💸 Withdraw MAXIMA Now',
      wd_history_title: '📜 Withdrawal History',
      no_wd_yet: 'No withdrawals yet.',
      leaderboard_title: '🏆 Top MAXIMA Miners',
      settings_tab_title: '⚙️ Settings',
      settings_lang_heading: '🌐 Language',
      btn_open_lang_popup: '🌍 Open Language Selection Popup',
      settings_sound_heading: '🔊 Sound & Music Settings',
      sfx_toggle_lbl: '🎵 Sound Effects (SFX)',
      sfx_toggle_sub: 'Play sounds on claim, check-in, presale & level up',
      bgm_toggle_lbl: '🎶 Ambient Mine Music (BGM)',
      bgm_toggle_sub: 'Background cosmic mining atmosphere',
      haptic_toggle_lbl: '📳 Haptic Vibration',
      haptic_toggle_sub: 'Tactile feedback on actions',
      volume_lbl: '🔉 Master Volume',
      btn_test_sound: '🔔 Test Sound Effect',
      account_info_heading: '👤 Account & Contract Info',
      nav_mining: 'Mining',
      nav_levels: 'MAP',
      nav_presale: 'Presale',
      nav_missions: 'Missions',
      nav_wallet: 'Wallet',
      nav_settings: 'Settings',
      copied_toast: '📋 Copied to clipboard!',
      nft_win_title: 'MAXIMA GENESIS NFT MINT',
      nft_owned_lbl: 'Wallet Quota',
      nft_power_boost_lbl: 'NFT Power Boost',
      nft_daily_bonus_lbl: '1st Mint Bonus',
      nft_box_name: 'MAXIMA Genesis Rig NFT',
      nft_win_desc: 'Mint 1 Genesis NFT for 10 GRAM (#0001–#1000) to gain +2% to +10% permanent Mining Power based on its Rarity & Traits! First-time minters who pull Legendary get +10,000 MAXIMA, or Mythic get +20,000 MAXIMA. All NFTs can be transferred or sold to other players!',
      nft_odds_heading: '🏛️ Listed Genesis NFT Collection (1,000 Supply)',
      nft_inventory_heading: '🎒 Your Minted NFTs (Transfer & Sell)',
      no_nft_owned_yet: 'No NFTs owned yet. Mint a Genesis NFT or buy one from the P2P Market to boost your Mining Power!',
      btn_spin_gacha: '💎 Mint Genesis NFT · {ton} GRAM ({used}/{max})',
      btn_gacha_spinning: '💎 Minting Genesis NFT...',
      btn_gacha_limit_full: '✅ Wallet Mint Quota Full ({max} / {max} NFT)',
      nft_owned_badge: 'OWNED ×{count}',
    },
    zh: {
      btn_copy_short: '📋 复制',
      mining_paused_title: '挖矿已暂停（未连接钱包）',
      mining_paused_desc: '请通过 TON Connect 自动连接您的个人钱包以启动挖矿！',
      btn_connect_auto: '连接钱包',
      lbl_rank: '等级称号',
      lbl_level: '等级',
      lbl_mining_power: '挖矿算力',
      lbl_daily_output: '24小时产出',
      combined_holding_kicker: '持币证明（连接钱包 + 应用内持币总和）',
      inapp_holding_lbl: '🏦 应用内持币',
      onchain_holding_lbl: '👛 钱包链上持币',
      live_mining_cart_lbl: '实时挖矿收益',
      shift_remaining_lbl: '24小时周期',
      claim_min_note: '满 {min} MAXIMA 即可随时领取',
      btn_connect_to_mine: '🔗 连接个人 TON 钱包开始挖矿',
      btn_claim_wait: '⏳ 最低领取 {min} MAXIMA ({cur} / {min})',
      btn_claim_ready: '⛏️ 领取挖矿收益 (+{amt} MAXIMA)',
      next_lv_title: '下一级: Lv {lvl} ({ths} TH/s)',
      next_lv_hint: '需总持币 {req} MAXIMA（还差 {rem}）',
      max_lv_title: '👑 已达最高 1,000 级！',
      max_lv_hint: '您已达到最高职级 Rank 10 · CEO (5,000 TH/s)！',
      road_1000_title: '🗺️ 1,000 挖矿等级',
      btn_my_level: '📍 我的等级',
      road_1000_desc: '10 大职级 (TRAINEE 至 CEO) 与 1,000 个等级，算力由钱包与游戏内 MAXIMA 总持仓决定。',
      lbl_holding_needed: '所需持币',
      lbl_tool_crew: '工具 · 团队',
      btn_all_1000: '全部 (1–1000)',
      search_lv_placeholder: '🔍 搜索等级 (1 - 1000)...',
      presale_title: '🚀 MAXIMA 官方预售',
      presale_desc: '使用 GRAM 兑换 MAXIMA，立即提升您的等级与挖矿算力！',
      presale_sold_lbl: '预售已售出',
      presale_remaining_lbl: '剩余总额度',
      wallet_presale_quota_lbl: '当前钱包额度（上限 100 GRAM）:',
      choose_presale_pkg: '选择预售套餐（单钱包最高 100 GRAM）',
      btn_buy_presale: '支付 {ton} GRAM',
      missions_tab_title: '📋 每日任务与邀请',
      checkin_title: '每日签到',
      day_short: '第{d}天',
      btn_checkin_now: '📅 第{d}天签到 (+{amt} MAXIMA)',
      btn_checkin_done: '✅ 今日已签到',
      daily_channels_heading: '📢 每日频道任务',
      btn_open_channel: '加入频道',
      btn_claim_mission: '领取',
      mission_done_today: '✓ 今日已领',
      referral_section_heading: '👥 活跃好友邀请 (+200 MAXIMA & +10% 挖矿提成)',
      ref_strict_title: '⚠️ 活跃有效邀请必须满足两个条件：',
      ref_cond_1: '1. 好友连续 3 天完成每日签到。',
      ref_cond_2: '2. 推荐好友需完成钱包验证。',
      ref_cond_3: '未同时满足以上两项将不计入邀请且无奖励。',
      wallet_tab_title: '👛 钱包与提现',
      step1_auto_wallet: '1. 自动连接个人钱包',
      step2_verify_ton: '2. 钱包验证 (发送 0.1 GRAM)',
      step3_withdraw_title: '3. 提现 MAXIMA（最低 2000 · 手续费 100）',
      btn_withdraw_now: '💸 立即提现 MAXIMA',
      settings_tab_title: '⚙️ 设置',
      settings_lang_heading: '🌐 Language',
      settings_sound_heading: '🔊 音效与音乐',
      nav_mining: '挖矿',
      nav_levels: 'MAP',
      nav_presale: '预售',
      nav_missions: '任务',
      nav_wallet: '钱包',
      nav_settings: '设置',
      copied_toast: '📋 已复制！',
    },
    hi: {
      btn_copy_short: '📋 कॉपी',
      mining_paused_title: 'माइनिंग रुकी हुई है (वॉलेट कनेक्ट नहीं है)',
      mining_paused_desc: 'माइनिंग शुरू करने के लिए TON Connect से अपना पर्सनल वॉलेट ऑटोमैटिक कनेक्ट करें!',
      btn_connect_auto: 'कनेक्ट करें',
      combined_holding_kicker: 'प्रूफ-ऑफ-होल्डिंग (वॉलेट + ऐप कुल कॉइन)',
      inapp_holding_lbl: '🏦 ऐप में होल्ड',
      onchain_holding_lbl: '👛 वॉलेट में होल्ड',
      live_mining_cart_lbl: 'लाइव माइनिंग रिवॉर्ड',
      claim_min_note: 'कम से कम {min} MAXIMA होने पर कभी भी क्लेम करें',
      btn_connect_to_mine: '🔗 माइनिंग के लिए पर्सनल वॉलेट कनेक्ट करें',
      btn_claim_ready: '⛏️ माइनिंग क्लेम करें (+{amt} MAXIMA)',
      road_1000_title: '🗺️ 1,000 माइनिंग लेवल',
      presale_title: '🚀 MAXIMA ऑफिशियल प्रीसेल',
      missions_tab_title: '📋 मिशन और रेफरल',
      checkin_title: 'Daily Check-In',
      wallet_tab_title: '👛 वॉलेट और निकासी',
      settings_tab_title: '⚙️ सेटिंग्स',
      nav_mining: 'माइनिंग',
      nav_levels: 'MAP',
      nav_presale: 'प्रीसेल',
      nav_missions: 'मिशन',
      nav_wallet: 'वॉलेट',
      nav_settings: 'सेटिंग्स',
      copied_toast: '📋 कॉपी हो गया!',
    },
    es: {
      btn_copy_short: '📋 Copiar',
      mining_paused_title: 'Minería en Pausa (Billetera No Conectada)',
      mining_paused_desc: '¡Conecta tu billetera TON personal automáticamente vía TON Connect para minar!',
      btn_connect_auto: 'Conectar',
      combined_holding_kicker: 'PROOF-OF-HOLDING (BILLETERA + APP COMBINADOS)',
      inapp_holding_lbl: '🏦 En la App',
      onchain_holding_lbl: '👛 En Billetera TON',
      live_mining_cart_lbl: 'MINERÍA EN VIVO',
      claim_min_note: 'Reclama en cualquier momento desde {min} MAXIMA',
      btn_connect_to_mine: '🔗 Conectar Billetera Personal para Minar',
      btn_claim_ready: '⛏️ Reclamar Minería (+{amt} MAXIMA)',
      road_1000_title: '🗺️ 1,000 Niveles de Minería',
      presale_title: '🚀 Preventa Oficial MAXIMA',
      missions_tab_title: '📋 Misiones y Referidos',
      checkin_title: 'Daily Check-In',
      wallet_tab_title: '👛 Billetera y Retiro',
      settings_tab_title: '⚙️ Ajustes',
      nav_mining: 'Minar',
      nav_levels: 'MAP',
      nav_presale: 'Preventa',
      nav_missions: 'Misiones',
      nav_wallet: 'Wallet',
      nav_settings: 'Ajustes',
      copied_toast: '📋 ¡Copiado!',
    },
    ar: {
      btn_copy_short: '📋 نسخ',
      mining_paused_title: 'التعدين متوقف (المحفظة غير متصلة)',
      mining_paused_desc: 'اربط محفظة TON الشخصية تلقائياً عبر TON Connect لبدء التعدين!',
      btn_connect_auto: 'اتصال',
      combined_holding_kicker: 'إثبات الحيازة (المحفظة + التطبيق معاً)',
      inapp_holding_lbl: '🏦 رصيد التطبيق',
      onchain_holding_lbl: '👛 رصيد المحفظة',
      live_mining_cart_lbl: 'عائد التعدين المباشر',
      claim_min_note: 'يمكنك المطالبة في أي وقت عند الوصول إلى {min} MAXIMA',
      btn_connect_to_mine: '🔗 اربط المحفظة الشخصية لبدء التعدين',
      btn_claim_ready: '⛏️ مطالبة التعدين (+{amt} MAXIMA)',
      road_1000_title: '🗺️ 1,000 مستوى تعدين',
      presale_title: '🚀 البيع المسبق الرسمي MAXIMA',
      missions_tab_title: '📋 المهام والإحالات',
      checkin_title: 'Daily Check-In',
      wallet_tab_title: '👛 المحفظة والسحب',
      settings_tab_title: '⚙️ الإعدادات',
      nav_mining: 'تعدين',
      nav_levels: 'MAP',
      nav_presale: 'البيع المسبق',
      nav_missions: 'المهام',
      nav_wallet: 'المحفظة',
      nav_settings: 'الإعدادات',
      copied_toast: '📋 تم النسخ!',
    },
    fr: {
      btn_copy_short: '📋 Copier',
      mining_paused_title: 'Minage en Pause (Portefeuille Non Connecté)',
      mining_paused_desc: 'Connectez automatiquement votre portefeuille TON personnel via TON Connect pour miner !',
      btn_connect_auto: 'Connecter',
      combined_holding_kicker: 'PROOF-OF-HOLDING (PORTEFEUILLE + APP COMBINÉS)',
      inapp_holding_lbl: '🏦 Solde App',
      onchain_holding_lbl: '👛 Solde Wallet TON',
      live_mining_cart_lbl: 'MINAGE EN DIRECT',
      claim_min_note: 'Réclamable à tout moment dès {min} MAXIMA',
      btn_connect_to_mine: '🔗 Connecter le Portefeuille Personnel',
      btn_claim_ready: '⛏️ Réclamer (+{amt} MAXIMA)',
      road_1000_title: '🗺️ 1 000 Niveaux de Minage',
      presale_title: '🚀 Prévente Officielle MAXIMA',
      missions_tab_title: '📋 Missions & Parrainage',
      checkin_title: 'Daily Check-In',
      wallet_tab_title: '👛 Portefeuille & Retrait',
      settings_tab_title: '⚙️ Paramètres',
      nav_mining: 'Minage',
      nav_levels: 'MAP',
      nav_presale: 'Prévente',
      nav_missions: 'Missions',
      nav_wallet: 'Wallet',
      nav_settings: 'Options',
      copied_toast: '📋 Copié !',
    },
    ru: {
      btn_copy_short: '📋 Копир.',
      mining_paused_title: 'Майнинг остановлен (кошелёк не подключён)',
      mining_paused_desc: 'Подключите личный TON кошелёк автоматически через TON Connect для запуска майнинга!',
      btn_connect_auto: 'Подключить',
      combined_holding_kicker: 'PROOF-OF-HOLDING (КОШЕЛЁК + ПРИЛОЖЕНИЕ ВМЕСТЕ)',
      inapp_holding_lbl: '🏦 В приложении',
      onchain_holding_lbl: '👛 В TON кошельке',
      live_mining_cart_lbl: 'ТЕКУЩАЯ ДОБЫЧА',
      claim_min_note: 'Клейм доступен в любое время от {min} MAXIMA',
      btn_connect_to_mine: '🔗 Подключить личный TON кошелёк',
      btn_claim_ready: '⛏️ Забрать добычу (+{amt} MAXIMA)',
      road_1000_title: '🗺️ 1,000 Уровней Майнинга',
      presale_title: '🚀 Официальный Пресейл MAXIMA',
      missions_tab_title: '📋 Миссии и Рефералы',
      checkin_title: 'Daily Check-In',
      wallet_tab_title: '👛 Кошелёк и Вывод',
      settings_tab_title: '⚙️ Настройки',
      nav_mining: 'Майнинг',
      nav_levels: 'MAP',
      nav_presale: 'Пресейл',
      nav_missions: 'Миссии',
      nav_wallet: 'Кошелёк',
      nav_settings: 'Настр.',
      copied_toast: '📋 Скопировано!',
    },
    pt: {
      btn_copy_short: '📋 Copiar',
      mining_paused_title: 'Mineração Pausada (Carteira Desconectada)',
      mining_paused_desc: 'Conecte sua carteira TON pessoal automaticamente via TON Connect para minerar!',
      btn_connect_auto: 'Conectar',
      combined_holding_kicker: 'PROOF-OF-HOLDING (CARTEIRA + APP COMBINADOS)',
      inapp_holding_lbl: '🏦 No App',
      onchain_holding_lbl: '👛 Na Carteira TON',
      live_mining_cart_lbl: 'MINERAÇÃO AO VIVO',
      claim_min_note: 'Resgate a qualquer momento a partir de {min} MAXIMA',
      btn_connect_to_mine: '🔗 Conectar Carteira Pessoal para Minerar',
      btn_claim_ready: '⛏️ Resgatar Mineração (+{amt} MAXIMA)',
      road_1000_title: '🗺️ 1.000 Níveis de Mineração',
      presale_title: '🚀 Pré-venda Oficial MAXIMA',
      missions_tab_title: '📋 Missões e Referências',
      checkin_title: 'Daily Check-In',
      wallet_tab_title: '👛 Carteira e Saque',
      settings_tab_title: '⚙️ Configurações',
      nav_mining: 'Minerar',
      nav_levels: 'MAP',
      nav_presale: 'Pré-venda',
      nav_missions: 'Missões',
      nav_wallet: 'Carteira',
      nav_settings: 'Ajustes',
      copied_toast: '📋 Copiado!',
    },
    ja: {
      btn_copy_short: '📋 コピー',
      mining_paused_title: 'マイニング停止中（ウォレット未接続）',
      mining_paused_desc: 'TON Connectで個人ウォレットを自動接続するとマイニングが開始されます！',
      btn_connect_auto: '接続',
      combined_holding_kicker: 'PROOF-OF-HOLDING（ウォレット＋アプリ合計保有量）',
      inapp_holding_lbl: '🏦 アプリ内保有',
      onchain_holding_lbl: '👛 ウォレット保有',
      live_mining_cart_lbl: 'リアルタイム採掘量',
      claim_min_note: '{min} MAXIMA以上でいつでも受取可能',
      btn_connect_to_mine: '🔗 ウォレットを接続してマイニング開始',
      btn_claim_ready: '⛏️ マイニング報酬を受取る (+{amt} MAXIMA)',
      road_1000_title: '🗺️ 1,000 マイニングレベル',
      presale_title: '🚀 MAXIMA 公式プレセール',
      missions_tab_title: '📋 ミッション＆招待',
      checkin_title: 'Daily Check-In',
      wallet_tab_title: '👛 ウォレット＆出金',
      settings_tab_title: '⚙️ 設定',
      nav_mining: '採掘',
      nav_levels: 'MAP',
      nav_presale: 'セール',
      nav_missions: '任務',
      nav_wallet: '財布',
      nav_settings: '設定',
      copied_toast: '📋 コピーしました！',
    },
  };

  if (!localStorage.getItem('maxima_default_en_v2')) {
    localStorage.setItem('maxima_lang', 'en');
    localStorage.setItem('maxima_default_en_v2', '1');
  }
  let currentLang = localStorage.getItem('maxima_lang') || 'en';
  if (!LANGUAGES.some((l) => l.code === currentLang)) currentLang = 'en';

  function t(key, vars = {}) {
    const dict = I18N[currentLang] || I18N.en;
    let str = dict[key] || I18N.en[key] || key;
    Object.keys(vars).forEach((k) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
    });
    return str;
  }

  // ================= WEB AUDIO SYNTHESIZER ENGINE (SFX + BGM) =================
  const savedAudio = (() => {
    try {
      return JSON.parse(localStorage.getItem('maxima_audio') || '{}');
    } catch (_) {
      return {};
    }
  })();

  const audioCfg = {
    sfx: savedAudio.sfx !== undefined ? Boolean(savedAudio.sfx) : true,
    bgm: savedAudio.bgm !== undefined ? Boolean(savedAudio.bgm) : false,
    haptic: savedAudio.haptic !== undefined ? Boolean(savedAudio.haptic) : true,
    volume: typeof savedAudio.volume === 'number' ? savedAudio.volume : 75,
  };

  function persistAudioCfg() {
    localStorage.setItem('maxima_audio', JSON.stringify(audioCfg));
  }

  let audioCtx = null;
  let bgmNodes = null;

  function ensureAudioCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(freq, durSec, type = 'sine', delaySec = 0, gainMul = 0.18) {
    if (!audioCfg.sfx || audioCfg.volume <= 0) return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const vol = (audioCfg.volume / 100) * gainMul;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durSec + 0.02);
  }

  function sfxClick() {
    playTone(580, 0.06, 'triangle', 0, 0.12);
  }

  function sfxSuccess() {
    playTone(523.25, 0.11, 'triangle', 0, 0.18);
    playTone(659.25, 0.12, 'triangle', 0.08, 0.18);
    playTone(783.99, 0.18, 'sine', 0.16, 0.22);
  }

  function sfxLevelUp() {
    playTone(523.25, 0.12, 'triangle', 0, 0.2);
    playTone(659.25, 0.12, 'triangle', 0.1, 0.2);
    playTone(783.99, 0.12, 'triangle', 0.2, 0.22);
    playTone(1046.5, 0.3, 'sine', 0.3, 0.26);
  }

  function triggerHaptic(kind = 'light') {
    if (!audioCfg.haptic) return;
    try {
      if (tg && tg.HapticFeedback) {
        if (kind === 'success') tg.HapticFeedback.notificationOccurred('success');
        else tg.HapticFeedback.impactOccurred(kind);
      } else if (navigator.vibrate) {
        navigator.vibrate(kind === 'success' ? [20, 30, 20] : 12);
      }
    } catch (_) {}
  }

  function syncBgmState() {
    if (!audioCfg.bgm || audioCfg.volume <= 0) {
      if (bgmNodes) {
        try {
          bgmNodes.osc1.stop();
          bgmNodes.osc2.stop();
          bgmNodes.gain.disconnect();
        } catch (_) {}
        bgmNodes = null;
      }
      return;
    }
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const targetGain = (audioCfg.volume / 100) * 0.045;
    if (bgmNodes) {
      bgmNodes.gain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.1);
      return;
    }
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = 110;
    osc2.type = 'triangle';
    osc2.frequency.value = 164.81;
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    gain.gain.value = targetGain;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc1.start();
    osc2.start();
    bgmNodes = { osc1, osc2, gain };
  }

  // ================= EXACT 1,000-LEVEL ECONOMY (VICTORSCOMPANYBOT FORMULA) =================
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

  function computeLevelFromHolding(combined) {
    const h = Math.max(0, Number(combined || 0));
    let lo = 2;
    let hi = MAX_LEVEL;
    let ans = 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (h >= requiredHolding(mid)) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  const nf = new Intl.NumberFormat('en-US');
  function compactNum(n) {
    if (n >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
    if (n >= 1e4) return `${+(n / 1e3).toFixed(1)}K`;
    return nf.format(Math.round(n * 100) / 100);
  }

  // ================= USER IDENTITY (TELEGRAM MINI APP + PC BROWSER HANDOFF) =================
  function getIdentity() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlSig = urlParams.get('tg_sig') || '';
    const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;
    const startParam =
      (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) ||
      urlParams.get('ref') ||
      '';

    if (tgUser && tgUser.id) {
      const idObj = {
        userId: String(tgUser.id),
        username: tgUser.username || tgUser.first_name || `Miner_${tgUser.id}`,
        firstName: tgUser.first_name || 'Miner',
        refBy: String(startParam).replace(/^ref_/i, ''),
        tgSig: urlSig,
      };
      try {
        localStorage.setItem('maxima_tg_identity', JSON.stringify(idObj));
      } catch (_) {}
      return idObj;
    }

    // Check URL handoff parameters from "Mode Browser PC" button on Telegram Desktop
    const handoffUid = urlParams.get('tg_uid');
    if (handoffUid && /^\d+$/.test(handoffUid.trim())) {
      const idObj = {
        userId: handoffUid.trim(),
        username: urlParams.get('tg_un') || `Miner_${handoffUid.slice(-4)}`,
        firstName: urlParams.get('tg_fn') || 'Miner',
        refBy: String(startParam).replace(/^ref_/i, ''),
        tgSig: urlSig,
      };
      try {
        localStorage.setItem('maxima_tg_identity', JSON.stringify(idObj));
      } catch (_) {}
      return idObj;
    }

    // Check saved Telegram identity in this browser
    try {
      const savedTg = JSON.parse(localStorage.getItem('maxima_tg_identity') || 'null');
      if (savedTg && savedTg.userId) {
        return {
          userId: String(savedTg.userId),
          username: savedTg.username || `Miner_${String(savedTg.userId).slice(-4)}`,
          firstName: savedTg.firstName || 'Miner',
          refBy: String(startParam || savedTg.refBy || '').replace(/^ref_/i, ''),
          tgSig: urlSig || savedTg.tgSig || '',
        };
      }
    } catch (_) {}

    let localId = localStorage.getItem('maxima_user_id');
    if (!localId) {
      localId = '200' + Math.floor(100000 + Math.random() * 900000);
      localStorage.setItem('maxima_user_id', localId);
    }
    return {
      userId: localId,
      username: `Miner_${localId.slice(-4)}`,
      firstName: `Miner #${localId.slice(-4)}`,
      refBy: String(startParam).replace(/^ref_/i, ''),
      tgSig: urlSig,
    };
  }

  const identity = getIdentity();
  const currentTgUser = identity;
  let appState = null;
  let serverClockOffsetMs = 0;
  let tonConnectUI = null;
  let hadLocalTonSession = false;
  let explicitDisconnectInProgress = false;
  let lastLevelsRenderSig = '';
  let lastPresaleRenderSig = '';
  let lastNftRenderSig = '';
  let isOfflineExperimentMode = false;
  let activeTxConfig = null;
  let txPollTimer = null;
  let explorerWorldIdx = 0;
  let activeLevelRange = '1-100';
  let searchLevelQuery = '';

  const MAX_TOTAL_NFT_SUPPLY = 1000;

  const DEFAULT_NFT_ITEMS = [
    {
      id: 'nft_bronze',
      name: 'Bronze Pickaxe Rig NFT',
      tier: 'COMMON',
      icon: '⛏️',
      image: 'nft/common.svg',
      ton: 10,
      chancePct: 50,
      powerBoostPct: 2,
      firstMintMaxima: 0,
      maxSupply: 500,
      theme: 'bronze',
    },
    {
      id: 'nft_silver',
      name: 'Cyber Drill Rig NFT',
      tier: 'RARE',
      icon: '⚙️',
      image: 'nft/rare.svg',
      ton: 10,
      chancePct: 28,
      powerBoostPct: 4,
      firstMintMaxima: 0,
      maxSupply: 280,
      theme: 'silver',
    },
    {
      id: 'nft_gold',
      name: 'Golden Reactor NFT',
      tier: 'EPIC',
      icon: '⚡',
      image: 'nft/epic.svg',
      ton: 10,
      chancePct: 14,
      powerBoostPct: 6,
      firstMintMaxima: 0,
      maxSupply: 140,
      theme: 'gold',
    },
    {
      id: 'nft_diamond',
      name: 'Plasma Core Genesis NFT',
      tier: 'LEGENDARY',
      icon: '💎',
      image: 'nft/legendary.svg',
      ton: 10,
      chancePct: 6,
      powerBoostPct: 8,
      firstMintMaxima: 10000,
      maxSupply: 60,
      theme: 'diamond',
    },
    {
      id: 'nft_mythic',
      name: 'CEO Crown Mythic NFT',
      tier: 'MYTHIC',
      icon: '👑',
      image: 'nft/mythic.svg',
      ton: 10,
      chancePct: 2,
      powerBoostPct: 10,
      firstMintMaxima: 20000,
      maxSupply: 20,
      theme: 'mythic',
    },
  ];

  const $ = (id) => document.getElementById(id);

  let toastTimer = null;
  function showToast(msg) {
    const box = $('toastBox');
    if (!box) return;
    box.textContent = msg;
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('show'), 3200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    triggerHaptic('light');
    sfxClick();
    showToast(t('copied_toast'));
  }

  async function apiPost(path, body = {}) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: identity.userId,
        username: identity.username,
        firstName: identity.firstName,
        refBy: identity.refBy,
        tgSig: identity.tgSig || '',
        ...body,
      }),
    });
    const json = await res.json();
    if (json && json.data && json.data.serverTime) {
      serverClockOffsetMs = json.data.serverTime - Date.now();
    }
    return json;
  }

  function nowServerMs() {
    return Date.now() + serverClockOffsetMs;
  }

  // ================= LANGUAGE POPUP & TRANSLATION SYNC =================
  function renderLanguageSelectors() {
    const modalGrid = $('langModalGrid');
    const select = $('settingsLangSelect');
    const chips = $('settingsLangChips');

    const buttonsHtml = LANGUAGES.map(
      (l) => `
        <button type="button" class="lang-option-btn ${l.code === currentLang ? 'active' : ''}" data-pick-lang="${l.code}">
          <span class="lang-flag">${l.flag}</span>
          <span class="lang-names">
            <span class="lang-native">${l.native}</span>
            <span class="lang-global">${l.global}</span>
          </span>
        </button>
      `
    ).join('');

    if (modalGrid) modalGrid.innerHTML = buttonsHtml;
    if (chips) chips.innerHTML = buttonsHtml;

    if (select) {
      select.innerHTML = LANGUAGES.map(
        (l) => `<option value="${l.code}">${l.flag} ${l.native} (${l.global})</option>`
      ).join('');
      select.value = currentLang;
    }

    document.querySelectorAll('[data-pick-lang]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chosen = btn.getAttribute('data-pick-lang');
        setLanguage(chosen, true);
      });
    });
  }

  function setLanguage(code, closeModal = false) {
    if (!LANGUAGES.some((l) => l.code === code)) return;
    currentLang = code;
    localStorage.setItem('maxima_lang', code);
    localStorage.setItem('maxima_lang_chosen', '1');
    sfxClick();
    triggerHaptic('light');
    if (closeModal && $('langModal')) {
      $('langModal').hidden = true;
    }
    applyTranslations();
    renderLanguageSelectors();
    renderAll();
  }

  function applyTranslations() {
    document.documentElement.lang = currentLang;
    document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';

    const langObj = LANGUAGES.find((l) => l.code === currentLang) || LANGUAGES[0];
    if ($('headerLangCode')) $('headerLangCode').textContent = langObj.code.toUpperCase();
    if ($('settingsLangBadge')) $('settingsLangBadge').textContent = `${langObj.flag} ${langObj.code.toUpperCase()}`;

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });

    if ($('inputSearchLevel')) $('inputSearchLevel').placeholder = t('search_lv_placeholder');
    if ($('inputWithdrawAmount')) $('inputWithdrawAmount').placeholder = t('wd_placeholder');
  }

  // Open Language Modal on First Launch!
  if (!localStorage.getItem('maxima_lang_chosen')) {
    if ($('langModal')) $('langModal').hidden = false;
  }

  if ($('btnOpenLangModal')) {
    $('btnOpenLangModal').addEventListener('click', () => {
      sfxClick();
      $('langModal').hidden = false;
    });
  }
  if ($('btnReopenLangPopup')) {
    $('btnReopenLangPopup').addEventListener('click', () => {
      sfxClick();
      $('langModal').hidden = false;
    });
  }
  if ($('settingsLangSelect')) {
    $('settingsLangSelect').addEventListener('change', (e) => setLanguage(e.target.value, false));
  }

  // ================= 10-WORLD EXPLORER & 1,000 LEVELS RENDERER =================
  function renderWorldExplorer() {
    const tier = WORLD_TIERS[explorerWorldIdx] || WORLD_TIERS[0];
    const lvStart = explorerWorldIdx * 100 + 1;
    const lvEnd = explorerWorldIdx * 100 + 100;

    const card = $('worldExplorerCard');
    if (card) {
      card.className = `world-explorer-card world-theme-${tier.rank}`;
    }

    const tabsWrap = $('worldRankTabs');
    if (tabsWrap) {
      if (!tabsWrap.children.length) {
        tabsWrap.innerHTML = WORLD_TIERS.map(
          (w, idx) => `
            <button type="button" class="w-tab-btn ${idx === explorerWorldIdx ? 'active' : ''}" data-world-idx="${idx}">
              <span>${w.icon}</span>
              <span>${w.rank}. ${w.name}</span>
            </button>
          `
        ).join('');
        tabsWrap.querySelectorAll('[data-world-idx]').forEach((btn) => {
          btn.addEventListener('click', () => {
            explorerWorldIdx = Number(btn.getAttribute('data-world-idx'));
            activeLevelRange = `${explorerWorldIdx * 100 + 1}-${explorerWorldIdx * 100 + 100}`;
            syncRangeChipsUI();
            sfxClick();
            renderWorldExplorer();
            render1000LevelsList();
          });
        });
      } else {
        tabsWrap.querySelectorAll('[data-world-idx]').forEach((btn) => {
          const idx = Number(btn.getAttribute('data-world-idx'));
          btn.classList.toggle('active', idx === explorerWorldIdx);
        });
      }
    }

    if ($('weRankTitle')) $('weRankTitle').textContent = `RANK ${tier.rank}`;
    if ($('weLevelRange')) $('weLevelRange').textContent = `Levels ${nf.format(lvStart)} – ${nf.format(lvEnd)}`;
    if ($('weIcon')) $('weIcon').textContent = tier.icon;
    if ($('weRankName')) $('weRankName').textContent = tier.name;
    if ($('weZoneName')) $('weZoneName').textContent = `MAXIMA Rank ${tier.rank} (Lv ${nf.format(lvStart)}–${nf.format(lvEnd)})`;
    if ($('weHoldRange')) {
      $('weHoldRange').textContent = `${compactNum(requiredHolding(lvStart))} – ${compactNum(requiredHolding(lvEnd))} MAXIMA`;
    }
    if ($('weSpeedRange')) {
      $('weSpeedRange').textContent = `${miningSpeed(lvStart).toFixed(2)} – ${nf.format(miningSpeed(lvEnd))} TH/s`;
    }
    if ($('weDailyRange')) {
      $('weDailyRange').textContent = `${compactNum(dailyOutput(lvStart))} – ${compactNum(dailyOutput(lvEnd))} MAXIMA`;
    }
    if ($('weToolCrew')) $('weToolCrew').textContent = `${tier.tool} · Crew ${tier.crew}`;
    if ($('weProgressBar')) $('weProgressBar').style.width = `${tier.rank * 10}%`;
    if ($('weStepCounter')) $('weStepCounter').textContent = `${tier.rank} / ${WORLD_TIERS.length}`;
  }

  function syncRangeChipsUI() {
    document.querySelectorAll('#levelRangeChips .r-chip').forEach((c) => {
      c.classList.toggle('active', c.getAttribute('data-range') === activeLevelRange && !searchLevelQuery);
    });
  }

  function render1000LevelsList() {
    const container = $('levelsListContainer');
    if (!container) return;

    const userLevel = appState && appState.user ? appState.user.level : 1;
    const isConnected = appState && appState.user ? appState.user.walletConnected : false;
    const renderSig = `${userLevel}_${isConnected}_${activeLevelRange}_${searchLevelQuery}_${currentLang}`;
    if (lastLevelsRenderSig === renderSig && container.children.length > 0) {
      return;
    }
    lastLevelsRenderSig = renderSig;

    let levelsToRender = [];
    if (searchLevelQuery) {
      const q = searchLevelQuery.trim();
      for (let i = 1; i <= MAX_LEVEL; i++) {
        if (String(i) === q || String(i).includes(q)) levelsToRender.push(i);
      }
      if ($('levelsListHeading')) {
        $('levelsListHeading').textContent = t('levels_heading_search', {
          q,
          count: levelsToRender.length,
        });
      }
    } else if (activeLevelRange === 'all') {
      for (let i = 1; i <= MAX_LEVEL; i++) levelsToRender.push(i);
      if ($('levelsListHeading')) {
        $('levelsListHeading').textContent = t('levels_heading_range', {
          a: 1,
          b: '1,000',
          count: '1,000',
        });
      }
    } else {
      const [a, b] = activeLevelRange.split('-').map(Number);
      for (let i = a; i <= b; i++) levelsToRender.push(i);
      if ($('levelsListHeading')) {
        $('levelsListHeading').textContent = t('levels_heading_range', {
          a: nf.format(a),
          b: nf.format(b),
          count: levelsToRender.length,
        });
      }
    }

    container.innerHTML = levelsToRender
      .map((lvl) => {
        const tier = WORLD_TIERS[Math.min(9, Math.floor((lvl - 1) / 100))];
        const holdReq = requiredHolding(lvl);
        const speed = miningSpeed(lvl);
        const daily = dailyOutput(lvl);
        const isCurrent = isConnected && lvl === userLevel;
        const isUnlocked = isConnected && lvl <= userLevel;

        let badgeHtml = '';
        if (isCurrent) {
          badgeHtml = `<span style="color:#f5c451;font-weight:900;font-size:11px;">${t('status_current')}</span>`;
        } else if (isUnlocked) {
          badgeHtml = `<span style="color:#10e899;font-weight:800;font-size:11px;">${t('status_unlocked')}</span>`;
        } else if (lvl === 1) {
          badgeHtml = `<span style="color:#38bdf8;font-weight:800;font-size:10px;">${t('status_free_lv1')}</span>`;
        } else {
          badgeHtml = `<span style="color:#94a3b8;font-weight:800;font-size:11px;">${compactNum(holdReq)} MAXIMA</span>`;
        }

        return `
          <div class="lv-row ${isCurrent ? 'is-current' : isUnlocked ? 'is-unlocked' : ''}" id="level-row-${lvl}">
            <div class="lv-left">
              <div class="lv-ico">${tier.icon}</div>
              <div>
                <div class="lv-title">Level ${nf.format(lvl)} · ${tier.name}</div>
                <div class="lv-meta">Rank ${tier.rank} · Hold: <b>${nf.format(holdReq)} MAXIMA</b></div>
                <div class="lv-speed">⚡ ${nf.format(speed)} TH/s · +${nf.format(daily)} MAXIMA/24h</div>
              </div>
            </div>
            <div class="lv-right">${badgeHtml}</div>
          </div>
        `;
      })
      .join('');
  }

  // ================= LIVE MINING COMPUTATION =================
  function computeLivePendingCoins() {
    if (!appState || !appState.user) return 0;
    const u = appState.user;
    if (!u.walletConnected || !u.isMiningActive) return Number(u.accruedMined || 0);
    const now = nowServerMs();
    const effectiveNow = Math.min(now, u.shiftEndsAt || now);
    const dtSec = Math.max(0, (effectiveNow - (u.lastAccruedAt || now)) / 1000);
    return Number(u.accruedMined || 0) + dtSec * Number(u.activeCoinsPerSec || 0);
  }

  function formatHms(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function openExternalUrlSafe(url) {
    if (!url) return;
    try {
      if (url.startsWith('https://t.me/') && tg && typeof tg.openTelegramLink === 'function') {
        tg.openTelegramLink(url);
        return;
      }
      if (url.startsWith('ton://')) {
        const a = document.createElement('a');
        a.href = url;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 500);
        return;
      }
      if (tg && typeof tg.openLink === 'function' && /^https?:\/\//i.test(url)) {
        tg.openLink(url, { try_instant_view: false });
        return;
      }
    } catch (_) {}
    window.open(url, '_blank', 'noopener');
  }

  const TON_SESSION_UID_KEY = 'maxima_ton_session_uid';

  async function syncLocalTonWalletToServer(walletObj) {
    const w = walletObj || (tonConnectUI && tonConnectUI.wallet);
    if (!w || !w.account || !w.account.address) return false;
    const res = await apiPost('/api/wallet/connect', {
      walletAddress: w.account.address,
      walletAppName: (w.device && w.device.appName) || 'TON Connect',
    });
    if (res && res.ok) {
      try {
        localStorage.setItem(TON_SESSION_UID_KEY, String(currentTgUser.userId || ''));
      } catch (_) {}
      appState = res.data;
      sfxSuccess();
      renderAll();
      showToast(res.message);
      return true;
    }
    if (res && res.error) {
      pendingTxAfterConnect = null;
      if (tonConnectUI) {
        explicitDisconnectInProgress = true;
        await tonConnectUI.disconnect().catch(() => {});
        explicitDisconnectInProgress = false;
      }
      hadLocalTonSession = false;
      try {
        localStorage.removeItem(TON_SESSION_UID_KEY);
      } catch (_) {}
      triggerHaptic('error');
      showToast(res.error);
      if (res.data) {
        appState = res.data;
        renderAll();
      }
    }
    return false;
  }

  async function openTonConnect(forceReset = false) {
    const shouldForceReset = forceReset === true;
    sfxClick();
    if (!tonConnectUI) {
      initTonConnect();
    }
    if (!tonConnectUI) {
      showToast('⏳ Loading TON Connect module... Please tap again.');
      setTimeout(() => {
        initTonConnect();
        if (tonConnectUI) openTonConnect(shouldForceReset);
      }, 450);
      return;
    }

    try {
      // If TON Connect already has an active local session in this browser/WebView
      if (tonConnectUI.connected && tonConnectUI.wallet && tonConnectUI.wallet.account) {
        if (!shouldForceReset && (!appState || !appState.user || !appState.user.walletConnected)) {
          const synced = await syncLocalTonWalletToServer(tonConnectUI.wallet);
          if (synced) return;
        }
        // Clear stale local session so openModal() never throws WalletAlreadyConnectedError!
        explicitDisconnectInProgress = true;
        await tonConnectUI.disconnect().catch(() => {});
        explicitDisconnectInProgress = false;
      }

      if (typeof tonConnectUI.closeModal === 'function') {
        try {
          tonConnectUI.closeModal();
        } catch (_) {}
      }
      await tonConnectUI.openModal();
    } catch (err) {
      console.warn('openTonConnect recovery:', err);
      try {
        explicitDisconnectInProgress = true;
        await tonConnectUI.disconnect().catch(() => {});
        explicitDisconnectInProgress = false;
        await tonConnectUI.openModal();
      } catch (_) {
        showToast('⚠️ Failed to open TON Connect popup. Please try again.');
      }
    }
  }

  // ================= MAIN UI RENDERER =================
  function renderAll() {
    if (!appState) return;
    const { user, config, presaleState, leaderboard } = appState;
    const localTier = WORLD_TIERS[Math.min(9, Math.floor(((user.level || 1) - 1) / 100))] || WORLD_TIERS[0];
    const spec = {
      ...(user.currentLevelSpec || {
        level: 1,
        powerThs: 0.2,
        dailyCoins: 5,
      }),
      rank: localTier.rank,
      rankName: localTier.name,
      zone: localTier.zone,
      tool: localTier.tool,
      crew: localTier.crew,
      icon: localTier.icon,
    };

    const contractAddr = config.token.contractAddress;
    const shortContract = `${contractAddr.slice(0, 8)}...${contractAddr.slice(-4)}`;
    if ($('stripContractShort')) $('stripContractShort').textContent = shortContract;
    if ($('fullContractAddr')) $('fullContractAddr').textContent = contractAddr;

    // Sync App & Token Logo across all UI slots and Favicon
    if (config.token && config.token.image) {
      document.querySelectorAll('.app-logo-img').forEach((img) => {
        if (img.getAttribute('data-logo-src') !== config.token.image) {
          img.setAttribute('data-logo-src', config.token.image);
          img.src = config.token.image;
        }
      });
      if ($('appFavicon') && $('appFavicon').getAttribute('href') !== config.token.image) {
        $('appFavicon').setAttribute('href', config.token.image);
      }
    }

    // Header sub
    if ($('headerRankSub')) {
      $('headerRankSub').textContent = user.walletConnected
        ? `${spec.icon} Lv ${nf.format(user.level)} / 1,000 · ${spec.rankName} · ${user.activePowerThs} TH/s`
        : `🔒 Mining Paused · Connect Wallet`;
    }

    // Tab 1: Mining Stage & Combined Holding
    if ($('miningWalletGate')) {
      $('miningWalletGate').style.display = user.walletConnected ? 'none' : 'flex';
    }
    const stageCard = $('mineStageCard');
    if (stageCard) {
      stageCard.className = `mine-stage world-theme-${spec.rank} ${user.walletConnected ? '' : 'paused'}`;
    }
    if ($('stageRankName')) $('stageRankName').textContent = spec.rankName;
    if ($('stageLevelNum')) $('stageLevelNum').textContent = `${nf.format(user.level)} / 1,000`;
    if ($('stageMinerIcon')) $('stageMinerIcon').textContent = user.walletConnected ? spec.icon : '🔒';
    if ($('stageToolCrew')) $('stageToolCrew').textContent = `${spec.tool} · Crew ${spec.crew}`;
    if ($('stageZoneName')) {
      const nftBoostSuffix = Number(user.nftBoostPct || 0) > 0 ? ` · 💎 +${user.nftBoostPct}% NFT` : '';
      $('stageZoneName').textContent = `RANK ${spec.rank} · ${spec.rankName}${nftBoostSuffix}`;
    }
    if ($('stagePowerVal')) $('stagePowerVal').textContent = `${nf.format(user.activePowerThs)} TH/s`;
    if ($('stageDailyVal')) $('stageDailyVal').textContent = `${nf.format(user.activeDailyCoins)} MAXIMA`;

    if ($('combinedHoldingVal')) $('combinedHoldingVal').textContent = nf.format(+user.combinedHolding.toFixed(2));
    if ($('inAppHoldingVal')) $('inAppHoldingVal').textContent = nf.format(+user.inAppHolding.toFixed(2));
    if ($('onChainHoldingVal')) $('onChainHoldingVal').textContent = nf.format(+user.onChainHolding.toFixed(2));

    // Next level bar
    const nextSpec = user.nextLevelSpec;
    if (nextSpec) {
      const prevMin = user.level === 1 ? 0 : spec.minHoldingCoins;
      const span = Math.max(1, nextSpec.minHoldingCoins - prevMin);
      const done = Math.max(0, user.combinedHolding - prevMin);
      const pct = Math.min(100, Math.floor((done / span) * 100));
      const rem = Math.max(0, +(nextSpec.minHoldingCoins - user.combinedHolding).toFixed(2));
      if ($('nextLevelTitle')) {
        $('nextLevelTitle').textContent = t('next_lv_title', {
          lvl: nf.format(nextSpec.level),
          ths: nf.format(nextSpec.powerThs),
        });
      }
      if ($('nextLevelPct')) $('nextLevelPct').textContent = `${pct}%`;
      if ($('nextLevelBar')) $('nextLevelBar').style.width = `${pct}%`;
      if ($('nextLevelHint')) {
        $('nextLevelHint').textContent = t('next_lv_hint', {
          req: nf.format(nextSpec.minHoldingCoins),
          rem: nf.format(rem),
        });
      }
    } else {
      if ($('nextLevelTitle')) $('nextLevelTitle').textContent = t('max_lv_title');
      if ($('nextLevelPct')) $('nextLevelPct').textContent = '100%';
      if ($('nextLevelBar')) $('nextLevelBar').style.width = '100%';
      if ($('nextLevelHint')) $('nextLevelHint').textContent = t('max_lv_hint');
    }

    if ($('claimMinHint')) {
      $('claimMinHint').textContent = t('claim_min_note', { min: config.mining.minClaimCoins });
    }

    // Tab 2: 1,000 Levels
    renderWorldExplorer();
    render1000LevelsList();

    // Tab 3: Presale
    if (presaleState) {
      if ($('presaleSoldVal')) $('presaleSoldVal').textContent = nf.format(presaleState.totalCoinsSold);
      if ($('presaleRemVal')) $('presaleRemVal').textContent = nf.format(presaleState.totalCoinsRemaining);
      if ($('presaleGlobalBar')) $('presaleGlobalBar').style.width = `${Math.max(1, presaleState.progressPct)}%`;
    }
    const maxTonW = config.presale.maxTonPerWallet || 100;
    const spentTon = user.walletPresaleTonSpent || 0;
    const remTon = Math.max(0, +(maxTonW - spentTon).toFixed(2));
    if ($('walletPresaleQuotaText')) {
      $('walletPresaleQuotaText').textContent = `${spentTon} / ${maxTonW} GRAM (${remTon} GRAM left)`;
    }

    const presaleEndsAtMs =
      (presaleState && presaleState.endsAtMs) ||
      Date.parse((config.presale && config.presale.endsAt) || '2026-11-10T23:59:59Z');
    const isPresaleEnded = Number.isFinite(presaleEndsAtMs) && nowServerMs() >= presaleEndsAtMs;
    syncPresaleTabVisibility(isPresaleEnded);

    const pkgWrap = $('presalePackagesContainer');
    if (pkgWrap && Array.isArray(config.presale.packages)) {
      const presaleSig = `${Math.round(user.combinedHolding)}_${user.walletConnected}_${remTon}_${presaleState ? presaleState.totalCoinsRemaining : 0}_${isPresaleEnded}_${currentLang}`;
      if (lastPresaleRenderSig !== presaleSig || !pkgWrap.children.length) {
        lastPresaleRenderSig = presaleSig;
        pkgWrap.innerHTML = config.presale.packages
          .map((pkg) => {
            const futureHolding = user.combinedHolding + pkg.coins;
            const futureLvl = computeLevelFromHolding(futureHolding);
            const futureSpeed = miningSpeed(futureLvl);
            const exceedsWallet = user.walletConnected && pkg.ton > remTon + 1e-9;
            const exceedsPool = presaleState && pkg.coins > presaleState.totalCoinsRemaining;
            const disabled = isPresaleEnded || exceedsWallet || exceedsPool;

            return `
              <div class="presale-pkg-card ${pkg.ton === 100 ? 'popular' : ''}">
                <div>
                  <div class="pkg-coins">+${nf.format(pkg.coins)} MAXIMA</div>
                  <div class="pkg-ton-sub">💎 ${pkg.ton} GRAM</div>
                  <div class="pkg-boost-hint">⚡ ${t('pkg_reach_level', { lvl: nf.format(futureLvl), ths: nf.format(futureSpeed) })}</div>
                </div>
                <div>
                  <button
                    type="button"
                    class="btn-gold btn-sm"
                    data-buy-pkg="${pkg.id}"
                    data-pkg-ton="${pkg.ton}"
                    ${disabled ? 'disabled' : ''}
                  >
                    ${
                      isPresaleEnded
                        ? t('presale_ended_btn')
                        : exceedsWallet
                        ? t('pkg_quota_exceeded', { rem: remTon })
                        : t('btn_buy_presale', { ton: pkg.ton })
                    }
                  </button>
                </div>
              </div>
            `;
          })
          .join('');

        pkgWrap.querySelectorAll('[data-buy-pkg]').forEach((btn) => {
          btn.addEventListener('click', () => handleBuyPresale(btn.getAttribute('data-buy-pkg')));
        });
      }
    }

    const psHist = $('presaleHistoryContainer');
    if (psHist) {
      const list = user.presalePurchases || [];
      if (!list.length) {
        psHist.innerHTML = `<div class="empty-box">${t('no_presale_yet')}</div>`;
      } else {
        psHist.innerHTML = list
          .slice()
          .reverse()
          .map(
            (p) => `
              <div class="lv-row is-unlocked">
                <div class="lv-left">
                  <div class="lv-ico">🚀</div>
                  <div>
                    <div class="lv-title">+${nf.format(p.coinsReceived)} MAXIMA</div>
                    <div class="lv-meta">${p.tonPaid} GRAM · ${new Date(p.createdAt).toLocaleString()}</div>
                  </div>
                </div>
                <div class="lv-right"><span class="pill-mint">PAID ✓</span></div>
              </div>
            `
          )
          .join('');
      }
    }

    // Tab 4: Missions (7-Day Repeating Check-In + Daily 00:00 UTC Channels + Active Referrals)
    const ci = user.checkIn;
    if (ci) {
      if ($('checkInStreakBadge')) $('checkInStreakBadge').textContent = `🔥 ${ci.consecutiveDays}d`;
      if ($('checkInDaysGrid')) {
        $('checkInDaysGrid').innerHTML = ci.days
          .map(
            (d) => `
              <div class="ci-day ${d.status}">
                <span class="ci-d-num">${t('day_short', { d: d.day })}</span>
                <span class="ci-d-val">+${d.rewardCoins}</span>
                <span class="ci-d-ico">${d.status === 'claimed' ? '✅' : d.status === 'today' ? '🎁' : '🪙'}</span>
              </div>
            `
          )
          .join('');
      }
      const btnCi = $('btnDailyCheckIn');
      if (btnCi) {
        btnCi.disabled = ci.checkedInToday;
        btnCi.textContent = ci.checkedInToday
          ? t('btn_checkin_done')
          : t('btn_checkin_now', { d: ci.activeCycleDay, amt: ci.todayRewardCoins });
      }
    }

    const chWrap = $('dailyChannelsContainer');
    if (chWrap && Array.isArray(user.dailyChannels)) {
      chWrap.innerHTML = user.dailyChannels
        .map((m) => {
          return `
            <div class="mission-card">
              <div class="lv-left">
                <div class="lv-ico">${m.icon || '📢'}</div>
                <div>
                  <div class="lv-title">${m.title}</div>
                  <div class="lv-speed">+${m.rewardCoins} MAXIMA</div>
                </div>
              </div>
              <div class="mission-actions">
                ${
                  m.claimedToday
                    ? `<span class="pill-mint">${t('mission_done_today')}</span>`
                    : `
                      <button type="button" class="btn-ghost btn-sm" data-visit-mission="${m.id}" data-mission-url="${m.url}">
                        ${t('btn_open_channel')}
                      </button>
                      <button type="button" class="btn-gold btn-sm" data-claim-mission="${m.id}" ${m.visitedToday ? '' : 'disabled'}>
                        ${t('btn_claim_mission')}
                      </button>
                    `
                }
              </div>
            </div>
          `;
        })
        .join('');

      chWrap.querySelectorAll('[data-visit-mission]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const missionId = btn.getAttribute('data-visit-mission');
          const url = btn.getAttribute('data-mission-url');
          sfxClick();
          if (tg && tg.openTelegramLink && url.startsWith('https://t.me/')) {
            tg.openTelegramLink(url);
          } else {
            window.open(url, '_blank', 'noopener');
          }
          const res = await apiPost('/api/missions/visit', { missionId });
          if (res && res.ok) {
            appState = res.data;
            renderAll();
          }
        });
      });

      chWrap.querySelectorAll('[data-claim-mission]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const missionId = btn.getAttribute('data-claim-mission');
          const res = await apiPost('/api/missions/claim-daily', { missionId });
          if (res && res.ok) {
            appState = res.data;
            res.leveledUp ? sfxLevelUp() : sfxSuccess();
            triggerHaptic('success');
            renderAll();
            showToast(res.message);
          } else {
            showToast((res && res.error) || 'Failed');
          }
        });
      });
    }

    // Referrals
    const rs = user.referralStats;
    if ($('refLinkDisplay')) $('refLinkDisplay').textContent = user.referralLink;
    if (rs) {
      if ($('refActiveCountVal')) $('refActiveCountVal').textContent = rs.activeCount;
      if ($('refPendingCountVal')) $('refPendingCountVal').textContent = rs.pendingCount;
      if ($('refEarnedCoinsVal')) $('refEarnedCoinsVal').textContent = `+${nf.format(rs.bonusCoinsEarned)}`;

      const fWrap = $('friendsListContainer');
      if (fWrap) {
        if (!rs.friends.length) {
          fWrap.innerHTML = `<div class="empty-box">${t('no_referrals_yet')}</div>`;
        } else {
          fWrap.innerHTML = rs.friends
            .map(
              (f) => `
                <div class="lv-row ${f.isActive ? 'is-unlocked' : ''}">
                  <div class="lv-left">
                    <div class="lv-ico">${f.isActive ? '✅' : '⏳'}</div>
                    <div>
                      <div class="lv-title">${f.name}</div>
                      <div class="lv-meta">
                        Check-In 3d: <b>${f.has3DayStreak ? '✓ (3/3)' : `${Math.min(3, f.streakDays)}/3`}</b> ·
                        Wallet Verify: <b>${f.walletVerified ? '✓' : '✗'}</b>
                      </div>
                    </div>
                  </div>
                  <div class="lv-right">
                    <span class="status-tag ${f.isActive ? 'ok' : ''}">
                      ${f.isActive ? t('ref_tag_active') : t('ref_tag_pending')}
                    </span>
                  </div>
                </div>
              `
            )
            .join('');
        }
      }
    }

    // Tab 5: Wallet, 0.1 TON Verification & Withdraw (Min 2,000, Fee 100)
    const isAdminUser = Boolean(appState.isAdmin || String(identity.userId) === '8464908276');
    if ($('adminQuickEntryCard')) {
      $('adminQuickEntryCard').style.display = isAdminUser ? 'block' : 'none';
    }
    if ($('adminPendingBadge')) {
      $('adminPendingBadge').textContent = `${nf.format(appState.pendingWithdrawCount || 0)} Queued`;
    }

    const connTag = $('walletConnTag');
    if (connTag) {
      connTag.textContent = user.walletConnected ? 'Connected ✓' : 'Disconnected';
      connTag.classList.toggle('ok', user.walletConnected);
    }
    if ($('walletConnectedInfo')) {
      $('walletConnectedInfo').textContent = user.walletConnected
        ? t('wallet_connected_box', { app: user.walletAppName || 'TON Wallet', addr: user.walletAddress })
        : t('wallet_disconnected_box');
    }
    if ($('btnConnectOrDisconnect')) {
      $('btnConnectOrDisconnect').textContent = user.walletConnected
        ? t('btn_disconnect_wallet')
        : t('btn_connect_wallet');
    }

    const verTag = $('walletVerifyTag');
    if (verTag) {
      verTag.textContent = user.walletVerified ? 'Verified ✓' : 'Unverified';
      verTag.classList.toggle('ok', user.walletVerified);
    }
    const btnVer = $('btnVerifyWalletTon');
    if (btnVer) {
      btnVer.disabled = user.walletVerified;
      btnVer.textContent = user.walletVerified ? t('btn_verified_ok') : t('btn_verify_ton');
    }

    const minWd = config.wallet.minWithdrawCoins || 2000;
    const hasBal = user.inAppHolding >= minWd;
    if ($('wdChk1')) {
      $('wdChk1').textContent = `${user.walletConnected ? '✅' : '❌'} ${t('wd_chk1_txt')}`;
      $('wdChk1').classList.toggle('ok', user.walletConnected);
    }
    if ($('wdChk2')) {
      $('wdChk2').textContent = `${user.walletVerified ? '✅' : '❌'} ${t('wd_chk2_txt')}`;
      $('wdChk2').classList.toggle('ok', user.walletVerified);
    }
    if ($('wdChk3')) {
      $('wdChk3').textContent = `${hasBal ? '✅' : '❌'} ${t('wd_chk3_txt', { bal: nf.format(+user.inAppHolding.toFixed(2)) })}`;
      $('wdChk3').classList.toggle('ok', hasBal);
    }
    if ($('btnSubmitWithdraw')) {
      $('btnSubmitWithdraw').disabled = !(user.walletConnected && user.walletVerified && hasBal);
    }
    updateWithdrawPreview();

    const wdHist = $('withdrawHistoryContainer');
    if (wdHist) {
      const wds = user.withdrawals || [];
      if (!wds.length) {
        wdHist.innerHTML = `<div class="empty-box">${t('no_wd_yet')}</div>`;
      } else {
        wdHist.innerHTML = wds
          .slice()
          .reverse()
          .map(
            (w) => `
              <div class="lv-row is-unlocked">
                <div class="lv-left">
                  <div class="lv-ico">💸</div>
                  <div>
                    <div class="lv-title">-${nf.format(w.requestedAmount)} MAXIMA (Net: ${nf.format(w.netAmount)})</div>
                    <div class="lv-meta">Fee: ${w.feeCoins} · ${w.walletAddress.slice(0, 8)}...${w.walletAddress.slice(-6)}</div>
                  </div>
                </div>
                <div class="lv-right"><span class="pill-mint">${w.status}</span></div>
              </div>
            `
          )
          .join('');
      }
    }

    // Leaderboard
    const lbWrap = $('leaderboardContainer');
    if (lbWrap && Array.isArray(leaderboard)) {
      lbWrap.innerHTML = leaderboard
        .map((m, idx) => {
          const mTier = WORLD_TIERS[Math.min(9, Math.floor(((m.level || 1) - 1) / 100))] || WORLD_TIERS[0];
          return `
            <div class="lv-row ${m.userId === user.userId ? 'is-current' : ''}">
              <div class="lv-left">
                <div class="lv-ico">${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}</div>
                <div>
                  <div class="lv-title">${m.name}</div>
                  <div class="lv-meta">${mTier.icon} Lv ${nf.format(m.level)} · ${mTier.name} · ${nf.format(m.powerThs)} TH/s</div>
                </div>
              </div>
              <div class="lv-right">
                <strong style="color:#f5c451;font-size:12px;">${compactNum(m.combinedHolding)} MAXIMA</strong>
              </div>
            </div>
          `;
        })
        .join('');
    }

    // Tab 6: Settings Account Meta
    if ($('metaMinerId')) $('metaMinerId').textContent = user.userId;
    if ($('metaLevelPower')) {
      const nftBoostTxt = Number(user.nftBoostPct || 0) > 0 ? ` (+${user.nftBoostPct}% NFT Boost)` : '';
      $('metaLevelPower').textContent = `Level ${nf.format(user.level)} / 1,000 · ${user.activePowerThs} TH/s${nftBoostTxt}`;
    }
    if ($('metaWalletAddr')) $('metaWalletAddr').textContent = user.walletConnected ? user.walletAddress : 'Disconnected';

    // Floating NFT Mint, Inventory & P2P Market Window
    renderNftFloatingWindow();
  }

  let gachaSpinInProgress = false;

  function resolveNftImageSrc(itemOrReceipt) {
    if (itemOrReceipt && itemOrReceipt.image) return itemOrReceipt.image;
    const t = String((itemOrReceipt && itemOrReceipt.tier) || 'COMMON').toUpperCase();
    if (t === 'MYTHIC') return 'nft/mythic.svg';
    if (t === 'LEGENDARY') return 'nft/legendary.svg';
    if (t === 'EPIC') return 'nft/epic.svg';
    if (t === 'RARE') return 'nft/rare.svg';
    return 'nft/common.svg';
  }

  function downloadUniqueNftCardPng(nft) {
    if (!nft) return;
    sfxClick();
    triggerHaptic('light');
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    const tier = String(nft.tier || 'COMMON').toUpperCase();
    const palette =
      tier === 'MYTHIC'
        ? { c1: '#881337', c2: '#090207', border: '#f43f5e', accent: '#fde047' }
        : tier === 'LEGENDARY'
        ? { c1: '#065f73', c2: '#050511', border: '#67e8f9', accent: '#c084fc' }
        : tier === 'EPIC'
        ? { c1: '#6b4408', c2: '#0a0602', border: '#f5c451', accent: '#fde047' }
        : tier === 'RARE'
        ? { c1: '#0f3f5c', c2: '#05080f', border: '#38bdf8', accent: '#7dd3fc' }
        : { c1: '#5c2d16', c2: '#090604', border: '#f59e0b', accent: '#fbbf24' };

    const bgGrad = ctx.createRadialGradient(512, 440, 40, 512, 512, 720);
    bgGrad.addColorStop(0, palette.c1);
    bgGrad.addColorStop(1, palette.c2);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1024, 1024);

    ctx.strokeStyle = palette.border;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(512, 460, 360, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(512, 460, 310, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 12;
    ctx.strokeRect(28, 28, 968, 968);

    const boostPct =
      nft.powerBoostPct ||
      (tier === 'MYTHIC' ? 10 : tier === 'LEGENDARY' ? 8 : tier === 'EPIC' ? 6 : tier === 'RARE' ? 4 : 2);
    const firstMintBonus =
      nft.firstMintMaxima !== undefined
        ? nft.firstMintMaxima
        : tier === 'MYTHIC'
        ? 20000
        : tier === 'LEGENDARY'
        ? 10000
        : 0;

    ctx.fillStyle = 'rgba(8, 10, 18, 0.88)';
    ctx.fillRect(142, 62, 740, 66);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 4;
    ctx.strokeRect(142, 62, 740, 66);
    ctx.fillStyle = palette.accent;
    ctx.font = '900 22px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `${tier}  |  EDITION ${nft.serialCode || '#0001'} / 1000  |  +${boostPct}% MINING POWER`,
      512,
      104
    );

    ctx.fillStyle = 'rgba(7, 9, 16, 0.9)';
    ctx.beginPath();
    ctx.arc(512, 460, 265, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 9;
    ctx.stroke();

    ctx.save();
    ctx.translate(512, 460);
    ctx.scale(1.42, 1.42);
    ctx.translate(-256, -248);
    const logoGrad = ctx.createLinearGradient(145, 130, 367, 360);
    logoGrad.addColorStop(0, '#ffffff');
    logoGrad.addColorStop(0.55, palette.accent);
    logoGrad.addColorStop(1, palette.border);
    ctx.fillStyle = logoGrad;
    ctx.shadowColor = palette.border;
    ctx.shadowBlur = 24;

    const polys = [
      [[155, 140], [248, 220], [248, 274], [155, 194]],
      [[357, 140], [264, 220], [264, 274], [357, 194]],
      [[155, 210], [184, 235], [184, 356], [155, 331]],
      [[357, 210], [328, 235], [328, 356], [357, 331]],
      [[196, 245], [248, 290], [248, 335], [196, 290]],
      [[316, 245], [264, 290], [264, 335], [316, 290]],
    ];
    polys.forEach((pts) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();

    ctx.fillStyle = 'rgba(7, 9, 16, 0.92)';
    ctx.fillRect(72, 776, 880, 172);
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 5;
    ctx.strokeRect(72, 776, 880, 172);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 32px Arial, sans-serif';
    ctx.fillText(
      `${String(nft.name || 'MAXIMA NFT').toUpperCase()} ${nft.serialCode || '#0001'}`,
      512,
      824
    );

    ctx.fillStyle = palette.accent;
    ctx.font = '800 19px Arial, sans-serif';
    ctx.fillText(
      `AURA: ${nft.bgAura || 'Genesis Core'}  ·  DNA: ${nft.dnaHash || '0xMAXIMA'}  ·  OVERCLOCK: ${nft.overclockPct || '99.1%'}`,
      512,
      866
    );

    ctx.fillStyle = '#10e899';
    ctx.font = '800 18px Arial, sans-serif';
    ctx.fillText(
      firstMintBonus > 0
        ? `MINING POWER: +${boostPct}%  |  1ST MINT BONUS: +${nf.format(firstMintBonus)} MAXIMA`
        : `MINING POWER BOOST: +${boostPct}%  |  EMBLEM: ${nft.emblemFinish || 'MAXIMA M'}`,
      512,
      904
    );

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 15px Arial, sans-serif';
    ctx.fillText('OFFICIAL MAXIMA GENESIS NFT COLLECTION (LIMITED 1,000 SUPPLY) · TON', 512, 934);

    const a = document.createElement('a');
    const cleanSerial = String(nft.serialCode || '0001').replace('#', '');
    a.download = `MAXIMA-NFT-${cleanSerial}-${tier}.png`;
    a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast(`🖼️ Downloaded Unique NFT Card (${a.download})!`);
  }

  function downloadUniqueNftMetadataJson(nft) {
    if (!nft) return;
    sfxClick();
    triggerHaptic('light');
    const tier = String(nft.tier || 'COMMON').toUpperCase();
    const serial = nft.serialCode || '#0001';
    const cleanSerial = String(serial).replace('#', '');
    const serialIdx = Math.max(0, (Number(nft.serialNum || cleanSerial) || 1) - 1);
    const boostPct =
      nft.powerBoostPct ||
      (tier === 'MYTHIC' ? 10 : tier === 'LEGENDARY' ? 8 : tier === 'EPIC' ? 6 : tier === 'RARE' ? 4 : 2);
    const firstMintBonus =
      nft.firstMintMaxima !== undefined
        ? nft.firstMintMaxima
        : tier === 'MYTHIC'
        ? 20000
        : tier === 'LEGENDARY'
        ? 10000
        : 0;
    const meta = {
      name: `${nft.name} ${serial}`,
      description: `Unique 1-of-1 MAXIMA Genesis Mining Rig NFT (${tier} Rarity, Edition ${serial} of 1,000 Max Supply, DNA ${nft.dnaHash || '0xMAXIMA'}). Permanently grants +${boostPct}% Mining Power Boost${firstMintBonus > 0 ? ` and a First-Mint Exclusive Bonus of ${nf.format(firstMintBonus)} MAXIMA` : ''}.`,
      image: `${window.location.origin}/nft/art/${serialIdx}.svg`,
      max_supply: MAX_TOTAL_NFT_SUPPLY,
      attributes: [
        { trait_type: 'Rarity', value: tier },
        { trait_type: 'Edition Serial', value: `${serial} / 1,000` },
        { trait_type: 'Mining Power Boost', value: `+${boostPct}%` },
        {
          trait_type: 'First-Mint MAXIMA Bonus',
          value: firstMintBonus > 0 ? `${nf.format(firstMintBonus)} MAXIMA (1st Mint Only)` : 'None (Mining Power Only)',
        },
        { trait_type: 'Collection Max Supply', value: '1,000 NFTs' },
        { trait_type: 'DNA Hash', value: nft.dnaHash || '0xMAXIMA' },
        { trait_type: 'Background Aura', value: nft.bgAura || 'Genesis Core' },
        { trait_type: 'Reactor Core Geometry', value: nft.coreGeometry || '16-Ray Octagonal Star' },
        { trait_type: 'Emblem Finish', value: nft.emblemFinish || 'Metallic MAXIMA Crest' },
        { trait_type: 'Overclock Efficiency', value: nft.overclockPct || '98.5%' },
      ],
    };
    const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `${serialIdx}.json`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`📄 Downloaded TEP-64 TON NFT Metadata (${a.download})!`);
  }

  function playGachaRevealAnimation(pulledNft, onComplete) {
    const box = $('nftGachaStageBox');
    const chestImg = $('nftGachaChestImg');
    const btn = $('btnSpinGachaNft');
    const resBanner = $('nftGachaResultBanner');
    if (!box || !pulledNft) {
      if (onComplete) onComplete();
      return;
    }

    gachaSpinInProgress = true;
    box.classList.add('is-spinning');
    if (resBanner) resBanner.hidden = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = t('btn_gacha_spinning');
    }

    const spinImages = [
      'nft/common.svg',
      'nft/rare.svg',
      'nft/epic.svg',
      'nft/legendary.svg',
      'nft/mythic.svg',
    ];
    let tick = 0;
    const totalTicks = 11;
    const timer = setInterval(() => {
      if (chestImg) chestImg.src = spinImages[tick % spinImages.length];
      playTone(420 + tick * 42, 0.055, 'triangle', 0, 0.14);
      triggerHaptic('light');
      tick++;

      if (tick >= totalTicks) {
        clearInterval(timer);
        gachaSpinInProgress = false;
        box.classList.remove('is-spinning');
        const finalImg = resolveNftImageSrc(pulledNft);
        if (chestImg) chestImg.src = finalImg;

        if (resBanner) {
          resBanner.hidden = false;
          if ($('nftResImg')) $('nftResImg').src = finalImg;
          if ($('nftResTier')) {
            $('nftResTier').textContent = `🎉 MINTED ${pulledNft.tier} RARITY (${pulledNft.serialCode || '#0001'})!`;
          }
          if ($('nftResName')) {
            $('nftResName').textContent = `${pulledNft.name} ${pulledNft.serialCode || ''}`;
          }
          if ($('nftResPerks')) {
            const pBoost = pulledNft.powerBoostPct || 2;
            const pCoins = Number(pulledNft.instantCoins || 0);
            $('nftResPerks').textContent =
              pCoins > 0
                ? `⚡ +${pBoost}% Mining Power · 🎁 1ST MINT JACKPOT: +${nf.format(pCoins)} MAXIMA!`
                : `⚡ +${pBoost}% Permanent Mining Power Boost`;
          }
          if ($('nftResTraits')) {
            $('nftResTraits').textContent = `🎨 ${pulledNft.bgAura || 'Genesis Aura'} · 🧬 DNA ${pulledNft.dnaHash || '0xMAX'} · ⚙️ Overclock ${pulledNft.overclockPct || '98%'}`;
          }
        }
        if (onComplete) onComplete();
      }
    }, 105);
  }

  const DEFAULT_NFT_START_MS = Date.parse('2026-11-04T00:00:00Z');
  let activeNftAction = null;

  function getNftStartMs() {
    if (appState && appState.nftState && appState.nftState.startsAtMs) {
      return Number(appState.nftState.startsAtMs);
    }
    if (appState && appState.config && appState.config.nftSale && appState.config.nftSale.startsAt) {
      const parsed = Date.parse(appState.config.nftSale.startsAt);
      if (Number.isFinite(parsed)) return parsed;
    }
    return DEFAULT_NFT_START_MS;
  }

  function openNftActionPanel(mode, nft) {
    if (!nft || !$('nftActionPanel')) return;
    sfxClick();
    triggerHaptic('light');
    activeNftAction = { mode, nft };
    $('nftActionPanel').hidden = false;
    if (mode === 'transfer') {
      if ($('nftActionTitle')) $('nftActionTitle').textContent = `📤 Transfer ${nft.name} ${nft.serialCode}`;
      if ($('nftActionSub')) {
        $('nftActionSub').textContent = `Enter recipient TON Wallet Address (UQ...) or Miner ID to transfer this NFT (+${nft.powerBoostPct || 2}% Mining Power):`;
      }
      if ($('nftActionInput')) {
        $('nftActionInput').value = '';
        $('nftActionInput').placeholder = 'Recipient Wallet Address (UQ...) or Miner ID';
        $('nftActionInput').focus();
      }
      if ($('btnConfirmNftAction')) $('btnConfirmNftAction').textContent = '📤 Send NFT';
    } else {
      if ($('nftActionTitle')) $('nftActionTitle').textContent = `🏷️ Sell ${nft.name} ${nft.serialCode} on P2P Market`;
      if ($('nftActionSub')) {
        $('nftActionSub').textContent = `Set selling price in MAXIMA (Min 500 MAXIMA). Buyer will receive this NFT & its +${nft.powerBoostPct || 2}% Mining Power:`;
      }
      if ($('nftActionInput')) {
        $('nftActionInput').value = '';
        $('nftActionInput').placeholder = 'Price in MAXIMA (e.g. 15000)';
        $('nftActionInput').focus();
      }
      if ($('btnConfirmNftAction')) $('btnConfirmNftAction').textContent = '🏷️ List NFT';
    }
  }

  function closeNftActionPanel() {
    activeNftAction = null;
    if ($('nftActionPanel')) $('nftActionPanel').hidden = true;
  }

  async function handleConfirmNftAction() {
    if (!activeNftAction || !activeNftAction.nft) return;
    const val = String(($('nftActionInput') && $('nftActionInput').value) || '').trim();
    const { mode, nft } = activeNftAction;
    sfxClick();
    if (mode === 'transfer') {
      if (!val || val.length < 3) {
        showToast('⚠️ Please enter a recipient TON Wallet Address or Miner ID!');
        return;
      }
      const res = await apiPost('/api/nft/transfer', { nftId: nft.id, recipient: val });
      if (res && res.ok) {
        appState = res.data;
        closeNftActionPanel();
        sfxSuccess();
        triggerHaptic('success');
        renderAll();
        showToast(res.message);
      } else {
        showToast((res && res.error) || 'Transfer failed');
      }
    } else if (mode === 'sell') {
      const priceMaxima = Math.floor(Number(val.replace(/[^0-9]/g, '') || 0));
      if (!Number.isFinite(priceMaxima) || priceMaxima < 500) {
        showToast('⚠️ Minimum selling price is 500 MAXIMA!');
        return;
      }
      const res = await apiPost('/api/nft/market/list', { nftId: nft.id, priceMaxima });
      if (res && res.ok) {
        appState = res.data;
        closeNftActionPanel();
        sfxSuccess();
        triggerHaptic('success');
        renderAll();
        showToast(res.message);
      } else {
        showToast((res && res.error) || 'Failed to list NFT');
      }
    }
  }

  function renderNftFloatingWindow() {
    if (!appState || !appState.user) return;
    const { user, config, nftState } = appState;
    const nftCfg = (config && config.nftSale) || {};
    if (nftCfg.enabled === false) {
      if ($('btnOpenNftWindow')) $('btnOpenNftWindow').hidden = true;
      if ($('nftFloatingModal')) $('nftFloatingModal').hidden = true;
      return;
    }
    if ($('btnOpenNftWindow')) $('btnOpenNftWindow').hidden = false;
    const items =
      Array.isArray(nftCfg.items) && nftCfg.items.length ? nftCfg.items : DEFAULT_NFT_ITEMS;
    const maxPerWallet = Number(nftCfg.maxPerWallet || 5);
    const maxTotalSupply = Number(
      (nftState && nftState.maxTotalSupply) || nftCfg.maxTotalSupply || MAX_TOTAL_NFT_SUPPLY
    );
    const boxPriceTon = Number(nftCfg.boxPriceTon || 10);
    const ownedList = Array.isArray(user.nftPurchases) ? user.nftPurchases : [];
    const usedCount = ownedList.length;
    const totalMinted = Number(
      nftState && nftState.totalMinted !== undefined ? nftState.totalMinted : usedCount
    );
    const globalRem = Math.max(0, maxTotalSupply - totalMinted);
    const isSoldOut = totalMinted >= maxTotalSupply;
    const remCount = Math.max(0, Math.min(maxPerWallet - usedCount, globalRem));
    const isQuotaFull = usedCount >= maxPerWallet || isSoldOut;

    const startMs = getNftStartMs();
    const waitSec = Math.max(0, Math.floor((startMs - nowServerMs()) / 1000));
    const isMintOpen = waitSec <= 0;

    if ($('nftMintScheduleBanner')) {
      $('nftMintScheduleBanner').classList.toggle('is-live', isMintOpen);
    }
    if ($('nftSchedTitle')) {
      $('nftSchedTitle').textContent = isMintOpen
        ? '🟢 GENESIS NFT MINTING & MARKET IS LIVE!'
        : '⏳ MINTING OPENS SOON';
    }
    if ($('nftMintCountdownVal')) {
      $('nftMintCountdownVal').textContent = isMintOpen ? 'LIVE NOW' : formatHms(waitSec);
    }

    const totalBoostPct = Number(
      user.nftBoostPct !== undefined
        ? user.nftBoostPct
        : ownedList.filter((n) => !n.listedForSale).reduce((acc, n) => acc + Number(n.powerBoostPct || 0), 0)
    );
    const firstMintBonusEarned = Number(
      ownedList.length > 0 ? Number(ownedList[0].instantCoins || 0) : 0
    );

    if ($('nftFabBoostTag')) {
      $('nftFabBoostTag').textContent =
        totalBoostPct > 0 ? `+${totalBoostPct}% Power` : `${usedCount}/${maxPerWallet} NFT`;
    }
    if ($('nftOwnedCountVal')) {
      $('nftOwnedCountVal').textContent = `${usedCount} / ${maxPerWallet} NFT`;
    }
    if ($('nftTotalBoostThsVal')) {
      $('nftTotalBoostThsVal').textContent = `+${totalBoostPct}% Power`;
    }
    if ($('nftTotalDailyCoinsVal')) {
      $('nftTotalDailyCoinsVal').textContent =
        ownedList.length === 0
          ? '10K / 20K (1st Mint)'
          : firstMintBonusEarned > 0
          ? `+${nf.format(firstMintBonusEarned)} MAXIMA`
          : '0 MAXIMA';
    }
    if ($('nftOfflineSimBanner')) {
      $('nftOfflineSimBanner').hidden = true;
    }

    if ($('nftGlobalMintedVal')) {
      $('nftGlobalMintedVal').textContent = `${nf.format(totalMinted)} / ${nf.format(maxTotalSupply)} NFTs`;
    }
    if ($('nftGlobalRemVal')) {
      $('nftGlobalRemVal').textContent = isSoldOut ? 'SOLD OUT' : `${nf.format(globalRem)} Left`;
    }
    if ($('nftGlobalSupplyFill')) {
      const pct = Math.min(100, Math.max(0, (totalMinted / maxTotalSupply) * 100));
      $('nftGlobalSupplyFill').style.width = `${pct}%`;
    }

    const quotaPill = $('nftGachaQuotaPill');
    if (quotaPill) {
      quotaPill.textContent = isSoldOut
        ? `SOLD OUT (${nf.format(maxTotalSupply)}/${nf.format(maxTotalSupply)})`
        : isQuotaFull
        ? `Quota Full (${maxPerWallet}/${maxPerWallet})`
        : `Remaining: ${remCount} / ${maxPerWallet} Mints`;
      quotaPill.classList.toggle('full', isQuotaFull);
    }

    const spinBtn = $('btnSpinGachaNft');
    if (spinBtn && !gachaSpinInProgress) {
      spinBtn.disabled = isQuotaFull || !isMintOpen;
      spinBtn.textContent = !isMintOpen
        ? `⏳ Mint Opens in ${formatHms(waitSec)}`
        : isSoldOut
        ? `⛔ SOLD OUT (1,000 / 1,000 NFTs MINTED)`
        : isQuotaFull
        ? t('btn_gacha_limit_full', { max: maxPerWallet })
        : t('btn_spin_gacha', { ton: boxPriceTon, used: usedCount, max: maxPerWallet });
    }

    const cardsWrap = $('nftCardsContainer');
    if (cardsWrap) {
      const countsById = {};
      ownedList.forEach((p) => {
        countsById[p.nftId] = (countsById[p.nftId] || 0) + 1;
      });
      const nftSig = `${ownedList.length}_${totalMinted}_${Math.round(user.combinedHolding)}_${currentLang}`;
      if (lastNftRenderSig !== nftSig || !cardsWrap.children.length) {
        lastNftRenderSig = nftSig;
        cardsWrap.innerHTML = items
          .map((item) => {
            const ownedCount = countsById[item.id] || 0;
            const chance = item.chancePct !== undefined ? item.chancePct : 20;
            const tierSupply = item.maxSupply || Math.round((chance / 100) * maxTotalSupply);
            const imgSrc = resolveNftImageSrc(item);
            return `
              <div class="nft-card theme-${item.theme || 'bronze'}">
                <div class="nft-card-top">
                  <div class="nft-emblem">
                    <img src="${imgSrc}" alt="${item.name}" class="nft-art-img" />
                  </div>
                  <div class="nft-info">
                    <div class="nft-tier-row">
                      <span class="nft-tier-badge">${item.tier}</span>
                      <span class="nft-supply-pill">🏛️ ${tierSupply} / ${nf.format(maxTotalSupply)}</span>
                      ${
                        ownedCount > 0
                          ? `<span class="nft-owned-pill">${t('nft_owned_badge', { count: ownedCount })}</span>`
                          : ''
                      }
                      <span class="nft-chance-badge">📊 ${chance}% SUPPLY</span>
                    </div>
                    <h4 class="nft-name">${item.name}</h4>
                    <div class="nft-perks">
                      <span class="nft-perk-chip power">⚡ +${item.powerBoostPct || 2}% Mining Power</span>
                      ${
                        Number(item.firstMintMaxima || 0) > 0
                          ? `<span class="nft-perk-chip instant">🎁 1st Mint Only: +${nf.format(item.firstMintMaxima)} MAXIMA</span>`
                          : `<span class="nft-perk-chip daily">⛏️ Power Boost Only (0 MAXIMA)</span>`
                      }
                    </div>
                  </div>
                </div>
              </div>
            `;
          })
          .join('');
      }
    }

    const invWrap = $('nftOwnedListContainer');
    if (invWrap) {
      if (!ownedList.length) {
        invWrap.innerHTML = `<div class="empty-box">${t('no_nft_owned_yet')}</div>`;
      } else {
        invWrap.innerHTML = ownedList
          .map((n, idx) => ({
            ...n,
            _origIdx: idx,
            serialCode: n.serialCode || `#${String(idx + 1).padStart(4, '0')}`,
          }))
          .slice()
          .reverse()
          .map((n) => {
            const imgSrc = resolveNftImageSrc(n);
            const isOnChain = Boolean(n.isOnChainSynced);
            return `
              <div class="lv-row is-unlocked">
                <div class="lv-left">
                  <div class="lv-ico" style="padding:0;overflow:hidden;">
                    <img src="${imgSrc}" alt="${n.name}" class="nft-art-img" />
                  </div>
                  <div>
                    <div class="lv-title">${n.name} <b>${n.serialCode}</b> <span class="nft-mini-tier">${n.tier || ''}</span>${isOnChain ? ' <span class="pill-mint">ON-CHAIN</span>' : ''}</div>
                    <div class="lv-speed">⚡ +${n.powerBoostPct || 2}% Mining Power${Number(n.instantCoins || 0) > 0 ? ` · 🎁 1st Mint Bonus: +${nf.format(n.instantCoins)} MAXIMA` : ''}</div>
                    <div class="nft-trait-tags">
                      <span class="nft-trait-pill">🎨 ${n.bgAura || 'Genesis Aura'}</span>
                      <span class="nft-trait-pill">🧬 ${n.dnaHash || '0xMAXIMA'}</span>
                      <span class="nft-trait-pill">⚙️ ${n.overclockPct || '98.5%'}</span>
                    </div>
                  </div>
                </div>
                <div class="lv-right nft-dl-actions">
                  ${
                    !isOnChain
                      ? `<div style="display:flex;gap:4px;">
                          ${
                            n.listedForSale
                              ? `<button type="button" class="nft-dl-btn sell" data-unlist-nft="${n._origIdx}" title="Remove from P2P Market">❌ Unlist (${nf.format(n.listedPriceMaxima)} MAX)</button>`
                              : `<button type="button" class="nft-dl-btn transfer" data-transfer-nft="${n._origIdx}" title="Transfer NFT to another user">📤 Transfer</button>
                                 <button type="button" class="nft-dl-btn sell" data-sell-nft="${n._origIdx}" title="Sell NFT on P2P Market">🏷️ Sell</button>`
                          }
                        </div>`
                      : ''
                  }
                  <div style="display:flex;gap:4px;">
                    <button type="button" class="nft-dl-btn" data-dl-nft-png="${n._origIdx}" title="Download Unique 1024x1024 NFT PNG">🖼️ PNG</button>
                    <button type="button" class="nft-dl-btn json" data-dl-nft-json="${n._origIdx}" title="Download TON NFT Metadata JSON">📄 JSON</button>
                  </div>
                </div>
              </div>
            `;
          })
          .join('');

        invWrap.querySelectorAll('[data-transfer-nft]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-transfer-nft'));
            if (ownedList[idx]) openNftActionPanel('transfer', ownedList[idx]);
          });
        });

        invWrap.querySelectorAll('[data-sell-nft]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-sell-nft'));
            if (ownedList[idx]) openNftActionPanel('sell', ownedList[idx]);
          });
        });

        invWrap.querySelectorAll('[data-unlist-nft]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const idx = Number(btn.getAttribute('data-unlist-nft'));
            const targetNft = ownedList[idx];
            if (!targetNft) return;
            sfxClick();
            const res = await apiPost('/api/nft/market/unlist', { nftId: targetNft.id });
            if (res && res.ok) {
              appState = res.data;
              sfxSuccess();
              renderAll();
              showToast(res.message);
            } else {
              showToast((res && res.error) || 'Failed to unlist NFT');
            }
          });
        });

        invWrap.querySelectorAll('[data-dl-nft-png]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-dl-nft-png'));
            const targetNft = ownedList[idx];
            if (targetNft) {
              downloadUniqueNftCardPng({
                ...targetNft,
                serialCode: targetNft.serialCode || `#${String(idx + 1).padStart(4, '0')}`,
              });
            }
          });
        });

        invWrap.querySelectorAll('[data-dl-nft-json]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-dl-nft-json'));
            const targetNft = ownedList[idx];
            if (targetNft) {
              downloadUniqueNftMetadataJson({
                ...targetNft,
                serialCode: targetNft.serialCode || `#${String(idx + 1).padStart(4, '0')}`,
              });
            }
          });
        });
      }
    }

    // Render Live P2P Player NFT Market
    const marketWrap = $('nftMarketListContainer');
    if (marketWrap) {
      const marketListings = Array.isArray(nftState && nftState.marketListings)
        ? nftState.marketListings
        : [];
      if (!marketListings.length) {
        marketWrap.innerHTML = `<div class="empty-box">No player NFTs listed for sale right now. Own an NFT above and click "🏷️ Sell" to list it here!</div>`;
      } else {
        marketWrap.innerHTML = marketListings
          .map((m) => {
            const imgSrc = resolveNftImageSrc(m);
            const isOwn = m.sellerUserId === user.userId;
            return `
              <div class="lv-row is-unlocked">
                <div class="lv-left">
                  <div class="lv-ico" style="padding:0;overflow:hidden;">
                    <img src="${imgSrc}" alt="${m.name}" class="nft-art-img" />
                  </div>
                  <div>
                    <div class="lv-title">${m.name} <b>${m.serialCode || '#0001'}</b> <span class="nft-mini-tier">${m.tier || ''}</span></div>
                    <div class="lv-speed">⚡ <b>+${m.powerBoostPct || 2}% Mining Power</b> · Seller: ${m.sellerName || m.sellerUserId}</div>
                    <div class="nft-trait-tags">
                      <span class="nft-trait-pill">💰 Price: ${nf.format(m.listedPriceMaxima)} MAXIMA</span>
                      <span class="nft-trait-pill">🧬 ${m.dnaHash || '0xMAXIMA'}</span>
                    </div>
                  </div>
                </div>
                <div class="lv-right">
                  ${
                    isOwn
                      ? `<button type="button" class="nft-dl-btn sell" data-market-cancel="${m.id}">❌ Cancel</button>`
                      : `<button type="button" class="btn-gold btn-xs" data-market-buy="${m.id}" data-seller="${m.sellerUserId}">🛒 Buy (${nf.format(m.listedPriceMaxima)} MAX)</button>`
                  }
                </div>
              </div>
            `;
          })
          .join('');

        marketWrap.querySelectorAll('[data-market-cancel]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-market-cancel');
            sfxClick();
            const res = await apiPost('/api/nft/market/unlist', { nftId: id });
            if (res && res.ok) {
              appState = res.data;
              sfxSuccess();
              renderAll();
              showToast(res.message);
            } else {
              showToast((res && res.error) || 'Failed to cancel listing');
            }
          });
        });

        marketWrap.querySelectorAll('[data-market-buy]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-market-buy');
            const sellerUserId = btn.getAttribute('data-seller');
            sfxClick();
            const res = await apiPost('/api/nft/market/buy', { nftId: id, sellerUserId });
            if (res && res.ok) {
              appState = res.data;
              res.leveledUp ? sfxLevelUp() : sfxSuccess();
              triggerHaptic('success');
              renderAll();
              showToast(res.message);
            } else {
              showToast((res && res.error) || 'Purchase failed');
            }
          });
        });
      }
    }
  }

  function updateWithdrawPreview() {
    const el = $('wdPreviewText');
    if (!el || !appState) return;
    const fee = appState.config.wallet.withdrawFeeCoins || 100;
    const amt = Number(($('inputWithdrawAmount') && $('inputWithdrawAmount').value) || 0);
    const net = amt >= fee ? +(amt - fee).toFixed(2) : 0;
    el.innerHTML = t('wd_preview_html', { net: nf.format(net) });
  }

  // ================= NATIVE TON CONNECT TRANSACTIONS & AUTOMATIC ON-CHAIN POLLING =================
  let pendingTxAfterConnect = null;
  let txVerifyInFlight = false;

  function stopAutoOnChainPoll() {
    if (txPollTimer) {
      clearInterval(txPollTimer);
      txPollTimer = null;
    }
    activeTxConfig = null;
  }

  function startAutoOnChainPoll(cfg) {
    stopAutoOnChainPoll();
    activeTxConfig = cfg;
    let attempts = 0;

    txPollTimer = setInterval(async () => {
      if (txVerifyInFlight) return;
      attempts++;
      if (attempts > 30 || !activeTxConfig) {
        stopAutoOnChainPoll();
        return;
      }
      txVerifyInFlight = true;
      try {
        if (cfg.mode === 'verify') {
          const res = await apiPost('/api/wallet/verify', { txBoc: '' });
          if (res && res.ok && activeTxConfig) {
            stopAutoOnChainPoll();
            appState = res.data;
            if (tonConnectUI && typeof tonConnectUI.closeModal === 'function') {
              try {
                tonConnectUI.closeModal();
              } catch (_) {}
            }
            sfxSuccess();
            triggerHaptic('success');
            renderAll();
            showToast(res.message);
          }
        } else if (cfg.mode === 'presale') {
          const res = await apiPost('/api/presale/buy', { packageId: cfg.packageId, txBoc: '' });
          if (res && res.ok && activeTxConfig) {
            stopAutoOnChainPoll();
            appState = res.data;
            if (tonConnectUI && typeof tonConnectUI.closeModal === 'function') {
              try {
                tonConnectUI.closeModal();
              } catch (_) {}
            }
            res.leveledUp ? sfxLevelUp() : sfxSuccess();
            triggerHaptic('success');
            renderAll();
            showToast(res.message);
          }
        } else if (cfg.mode === 'nft') {
          const res = await apiPost('/api/nft/buy', { txBoc: '' });
          if (res && res.ok && activeTxConfig) {
            stopAutoOnChainPoll();
            if (tonConnectUI && typeof tonConnectUI.closeModal === 'function') {
              try {
                tonConnectUI.closeModal();
              } catch (_) {}
            }
            if (res.pulledNft) {
              playGachaRevealAnimation(res.pulledNft, () => {
                appState = res.data;
                sfxLevelUp();
                triggerHaptic('success');
                renderAll();
                showToast(res.message);
              });
            } else {
              appState = res.data;
              sfxLevelUp();
              triggerHaptic('success');
              renderAll();
              showToast(res.message);
            }
          }
        }
      } catch (_) {
      } finally {
        txVerifyInFlight = false;
      }
    }, 4000);
  }

  async function executeTonTransaction(cfg) {
    if (!cfg) return;
    if (!tonConnectUI) initTonConnect();

    if (!tonConnectUI || !tonConnectUI.connected) {
      pendingTxAfterConnect = cfg;
      await openTonConnect(false);
      return;
    }

    if (tonConnectUI.wallet && (!appState || !appState.user || !appState.user.walletConnected)) {
      await syncLocalTonWalletToServer(tonConnectUI.wallet);
    }

    // Start automatic background on-chain verification polling right away
    startAutoOnChainPoll(cfg);

    try {
      const validUntilSec = Math.floor(nowServerMs() / 1000) + 360;
      const txResult = await tonConnectUI.sendTransaction({
        validUntil: validUntilSec,
        messages: [
          {
            address: cfg.ownerWallet,
            amount: cfg.nanoTon,
          },
        ],
      });

      if (txResult && txResult.boc) {
        const alreadyCreditedByPoll = !activeTxConfig;
        stopAutoOnChainPoll();
        txVerifyInFlight = true;
        try {
          if (cfg.mode === 'verify') {
            const res = await apiPost('/api/wallet/verify', { txBoc: txResult.boc });
            if (res && res.ok) {
              appState = res.data;
              renderAll();
              if (!alreadyCreditedByPoll) {
                sfxSuccess();
                triggerHaptic('success');
                showToast(res.message);
              }
              return;
            }
          } else if (cfg.mode === 'presale') {
            const res = await apiPost('/api/presale/buy', {
              packageId: cfg.packageId,
              txBoc: txResult.boc,
            });
            if (res && res.ok) {
              appState = res.data;
              renderAll();
              if (!alreadyCreditedByPoll) {
                res.leveledUp ? sfxLevelUp() : sfxSuccess();
                triggerHaptic('success');
                showToast(res.message);
              }
              return;
            }
          } else if (cfg.mode === 'nft') {
            const res = await apiPost('/api/nft/buy', {
              txBoc: txResult.boc,
            });
            if (res && res.ok) {
              if (!alreadyCreditedByPoll && res.pulledNft) {
                playGachaRevealAnimation(res.pulledNft, () => {
                  appState = res.data;
                  sfxLevelUp();
                  triggerHaptic('success');
                  renderAll();
                  showToast(res.message);
                });
              } else {
                appState = res.data;
                renderAll();
                if (!alreadyCreditedByPoll) {
                  sfxLevelUp();
                  triggerHaptic('success');
                  showToast(res.message);
                }
              }
              return;
            }
          }
        } finally {
          txVerifyInFlight = false;
        }
      }
    } catch (err) {
      const msg = String((err && err.message) || err || '').toLowerCase();
      if (msg.includes('reject') || msg.includes('decline') || msg.includes('user_rejects')) {
        stopAutoOnChainPoll();
        showToast('❌ Transaction cancelled in wallet.');
      }
    }
  }

  async function handleBuyNft() {
    if (!appState || gachaSpinInProgress) return;
    const waitSec = Math.max(0, Math.floor((getNftStartMs() - nowServerMs()) / 1000));
    if (waitSec > 0) {
      showToast(`⏳ NFT Minting opens in ${formatHms(waitSec)}!`);
      return;
    }
    const nftCfg = (appState.config && appState.config.nftSale) || {};
    const maxPerWallet = Number(nftCfg.maxPerWallet || 5);
    const boxPriceTon = Number(nftCfg.boxPriceTon || 10);
    const ownedList = Array.isArray(appState.user.nftPurchases) ? appState.user.nftPurchases : [];
    const inAppCount = ownedList.filter((n) => !n.isOnChainSynced).length;

    if (inAppCount >= maxPerWallet) {
      showToast(`⚠️ Maximum limit of ${maxPerWallet} Genesis NFTs per wallet reached!`);
      return;
    }

    const ownerWallet =
      nftCfg.recipientWallet ||
      (appState.config.presale && appState.config.presale.recipientWallet) ||
      'UQDUe_P76bjHJ9EIUk8KLnFVRhbHf9_g7lJXHXgchYpZy4R1';
    const nanoTon = String(Math.round(boxPriceTon * 1e9));

    sfxClick();
    await executeTonTransaction({
      mode: 'nft',
      tonAmount: boxPriceTon,
      nanoTon,
      ownerWallet,
    });
  }

  async function handleBuyPresale(packageId) {
    if (!appState) return;
    const pkg = (appState.config.presale.packages || []).find((p) => p.id === packageId);
    if (!pkg) return;

    const ownerWallet = appState.config.presale.recipientWallet;
    const nanoTon = String(Math.round(pkg.ton * 1e9));

    sfxClick();
    await executeTonTransaction({
      mode: 'presale',
      packageId: pkg.id,
      coins: pkg.coins,
      tonAmount: pkg.ton,
      nanoTon,
      ownerWallet,
    });
  }

  async function handleVerifyWalletTon() {
    if (!appState) return;
    const feeTon = appState.config.wallet.verificationFeeTon || 0.1;
    const ownerWallet = appState.config.wallet.creatorTonWallet;
    const nanoTon = String(Math.round(feeTon * 1e9)); // 0.1 TON = 100,000,000 nanoton

    sfxClick();
    await executeTonTransaction({
      mode: 'verify',
      tonAmount: feeTon,
      nanoTon,
      ownerWallet,
    });
  }

  // ================= EVENT LISTENERS =================
  // Tab Navigation
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      sfxClick();
      triggerHaptic('light');
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = $(btn.getAttribute('data-tab'));
      if (pane) pane.classList.add('active');
    });
  });

  if ($('btnGateConnect')) $('btnGateConnect').addEventListener('click', openTonConnect);

  if ($('btnClaimMining')) {
    $('btnClaimMining').addEventListener('click', async () => {
      if (!appState) return;
      if (!appState.user.walletConnected) {
        openTonConnect();
        return;
      }
      const res = await apiPost('/api/mine/claim');
      if (res && res.ok) {
        appState = res.data;
        res.leveledUp ? sfxLevelUp() : sfxSuccess();
        triggerHaptic('success');
        renderAll();
        showToast(res.message);
      } else {
        showToast((res && res.error) || 'Minimum claim is 0.1 MAXIMA');
      }
    });
  }

  if ($('btnCopyContractTop')) {
    $('btnCopyContractTop').addEventListener('click', () => {
      const addr = (appState && appState.config.token.contractAddress) || 'EQBf0K3oICQZr-UPkiQiP7fMcGXQqq_aQB0jno6mbpssbr45';
      copyText(addr);
    });
  }
  if ($('btnCopyContractMain')) {
    $('btnCopyContractMain').addEventListener('click', () => {
      const addr = (appState && appState.config.token.contractAddress) || 'EQBf0K3oICQZr-UPkiQiP7fMcGXQqq_aQB0jno6mbpssbr45';
      copyText(addr);
    });
  }

  // 1000 Levels Controls
  if ($('btnPrevWorld')) {
    $('btnPrevWorld').addEventListener('click', () => {
      explorerWorldIdx = (explorerWorldIdx + 9) % 10;
      activeLevelRange = `${explorerWorldIdx * 100 + 1}-${explorerWorldIdx * 100 + 100}`;
      syncRangeChipsUI();
      sfxClick();
      renderWorldExplorer();
      render1000LevelsList();
    });
  }
  if ($('btnNextWorld')) {
    $('btnNextWorld').addEventListener('click', () => {
      explorerWorldIdx = (explorerWorldIdx + 1) % 10;
      activeLevelRange = `${explorerWorldIdx * 100 + 1}-${explorerWorldIdx * 100 + 100}`;
      syncRangeChipsUI();
      sfxClick();
      renderWorldExplorer();
      render1000LevelsList();
    });
  }

  document.querySelectorAll('#levelRangeChips .r-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      sfxClick();
      activeLevelRange = chip.getAttribute('data-range') || '1-100';
      searchLevelQuery = '';
      if ($('inputSearchLevel')) $('inputSearchLevel').value = '';
      if (activeLevelRange !== 'all') {
        const startLv = Number(activeLevelRange.split('-')[0]);
        explorerWorldIdx = Math.min(9, Math.floor((startLv - 1) / 100));
        renderWorldExplorer();
      }
      syncRangeChipsUI();
      render1000LevelsList();
    });
  });

  if ($('inputSearchLevel')) {
    $('inputSearchLevel').addEventListener('input', (e) => {
      searchLevelQuery = e.target.value.trim();
      syncRangeChipsUI();
      render1000LevelsList();
    });
  }

  if ($('btnJumpMyLevel')) {
    $('btnJumpMyLevel').addEventListener('click', () => {
      sfxClick();
      const myLv = appState && appState.user ? appState.user.level : 1;
      explorerWorldIdx = Math.min(9, Math.floor((myLv - 1) / 100));
      activeLevelRange = `${explorerWorldIdx * 100 + 1}-${explorerWorldIdx * 100 + 100}`;
      searchLevelQuery = '';
      if ($('inputSearchLevel')) $('inputSearchLevel').value = '';
      syncRangeChipsUI();
      renderWorldExplorer();
      render1000LevelsList();
      const row = $(`level-row-${myLv}`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // Daily Check-In
  if ($('btnDailyCheckIn')) {
    $('btnDailyCheckIn').addEventListener('click', async () => {
      const res = await apiPost('/api/missions/checkin');
      if (res && res.ok) {
        appState = res.data;
        res.leveledUp ? sfxLevelUp() : sfxSuccess();
        triggerHaptic('success');
        renderAll();
        showToast(res.message);
      } else {
        showToast((res && res.error) || 'Already checked in today');
      }
    });
  }

  // Referral Share & Copy
  if ($('btnShareRefTg')) {
    $('btnShareRefTg').addEventListener('click', () => {
      if (!appState) return;
      sfxClick();
      const link = appState.user.referralLink;
      const text = '⛏️ Join MAXIMA MINING APP on TON! Climb 1,000 Mining Levels up to 5,000 TH/s & mine real MAXIMA Jettons!';
      const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
      if (tg && tg.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url, '_blank', 'noopener');
    });
  }
  if ($('btnCopyRefLink')) {
    $('btnCopyRefLink').addEventListener('click', () => {
      if (appState) copyText(appState.user.referralLink);
    });
  }

  // Wallet Tab Controls
  if ($('btnConnectOrDisconnect')) {
    $('btnConnectOrDisconnect').addEventListener('click', async () => {
      sfxClick();
      const isServerConnected = Boolean(appState && appState.user && appState.user.walletConnected);
      if (isServerConnected) {
        explicitDisconnectInProgress = true;
        if (tonConnectUI && tonConnectUI.connected) {
          await tonConnectUI.disconnect().catch(() => {});
        }
        const res = await apiPost('/api/wallet/disconnect');
        explicitDisconnectInProgress = false;
        if (res && res.ok) {
          appState = res.data;
          renderAll();
          showToast(res.message);
        }
      } else {
        openTonConnect(false);
      }
    });
  }

  if ($('btnVerifyWalletTon')) {
    $('btnVerifyWalletTon').addEventListener('click', handleVerifyWalletTon);
  }
  if ($('btnRecheckOnChainVerify')) {
    $('btnRecheckOnChainVerify').addEventListener('click', async () => {
      sfxClick();
      showToast('🔍 Checking 0.1 GRAM verification transaction on-chain...');
      const res = await apiPost('/api/wallet/verify', { txBoc: '' });
      if (res && res.ok) {
        appState = res.data;
        sfxSuccess();
        renderAll();
        showToast(res.message);
      } else {
        showToast((res && res.error) || 'Not verified yet');
      }
    });
  }

  if ($('inputWithdrawAmount')) {
    $('inputWithdrawAmount').addEventListener('input', (e) => {
      const cleaned = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
      if (e.target.value !== cleaned) e.target.value = cleaned;
      updateWithdrawPreview();
    });
  }
  if ($('btnWithdrawMax')) {
    $('btnWithdrawMax').addEventListener('click', () => {
      if (!appState || !$('inputWithdrawAmount')) return;
      sfxClick();
      $('inputWithdrawAmount').value = Math.floor(appState.user.inAppHolding);
      updateWithdrawPreview();
    });
  }
  if ($('btnSubmitWithdraw')) {
    $('btnSubmitWithdraw').addEventListener('click', async () => {
      const amount = Number($('inputWithdrawAmount').value || 0);
      const res = await apiPost('/api/wallet/withdraw', { amount });
      if (res && res.ok) {
        $('inputWithdrawAmount').value = '';
        appState = res.data;
        sfxSuccess();
        triggerHaptic('success');
        renderAll();
        showToast(res.message);
      } else {
        showToast((res && res.error) || 'Withdraw failed');
      }
    });
  }

  // ================= ADMIN AUTO-WITHDRAW PANEL (1-CLICK & BATCH VIA TON CONNECT) =================
  let adminWdData = null;
  const selectedAdminWdIds = new Set();
  let adminBusy = false;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function openAdminWithdrawModal() {
    const modal = $('adminWdModal');
    if (!modal) return;
    sfxClick();
    modal.style.display = 'flex';
    await loadAdminWithdrawals();
  }

  function closeAdminWithdrawModal() {
    const modal = $('adminWdModal');
    if (!modal) return;
    sfxClick();
    modal.style.display = 'none';
  }

  async function loadAdminWithdrawals(silent = false) {
    if (!silent && $('admPendingWdList') && !adminWdData) {
      $('admPendingWdList').innerHTML = `<div class="empty-box">⏳ Memuat antrean withdraw & audit anti-bug...</div>`;
    }
    try {
      const res = await apiPost('/api/admin/withdrawals');
      const payload = res && (res.adminData || res.data);
      if (res && res.ok && payload) {
        adminWdData = payload;
        const validPendingIds = new Set((adminWdData.pending || []).map((w) => w.wdId));
        Array.from(selectedAdminWdIds).forEach((id) => {
          if (!validPendingIds.has(id)) selectedAdminWdIds.delete(id);
        });
        if (appState && adminWdData.counts) {
          appState.pendingWithdrawCount = adminWdData.counts.totalPending || 0;
          if ($('adminPendingBadge')) {
            $('adminPendingBadge').textContent = `${nf.format(appState.pendingWithdrawCount)} Queued`;
          }
        }
        renderAdminWithdrawModal();
      } else if (!silent) {
        showToast((res && res.error) || 'Gagal memuat data Admin Withdraw.');
      }
    } catch (err) {
      if (!silent) showToast('⚠️ Gagal memuat antrean withdraw.');
    }
  }

  function updateAdminSelectionButtons() {
    const pending = (adminWdData && adminWdData.pending) || [];
    let selCount = 0;
    let selNetMaxima = 0;
    pending.forEach((w) => {
      if (selectedAdminWdIds.has(w.wdId)) {
        selCount++;
        selNetMaxima += Number(w.netAmount || 0);
      }
    });
    selNetMaxima = +selNetMaxima.toFixed(2);

    if ($('admBtnAutoPayLabel')) {
      $('admBtnAutoPayLabel').textContent =
        selCount > 0
          ? `⚡ Kirim Otomatis via TON Connect (${selCount} Terpilih · ${nf.format(selNetMaxima)} MAXIMA)`
          : `⚡ Kirim Otomatis via TON Connect (0 Terpilih)`;
    }
    const disableBatch = adminBusy || selCount === 0;
    if ($('btnAdmAutoPaySelected')) $('btnAdmAutoPaySelected').disabled = disableBatch;
    if ($('btnAdmMarkPaidSelected')) $('btnAdmMarkPaidSelected').disabled = disableBatch;
    if ($('btnAdmBurnSelected')) $('btnAdmBurnSelected').disabled = disableBatch;
    if ($('btnAdmWipeSelected')) $('btnAdmWipeSelected').disabled = disableBatch;
  }

  function renderAdminWithdrawModal() {
    if (!adminWdData) return;
    const counts = adminWdData.counts || {};
    const pending = adminWdData.pending || [];
    const recentHistory = adminWdData.recentHistory || [];

    if ($('admStatPendingCount')) $('admStatPendingCount').textContent = nf.format(counts.totalPending || 0);
    if ($('admStatSafeCount')) $('admStatSafeCount').textContent = nf.format(counts.safeCount || 0);
    if ($('admStatFraudCount')) {
      $('admStatFraudCount').textContent = nf.format((counts.fraudCount || 0) + (counts.warnCount || 0));
    }
    if ($('admStatNetMaxima')) $('admStatNetMaxima').textContent = compactNum(counts.totalPendingNetMaxima || 0);
    if ($('admQueueCountChip')) $('admQueueCountChip').textContent = `${nf.format(counts.totalPending || 0)} Pending`;

    const listEl = $('admPendingWdList');
    if (listEl) {
      if (!pending.length) {
        listEl.innerHTML = `<div class="empty-box">🎉 Tidak ada antrean withdraw PENDING saat ini. Semua withdraw telah selesai diproses!</div>`;
      } else {
        listEl.innerHTML = pending
          .map((w) => {
            const isSel = selectedAdminWdIds.has(w.wdId);
            const cardRiskCls =
              w.riskLevel === 'FRAUD' ? 'fraud-card' : w.riskLevel === 'WARN' ? 'warn-card' : '';
            const badgeHtml =
              w.riskLevel === 'FRAUD'
                ? `<span class="adm-risk-badge fraud">🚨 TERINDIKASI BUG</span>`
                : w.riskLevel === 'WARN'
                ? `<span class="adm-risk-badge warn">⚠️ PERINGATAN</span>`
                : `<span class="adm-risk-badge safe">✅ AMAN (MURNI)</span>`;
            const timeStr = w.createdAt ? new Date(w.createdAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '-';
            const reasonsHtml = (w.reasons || []).map((r) => `<div>• ${escapeHtml(r)}</div>`).join('');

            return `
              <div class="adm-wd-card ${cardRiskCls} ${isSel ? 'selected' : ''}" data-adm-card="${escapeHtml(w.wdId)}">
                <div class="adm-wd-top">
                  <label class="adm-wd-chk-wrap">
                    <input type="checkbox" class="adm-wd-chk" data-adm-chk="${escapeHtml(w.wdId)}" ${isSel ? 'checked' : ''} />
                    <div>
                      <div class="adm-wd-amount">${nf.format(w.netAmount)} MAXIMA</div>
                      <div style="font-size:10px;color:#94a3b8;">Gross: ${nf.format(w.requestedAmount)} · Fee: ${nf.format(w.feeCoins)} · ${timeStr}</div>
                    </div>
                  </label>
                  ${badgeHtml}
                </div>

                <div class="adm-wd-user-meta">
                  👤 <b>${escapeHtml(w.username)}</b> (ID: <code>${escapeHtml(w.userId)}</code>) · Lv.${nf.format(w.userLevel || 1)}<br/>
                  💰 Sisa Saldo App: <b>${nf.format(w.userCurrentInApp || 0)}</b> · Total Mined: <b>${nf.format(w.userMinedTotal || 0)}</b> · Presale: <b>${nf.format(w.userPresaleCoins || 0)}</b>
                </div>

                <div class="adm-wd-wallet-box">
                  <span class="adm-wd-wallet-addr">${escapeHtml(w.walletAddress)}</span>
                  <button type="button" class="btn-mini" data-adm-copy="${escapeHtml(w.walletAddress)}">Salin</button>
                </div>

                <div class="adm-wd-reasons">${reasonsHtml}</div>

                <div class="adm-wd-single-actions">
                  <button type="button" class="adm-single-btn autopay" data-adm-autopay="${escapeHtml(w.wdId)}" ${adminBusy ? 'disabled' : ''}>
                    ⚡ Auto-Pay 1-Click (TON Connect)
                  </button>
                  <button type="button" class="adm-single-btn paid" data-adm-paid="${escapeHtml(w.wdId)}" ${adminBusy ? 'disabled' : ''}>
                    ✅ PAID Manual
                  </button>
                  <button type="button" class="adm-single-btn burn" data-adm-burn="${escapeHtml(w.wdId)}" ${adminBusy ? 'disabled' : ''}>
                    🔥 Hanguskan Bug
                  </button>
                  <button type="button" class="adm-single-btn wipe" data-adm-wipe="${escapeHtml(w.wdId)}" ${adminBusy ? 'disabled' : ''}>
                    🚫 Sita Reset 0
                  </button>
                  <button type="button" class="adm-single-btn refund" data-adm-refund="${escapeHtml(w.wdId)}" ${adminBusy ? 'disabled' : ''}>
                    🔄 Refund
                  </button>
                </div>
              </div>
            `;
          })
          .join('');
      }
    }

    const histEl = $('admHistoryWdList');
    if (histEl) {
      if (!recentHistory.length) {
        histEl.innerHTML = `<div class="empty-box">Belum ada riwayat withdraw yang selesai diproses.</div>`;
      } else {
        histEl.innerHTML = recentHistory
          .map(
            (h) => `
              <div class="lv-row is-unlocked">
                <div class="lv-left">
                  <div class="lv-ico">${String(h.status).includes('PAID') ? '✅' : '🚫'}</div>
                  <div>
                    <div class="lv-title">${nf.format(h.netAmount)} MAXIMA · ${escapeHtml(h.username)} (${escapeHtml(h.userId)})</div>
                    <div class="lv-meta">${escapeHtml((h.walletAddress || '').slice(0, 10))}...${escapeHtml((h.walletAddress || '').slice(-6))} · ${escapeHtml(h.status)}</div>
                  </div>
                </div>
              </div>
            `
          )
          .join('');
      }
    }

    updateAdminSelectionButtons();
  }

  async function executeAdminAutoPay(wdIds) {
    const targetIds = Array.isArray(wdIds) ? wdIds.filter(Boolean) : [];
    if (!targetIds.length || adminBusy) return;

    if (!tonConnectUI) initTonConnect();
    if (!tonConnectUI || !tonConnectUI.connected || !tonConnectUI.wallet || !tonConnectUI.wallet.account) {
      showToast('🔗 Hubungkan dompet TON Admin (Creator Wallet) terlebih dahulu, lalu klik Auto-Pay lagi.');
      await openTonConnect(false);
      return;
    }

    const memoInput = $('admInputMemo');
    const memo = ((memoInput && memoInput.value) || 'MAXIMA PAYOUT').trim().slice(0, 80) || 'MAXIMA PAYOUT';
    const senderWalletAddress = tonConnectUI.wallet.account.address;

    adminBusy = true;
    updateAdminSelectionButtons();

    try {
      showToast(`⏳ Menyiapkan payload Jetton MAXIMA (${targetIds.length} withdraw, Memo: "${memo}")...`);
      const prep = await apiPost('/api/admin/withdraw/prepare-tx', {
        wdIds: targetIds,
        memo,
        senderWalletAddress,
      });

      if (!prep || !prep.ok || !Array.isArray(prep.items) || !prep.items.length) {
        showToast((prep && prep.error) || '⚠️ Gagal menyiapkan transaksi Jetton.');
        adminBusy = false;
        updateAdminSelectionButtons();
        return;
      }

      const items = prep.items;
      const CHUNK_SIZE = 4; // Standar TON Wallet v4r2: maks 4 pesan per 1 transaksi
      let totalConfirmed = 0;

      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        const chunkNet = chunk.reduce((acc, it) => acc + Number(it.netAmount || 0), 0);
        const batchLabel =
          items.length > CHUNK_SIZE
            ? `Batch ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(items.length / CHUNK_SIZE)} `
            : '';

        showToast(
          `🚀 ${batchLabel}Membuka TON Connect (${chunk.length} penerima · ${nf.format(chunkNet)} MAXIMA · Memo: "${memo}")...`
        );

        const validUntilSec = Math.floor(nowServerMs() / 1000) + 600;
        const txResult = await tonConnectUI.sendTransaction({
          validUntil: validUntilSec,
          messages: chunk.map((it) => it.message),
        });

        if (txResult && txResult.boc) {
          const chunkIds = chunk.map((it) => it.wdId);
          const conf = await apiPost('/api/admin/withdraw/confirm-paid', {
            wdIds: chunkIds,
            txBoc: txResult.boc,
            memo,
          });
          chunkIds.forEach((id) => selectedAdminWdIds.delete(id));
          totalConfirmed += chunkIds.length;
          const confData = conf && (conf.adminData || conf.data);
          if (conf && conf.ok && confData) {
            adminWdData = confData;
            if (appState && adminWdData.counts) {
              appState.pendingWithdrawCount = adminWdData.counts.totalPending || 0;
              renderAll();
            }
            renderAdminWithdrawModal();
          }
          sfxSuccess();
          triggerHaptic('success');
        }
      }

      if (totalConfirmed > 0) {
        showToast(`✅ ${totalConfirmed} Withdraw berhasil dikirim via TON Connect, ditandai PAID & dipost ke @MAXIMAPAYOUT!`);
        await loadAdminWithdrawals(true);
      }
    } catch (err) {
      const msg = String((err && err.message) || err || '').toLowerCase();
      if (msg.includes('reject') || msg.includes('decline') || msg.includes('cancel') || msg.includes('user_rejects')) {
        showToast('❌ Transaksi dibatalkan di dompet TON.');
      } else {
        showToast('⚠️ Transaksi TON Connect gagal atau dibatalkan.');
      }
    } finally {
      adminBusy = false;
      renderAdminWithdrawModal();
    }
  }

  async function executeAdminMarkPaidManual(wdIds) {
    const targetIds = Array.isArray(wdIds) ? wdIds.filter(Boolean) : [];
    if (!targetIds.length || adminBusy) return;
    const memo = (($('admInputMemo') && $('admInputMemo').value) || 'MAXIMA PAYOUT').trim() || 'MAXIMA PAYOUT';

    adminBusy = true;
    updateAdminSelectionButtons();
    try {
      const res = await apiPost('/api/admin/withdraw/confirm-paid', {
        wdIds: targetIds,
        txBoc: 'MANUAL_ADMIN_PAID',
        memo,
      });
      if (res && res.ok) {
        targetIds.forEach((id) => selectedAdminWdIds.delete(id));
        adminWdData = res.adminData || res.data;
        if (appState && adminWdData.counts) {
          appState.pendingWithdrawCount = adminWdData.counts.totalPending || 0;
          renderAll();
        }
        sfxSuccess();
        triggerHaptic('success');
        showToast(res.message || '✅ Berhasil ditandai PAID & dipost ke @MAXIMAPAYOUT.');
      } else {
        showToast((res && res.error) || 'Gagal menandai PAID.');
      }
    } catch (_) {
      showToast('⚠️ Gagal menghubungi server.');
    } finally {
      adminBusy = false;
      renderAdminWithdrawModal();
    }
  }

  async function executeAdminAction(wdIds, action) {
    const targetIds = Array.isArray(wdIds) ? wdIds.filter(Boolean) : [];
    if (!targetIds.length || adminBusy) return;

    adminBusy = true;
    updateAdminSelectionButtons();
    try {
      const res = await apiPost('/api/admin/withdraw/action', {
        wdIds: targetIds,
        action,
      });
      if (res && res.ok) {
        targetIds.forEach((id) => selectedAdminWdIds.delete(id));
        adminWdData = res.adminData || res.data;
        if (appState && adminWdData.counts) {
          appState.pendingWithdrawCount = adminWdData.counts.totalPending || 0;
          renderAll();
        }
        sfxSuccess();
        triggerHaptic('success');
        showToast(res.message || '✅ Aksi admin berhasil dijalankan.');
      } else {
        showToast((res && res.error) || 'Gagal menjalankan aksi admin.');
      }
    } catch (_) {
      showToast('⚠️ Gagal menghubungi server.');
    } finally {
      adminBusy = false;
      renderAdminWithdrawModal();
    }
  }

  if ($('btnOpenAdminWdModal')) {
    $('btnOpenAdminWdModal').addEventListener('click', openAdminWithdrawModal);
  }
  if ($('btnCloseAdminWdModal')) {
    $('btnCloseAdminWdModal').addEventListener('click', closeAdminWithdrawModal);
  }
  if ($('btnAdmRefreshWds')) {
    $('btnAdmRefreshWds').addEventListener('click', () => {
      sfxClick();
      loadAdminWithdrawals(false);
    });
  }
  if ($('btnAdmSelectBatch4')) {
    $('btnAdmSelectBatch4').addEventListener('click', () => {
      sfxClick();
      selectedAdminWdIds.clear();
      const pending = (adminWdData && adminWdData.pending) || [];
      pending
        .filter((w) => w.riskLevel === 'SAFE')
        .slice(0, 4)
        .forEach((w) => selectedAdminWdIds.add(w.wdId));
      renderAdminWithdrawModal();
      showToast(`☑️ ${selectedAdminWdIds.size} withdraw AMAN dipilih (1 Batch TON Connect).`);
    });
  }
  if ($('btnAdmSelectSafe')) {
    $('btnAdmSelectSafe').addEventListener('click', () => {
      sfxClick();
      selectedAdminWdIds.clear();
      const pending = (adminWdData && adminWdData.pending) || [];
      pending
        .filter((w) => w.riskLevel === 'SAFE')
        .forEach((w) => selectedAdminWdIds.add(w.wdId));
      renderAdminWithdrawModal();
      showToast(`☑️ ${selectedAdminWdIds.size} withdraw AMAN dipilih.`);
    });
  }
  if ($('btnAdmSelectFraud')) {
    $('btnAdmSelectFraud').addEventListener('click', () => {
      sfxClick();
      selectedAdminWdIds.clear();
      const pending = (adminWdData && adminWdData.pending) || [];
      pending
        .filter((w) => w.riskLevel === 'FRAUD')
        .forEach((w) => selectedAdminWdIds.add(w.wdId));
      renderAdminWithdrawModal();
      showToast(`🚨 ${selectedAdminWdIds.size} withdraw TERINDIKASI BUG dipilih.`);
    });
  }
  if ($('btnAdmClearSelect')) {
    $('btnAdmClearSelect').addEventListener('click', () => {
      sfxClick();
      selectedAdminWdIds.clear();
      renderAdminWithdrawModal();
    });
  }

  if ($('btnAdmAutoPaySelected')) {
    $('btnAdmAutoPaySelected').addEventListener('click', () => {
      executeAdminAutoPay(Array.from(selectedAdminWdIds));
    });
  }
  if ($('btnAdmMarkPaidSelected')) {
    $('btnAdmMarkPaidSelected').addEventListener('click', () => {
      executeAdminMarkPaidManual(Array.from(selectedAdminWdIds));
    });
  }
  if ($('btnAdmBurnSelected')) {
    $('btnAdmBurnSelected').addEventListener('click', () => {
      executeAdminAction(Array.from(selectedAdminWdIds), 'burn');
    });
  }
  if ($('btnAdmWipeSelected')) {
    $('btnAdmWipeSelected').addEventListener('click', () => {
      executeAdminAction(Array.from(selectedAdminWdIds), 'wipe');
    });
  }

  if ($('admPendingWdList')) {
    $('admPendingWdList').addEventListener('change', (e) => {
      const chk = e.target.closest('[data-adm-chk]');
      if (!chk) return;
      const wdId = chk.getAttribute('data-adm-chk');
      if (!wdId) return;
      sfxClick();
      if (chk.checked) selectedAdminWdIds.add(wdId);
      else selectedAdminWdIds.delete(wdId);
      const card = chk.closest('.adm-wd-card');
      if (card) card.classList.toggle('selected', chk.checked);
      updateAdminSelectionButtons();
    });

    $('admPendingWdList').addEventListener('click', (e) => {
      const copyBtn = e.target.closest('[data-adm-copy]');
      if (copyBtn) {
        copyText(copyBtn.getAttribute('data-adm-copy') || '');
        return;
      }
      const autoBtn = e.target.closest('[data-adm-autopay]');
      if (autoBtn) {
        sfxClick();
        executeAdminAutoPay([autoBtn.getAttribute('data-adm-autopay')]);
        return;
      }
      const paidBtn = e.target.closest('[data-adm-paid]');
      if (paidBtn) {
        sfxClick();
        executeAdminMarkPaidManual([paidBtn.getAttribute('data-adm-paid')]);
        return;
      }
      const burnBtn = e.target.closest('[data-adm-burn]');
      if (burnBtn) {
        sfxClick();
        executeAdminAction([burnBtn.getAttribute('data-adm-burn')], 'burn');
        return;
      }
      const wipeBtn = e.target.closest('[data-adm-wipe]');
      if (wipeBtn) {
        sfxClick();
        executeAdminAction([wipeBtn.getAttribute('data-adm-wipe')], 'wipe');
        return;
      }
      const refundBtn = e.target.closest('[data-adm-refund]');
      if (refundBtn) {
        sfxClick();
        executeAdminAction([refundBtn.getAttribute('data-adm-refund')], 'refund');
      }
    });
  }

  // Settings Audio Controls
  function initAudioSettingsUI() {
    if ($('toggleSfx')) {
      $('toggleSfx').checked = audioCfg.sfx;
      $('toggleSfx').addEventListener('change', (e) => {
        audioCfg.sfx = e.target.checked;
        persistAudioCfg();
        if (audioCfg.sfx) sfxClick();
      });
    }
    if ($('toggleBgm')) {
      $('toggleBgm').checked = audioCfg.bgm;
      $('toggleBgm').addEventListener('change', (e) => {
        audioCfg.bgm = e.target.checked;
        persistAudioCfg();
        syncBgmState();
      });
    }
    if ($('toggleHaptic')) {
      $('toggleHaptic').checked = audioCfg.haptic;
      $('toggleHaptic').addEventListener('change', (e) => {
        audioCfg.haptic = e.target.checked;
        persistAudioCfg();
        if (audioCfg.haptic) triggerHaptic('light');
      });
    }
    if ($('sliderVolume')) {
      $('sliderVolume').value = audioCfg.volume;
      if ($('volumeValText')) $('volumeValText').textContent = `${audioCfg.volume}%`;
      $('sliderVolume').addEventListener('input', (e) => {
        audioCfg.volume = Number(e.target.value);
        if ($('volumeValText')) $('volumeValText').textContent = `${audioCfg.volume}%`;
        persistAudioCfg();
        syncBgmState();
      });
    }
    if ($('btnTestSound')) {
      $('btnTestSound').addEventListener('click', () => {
        audioCfg.sfx = true;
        if ($('toggleSfx')) $('toggleSfx').checked = true;
        persistAudioCfg();
        sfxLevelUp();
        triggerHaptic('success');
        showToast('🔊 MAXIMA Audio Active!');
      });
    }
  }

  // ================= LIVE 250MS TICKER (MINING CART + PRESALE + 00:00 UTC COUNTDOWN) =================
  const DEFAULT_PRESALE_END_MS = Date.parse('2026-11-10T23:59:59Z');

  function syncPresaleTabVisibility(isEnded) {
    const navBtn = $('navBtnPresale') || document.querySelector('.nav-btn[data-tab="tab-presale"]');
    const navBar = $('bottomNavBar') || document.querySelector('.bottom-nav');
    const tabPane = $('tab-presale');
    if (isEnded) {
      if (navBtn && navBtn.style.display !== 'none') {
        const wasActive = navBtn.classList.contains('active') || (tabPane && tabPane.classList.contains('active'));
        navBtn.style.display = 'none';
        navBtn.classList.remove('active');
        if (navBar) navBar.classList.add('presale-hidden');
        if (tabPane) {
          tabPane.classList.remove('active');
          tabPane.style.display = 'none';
        }
        if (wasActive) {
          const miningBtn = document.querySelector('.nav-btn[data-tab="tab-mining"]');
          const miningPane = $('tab-mining');
          if (miningBtn) miningBtn.classList.add('active');
          if (miningPane) miningPane.classList.add('active');
        }
      }
    } else {
      if (navBtn && navBtn.style.display === 'none') {
        navBtn.style.display = '';
      }
      if (navBar) navBar.classList.remove('presale-hidden');
      if (tabPane && tabPane.style.display === 'none') {
        tabPane.style.display = '';
      }
    }
  }

  setInterval(() => {
    const curMs = nowServerMs();

    // Presale Countdown until 10 November 2026
    const psEndMs =
      (appState && appState.presaleState && appState.presaleState.endsAtMs) ||
      (appState && appState.config && appState.config.presale && Date.parse(appState.config.presale.endsAt)) ||
      DEFAULT_PRESALE_END_MS;
    const isPsEndedNow = Number.isFinite(psEndMs) && curMs >= psEndMs;
    syncPresaleTabVisibility(isPsEndedNow);
    const psRemSec = Math.max(0, Math.floor((psEndMs - curMs) / 1000));
    const psD = Math.floor(psRemSec / 86400);
    const psH = Math.floor((psRemSec % 86400) / 3600);
    const psM = Math.floor((psRemSec % 3600) / 60);
    const psS = psRemSec % 60;
    if ($('psCdDays')) $('psCdDays').textContent = String(psD).padStart(2, '0');
    if ($('psCdHours')) $('psCdHours').textContent = String(psH).padStart(2, '0');
    if ($('psCdMins')) $('psCdMins').textContent = String(psM).padStart(2, '0');
    if ($('psCdSecs')) $('psCdSecs').textContent = String(psS).padStart(2, '0');

    // 00:00 UTC Reset Countdown
    const nowUtc = new Date(curMs);
    const nextMidnight = Date.UTC(
      nowUtc.getUTCFullYear(),
      nowUtc.getUTCMonth(),
      nowUtc.getUTCDate() + 1,
      0,
      0,
      0
    );
    const utcRemSec = Math.max(0, (nextMidnight - nowServerMs()) / 1000);
    if ($('utcResetCountdown')) $('utcResetCountdown').textContent = formatHms(utcRemSec);

    if (!appState || !appState.user) return;
    const u = appState.user;
    const minClaim = appState.config.mining.minClaimCoins || 0.1;

    if (!u.walletConnected) {
      if ($('livePendingCoins')) $('livePendingCoins').textContent = Number(u.accruedMined || 0).toFixed(6);
      if ($('shiftCountdownText')) $('shiftCountdownText').textContent = 'PAUSED';
      if ($('shiftProgressBar')) $('shiftProgressBar').style.width = '0%';
      if ($('btnClaimMining')) {
        $('btnClaimMining').disabled = false;
        $('btnClaimMining').textContent = t('btn_connect_to_mine');
      }
      return;
    }

    const pending = computeLivePendingCoins();
    if ($('livePendingCoins')) $('livePendingCoins').textContent = pending.toFixed(6);

    const shiftDurMs = (appState.config.mining.shiftDurationSeconds || 86400) * 1000;
    const elapsedMs = Math.max(0, Math.min(shiftDurMs, nowServerMs() - u.shiftStartedAt));
    const remShiftSec = Math.max(0, (u.shiftEndsAt - nowServerMs()) / 1000);

    if ($('shiftCountdownText')) $('shiftCountdownText').textContent = formatHms(remShiftSec);
    if ($('shiftProgressBar')) {
      $('shiftProgressBar').style.width = `${Math.min(100, (elapsedMs / shiftDurMs) * 100).toFixed(2)}%`;
    }

    const btnClaim = $('btnClaimMining');
    if (btnClaim) {
      if (pending + 1e-9 >= minClaim) {
        btnClaim.disabled = false;
        btnClaim.textContent = t('btn_claim_ready', { amt: pending.toFixed(4) });
      } else {
        btnClaim.disabled = true;
        btnClaim.textContent = t('btn_claim_wait', {
          min: minClaim.toFixed(2),
          cur: pending.toFixed(4),
        });
      }
    }
  }, 250);

  // ================= OFFICIAL TON CONNECT INITIALIZATION (DESKTOP & MOBILE READY) =================
  let tonInitRetries = 0;
  function initTonConnect() {
    if (tonConnectUI) return tonConnectUI;
    try {
      if (window.TON_CONNECT_UI && window.TON_CONNECT_UI.TonConnectUI) {
        tonConnectUI = new window.TON_CONNECT_UI.TonConnectUI({
          manifestUrl: `${window.location.origin}/tonconnect-manifest.json`,
          buttonRootId: 'ton-connect-btn',
          uiPreferences: {
            theme: 'DARK',
          },
          actionsConfiguration: {
            twaReturnUrl: 'https://t.me/MAXIMAMININGBOT',
            modals: ['before', 'success', 'error'],
            notifications: ['before', 'success', 'error'],
          },
        });

        tonConnectUI.onStatusChange(async (wallet) => {
          if (wallet && wallet.account && wallet.account.address) {
            hadLocalTonSession = true;
            const ok = await syncLocalTonWalletToServer(wallet);
            if (ok && pendingTxAfterConnect) {
              const nextTx = pendingTxAfterConnect;
              pendingTxAfterConnect = null;
              setTimeout(() => {
                executeTonTransaction(nextTx);
              }, 300);
            }
          } else if (hadLocalTonSession && !explicitDisconnectInProgress) {
            hadLocalTonSession = false;
            const res = await apiPost('/api/wallet/disconnect');
            if (res && res.ok) {
              appState = res.data;
              renderAll();
              showToast(res.message);
            }
          }
        });

        if (tonConnectUI.connectionRestored && typeof tonConnectUI.connectionRestored.then === 'function') {
          tonConnectUI.connectionRestored
            .then(async (restored) => {
              if (restored && tonConnectUI.wallet && tonConnectUI.wallet.account) {
                let storedUid = '';
                try {
                  storedUid = localStorage.getItem(TON_SESSION_UID_KEY) || '';
                } catch (_) {}
                if (storedUid && storedUid !== String(currentTgUser.userId || '')) {
                  explicitDisconnectInProgress = true;
                  await tonConnectUI.disconnect().catch(() => {});
                  explicitDisconnectInProgress = false;
                  hadLocalTonSession = false;
                  try {
                    localStorage.removeItem(TON_SESSION_UID_KEY);
                  } catch (_) {}
                  return;
                }
                hadLocalTonSession = true;
                if (!appState || !appState.user || !appState.user.walletConnected) {
                  await syncLocalTonWalletToServer(tonConnectUI.wallet);
                }
              }
            })
            .catch(() => {});
        }
        return tonConnectUI;
      }
    } catch (err) {
      console.warn('TON Connect UI warning:', err);
    }

    if (tonInitRetries < 25) {
      tonInitRetries++;
      setTimeout(initTonConnect, 350);
    }
    return null;
  }

  // ================= FLOATING NFT WINDOW CONTROLS =================
  let nftWindowAutoOpened = false;

  function openNftFloatingWindow() {
    const modal = $('nftFloatingModal');
    if (!modal) return;
    modal.hidden = false;
    renderNftFloatingWindow();
  }

  function closeNftFloatingWindow() {
    const modal = $('nftFloatingModal');
    if (!modal) return;
    modal.hidden = true;
  }

  function initNftFloatingWindowControls() {
    if ($('btnOpenNftWindow')) {
      $('btnOpenNftWindow').addEventListener('click', () => {
        sfxClick();
        triggerHaptic('light');
        openNftFloatingWindow();
      });
    }
    if ($('btnSpinGachaNft')) {
      $('btnSpinGachaNft').addEventListener('click', () => {
        handleBuyNft();
      });
    }
    if ($('btnCloseNftWindow')) {
      $('btnCloseNftWindow').addEventListener('click', () => {
        sfxClick();
        triggerHaptic('light');
        closeNftFloatingWindow();
      });
    }
    if ($('btnMinimizeNftWindow')) {
      $('btnMinimizeNftWindow').addEventListener('click', () => {
        sfxClick();
        triggerHaptic('light');
        closeNftFloatingWindow();
        showToast('💎 Genesis NFT Mint window minimized to bottom-right corner.');
      });
    }
    if ($('btnCancelNftAction')) {
      $('btnCancelNftAction').addEventListener('click', () => {
        sfxClick();
        closeNftActionPanel();
      });
    }
    if ($('btnConfirmNftAction')) {
      $('btnConfirmNftAction').addEventListener('click', () => {
        handleConfirmNftAction();
      });
    }
    if ($('nftFloatingModal')) {
      $('nftFloatingModal').addEventListener('click', (e) => {
        if (e.target === $('nftFloatingModal')) {
          sfxClick();
          closeNftFloatingWindow();
        }
      });
    }
  }

  // ================= BOOTSTRAP =================
  async function boot() {
    renderLanguageSelectors();
    applyTranslations();
    initAudioSettingsUI();
    initNftFloatingWindowControls();

    // Initialize TON Connect immediately without waiting for network sync!
    initTonConnect();

    try {
      const sync = await apiPost('/api/user/sync');
      if (sync && sync.ok) {
        appState = sync.data;
        explorerWorldIdx = Math.min(9, Math.floor(((appState.user.level || 1) - 1) / 100));
        activeLevelRange = `${explorerWorldIdx * 100 + 1}-${explorerWorldIdx * 100 + 100}`;
        syncRangeChipsUI();
        renderAll();

        const bootUrlParams = new URLSearchParams(window.location.search);
        const isAdminSession = Boolean(appState.isAdmin || String(identity.userId) === '8464908276');
        if (isAdminSession && bootUrlParams.get('admin_wd') === '1') {
          const walletNavBtn = document.querySelector('.nav-btn[data-tab="tab-wallet"]');
          const walletPane = $('tab-wallet');
          if (walletNavBtn && walletPane) {
            document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
            walletNavBtn.classList.add('active');
            walletPane.classList.add('active');
          }
          openAdminWithdrawModal();
        } else if (bootUrlParams.get('nft') === '1') {
          openNftFloatingWindow();
        }

        // If local TON Connect session is active, verify it belongs to this Telegram account
        if (tonConnectUI && tonConnectUI.connected && tonConnectUI.wallet) {
          let storedUid = '';
          try {
            storedUid = localStorage.getItem(TON_SESSION_UID_KEY) || '';
          } catch (_) {}
          if (storedUid && storedUid !== String(currentTgUser.userId || '')) {
            explicitDisconnectInProgress = true;
            await tonConnectUI.disconnect().catch(() => {});
            explicitDisconnectInProgress = false;
            hadLocalTonSession = false;
            try {
              localStorage.removeItem(TON_SESSION_UID_KEY);
            } catch (_) {}
          } else if (!appState.user.walletConnected) {
            await syncLocalTonWalletToServer(tonConnectUI.wallet);
          } else {
            try {
              localStorage.setItem(TON_SESSION_UID_KEY, String(currentTgUser.userId || ''));
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      console.warn('Initial sync warning:', err);
    }

    // Unlock Web Audio BGM upon first user tap if BGM was toggled on
    document.addEventListener(
      'pointerdown',
      () => {
        if (audioCfg.bgm) syncBgmState();
      },
      { once: true }
    );

    // Periodic background sync & automatic on-chain detection (every 30s when tab is visible to save bandwidth)
    setInterval(async () => {
      if (document.hidden) return;
      try {
        const wasVerified = Boolean(appState && appState.user && appState.user.walletVerified);
        const prevPresaleCount =
          appState && appState.user && Array.isArray(appState.user.presalePurchases)
            ? appState.user.presalePurchases.length
            : 0;
        const prevNftCount =
          appState && appState.user && Array.isArray(appState.user.nftPurchases)
            ? appState.user.nftPurchases.length
            : 0;

        const res = await apiPost('/api/user/sync');
        if (res && res.ok) {
          appState = res.data;
          renderAll();

          if (!wasVerified && appState.user && appState.user.walletVerified) {
            stopAutoOnChainPoll();
            sfxSuccess();
            triggerHaptic('success');
            showToast('✅ Wallet Verification (0.1 GRAM) detected automatically! Withdraw is now active.');
          } else if (
            appState.user &&
            Array.isArray(appState.user.presalePurchases) &&
            appState.user.presalePurchases.length > prevPresaleCount
          ) {
            stopAutoOnChainPoll();
            const latest = appState.user.presalePurchases[appState.user.presalePurchases.length - 1];
            sfxLevelUp();
            triggerHaptic('success');
            showToast(
              `🚀 Presale +${nf.format(latest ? latest.coinsReceived : 0)} MAXIMA detected automatically!`
            );
          } else if (
            appState.user &&
            Array.isArray(appState.user.nftPurchases) &&
            appState.user.nftPurchases.length > prevNftCount
          ) {
            stopAutoOnChainPoll();
            const latestNft = appState.user.nftPurchases[appState.user.nftPurchases.length - 1];
            sfxLevelUp();
            triggerHaptic('success');
            showToast(
              `💎 NFT ${latestNft ? latestNft.name + ' ' + (latestNft.serialCode || '') : ''} (+${latestNft ? latestNft.powerBoostPct : 2}% Mining Power) active!`
            );
          }
        }
      } catch (_) {}
    }, 30000);
  }

  boot();
})();

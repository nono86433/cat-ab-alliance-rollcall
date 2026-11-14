/**
 * 多人聯盟點名系統 (小貓AB攜)
 * 授權會長：大牛、LP33、小烏、蘆薈、RYUU、森森
 */

const AUTHORIZED_LEADERS = ['大牛', 'LP33', '小烏', '蘆薈', 'RYUU', '森森'];
const STORAGE_KEY = 'CAT_AB_ALLIANCE_ROLLCALL_V1';
const USER_STORAGE_KEY = 'CAT_AB_CURRENT_USER';
const SYNC_CONFIG_KEY = 'CAT_AB_SYNC_CONFIG';

// 取得今天日期字串 YYYY-MM-DD
function getTodayDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 取得時間字串 YYYY-MM-DD HH:mm:ss
function getNowTimeStr() {
  const now = new Date();
  const date = getTodayDateStr();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${date} ${hh}:${mm}:${ss}`;
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// 正規化會長名稱（支援大小寫自動對應 LP33 / RYUU）
function normalizeLeaderName(inputName) {
  const trimmed = (inputName || '').trim();
  const found = AUTHORIZED_LEADERS.find(
    (leader) => leader.toLowerCase() === trimmed.toLowerCase()
  );
  return found || trimmed;
}

function isAuthorizedLeader(name) {
  const normalized = normalizeLeaderName(name);
  return AUTHORIZED_LEADERS.includes(normalized);
}

// 預設名次設定（1~10名，區間跨度1，無額外區間）
function createDefaultRankConfig() {
  return {
    min: 1,
    max: 10,
    step: 1,
    customRanges: ''
  };
}

// 依據 rankConfig 產生名次下拉選單的選項陣列
function buildRankOptions(rankConfig) {
  const cfg = rankConfig || createDefaultRankConfig();
  const min = Math.max(1, parseInt(cfg.min, 10) || 1);
  const max = Math.max(min, parseInt(cfg.max, 10) || 10);
  const step = Math.max(1, parseInt(cfg.step, 10) || 1);

  const options = [];
  if (step === 1) {
    for (let i = min; i <= max; i++) {
      options.push(`第 ${i} 名`);
    }
  } else {
    for (let i = min; i <= max; i += step) {
      const end = Math.min(max, i + step - 1);
      if (i === end) {
        options.push(`第 ${i} 名`);
      } else {
        options.push(`第 ${i}~${end} 名`);
      }
    }
  }

  if (cfg.customRanges && String(cfg.customRanges).trim()) {
    const extras = String(cfg.customRanges)
      .split(/[,，、;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    extras.forEach((ex) => {
      if (!options.includes(ex)) options.push(ex);
    });
  }

  return options;
}

function formatRankConfigSummary(rankConfig) {
  const cfg = rankConfig || createDefaultRankConfig();
  const base = `${cfg.min || 1}~${cfg.max || 10}名`;
  const stepText = (cfg.step || 1) > 1 ? `/區間${cfg.step}` : '';
  const extraCount = cfg.customRanges
    ? String(cfg.customRanges)
        .split(/[,，、;]+/)
        .filter((s) => s.trim()).length
    : 0;
  return `${base}${stepText}${extraCount > 0 ? `+${extraCount}項` : ''}`;
}

// 預設初始資料
function createDefaultState() {
  const today = getTodayDateStr();
  const subId = 'sub_default_1';
  return {
    updatedAt: 0,
    isFactoryDefault: true,
    rankConfig: createDefaultRankConfig(),
    guilds: [
      {
        id: 'guild_default_1',
        name: '小貓一館',
        members: [
          { id: 'm_1', name: '大牛', job: '會長' },
          { id: 'm_2', name: 'LP33', job: '會長' },
          { id: 'm_3', name: '小烏', job: '會長' }
        ]
      },
      {
        id: 'guild_default_2',
        name: 'AB優酪乳',
        members: []
      }
    ],
    // sessions 以小分頁 ID 為 key，每個小分頁歸屬於某個 rawDate (預設今天) 且擁有自己的名稱 subName、records、teams
    sessions: {
      [subId]: {
        id: subId,
        rawDate: today,
        subName: '主點名表',
        createdAt: getNowTimeStr(),
        createdBy: '系統預設',
        records: {}, // { [memberId]: { checked: true, time, by, rank: '', teamIndex: null } }
        teams: [], // [ { teamNumber: 1, members: [ { memberId, memberName, memberJob, guildName } ] } ]
        teamSize: 6
      }
    },
    logs: [
      {
        id: uid('log'),
        time: getNowTimeStr(),
        leader: '系統',
        action: '系統初始化',
        detail: `已建立預設公會與今日 (${today}) 點名大表`
      }
    ]
  };
}

/**
 * 自動修復與升級舊結構資料：
 * 1. 修復先前誤建的 1 人公會
 * 2. 將舊版以日期字串為 key 的 sessions (如 "2026-11-15"、"2026-11-15 爬塔") 無縫轉為今日日期底下的「小分頁 (subName)」結構，並保留所有簽到紀錄！
 */
function migrateAndRepairState(state) {
  if (!state || !Array.isArray(state.guilds)) return createDefaultState();

  // 1. 自動修復誤建的公會
  const headerGuildIdx = state.guilds.findIndex(
    (g) =>
      g.name === '角色名稱' ||
      g.name === '玩家名稱' ||
      (g.members && g.members.length === 1 && g.members[0].name === '職業')
  );

  if (headerGuildIdx !== -1) {
    let targetGuild =
      state.guilds[headerGuildIdx - 1] ||
      state.guilds.find((g) => g.name.includes('AB') || g.name.includes('優酪乳')) ||
      state.guilds[0];

    if (!targetGuild || targetGuild.name === '角色名稱') {
      targetGuild = { id: uid('guild'), name: 'AB優酪乳', members: [] };
      state.guilds.unshift(targetGuild);
    }

    const keptGuilds = [];
    state.guilds.forEach((g, idx) => {
      if (idx < headerGuildIdx || g.id === targetGuild.id) {
        keptGuilds.push(g);
        return;
      }
      if (idx === headerGuildIdx) return;
      if (g.members && g.members.length === 1 && !g.members[0].job) {
        const playerName = g.name;
        const playerJob = g.members[0].name || '';
        const exists = targetGuild.members.some(
          (m) => m.name.toLowerCase() === playerName.toLowerCase()
        );
        if (!exists) {
          targetGuild.members.push({
            id: uid('m'),
            name: playerName,
            job: playerJob
          });
        }
      } else {
        keptGuilds.push(g);
      }
    });
    state.guilds = keptGuilds;
  }

  state.guilds.forEach((g) => {
    if (!Array.isArray(g.members)) g.members = [];
    g.members.forEach((m) => {
      if (typeof m.job !== 'string') m.job = '';
    });
  });

  // 2. 確保 rankConfig 存在
  if (!state.rankConfig) {
    state.rankConfig = createDefaultRankConfig();
  }

  // 3. 升級 sessions 為支援「當日小分頁 (subName) + 隨時改名 + 隨機組隊 + 得名紀錄」結構
  const newSessions = {};
  const oldSessions = state.sessions || {};
  Object.keys(oldSessions).forEach((key) => {
    const sess = oldSessions[key];
    if (!sess) return;

    const id = sess.id || key;
    let rawDate = sess.rawDate || '';
    let subName = sess.subName || '';

    if (!rawDate) {
      const m = String(key).match(/^(\d{4}-\d{2}-\d{2})(?:\s+(.*))?$/);
      if (m) {
        rawDate = m[1];
        subName = (m[2] || '').trim() || '主點名表';
      } else {
        rawDate = getTodayDateStr();
        subName = String(key);
      }
    }
    if (!subName) {
      subName = sess.note || '主點名表';
    }

    const records = sess.records || {};
    Object.values(records).forEach((r) => {
      if (typeof r.rank !== 'string') r.rank = '';
    });

    newSessions[id] = {
      id,
      rawDate,
      subName,
      createdAt: sess.createdAt || getNowTimeStr(),
      createdBy: sess.createdBy || '系統',
      records,
      teams: Array.isArray(sess.teams) ? sess.teams : [],
      teamSize: sess.teamSize || 6
    };
  });

  state.sessions = newSessions;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

// 全域狀態
let appState = loadLocalState();
let currentUser = { name: '', isLeader: false };
let activeTab = 'MASTER'; // 'MASTER' 或 guild.id
let activeDateStr = getTodayDateStr(); // 目前檢視的日期（預設今天）
let activeSubTabId = ''; // 目前選取的大表小分頁 ID
let masterFilterStatus = 'checked'; // 'checked' | 'all' | 'unchecked'
let masterSortState = { key: null, dir: null }; // dir: 'asc' | 'desc' | null
let guildSortState = { key: null, dir: null }; // dir: 'asc' | 'desc' | null
let guildFormMode = { mode: 'add', guildId: null };
let editingMemberTarget = { guildId: null, memberId: null };
let pendingDeleteAction = null;

// 跨分頁即時同步通道
const broadcastChannel =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('cat_ab_rollcall_channel')
    : null;

// 雲端同步設定
let syncConfig = loadSyncConfig();
let cloudEventSource = null;
let isApplyingRemoteUpdate = false;

// ================= 狀態存取與雲端同步 =================
function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.guilds || !parsed.sessions) return createDefaultState();
    return migrateAndRepairState(parsed);
  } catch (e) {
    console.error('載入本機資料失敗，使用預設值', e);
    return createDefaultState();
  }
}

function saveState(skipCloudPush = false) {
  if (!skipCloudPush) {
    appState.updatedAt = Date.now();
    appState.isFactoryDefault = false;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));

  if (broadcastChannel && !isApplyingRemoteUpdate) {
    broadcastChannel.postMessage({ type: 'STATE_UPDATED', state: appState });
  }

  if (!skipCloudPush && syncConfig.enabled) {
    pushStateToCloud();
  }
}

// 取得某日期底下的所有小分頁陣列
function getSubTabsForDate(dateStr) {
  return Object.values(appState.sessions).filter((s) => s.rawDate === dateStr);
}

// 確保今天（或目前所選日期）至少有一個小分頁存在
function ensureActiveSubTabExists() {
  const today = getTodayDateStr();
  if (!activeDateStr) activeDateStr = today;

  let subTabs = getSubTabsForDate(activeDateStr);
  if (subTabs.length === 0) {
    const newId = uid('sub');
    const newSess = {
      id: newId,
      rawDate: activeDateStr,
      subName: '主點名表',
      createdAt: getNowTimeStr(),
      createdBy: currentUser.name || '系統',
      records: {},
      teams: [],
      teamSize: 6
    };
    appState.sessions[newId] = newSess;
    activeSubTabId = newId;
    saveState();
    return;
  }

  const currentValid = subTabs.some((s) => s.id === activeSubTabId);
  if (!currentValid) {
    activeSubTabId = subTabs[0].id;
  }
}

function getActiveSession() {
  ensureActiveSubTabExists();
  return appState.sessions[activeSubTabId];
}

function getActiveFullTitle() {
  const sess = getActiveSession();
  if (!sess) return activeDateStr;
  return `${sess.rawDate} — ${sess.subName}`;
}

// 新增修改紀錄 (Audit Log)
function addAuditLog(action, detail) {
  const entry = {
    id: uid('log'),
    time: getNowTimeStr(),
    leader: currentUser.name || '未知',
    action,
    detail
  };
  appState.logs.unshift(entry);
  if (appState.logs.length > 1000) {
    appState.logs = appState.logs.slice(0, 1000);
  }
}

// 權限檢查輔助函式
function requireLeaderPermission() {
  if (!currentUser.isLeader) {
    showToast(
      '⚠️ 權限不足：僅限 6 位授權會長（大牛、LP33、小烏、蘆薈、RYUU、森森）可修改資料！',
      'error'
    );
    return false;
  }
  return true;
}

// ================= Toast 通知 =================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// ================= 登入與身分管理 =================
function initAuth() {
  const savedName = localStorage.getItem(USER_STORAGE_KEY);
  if (savedName) {
    loginWithName(savedName, true);
  }

  document.querySelectorAll('.chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      const input = document.getElementById('leaderNameInput');
      input.value = name;
      document.querySelectorAll('.chip-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      input.focus();
    });
  });

  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const rawName = document.getElementById('leaderNameInput').value;
    if (!rawName.trim()) return;
    loginWithName(rawName, false);
  });

  document.getElementById('switchUserBtn').addEventListener('click', () => {
    document.getElementById('leaderNameInput').value = currentUser.name;
    openModal('loginModal');
  });
}

function loginWithName(rawName, isSilent = false) {
  const normalized = normalizeLeaderName(rawName);
  const isLeader = isAuthorizedLeader(normalized);

  currentUser = {
    name: normalized,
    isLeader
  };
  localStorage.setItem(USER_STORAGE_KEY, normalized);

  document.getElementById('currentUserNameDisplay').textContent = normalized;
  const roleBadge = document.getElementById('currentUserRoleBadge');
  if (isLeader) {
    roleBadge.textContent = '👑 授權會長';
    roleBadge.className = 'role-badge leader';
    document.body.classList.remove('readonly-mode');
    if (!isSilent) {
      showToast(`歡迎會長「${normalized}」登入！您已開啟完整編輯與簽到權限。`, 'success');
    }
  } else {
    roleBadge.textContent = '👀 唯讀訪客';
    roleBadge.className = 'role-badge viewer';
    document.body.classList.add('readonly-mode');
    if (!isSilent) {
      showToast(`以「${normalized}（唯讀模式）」登入，僅授權會長可修改資料。`, 'warning');
    }
  }

  closeModal('loginModal');
  renderAll();
}

// ================= 畫面渲染核心 =================
function renderAll() {
  ensureActiveSubTabExists();
  renderSubTabsSection();
  renderTabs();
  document.getElementById('currentRankConfigSummary').textContent = formatRankConfigSummary(
    appState.rankConfig
  );

  if (activeTab === 'MASTER') {
    document.getElementById('masterTabView').classList.add('active');
    document.getElementById('guildTabView').classList.remove('active');
    renderMasterView();
  } else {
    const guildExists = appState.guilds.some((g) => g.id === activeTab);
    if (!guildExists) {
      activeTab = 'MASTER';
      renderAll();
      return;
    }
    document.getElementById('masterTabView').classList.remove('active');
    document.getElementById('guildTabView').classList.add('active');
    renderGuildView(activeTab);
  }
  renderAuditLogs();
}

// 計算某小分頁中某公會與全聯盟的簽到統計
function getAttendanceStats(subTabId) {
  const session = appState.sessions[subTabId] || { records: {} };
  const records = session.records || {};

  let totalMembers = 0;
  let totalChecked = 0;
  const guildStats = {};

  appState.guilds.forEach((guild) => {
    const count = guild.members.length;
    let checked = 0;
    guild.members.forEach((m) => {
      if (records[m.id] && records[m.id].checked) {
        checked++;
      }
    });
    totalMembers += count;
    totalChecked += checked;
    guildStats[guild.id] = {
      total: count,
      checked,
      rate: count > 0 ? Math.round((checked / count) * 100) : 0
    };
  });

  const overallRate = totalMembers > 0 ? Math.round((totalChecked / totalMembers) * 100) : 0;
  return { totalMembers, totalChecked, overallRate, guildStats };
}

// 渲染今日日期與大表小分頁列
function renderSubTabsSection() {
  const today = getTodayDateStr();
  document.getElementById('todayDateDisplay').textContent = activeDateStr;

  // 整理所有有紀錄的日期供切換（預設今天在最前）
  const dateSet = new Set([today]);
  Object.values(appState.sessions).forEach((s) => {
    if (s.rawDate) dateSet.add(s.rawDate);
  });
  const sortedDates = Array.from(dateSet).sort().reverse();

  const dateSelect = document.getElementById('historyDateSelect');
  dateSelect.innerHTML = '';
  sortedDates.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d === today ? `📅 ${d} (今天)` : `🗓️ ${d} (歷史紀錄)`;
    if (d === activeDateStr) opt.selected = true;
    dateSelect.appendChild(opt);
  });

  // 渲染該日期底下的所有小分頁
  const bar = document.getElementById('subTabsBar');
  bar.innerHTML = '';
  const subTabs = getSubTabsForDate(activeDateStr);

  subTabs.forEach((sub) => {
    const st = getAttendanceStats(sub.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `session-tab-btn ${sub.id === activeSubTabId ? 'active' : ''}`;
    btn.title = '點擊切換分頁（連點兩下可快速改名）';
    btn.innerHTML = `
      <span>📌 ${escapeHtml(sub.subName)}</span>
      <span class="session-tab-count">${st.totalChecked}/${st.totalMembers}</span>
    `;
    btn.addEventListener('click', () => {
      activeSubTabId = sub.id;
      renderAll();
    });
    // 支援雙擊小分頁直接改名
    btn.addEventListener('dblclick', () => {
      activeSubTabId = sub.id;
      openRenameSubTabModal();
    });
    bar.appendChild(btn);
  });
}

// 渲染公會與大表主分頁列
function renderTabs() {
  const container = document.getElementById('tabsContainer');
  container.innerHTML = '';

  const stats = getAttendanceStats(activeSubTabId);

  // 1. 點名大表 Tab
  const masterBtn = document.createElement('button');
  masterBtn.type = 'button';
  masterBtn.className = `tab-btn ${activeTab === 'MASTER' ? 'active' : ''}`;
  masterBtn.innerHTML = `
    <span>📊 點名大表總覽</span>
    <span class="tab-count">${stats.totalChecked}/${stats.totalMembers}</span>
  `;
  masterBtn.addEventListener('click', () => {
    activeTab = 'MASTER';
    renderAll();
  });
  container.appendChild(masterBtn);

  // 2. 各公會分頁 Tab
  appState.guilds.forEach((guild) => {
    const gStat = stats.guildStats[guild.id] || { checked: 0, total: 0 };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tab-btn ${activeTab === guild.id ? 'active' : ''}`;
    btn.innerHTML = `
      <span>🛡️ ${escapeHtml(guild.name)}</span>
      <span class="tab-count">${gStat.checked}/${gStat.total}</span>
    `;
    btn.addEventListener('click', () => {
      activeTab = guild.id;
      renderAll();
    });
    container.appendChild(btn);
  });
}

// 建立得名下拉選單 HTML
function createRankSelectElement(memberId, currentRank, guildId) {
  const select = document.createElement('select');
  select.className = `rank-select ${currentRank ? 'has-rank' : ''}`;
  if (!currentUser.isLeader) select.disabled = true;

  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '未得名 (-)';
  select.appendChild(emptyOpt);

  const options = buildRankOptions(appState.rankConfig);
  // 若目前成員已選的名次不在最新清單內，仍保留顯示避免遺失
  if (currentRank && !options.includes(currentRank)) {
    options.unshift(currentRank);
  }

  options.forEach((optLabel) => {
    const opt = document.createElement('option');
    opt.value = optLabel;
    opt.textContent = `🏆 ${optLabel}`;
    if (optLabel === currentRank) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener('change', (e) => {
    updateMemberRank(guildId, memberId, e.target.value);
  });

  return select;
}

// 渲染「點名大表」
function renderMasterView() {
  const sess = getActiveSession();
  const stats = getAttendanceStats(activeSubTabId);
  const fullTitle = getActiveFullTitle();

  document.getElementById('masterDateTitle').textContent = fullTitle;
  document.getElementById('teamSubTabTitle').textContent = fullTitle;
  document.getElementById('presentCountForTeam').textContent = stats.totalChecked;
  document.getElementById('bigTotalCount').textContent = stats.totalChecked;
  document.getElementById('masterTotalMembers').textContent = stats.totalMembers;
  document.getElementById('masterAttendanceRate').textContent = `${stats.overallRate}%`;

  // 渲染隨機組隊結果
  renderRandomTeamsSection(sess);

  // 渲染各公會出席統計卡片
  const cardsGrid = document.getElementById('guildSummaryCards');
  cardsGrid.innerHTML = '';
  appState.guilds.forEach((guild) => {
    const gStat = stats.guildStats[guild.id] || { checked: 0, total: 0, rate: 0 };
    const card = document.createElement('div');
    card.className = 'guild-mini-card';
    card.title = `點擊前往「${guild.name}」分頁進行簽到勾選`;
    card.innerHTML = `
      <div class="guild-mini-top">
        <span class="guild-mini-name">🛡️ ${escapeHtml(guild.name)}</span>
        <span class="guild-mini-rate">${gStat.rate}%</span>
      </div>
      <div class="guild-mini-numbers">
        已簽到 <strong>${gStat.checked}</strong> / ${gStat.total} 人
      </div>
      <div class="mini-progress-bg">
        <div class="mini-progress-fill" style="width: ${gStat.rate}%"></div>
      </div>
    `;
    card.addEventListener('click', () => {
      activeTab = guild.id;
      renderAll();
    });
    cardsGrid.appendChild(card);
  });

  // 更新公會篩選下拉選單
  const guildFilterSelect = document.getElementById('masterGuildFilter');
  const prevGuildFilter = guildFilterSelect.value || 'ALL';
  guildFilterSelect.innerHTML = '<option value="ALL">全部公會</option>';
  appState.guilds.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    if (g.id === prevGuildFilter) opt.selected = true;
    guildFilterSelect.appendChild(opt);
  });

  // 建立 memberId -> 組別對照表
  const memberTeamMap = {};
  const memberTeamNumMap = {};
  (sess.teams || []).forEach((t) => {
    (t.members || []).forEach((m) => {
      memberTeamMap[m.memberId] = `第 ${t.teamNumber} 組`;
      memberTeamNumMap[m.memberId] = t.teamNumber;
    });
  });

  // 組裝大表細項清單
  const records = sess.records || {};
  const keyword = (document.getElementById('masterSearchInput').value || '').trim().toLowerCase();
  const selectedGuildId = guildFilterSelect.value;

  const rows = [];
  appState.guilds.forEach((guild) => {
    if (selectedGuildId !== 'ALL' && guild.id !== selectedGuildId) return;
    guild.members.forEach((member) => {
      const rec = records[member.id];
      const isChecked = !!(rec && rec.checked);
      if (masterFilterStatus === 'checked' && !isChecked) return;
      if (masterFilterStatus === 'unchecked' && isChecked) return;

      const jobStr = member.job || '';
      const rankStr = (rec && rec.rank) || '';
      const teamStr = memberTeamMap[member.id] || '';
      const teamNum = memberTeamNumMap[member.id] || null;

      if (
        keyword &&
        !member.name.toLowerCase().includes(keyword) &&
        !jobStr.toLowerCase().includes(keyword) &&
        !guild.name.toLowerCase().includes(keyword) &&
        !rankStr.toLowerCase().includes(keyword) &&
        !teamStr.toLowerCase().includes(keyword)
      ) {
        return;
      }

      rows.push({
        memberId: member.id,
        memberName: member.name,
        memberJob: jobStr,
        guildId: guild.id,
        guildName: guild.name,
        isChecked,
        rank: rankStr,
        teamLabel: teamStr,
        teamNum,
        time: isChecked ? rec.time || '-' : '-',
        by: isChecked ? rec.by || '-' : '-'
      });
    });
  });

  // 依據點擊的標題進行排序
  sortMasterRows(rows, masterSortState);
  updateSortHeadersUI('[data-master-sort]', 'masterSort', masterSortState);

  const tbody = document.getElementById('masterTableBody');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td colspan="9" class="empty-state">
        ${
          masterFilterStatus === 'checked'
            ? '目前此小分頁尚無已簽到的在場玩家，請點選上方各「公會分頁」勾選出席成員（或點選「🔄 同步今日在場名單」）！'
            : '沒有符合篩選條件的成員資料'
        }
      </td>
    `;
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${escapeHtml(row.memberName)}</strong></td>
      <td>${
        row.memberJob
          ? `<span class="job-badge">${escapeHtml(row.memberJob)}</span>`
          : '<span style="color:var(--text-muted)">-</span>'
      }</td>
      <td><span class="guild-pill">${escapeHtml(row.guildName)}</span></td>
      <td class="rank-cell"></td>
      <td>${
        row.teamLabel
          ? `<span class="team-badge">🎲 ${escapeHtml(row.teamLabel)}</span>`
          : '<span style="color:var(--text-muted)">未分組</span>'
      }</td>
      <td>
        ${
          row.isChecked
            ? '<span class="status-pill checked">✅ 在場</span>'
            : '<span class="status-pill unchecked">⏳ 未簽到</span>'
        }
      </td>
      <td>
        <small style="color:var(--text-secondary)">
          ${row.isChecked ? `${escapeHtml(row.time.split(' ')[1] || row.time)} (${escapeHtml(row.by)})` : '-'}
        </small>
      </td>
      <td class="auth-only">
        <button type="button" class="btn btn-xs ${
          row.isChecked ? 'btn-outline' : 'btn-accent'
        } toggle-check-btn">
          ${row.isChecked ? '取消簽到' : '勾選簽到'}
        </button>
      </td>
    `;

    // 插入得名下拉選單
    tr.querySelector('.rank-cell').appendChild(
      createRankSelectElement(row.memberId, row.rank, row.guildId)
    );

    const toggleBtn = tr.querySelector('.toggle-check-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        toggleMemberCheckIn(row.guildId, row.memberId, !row.isChecked);
      });
    }
    tbody.appendChild(tr);
  });
}

// 渲染「單一公會分頁」（含玩家名稱、職業、得名下拉選單、勾選簽到）
function renderGuildView(guildId) {
  const guild = appState.guilds.find((g) => g.id === guildId);
  if (!guild) return;

  const sess = getActiveSession();
  const stats = getAttendanceStats(activeSubTabId);
  const gStat = stats.guildStats[guild.id] || { checked: 0, total: 0, rate: 0 };

  document.getElementById('activeGuildNameTitle').textContent = guild.name;
  document.getElementById('guildCurrentDateLabel').textContent = getActiveFullTitle();
  document.getElementById('guildCheckedCount').textContent = gStat.checked;
  document.getElementById('guildTotalCount').textContent = gStat.total;
  document.getElementById('guildRateText').textContent = `${gStat.rate}%`;

  const records = sess.records || {};
  const searchKw = (document.getElementById('guildMemberSearchInput').value || '')
    .trim()
    .toLowerCase();

  const tbody = document.getElementById('guildMembersTableBody');
  tbody.innerHTML = '';

  const filteredMembers = guild.members
    .filter(
      (m) =>
        !searchKw ||
        m.name.toLowerCase().includes(searchKw) ||
        (m.job || '').toLowerCase().includes(searchKw)
    )
    .slice();

  sortGuildMembers(filteredMembers, records, guildSortState);
  updateSortHeadersUI('[data-guild-sort]', 'guildSort', guildSortState);

  if (filteredMembers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">
          此公會尚無符合的成員，請使用上方輸入框新增，或點選「📥 上傳 Excel / 圖片辨識加入此公會」匯入名單。
        </td>
      </tr>
    `;
    return;
  }

  filteredMembers.forEach((member, idx) => {
    const rec = records[member.id];
    const isChecked = !!(rec && rec.checked);
    const currentRank = (rec && rec.rank) || '';
    const tr = document.createElement('tr');
    if (isChecked) tr.className = 'checked-row';

    tr.innerHTML = `
      <td class="col-check">
        <input
          type="checkbox"
          class="member-checkbox"
          ${isChecked ? 'checked' : ''}
          ${!currentUser.isLeader ? 'disabled' : ''}
          title="勾選簽到"
        />
      </td>
      <td>${idx + 1}</td>
      <td>
        <strong style="font-size:0.98rem; cursor:pointer;" class="clickable-name">
          ${escapeHtml(member.name)}
        </strong>
      </td>
      <td>
        ${
          member.job
            ? `<span class="job-badge">${escapeHtml(member.job)}</span>`
            : '<span style="color:var(--text-muted)">未填寫</span>'
        }
      </td>
      <td class="guild-rank-cell"></td>
      <td>
        ${
          isChecked
            ? `<span class="status-pill checked">✅ 已簽到</span> <small style="color:var(--text-muted); margin-left:6px;">(${escapeHtml(
                rec.time.split(' ')[1] || rec.time
              )} 由 ${escapeHtml(rec.by)} 勾選)</small>`
            : '<span class="status-pill unchecked">尚未簽到</span>'
        }
      </td>
      <td class="auth-only">
        <button type="button" class="btn btn-outline btn-xs edit-member-btn" title="編輯名稱與職業">✏️ 編輯</button>
        <button type="button" class="btn btn-danger-outline btn-xs delete-member-btn" title="刪除此成員">🗑️</button>
      </td>
    `;

    tr.querySelector('.guild-rank-cell').appendChild(
      createRankSelectElement(member.id, currentRank, guild.id)
    );

    const checkbox = tr.querySelector('.member-checkbox');
    checkbox.addEventListener('change', (e) => {
      toggleMemberCheckIn(guild.id, member.id, e.target.checked);
    });

    tr.querySelector('.clickable-name').addEventListener('click', () => {
      if (!currentUser.isLeader) return;
      toggleMemberCheckIn(guild.id, member.id, !isChecked);
    });

    const editBtn = tr.querySelector('.edit-member-btn');
    editBtn.addEventListener('click', () => {
      if (!requireLeaderPermission()) return;
      editingMemberTarget = { guildId: guild.id, memberId: member.id };
      document.getElementById('editMemberNameInput').value = member.name;
      document.getElementById('editMemberJobInput').value = member.job || '';
      openModal('editMemberModal');
      setTimeout(() => document.getElementById('editMemberNameInput').focus(), 80);
    });

    const delBtn = tr.querySelector('.delete-member-btn');
    delBtn.addEventListener('click', () => {
      if (!requireLeaderPermission()) return;
      openDeleteConfirmModal({
        title: `⚠️ 確認刪除成員「${member.name}」`,
        warningHtml: `您即將從公會 <strong>${escapeHtml(guild.name)}</strong> 中移除玩家 <strong>${escapeHtml(
          member.name
        )}</strong>（職業：${escapeHtml(member.job || '無')}）。`,
        requireInputText: null,
        onConfirm: () => {
          guild.members = guild.members.filter((m) => m.id !== member.id);
          addAuditLog(
            '刪除成員',
            `從公會「${guild.name}」刪除成員「${member.name} (${member.job || '無職業'})」`
          );
          saveState();
          renderAll();
          showToast(`已刪除成員「${member.name}」`, 'info');
        }
      });
    });

    tbody.appendChild(tr);
  });
}

// ================= 簽到勾選與得名設定邏輯 =================
function toggleMemberCheckIn(guildId, memberId, checked) {
  if (!requireLeaderPermission()) {
    renderAll();
    return;
  }
  const guild = appState.guilds.find((g) => g.id === guildId);
  if (!guild) return;
  const member = guild.members.find((m) => m.id === memberId);
  if (!member) return;

  const session = getActiveSession();
  if (!session.records) session.records = {};

  const existingRec = session.records[memberId] || {};

  if (checked) {
    session.records[memberId] = {
      checked: true,
      time: getNowTimeStr(),
      by: currentUser.name,
      rank: existingRec.rank || '',
      memberName: member.name,
      memberJob: member.job || '',
      guildId: guild.id,
      guildName: guild.name
    };
    addAuditLog(
      '勾選簽到',
      `[${getActiveFullTitle()}] 勾選「${guild.name} - ${member.name}${
        member.job ? ` (${member.job})` : ''
      }」出席簽到`
    );
  } else {
    delete session.records[memberId];
    addAuditLog(
      '取消簽到',
      `[${getActiveFullTitle()}] 取消「${guild.name} - ${member.name}」的簽到狀態`
    );
  }

  saveState();
  renderAll();
}

function updateMemberRank(guildId, memberId, newRank) {
  if (!requireLeaderPermission()) {
    renderAll();
    return;
  }
  const guild = appState.guilds.find((g) => g.id === guildId);
  if (!guild) return;
  const member = guild.members.find((m) => m.id === memberId);
  if (!member) return;

  const session = getActiveSession();
  if (!session.records) session.records = {};

  if (!session.records[memberId]) {
    // 若尚未簽到但直接給予名次，自動標記為已簽到在場
    session.records[memberId] = {
      checked: true,
      time: getNowTimeStr(),
      by: currentUser.name,
      rank: newRank,
      memberName: member.name,
      memberJob: member.job || '',
      guildId: guild.id,
      guildName: guild.name
    };
  } else {
    session.records[memberId].rank = newRank;
  }

  addAuditLog(
    '設定得名名次',
    `[${getActiveFullTitle()}] 設定「${guild.name} - ${member.name}」得名名次為：${
      newRank || '未得名'
    }`
  );
  saveState();
  renderAll();
  showToast(
    `已設定「${member.name}」為 ${newRank ? `🏆 ${newRank}` : '未得名'}`,
    'success'
  );
}

// ================= 🏆 得名名次設定 Modal 邏輯 =================
function initRankConfigModal() {
  const minInput = document.getElementById('rankMinInput');
  const maxInput = document.getElementById('rankMaxInput');
  const stepInput = document.getElementById('rankStepInput');
  const customInput = document.getElementById('rankCustomRangesInput');
  const previewBox = document.getElementById('rankOptionsPreview');

  function updatePreview() {
    const tempCfg = {
      min: parseInt(minInput.value, 10) || 1,
      max: parseInt(maxInput.value, 10) || 10,
      step: parseInt(stepInput.value, 10) || 1,
      customRanges: customInput.value.trim()
    };
    const opts = buildRankOptions(tempCfg);
    previewBox.innerHTML = '';
    opts.slice(0, 24).forEach((o) => {
      const span = document.createElement('span');
      span.className = 'job-badge';
      span.textContent = `🏆 ${o}`;
      previewBox.appendChild(span);
    });
    if (opts.length > 24) {
      const more = document.createElement('span');
      more.style.fontSize = '0.8rem';
      more.style.color = 'var(--text-muted)';
      more.textContent = `...共 ${opts.length} 個選項`;
      previewBox.appendChild(more);
    }
  }

  [minInput, maxInput, stepInput, customInput].forEach((el) => {
    el.addEventListener('input', updatePreview);
  });

  document.getElementById('openRankConfigModalBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    const cfg = appState.rankConfig || createDefaultRankConfig();
    minInput.value = cfg.min || 1;
    maxInput.value = cfg.max || 10;
    stepInput.value = cfg.step || 1;
    customInput.value = cfg.customRanges || '';
    updatePreview();
    openModal('rankConfigModal');
  });

  document.getElementById('resetRankConfigBtn').addEventListener('click', () => {
    minInput.value = 1;
    maxInput.value = 10;
    stepInput.value = 1;
    customInput.value = '';
    updatePreview();
  });

  document.getElementById('rankConfigForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!requireLeaderPermission()) return;
    const min = Math.max(1, parseInt(minInput.value, 10) || 1);
    const max = Math.max(min, parseInt(maxInput.value, 10) || 10);
    const step = Math.max(1, parseInt(stepInput.value, 10) || 1);
    const customRanges = customInput.value.trim();

    appState.rankConfig = { min, max, step, customRanges };
    addAuditLog(
      '調整得名設定',
      `將得名選單設定為：${min}~${max}名（區間跨度 ${step}${
        customRanges ? `，自訂區間：${customRanges}` : ''
      }）`
    );
    closeModal('rankConfigModal');
    saveState();
    renderAll();
    showToast('已更新得名名次下拉選單設定！', 'success');
  });
}

// ================= 🎲 大表在場人員隨機組隊功能 =================
function initRandomTeamActions() {
  const sizeInput = document.getElementById('teamSizeInput');

  // 快速人數按鈕 (2~6人)
  document.querySelectorAll('.size-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      sizeInput.value = btn.dataset.size;
    });
  });

  sizeInput.addEventListener('input', () => {
    document.querySelectorAll('.size-chip').forEach((b) => {
      b.classList.toggle('active', b.dataset.size === sizeInput.value);
    });
  });

  // 執行隨機組隊
  document.getElementById('runRandomTeamBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    const sess = getActiveSession();
    const records = sess.records || {};

    // 收集目前大表小分頁所有「在場（已簽到）」成員
    const presentMembers = [];
    appState.guilds.forEach((guild) => {
      guild.members.forEach((member) => {
        if (records[member.id] && records[member.id].checked) {
          presentMembers.push({
            memberId: member.id,
            memberName: member.name,
            memberJob: member.job || '',
            guildId: guild.id,
            guildName: guild.name
          });
        }
      });
    });

    if (presentMembers.length === 0) {
      showToast('目前此分頁沒有已簽到的在場人員，請先勾選簽到後再進行隨機組隊！', 'warning');
      return;
    }

    const teamSize = Math.max(1, parseInt(sizeInput.value, 10) || 6);
    const remainderMode = document.getElementById('teamRemainderMode').value;

    // Fisher-Yates 洗牌演算法隨機打亂在場所有人
    const shuffled = [...presentMembers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const teams = [];
    if (remainderMode === 'distribute' && shuffled.length > teamSize) {
      const fullGroupCount = Math.floor(shuffled.length / teamSize);
      for (let g = 0; g < fullGroupCount; g++) {
        teams.push({
          teamNumber: g + 1,
          members: shuffled.slice(g * teamSize, (g + 1) * teamSize)
        });
      }
      const leftovers = shuffled.slice(fullGroupCount * teamSize);
      leftovers.forEach((person, idx) => {
        teams[idx % teams.length].members.push(person);
      });
    } else {
      let teamNum = 1;
      for (let i = 0; i < shuffled.length; i += teamSize) {
        teams.push({
          teamNumber: teamNum++,
          members: shuffled.slice(i, i + teamSize)
        });
      }
    }

    sess.teams = teams;
    sess.teamSize = teamSize;

    addAuditLog(
      '隨機組隊',
      `[${getActiveFullTitle()}] 將在場 ${presentMembers.length} 人依「每組 ${teamSize} 人」隨機分為 ${
        teams.length
      } 組`
    );
    saveState();
    renderAll();
    showToast(
      `🎲 已將在場 ${presentMembers.length} 人隨機排好 ${teams.length} 組隊伍！`,
      'success'
    );
  });

  // 複製組隊結果文字
  document.getElementById('copyTeamsTextBtn').addEventListener('click', () => {
    const sess = getActiveSession();
    const teams = sess.teams || [];
    if (teams.length === 0) {
      showToast('尚未產生隨機組隊結果，請先點擊「🎲 隨機組隊」！', 'warning');
      return;
    }

    const lines = [`【${getActiveFullTitle()} 隨機組隊名單】`];
    teams.forEach((t) => {
      const names = t.members
        .map((m) => `${m.memberName}${m.memberJob ? `(${m.memberJob})` : ''}`)
        .join('、');
      lines.push(`第 ${t.teamNumber} 組（${t.members.length}人）：${names}`);
    });

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      showToast('📋 已複製組隊名單文字！可直接貼上至 Discord / Line / 遊戲頻道。', 'success');
    });
  });

  // 清除分組
  document.getElementById('clearTeamsBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    const sess = getActiveSession();
    if (!sess.teams || sess.teams.length === 0) return;
    sess.teams = [];
    addAuditLog('清除隨機組隊', `[${getActiveFullTitle()}] 清除隨機組隊結果`);
    saveState();
    renderAll();
    showToast('已清除本分頁的組隊結果', 'info');
  });
}

function renderRandomTeamsSection(sess) {
  const container = document.getElementById('randomTeamsContainer');
  container.innerHTML = '';

  const teams = (sess && sess.teams) || [];
  if (teams.length === 0) return;

  // 建立最新成員資訊快取，確保修改名稱或職業後組隊卡片立即同步顯示完整內容
  const liveMemberLookup = {};
  appState.guilds.forEach((g) => {
    g.members.forEach((m) => {
      liveMemberLookup[m.id] = {
        name: m.name,
        job: m.job || '',
        guildName: g.name
      };
    });
  });

  teams.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'team-box-card';
    const itemsHtml = (t.members || [])
      .map((m, idx) => {
        const live = liveMemberLookup[m.memberId] || {
          name: m.memberName,
          job: m.memberJob || '',
          guildName: m.guildName
        };
        return `
        <li class="team-member-item">
          <div class="team-member-left">
            <span class="team-member-idx">${idx + 1}.</span>
            <strong class="team-member-name" title="${escapeHtml(live.name)}">${escapeHtml(live.name)}</strong>
          </div>
          <div class="team-member-right">
            ${live.job ? `<span class="job-badge">${escapeHtml(live.job)}</span>` : ''}
            <span class="guild-pill team-guild-pill">${escapeHtml(live.guildName)}</span>
          </div>
        </li>
      `;
      })
      .join('');

    card.innerHTML = `
      <div class="team-box-header">
        <span>🚩 第 ${t.teamNumber} 組</span>
        <span class="badge">${t.members.length} 人</span>
      </div>
      <ul class="team-member-list">
        ${itemsHtml}
      </ul>
    `;
    container.appendChild(card);
  });
}

// ================= 大表小分頁新增 / 改名 / 同步 / 刪除 =================
function initSubTabActions() {
  // 切換日期（預設今天）
  document.getElementById('historyDateSelect').addEventListener('change', (e) => {
    activeDateStr = e.target.value;
    activeSubTabId = '';
    ensureActiveSubTabExists();
    renderAll();
  });

  // 新增今日小分頁（預設自動複製當天第一個分頁的在場簽到名單，方便直接分組或點名）
  document.getElementById('createSubTabForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!requireLeaderPermission()) return;

    const input = document.getElementById('newSubTabNameInput');
    let subName = input.value.trim();
    const existingSubTabs = getSubTabsForDate(activeDateStr);

    if (!subName) {
      subName = `分頁 ${existingSubTabs.length + 1}`;
    }

    // 檢查同名
    if (existingSubTabs.some((s) => s.subName.toLowerCase() === subName.toLowerCase())) {
      showToast(`今日已有為「${subName}」的小分頁，請換個名稱或直接點擊該分頁！`, 'warning');
      return;
    }

    // 複製目前分頁（或當日第一個分頁）的已簽到在場狀態（但不複製得名與分組）
    const baseSession = getActiveSession() || existingSubTabs[0];
    const copiedRecords = {};
    if (baseSession && baseSession.records) {
      Object.keys(baseSession.records).forEach((mId) => {
        const r = baseSession.records[mId];
        if (r && r.checked) {
          copiedRecords[mId] = {
            ...r,
            rank: ''
          };
        }
      });
    }

    const newId = uid('sub');
    appState.sessions[newId] = {
      id: newId,
      rawDate: activeDateStr,
      subName,
      createdAt: getNowTimeStr(),
      createdBy: currentUser.name,
      records: copiedRecords,
      teams: [],
      teamSize: 6
    };

    activeSubTabId = newId;
    input.value = '';
    addAuditLog('新增大表小分頁', `於 ${activeDateStr} 新增小分頁「${subName}」`);
    saveState();
    renderAll();
    showToast(`已新增小分頁「${subName}」（已自動帶入今日在場人員）！`, 'success');
  });

  // 小分頁改名按鈕
  document.getElementById('renameSubTabBtn').addEventListener('click', () => {
    openRenameSubTabModal();
  });

  document.getElementById('subTabRenameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!requireLeaderPermission()) return;
    const sess = getActiveSession();
    if (!sess) return;

    const newName = document.getElementById('subTabRenameInput').value.trim();
    if (!newName) return;

    const oldName = sess.subName;
    sess.subName = newName;
    addAuditLog(
      '修改小分頁名稱',
      `於 ${sess.rawDate} 將小分頁「${oldName}」改名為「${newName}」`
    );
    closeModal('subTabRenameModal');
    saveState();
    renderAll();
    showToast(`小分頁已改名為「${newName}」！`, 'success');
  });

  // 同步今日主表在場名單按鈕
  document.getElementById('copyFromFirstSubTabBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    const subTabs = getSubTabsForDate(activeDateStr);
    if (subTabs.length <= 1) {
      showToast('目前只有一個小分頁，無需同步！', 'info');
      return;
    }
    const firstSub = subTabs[0];
    const currentSub = getActiveSession();
    if (firstSub.id === currentSub.id) {
      showToast('目前已是第一個主點名分頁！', 'info');
      return;
    }

    let syncCount = 0;
    Object.keys(firstSub.records || {}).forEach((mId) => {
      const r = firstSub.records[mId];
      if (r && r.checked) {
        if (!currentSub.records[mId]) {
          currentSub.records[mId] = { ...r, rank: '' };
          syncCount++;
        } else {
          currentSub.records[mId].checked = true;
        }
      }
    });

    addAuditLog(
      '同步在場名單',
      `將「${firstSub.subName}」的在場名單同步至「${currentSub.subName}」`
    );
    saveState();
    renderAll();
    showToast(`已從「${firstSub.subName}」同步在場人員名單！`, 'success');
  });

  // 刪除目前選取的小分頁
  document.getElementById('deleteSubTabBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    const subTabs = getSubTabsForDate(activeDateStr);
    if (subTabs.length <= 1) {
      showToast('每天至少需保留一個小分頁（您可直接點「✏️ 小分頁改名」修改它的名字）！', 'warning');
      return;
    }
    const sess = getActiveSession();
    openDeleteConfirmModal({
      title: `⚠️ 確認刪除小分頁「${sess.subName}」`,
      warningHtml: `您即將刪除 ${escapeHtml(sess.rawDate)} 的小分頁 <strong>「${escapeHtml(
        sess.subName
      )}」</strong> 及其內含的簽到、得名與分組紀錄（公會成員名單不會被刪除）。`,
      requireInputText: null,
      onConfirm: () => {
        const deletedName = sess.subName;
        delete appState.sessions[sess.id];
        activeSubTabId = '';
        ensureActiveSubTabExists();
        addAuditLog('刪除小分頁', `刪除 ${activeDateStr} 的小分頁「${deletedName}」`);
        saveState();
        renderAll();
        showToast(`已刪除小分頁「${deletedName}」`, 'info');
      }
    });
  });

  // 大表篩選器事件
  document.querySelectorAll('[data-filter-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-status]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      masterFilterStatus = btn.dataset.filterStatus;
      renderMasterView();
    });
  });

  document.getElementById('masterGuildFilter').addEventListener('change', () => renderMasterView());
  document.getElementById('masterSearchInput').addEventListener('input', () => renderMasterView());
  document.getElementById('guildMemberSearchInput').addEventListener('input', () => {
    if (activeTab !== 'MASTER') renderGuildView(activeTab);
  });
}

function openRenameSubTabModal() {
  if (!requireLeaderPermission()) return;
  const sess = getActiveSession();
  if (!sess) return;
  const input = document.getElementById('subTabRenameInput');
  input.value = sess.subName;
  openModal('subTabRenameModal');
  setTimeout(() => {
    input.focus();
    input.select();
  }, 80);
}

// ================= 公會新增 / 改名 / 防呆刪除 / 成員編輯 =================
function initGuildActions() {
  document.getElementById('addGuildBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    guildFormMode = { mode: 'add', guildId: null };
    document.getElementById('guildFormModalTitle').textContent = '➕ 新增公會';
    document.getElementById('guildNameInput').value = '';
    openModal('guildFormModal');
    setTimeout(() => document.getElementById('guildNameInput').focus(), 80);
  });

  document.getElementById('renameGuildBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    const guild = appState.guilds.find((g) => g.id === activeTab);
    if (!guild) return;
    guildFormMode = { mode: 'rename', guildId: guild.id };
    document.getElementById('guildFormModalTitle').textContent = `✏️ 修改公會名稱（原：${guild.name}）`;
    document.getElementById('guildNameInput').value = guild.name;
    openModal('guildFormModal');
    setTimeout(() => document.getElementById('guildNameInput').focus(), 80);
  });

  document.getElementById('guildForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!requireLeaderPermission()) return;
    const name = document.getElementById('guildNameInput').value.trim();
    if (!name) return;

    const duplicate = appState.guilds.find(
      (g) => g.name.toLowerCase() === name.toLowerCase() && g.id !== guildFormMode.guildId
    );
    if (duplicate) {
      showToast(`公會名稱「${name}」已經存在，請使用其他名稱！`, 'error');
      return;
    }

    if (guildFormMode.mode === 'add') {
      const newGuild = {
        id: uid('guild'),
        name,
        members: []
      };
      appState.guilds.push(newGuild);
      activeTab = newGuild.id;
      addAuditLog('新增公會', `建立新公會分頁「${name}」`);
      showToast(`已成功新增公會「${name}」！`, 'success');
    } else {
      const guild = appState.guilds.find((g) => g.id === guildFormMode.guildId);
      if (guild) {
        const oldName = guild.name;
        guild.name = name;
        addAuditLog('修改公會名稱', `將公會「${oldName}」更名為「${name}」`);
        showToast(`公會已更名為「${name}」`, 'success');
      }
    }

    closeModal('guildFormModal');
    saveState();
    renderAll();
  });

  document.getElementById('editMemberForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!requireLeaderPermission()) return;
    const guild = appState.guilds.find((g) => g.id === editingMemberTarget.guildId);
    if (!guild) return;
    const member = guild.members.find((m) => m.id === editingMemberTarget.memberId);
    if (!member) return;

    const newName = document.getElementById('editMemberNameInput').value.trim();
    const newJob = document.getElementById('editMemberJobInput').value.trim();
    if (!newName) return;

    const oldDesc = `${member.name} (${member.job || '無職業'})`;
    member.name = newName;
    member.job = newJob;
    const newDesc = `${member.name} (${member.job || '無職業'})`;

    addAuditLog('修改成員資料', `於公會「${guild.name}」將成員由「${oldDesc}」更新為「${newDesc}」`);
    closeModal('editMemberModal');
    saveState();
    renderAll();
    showToast(`已更新成員「${newName}」的資料`, 'success');
  });

  document.getElementById('clearGuildMembersBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    const guild = appState.guilds.find((g) => g.id === activeTab);
    if (!guild || guild.members.length === 0) {
      showToast('此公會目前沒有成員可清空', 'warning');
      return;
    }
    openDeleteConfirmModal({
      title: `⚠️ 防呆確認：清空「${guild.name}」所有成員`,
      warningHtml: `您即將清空公會 <strong>${escapeHtml(guild.name)}</strong> 的全部 <strong>${
        guild.members.length
      } 位成員名單</strong>（公會分頁本身會保留，方便您重新上傳名單）。`,
      requireInputText: guild.name,
      onConfirm: () => {
        const count = guild.members.length;
        guild.members = [];
        addAuditLog('清空公會成員', `清空公會「${guild.name}」的全部 ${count} 位成員`);
        saveState();
        renderAll();
        showToast(`已清空「${guild.name}」的成員名單`, 'info');
      }
    });
  });

  document.getElementById('deleteGuildBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    const guild = appState.guilds.find((g) => g.id === activeTab);
    if (!guild) return;

    openDeleteConfirmModal({
      title: `⚠️ 防呆確認：刪除公會「${guild.name}」`,
      warningHtml: `
        您即將永久刪除公會 <strong>「${escapeHtml(guild.name)}」</strong> 及其內含的 <strong>${
        guild.members.length
      } 位成員名單</strong>！<br/>
        為防止誤觸，請於下方輸入框完整輸入公會名稱 <code>${escapeHtml(guild.name)}</code> 並勾選確認。
      `,
      requireInputText: guild.name,
      onConfirm: () => {
        const deletedName = guild.name;
        const memberCount = guild.members.length;
        const memberIds = new Set(guild.members.map((m) => m.id));

        Object.values(appState.sessions).forEach((sess) => {
          if (!sess.records) return;
          Object.keys(sess.records).forEach((mId) => {
            if (memberIds.has(mId)) delete sess.records[mId];
          });
        });

        appState.guilds = appState.guilds.filter((g) => g.id !== guild.id);
        activeTab = 'MASTER';
        addAuditLog('刪除公會', `刪除公會「${deletedName}」（原含 ${memberCount} 位成員）`);
        saveState();
        renderAll();
        showToast(`已刪除公會「${deletedName}」`, 'info');
      }
    });
  });

  document.getElementById('addMemberForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!requireLeaderPermission()) return;
    const guild = appState.guilds.find((g) => g.id === activeTab);
    if (!guild) return;

    const nameInput = document.getElementById('newMemberNameInput');
    const jobInput = document.getElementById('newMemberJobInput');
    const rawName = nameInput.value.trim();
    const rawJob = jobInput.value.trim();
    if (!rawName) return;

    const existing = guild.members.find((m) => m.name.toLowerCase() === rawName.toLowerCase());
    if (existing) {
      if (rawJob && existing.job !== rawJob) {
        existing.job = rawJob;
        addAuditLog('更新成員職業', `於公會「${guild.name}」更新「${rawName}」職業為「${rawJob}」`);
        nameInput.value = '';
        jobInput.value = '';
        saveState();
        renderAll();
        showToast(`「${rawName}」已存在，已為其更新職業為「${rawJob}」！`, 'success');
      } else {
        showToast(`玩家「${rawName}」已經在「${guild.name}」名單中了！`, 'warning');
      }
      return;
    }

    guild.members.push({
      id: uid('m'),
      name: rawName,
      job: rawJob
    });

    addAuditLog(
      '新增成員',
      `於公會「${guild.name}」新增成員「${rawName}${rawJob ? ` (${rawJob})` : ''}」`
    );
    nameInput.value = '';
    jobInput.value = '';
    nameInput.focus();
    saveState();
    renderAll();
    showToast(`已新增成員「${rawName}」至「${guild.name}」`, 'success');
  });

  document.getElementById('checkAllGuildBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    const guild = appState.guilds.find((g) => g.id === activeTab);
    if (!guild || guild.members.length === 0) return;

    const session = getActiveSession();
    if (!session.records) session.records = {};

    const nowStr = getNowTimeStr();
    guild.members.forEach((m) => {
      const prevRank = session.records[m.id]?.rank || '';
      session.records[m.id] = {
        checked: true,
        time: nowStr,
        by: currentUser.name,
        rank: prevRank,
        memberName: m.name,
        memberJob: m.job || '',
        guildId: guild.id,
        guildName: guild.name
      };
    });

    addAuditLog(
      '批次全選簽到',
      `[${getActiveFullTitle()}] 將公會「${guild.name}」全部 ${guild.members.length} 位成員標記為已簽到`
    );
    saveState();
    renderAll();
    showToast(`已將「${guild.name}」全體成員打勾簽到！`, 'success');
  });

  document.getElementById('uncheckAllGuildBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    const guild = appState.guilds.find((g) => g.id === activeTab);
    if (!guild || guild.members.length === 0) return;

    const session = getActiveSession();
    if (!session.records) return;

    guild.members.forEach((m) => {
      delete session.records[m.id];
    });

    addAuditLog('批次取消簽到', `[${getActiveFullTitle()}] 將公會「${guild.name}」全體成員取消簽到`);
    saveState();
    renderAll();
    showToast(`已清空「${guild.name}」本場簽到勾選`, 'info');
  });
}

// ================= 防呆刪除確認 Modal 控制器 =================
function openDeleteConfirmModal({ title, warningHtml, requireInputText, onConfirm }) {
  document.getElementById('deleteModalTitle').textContent = title;
  document.getElementById('deleteWarningMessage').innerHTML = warningHtml;

  const inputBox = document.getElementById('deleteConfirmInputBox');
  const inputEl = document.getElementById('deleteConfirmInput');
  const checkboxEl = document.getElementById('deleteConfirmCheckbox');
  const execBtn = document.getElementById('confirmDeleteExecuteBtn');

  inputEl.value = '';
  checkboxEl.checked = false;
  execBtn.disabled = true;

  if (requireInputText) {
    inputBox.classList.remove('hidden');
    document.getElementById(
      'deleteConfirmPromptLabel'
    ).textContent = `請輸入「${requireInputText}」以解除防呆鎖定：`;
    inputEl.placeholder = requireInputText;
  } else {
    inputBox.classList.add('hidden');
  }

  function validateDeleteReady() {
    const checkOk = checkboxEl.checked;
    const textOk = !requireInputText || inputEl.value.trim() === requireInputText;
    execBtn.disabled = !(checkOk && textOk);
  }

  inputEl.oninput = validateDeleteReady;
  checkboxEl.onchange = validateDeleteReady;

  pendingDeleteAction = onConfirm;
  openModal('confirmDeleteModal');
}

// ================= Excel 匯入 (名稱 + 職業) & 圖片 OCR 辨識 =================
function initImportAndOcr() {
  const openImportModal = (preferredGuildId = null) => {
    if (!requireLeaderPermission()) return;
    if (appState.guilds.length === 0) {
      showToast('請先建立至少一個公會再匯入成員！', 'warning');
      return;
    }
    const select = document.getElementById('importTargetGuildSelect');
    select.innerHTML = '';

    const targetId =
      preferredGuildId && preferredGuildId !== 'MASTER'
        ? preferredGuildId
        : activeTab !== 'MASTER'
        ? activeTab
        : appState.guilds[0].id;

    appState.guilds.forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `🛡️ ${g.name}（目前 ${g.members.length} 人）`;
      if (g.id === targetId) opt.selected = true;
      select.appendChild(opt);
    });

    document.getElementById('importTodayDateLabel').textContent = getActiveFullTitle();
    openModal('importModal');
  };

  document.getElementById('openImportModalBtn').addEventListener('click', () => {
    openImportModal(activeTab);
  });

  document.getElementById('openImportForGuildBtn').addEventListener('click', () => {
    openImportModal(activeTab);
  });

  document.querySelectorAll('[data-import-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-import-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.importTab;
      document.getElementById('excelImportPane').classList.toggle('active', mode === 'excel');
      document.getElementById('ocrImportPane').classList.toggle('active', mode === 'ocr');
    });
  });

  const textarea = document.getElementById('parsedNamesTextarea');
  const updateParsedCount = () => {
    const lines = textarea.value
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    document.getElementById('parsedCountBadge').textContent = `共 ${lines.length} 位`;
  };
  textarea.addEventListener('input', updateParsedCount);

  const excelInput = document.getElementById('excelFileInput');
  document.getElementById('selectExcelBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    excelInput.click();
  });
  document.getElementById('excelDropzone').addEventListener('click', () => excelInput.click());

  setupDragAndDrop('excelDropzone', (file) => handleExcelFile(file));
  excelInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleExcelFile(e.target.files[0]);
    excelInput.value = '';
  });

  function handleExcelFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

        if (!rows || rows.length === 0) {
          showToast('Excel 檔案內容為空！', 'warning');
          return;
        }

        let nameColIdx = 0;
        let jobColIdx = 1;
        let startRowIdx = 0;

        const firstRowCells = (rows[0] || []).map((c) => String(c ?? '').trim());
        const detectedNameIdx = firstRowCells.findIndex((t) =>
          /名稱|角色|玩家|名字|id|name/i.test(t)
        );
        const detectedJobIdx = firstRowCells.findIndex((t) =>
          /職業|職稱|class|job/i.test(t)
        );

        if (detectedNameIdx !== -1 || detectedJobIdx !== -1) {
          startRowIdx = 1;
          if (detectedNameIdx !== -1) nameColIdx = detectedNameIdx;
          if (detectedJobIdx !== -1) jobColIdx = detectedJobIdx;
        } else if (
          firstRowCells[0] &&
          /^(序號|編號|#|no\.?)$/i.test(firstRowCells[0]) &&
          firstRowCells.length >= 2
        ) {
          startRowIdx = 1;
          nameColIdx = 1;
          jobColIdx = 2;
        }

        const extractedLines = [];
        for (let i = startRowIdx; i < rows.length; i++) {
          const row = rows[i];
          if (!Array.isArray(row) || row.length === 0) continue;

          const playerName = String(row[nameColIdx] ?? '').trim();
          const playerJob =
            jobColIdx !== -1 && jobColIdx < row.length ? String(row[jobColIdx] ?? '').trim() : '';

          if (!playerName) continue;
          if (
            (playerName === '角色名稱' || playerName === '玩家名稱' || playerName === '名稱') &&
            (playerJob === '職業' || !playerJob)
          ) {
            continue;
          }

          if (playerJob) {
            extractedLines.push(`${playerName},${playerJob}`);
          } else {
            extractedLines.push(playerName);
          }
        }

        const existing = textarea.value.trim();
        textarea.value = existing
          ? `${existing}\n${extractedLines.join('\n')}`
          : extractedLines.join('\n');
        updateParsedCount();

        const targetGuild = appState.guilds.find(
          (g) => g.id === document.getElementById('importTargetGuildSelect').value
        );
        showToast(
          `已從 Excel 讀取 ${extractedLines.length} 位成員（含名稱與職業），準備匯入至「${
            targetGuild ? targetGuild.name : '所選公會'
          }」！`,
          'success'
        );
      } catch (err) {
        console.error(err);
        showToast('Excel 檔案解析失敗，請確認檔案格式是否正確。', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  document.getElementById('downloadTemplateBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const wsData = [
      ['角色名稱', '職業'],
      ['LP33', '主教'],
      ['o煞氣a蘆薈o', '夜使者'],
      ['襪襪是隻喵', '箭神']
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, '公會成員名單範本');
    XLSX.writeFile(wb, '公會成員匯入範本_名稱與職業.xlsx');
  });

  const ocrInput = document.getElementById('ocrFileInput');
  document.getElementById('selectOcrImgBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    ocrInput.click();
  });
  document.getElementById('ocrDropzone').addEventListener('click', () => ocrInput.click());

  setupDragAndDrop('ocrDropzone', (file) => handleOcrImageFile(file));
  ocrInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleOcrImageFile(e.target.files[0]);
    ocrInput.value = '';
  });

  window.addEventListener('paste', (e) => {
    const importModalEl = document.getElementById('importModal');
    if (!importModalEl.classList.contains('active')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          document.querySelector('[data-import-tab="ocr"]').click();
          handleOcrImageFile(file);
          break;
        }
      }
    }
  });

  async function handleOcrImageFile(file) {
    if (!file.type.startsWith('image/')) {
      showToast('請上傳圖片格式檔案（PNG / JPG / WEBP）', 'error');
      return;
    }

    const progressBox = document.getElementById('ocrProgressBox');
    const statusText = document.getElementById('ocrStatusText');
    const percentText = document.getElementById('ocrPercentText');
    const progressBar = document.getElementById('ocrProgressBar');
    const previewRow = document.getElementById('ocrPreviewRow');
    const canvas = document.getElementById('ocrPreprocessCanvas');

    progressBox.classList.remove('hidden');
    previewRow.classList.remove('hidden');
    statusText.textContent = '正在處理圖片並啟動 OCR 辨識引擎...';
    percentText.textContent = '0%';
    progressBar.style.width = '0%';

    try {
      const doPreprocess = document.getElementById('ocrPreprocessCheck').checked;
      await drawAndPreprocessImageToCanvas(file, canvas, doPreprocess);

      const lang = document.getElementById('ocrLangSelect').value || 'chi_tra+eng';
      const result = await Tesseract.recognize(canvas, lang, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            const pct = Math.round((m.progress || 0) * 100);
            statusText.textContent = '正在辨識圖片中的玩家名稱...';
            percentText.textContent = `${pct}%`;
            progressBar.style.width = `${pct}%`;
          } else {
            statusText.textContent = `OCR 狀態：${m.status}`;
          }
        }
      });

      const rawText = result?.data?.text || '';
      const cleanedLines = rawText
        .split(/\r?\n/)
        .map((line) =>
          line.replace(/[|｜¦•·~`!@#$%^&*+=<>?/\\{}[\];:'"']/g, ' ').trim()
        )
        .filter((s) => s.length >= 2)
        .map((line) => {
          const parts = line
            .split(/\s{2,}/)
            .map((p) => p.trim())
            .filter(Boolean);
          if (parts.length >= 2) {
            return `${parts[0]},${parts[1]}`;
          }
          return line;
        });

      const existing = textarea.value.trim();
      textarea.value = existing
        ? `${existing}\n${cleanedLines.join('\n')}`
        : cleanedLines.join('\n');
      updateParsedCount();

      statusText.textContent = `✅ 辨識完成！共擷取 ${cleanedLines.length} 筆名單（可於下方文字框微調）`;
      percentText.textContent = '100%';
      progressBar.style.width = '100%';
      showToast(`圖片辨識完成，擷取了 ${cleanedLines.length} 筆成員資料！`, 'success');
    } catch (err) {
      console.error('OCR Error:', err);
      statusText.textContent = '❌ 圖片辨識發生錯誤，請重試或換一張截圖';
      showToast('圖片辨識失敗，請確認網路連線或重試。', 'error');
    }
  }

  document.getElementById('confirmImportBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    const rawLines = textarea.value
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (rawLines.length === 0) {
      showToast('預覽區沒有可匯入的玩家名稱！', 'warning');
      return;
    }

    const targetGuildId = document.getElementById('importTargetGuildSelect').value;
    const guild = appState.guilds.find((g) => g.id === targetGuildId) || appState.guilds[0];
    if (!guild) {
      showToast('找不到目標公會，請先建立公會！', 'error');
      return;
    }

    const alsoCheckIn = document.getElementById('importAndCheckInToday').checked;
    const session = getActiveSession();
    if (!session.records) session.records = {};

    let addedTotal = 0;
    let updatedTotal = 0;
    let checkInTotal = 0;

    rawLines.forEach((line) => {
      const parts = line.split(/[,，\t]+/).map((s) => s.trim());
      const playerName = parts[0] || '';
      const playerJob = parts.slice(1).join(' ').trim();

      if (!playerName) return;
      if (playerName === '角色名稱' || playerName === '玩家名稱') return;

      let member = guild.members.find(
        (m) => m.name.toLowerCase() === playerName.toLowerCase()
      );
      if (!member) {
        member = { id: uid('m'), name: playerName, job: playerJob };
        guild.members.push(member);
        addedTotal++;
      } else if (playerJob && member.job !== playerJob) {
        member.job = playerJob;
        updatedTotal++;
      }

      if (alsoCheckIn) {
        session.records[member.id] = {
          checked: true,
          time: getNowTimeStr(),
          by: currentUser.name,
          rank: session.records[member.id]?.rank || '',
          memberName: member.name,
          memberJob: member.job || '',
          guildId: guild.id,
          guildName: guild.name
        };
        checkInTotal++;
      }
    });

    addAuditLog(
      '批次匯入名單',
      `於公會「${guild.name}」匯入 ${rawLines.length} 筆資料（新增 ${addedTotal} 人、更新職業 ${updatedTotal} 人${
        alsoCheckIn ? `，並於 ${getActiveFullTitle()} 勾選 ${checkInTotal} 人簽到` : ''
      }）`
    );

    textarea.value = '';
    updateParsedCount();
    closeModal('importModal');

    activeTab = guild.id;
    saveState();
    renderAll();
    showToast(
      `已成功將 ${addedTotal} 位新成員（更新 ${updatedTotal} 位）匯入至公會「${guild.name}」！`,
      'success'
    );
  });
}

function drawAndPreprocessImageToCanvas(file, canvas, enhanceDarkGameUi) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = img.width < 1000 ? 2 : 1;
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (enhanceDarkGameUi) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;

        let sumLum = 0;
        const pixelCount = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          sumLum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        }
        const avgLum = sumLum / pixelCount;
        const isDarkBg = avgLum < 128;

        for (let i = 0; i < d.length; i += 4) {
          let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (isDarkBg) {
            gray = 255 - gray;
          }
          const contrast = 1.6;
          gray = (gray - 128) * contrast + 128;
          gray = Math.max(0, Math.min(255, gray));
          d[i] = d[i + 1] = d[i + 2] = gray;
        }
        ctx.putImageData(imgData, 0, 0);
      }
      resolve();
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ================= Excel 匯出功能 (含各分頁全部資料、數據統計、名稱、職業、得名、隨機組隊) =================
function initExportActions() {
  const openExportModal = () => {
    const select = document.getElementById('exportGuildSelect');
    select.innerHTML = '<option value="ALL">🌟 全部公會（包含聯盟總表與各公會分頁）</option>';
    appState.guilds.forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `🛡️ 僅匯出：${g.name} (${g.members.length} 人)`;
      select.appendChild(opt);
    });

    const scopeSelect = document.getElementById('exportSessionScopeSelect');
    if (scopeSelect) {
      const todaySubs = getSubTabsForDate(activeDateStr);
      const totalSubs = Object.keys(appState.sessions).length;
      scopeSelect.innerHTML = `
        <option value="ALL_DATE">🌟 當日 (${activeDateStr}) 全部 ${todaySubs.length} 個小分頁＋各公會完整資料與數據（推薦）</option>
        <option value="ALL_SESSIONS">🗂️ 系統全部日期（共 ${totalSubs} 個分頁）＋各公會完整資料與數據</option>
        <option value="CURRENT_ONLY">📌 僅匯出目前單一小分頁（${getActiveFullTitle()}）</option>
      `;
    }
    openModal('exportModal');
  };

  document.getElementById('openExportModalBtn').addEventListener('click', openExportModal);

  document.getElementById('exportSingleGuildBtn').addEventListener('click', () => {
    exportGuildMembersExcel(activeTab);
  });

  // 大表上的快速匯出按鈕：直接匯出當日所有小分頁＋各公會分頁的全部資料與數據
  document.getElementById('exportMasterExcelBtn').addEventListener('click', () => {
    exportFullMasterWorkbook('ALL_DATE');
  });

  document.getElementById('doExportGuildRosterBtn').addEventListener('click', () => {
    const target = document.getElementById('exportGuildSelect').value;
    exportGuildMembersExcel(target);
  });

  document.getElementById('doExportSessionReportBtn').addEventListener('click', () => {
    const scopeSelect = document.getElementById('exportSessionScopeSelect');
    const scope = scopeSelect ? scopeSelect.value : 'ALL_DATE';
    exportFullMasterWorkbook(scope);
  });

  document.getElementById('exportJsonBackupBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `聯盟點名系統備份_${getTodayDateStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('已下載完整系統 JSON 備份檔', 'success');
  });

  const jsonInput = document.getElementById('importJsonBackupInput');
  document.getElementById('importJsonBackupBtn').addEventListener('click', () => {
    if (!requireLeaderPermission()) return;
    jsonInput.click();
  });
  jsonInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.guilds || !parsed.sessions) throw new Error('Invalid schema');
        appState = migrateAndRepairState(parsed);
        addAuditLog('還原系統備份', `從備份檔「${file.name}」還原系統資料`);
        saveState();
        renderAll();
        closeModal('exportModal');
        showToast('已成功還原系統完整資料！', 'success');
      } catch (err) {
        showToast('JSON 備份檔案格式不正確！', 'error');
      }
    };
    reader.readAsText(file);
    jsonInput.value = '';
  });
}

// 自動計算 Excel 工作表欄位最佳寬度（避免文字擠在一起）
function createSheetWithAutoWidth(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const colWidths = [];
  rows.forEach((row) => {
    if (!Array.isArray(row)) return;
    row.forEach((cell, cIdx) => {
      const str = String(cell ?? '');
      let width = 0;
      for (let i = 0; i < str.length; i++) {
        width += str.charCodeAt(i) > 255 ? 2.1 : 1.1;
      }
      colWidths[cIdx] = Math.max(colWidths[cIdx] || 10, Math.min(48, Math.ceil(width) + 3));
    });
  });
  ws['!cols'] = colWidths.map((w) => ({ wch: w }));
  return ws;
}

// 確保 Excel Sheet 名稱合法且不重複（最長 31 字元）
function appendSafeSheet(wb, ws, rawTitle, usedNamesSet) {
  let clean = String(rawTitle || '分頁')
    .replace(/[\\/?*[\]:]/g, '_')
    .trim();
  if (!clean) clean = '分頁';
  let candidate = clean.slice(0, 28);
  let counter = 2;
  while (usedNamesSet.has(candidate)) {
    const suffix = `_${counter++}`;
    candidate = clean.slice(0, 31 - suffix.length) + suffix;
  }
  usedNamesSet.add(candidate);
  XLSX.utils.book_append_sheet(wb, ws, candidate);
}

function exportGuildMembersExcel(targetGuildId = 'ALL') {
  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set();

  if (targetGuildId === 'ALL') {
    const allRows = [['序號', '公會名稱', '角色名稱', '職業']];
    let idx = 1;
    appState.guilds.forEach((g) => {
      g.members.forEach((m) => {
        allRows.push([idx++, g.name, m.name, m.job || '']);
      });
    });
    appendSafeSheet(wb, createSheetWithAutoWidth(allRows), '聯盟全體成員總表', usedSheetNames);

    appState.guilds.forEach((g) => {
      const gRows = [['序號', '角色名稱', '職業']];
      g.members.forEach((m, i) => gRows.push([i + 1, m.name, m.job || '']));
      appendSafeSheet(wb, createSheetWithAutoWidth(gRows), g.name, usedSheetNames);
    });

    XLSX.writeFile(wb, `聯盟公會成員名單_${getTodayDateStr()}.xlsx`);
    showToast('已匯出「聯盟全體公會成員名單」Excel！', 'success');
  } else {
    const guild = appState.guilds.find((g) => g.id === targetGuildId);
    if (!guild) return;
    const gRows = [['序號', '角色名稱', '職業']];
    guild.members.forEach((m, i) => gRows.push([i + 1, m.name, m.job || '']));
    appendSafeSheet(wb, createSheetWithAutoWidth(gRows), guild.name, usedSheetNames);
    XLSX.writeFile(wb, `${guild.name}_成員名單_${getTodayDateStr()}.xlsx`);
    showToast(`已匯出「${guild.name}」成員名單 Excel！`, 'success');
  }
}

/**
 * 匯出完整點名大表 Excel（包含：全分頁數據總覽、跨分頁成員總表、每個大表小分頁完整資料、每個公會分頁完整數據）
 */
function exportFullMasterWorkbook(scope = 'ALL_DATE') {
  let targetSessions = [];
  if (scope === 'CURRENT_ONLY') {
    targetSessions = [getActiveSession()];
  } else if (scope === 'ALL_SESSIONS') {
    targetSessions = Object.values(appState.sessions);
  } else {
    targetSessions = getSubTabsForDate(activeDateStr);
    if (targetSessions.length === 0) targetSessions = [getActiveSession()];
  }

  // 建立最新成員資訊快取，讓隨機組隊與報表皆顯示最新完整名稱與職業
  const liveMemberLookup = {};
  appState.guilds.forEach((g) => {
    g.members.forEach((m) => {
      liveMemberLookup[m.id] = {
        name: m.name,
        job: m.job || '',
        guildName: g.name
      };
    });
  });

  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set();

  // =========================================================================
  // WorkSheet 1：📊 全分頁數據與成員總表 (All Sub-Tabs Summary & Cross-Tab Matrix)
  // =========================================================================
  const overviewRows = [];
  overviewRows.push([
    `📊 聯盟點名大表 — 各分頁全部資料與數據總覽`,
    `匯出時間：${getNowTimeStr()}`,
    `統計範圍：${
      scope === 'ALL_SESSIONS'
        ? `全部歷史日期 (共 ${targetSessions.length} 個分頁)`
        : `${activeDateStr} (共 ${targetSessions.length} 個分頁)`
    }`
  ]);
  overviewRows.push([]);

  // 區塊一：各小分頁 × 各公會出席數據統計表
  overviewRows.push(['【一、各小分頁出席人數與各公會數據統計】']);
  const statHeader = [
    '日期',
    '小分頁名稱',
    '聯盟在場總人數',
    '聯盟總人數',
    '總出席率',
    '有得名人數',
    '隨機組隊數',
    ...appState.guilds.map((g) => `${g.name} (簽到/總數/出席率)`)
  ];
  overviewRows.push(statHeader);

  targetSessions.forEach((sess) => {
    const st = getAttendanceStats(sess.id);
    const records = sess.records || {};
    const rankedCount = Object.values(records).filter((r) => r && r.rank).length;
    const teamCount = Array.isArray(sess.teams) ? sess.teams.length : 0;

    const guildCells = appState.guilds.map((g) => {
      const gst = st.guildStats[g.id] || { checked: 0, total: 0, rate: 0 };
      return `${gst.checked} / ${gst.total} 人 (${gst.rate}%)`;
    });

    overviewRows.push([
      sess.rawDate,
      sess.subName,
      st.totalChecked,
      st.totalMembers,
      `${st.overallRate}%`,
      `${rankedCount} 人`,
      teamCount > 0 ? `${teamCount} 組` : '未分組',
      ...guildCells
    ]);
  });

  overviewRows.push([]);
  overviewRows.push(['【二、全聯盟成員跨分頁完整出席、得名與組隊總表】']);

  // 預先建立每個 session 的 memberId -> 組別對照
  const sessionTeamMaps = {};
  targetSessions.forEach((sess) => {
    const tMap = {};
    (sess.teams || []).forEach((t) => {
      (t.members || []).forEach((m) => {
        tMap[m.memberId] = `第 ${t.teamNumber} 組`;
      });
    });
    sessionTeamMaps[sess.id] = tMap;
  });

  const matrixHeader = [
    '序號',
    '公會名稱',
    '玩家名稱',
    '職業',
    '總出席場數',
    '出席率'
  ];
  targetSessions.forEach((sess) => {
    const label = scope === 'ALL_SESSIONS' ? `${sess.rawDate} ${sess.subName}` : sess.subName;
    matrixHeader.push(`[${label}] 簽到狀態`, `[${label}] 得名名次`, `[${label}] 隨機組隊`, `[${label}] 簽到時間`);
  });
  overviewRows.push(matrixHeader);

  let mIdx = 1;
  appState.guilds.forEach((guild) => {
    guild.members.forEach((member) => {
      let attendedCount = 0;
      const perSessionCells = [];

      targetSessions.forEach((sess) => {
        const rec = (sess.records || {})[member.id];
        const isChecked = !!(rec && rec.checked);
        if (isChecked) attendedCount++;
        const rankStr = (rec && rec.rank) || '-';
        const teamStr = sessionTeamMaps[sess.id][member.id] || '-';
        const timeStr = isChecked ? rec.time || '-' : '-';
        perSessionCells.push(isChecked ? '✅ 在場' : '未簽到', rankStr, teamStr, timeStr);
      });

      const memberRate =
        targetSessions.length > 0
          ? `${Math.round((attendedCount / targetSessions.length) * 100)}%`
          : '0%';

      overviewRows.push([
        mIdx++,
        guild.name,
        member.name,
        member.job || '',
        `${attendedCount} / ${targetSessions.length}`,
        memberRate,
        ...perSessionCells
      ]);
    });
  });

  appendSafeSheet(wb, createSheetWithAutoWidth(overviewRows), '📊全分頁數據與總表', usedSheetNames);

  // =========================================================================
  // WorkSheet 2 ~ N：每個大表「小分頁」各自的完整資料與數據工作表
  // =========================================================================
  targetSessions.forEach((sess) => {
    const st = getAttendanceStats(sess.id);
    const records = sess.records || {};
    const tMap = sessionTeamMaps[sess.id] || {};
    const subRows = [];

    subRows.push([
      `📌 點名大表分頁：${sess.rawDate} — ${sess.subName}`,
      `在場簽到總人數：${st.totalChecked} 人`,
      `聯盟總人數：${st.totalMembers} 人`,
      `總出席率：${st.overallRate}%`
    ]);
    subRows.push([]);

    // 1. 該小分頁的各公會出席統計數據
    subRows.push(['【1. 本分頁各公會出席數據統計】']);
    subRows.push(['公會名稱', '在場簽到人數', '公會總人數', '出席率']);
    appState.guilds.forEach((g) => {
      const gst = st.guildStats[g.id] || { checked: 0, total: 0, rate: 0 };
      subRows.push([g.name, gst.checked, gst.total, `${gst.rate}%`]);
    });
    subRows.push(['聯盟總計', st.totalChecked, st.totalMembers, `${st.overallRate}%`]);
    subRows.push([]);

    // 2. 該小分頁的隨機組隊結果（若有分組）
    if (Array.isArray(sess.teams) && sess.teams.length > 0) {
      subRows.push([`【2. 本分頁隨機組隊名單（每組 ${sess.teamSize || ''} 人，共 ${sess.teams.length} 組）】`]);
      subRows.push(['組別', '隊員序號', '玩家名稱', '職業', '公會名稱', '本場得名']);
      sess.teams.forEach((t) => {
        (t.members || []).forEach((tm, idx) => {
          const live = liveMemberLookup[tm.memberId] || {
            name: tm.memberName,
            job: tm.memberJob || '',
            guildName: tm.guildName
          };
          const rankText = (records[tm.memberId] && records[tm.memberId].rank) || '-';
          subRows.push([
            `第 ${t.teamNumber} 組`,
            idx + 1,
            live.name,
            live.job,
            live.guildName,
            rankText
          ]);
        });
      });
      subRows.push([]);
    }

    // 3. 該小分頁在場已簽到名單
    subRows.push(['【3. 本分頁在場（已簽到）人員明細】']);
    subRows.push([
      '序號',
      '玩家名稱',
      '職業',
      '公會名稱',
      '得名名次',
      '隨機組隊',
      '簽到狀態',
      '簽到時間',
      '勾選會長'
    ]);

    let cIdx = 1;
    appState.guilds.forEach((guild) => {
      guild.members.forEach((member) => {
        const rec = records[member.id];
        if (rec && rec.checked) {
          subRows.push([
            cIdx++,
            member.name,
            member.job || '',
            guild.name,
            rec.rank || '-',
            tMap[member.id] || '-',
            '✅ 在場',
            rec.time || '-',
            rec.by || '-'
          ]);
        }
      });
    });
    if (cIdx === 1) {
      subRows.push(['(本分頁尚無已簽到成員)']);
    }
    subRows.push([]);

    // 4. 該小分頁全體成員簽到狀態明細
    subRows.push(['【4. 本分頁全體聯盟成員簽到狀態明細】']);
    subRows.push([
      '序號',
      '玩家名稱',
      '職業',
      '公會名稱',
      '得名名次',
      '隨機組隊',
      '簽到狀態',
      '簽到時間',
      '勾選會長'
    ]);
    let aIdx = 1;
    appState.guilds.forEach((guild) => {
      guild.members.forEach((member) => {
        const rec = records[member.id];
        const isChecked = !!(rec && rec.checked);
        subRows.push([
          aIdx++,
          member.name,
          member.job || '',
          guild.name,
          (rec && rec.rank) || '-',
          tMap[member.id] || '-',
          isChecked ? '✅ 在場' : '未簽到',
          isChecked ? rec.time || '-' : '-',
          isChecked ? rec.by || '-' : '-'
        ]);
      });
    });

    const sheetTitle =
      scope === 'ALL_SESSIONS' ? `分頁_${sess.rawDate}_${sess.subName}` : `分頁_${sess.subName}`;
    appendSafeSheet(wb, createSheetWithAutoWidth(subRows), sheetTitle, usedSheetNames);
  });

  // =========================================================================
  // WorkSheet N+1 ~ K：各「公會分頁」的獨立完整數據與成員出席表
  // =========================================================================
  appState.guilds.forEach((guild) => {
    const gRows = [];
    gRows.push([
      `🛡️ 公會分頁報表：${guild.name}`,
      `公會總人數：${guild.members.length} 人`,
      `統計場次：共 ${targetSessions.length} 個小分頁`
    ]);
    gRows.push([]);

    // 1. 該公會於各小分頁的出席統計數據
    gRows.push([`【1. ${guild.name} 於各小分頁的出席數據統計】`]);
    gRows.push(['日期', '小分頁名稱', '本公會在場人數', '本公會總人數', '本公會出席率', '本公會得名人數']);
    targetSessions.forEach((sess) => {
      const st = getAttendanceStats(sess.id);
      const gst = st.guildStats[guild.id] || { checked: 0, total: 0, rate: 0 };
      const records = sess.records || {};
      const guildRankedCount = guild.members.filter(
        (m) => records[m.id] && records[m.id].rank
      ).length;
      gRows.push([
        sess.rawDate,
        sess.subName,
        gst.checked,
        gst.total,
        `${gst.rate}%`,
        `${guildRankedCount} 人`
      ]);
    });
    gRows.push([]);

    // 2. 該公會全體成員於各小分頁的詳細紀錄
    gRows.push([`【2. ${guild.name} 成員名單與各分頁簽到/得名/組隊明細】`]);
    const gHeader = ['序號', '角色名稱', '職業', '累積出席場次', '個人出席率'];
    targetSessions.forEach((sess) => {
      const label = scope === 'ALL_SESSIONS' ? `${sess.rawDate} ${sess.subName}` : sess.subName;
      gHeader.push(`[${label}] 簽到`, `[${label}] 得名`, `[${label}] 組別`);
    });
    gRows.push(gHeader);

    guild.members.forEach((member, idx) => {
      let attended = 0;
      const cells = [];
      targetSessions.forEach((sess) => {
        const rec = (sess.records || {})[member.id];
        const isChecked = !!(rec && rec.checked);
        if (isChecked) attended++;
        cells.push(
          isChecked ? '✅ 已簽到' : '未簽到',
          (rec && rec.rank) || '-',
          sessionTeamMaps[sess.id][member.id] || '-'
        );
      });
      const rate =
        targetSessions.length > 0 ? `${Math.round((attended / targetSessions.length) * 100)}%` : '0%';
      gRows.push([
        idx + 1,
        member.name,
        member.job || '',
        `${attended} / ${targetSessions.length}`,
        rate,
        ...cells
      ]);
    });

    appendSafeSheet(wb, createSheetWithAutoWidth(gRows), `公會_${guild.name}`, usedSheetNames);
  });

  const fileSuffix =
    scope === 'ALL_SESSIONS'
      ? `全部歷史分頁總報表_${getTodayDateStr()}`
      : scope === 'CURRENT_ONLY'
      ? getActiveFullTitle().replace(/[\\/?*[\]:\s]/g, '_')
      : `${activeDateStr}_全分頁完整大表`;

  XLSX.writeFile(wb, `聯盟點名大表_${fileSuffix}.xlsx`);
  showToast(
    `📊 已匯出包含 ${targetSessions.length} 個小分頁與 ${appState.guilds.length} 個公會分頁的全部資料與數據 Excel！`,
    'success'
  );
}

// ================= 修改紀錄側邊抽屜 (Audit Logs) =================
function initAuditLogDrawer() {
  const overlay = document.getElementById('logDrawerOverlay');
  document.getElementById('openLogDrawerBtn').addEventListener('click', () => {
    renderAuditLogs();
    overlay.classList.add('active');
  });
  document.getElementById('closeLogDrawerBtn').addEventListener('click', () => {
    overlay.classList.remove('active');
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });

  document.getElementById('logLeaderFilter').addEventListener('change', renderAuditLogs);
  document.getElementById('logSearchInput').addEventListener('input', renderAuditLogs);

  document.getElementById('exportLogsExcelBtn').addEventListener('click', () => {
    const rows = [['時間', '操作會長', '動作類別', '詳細內容']];
    (appState.logs || []).forEach((l) => {
      rows.push([l.time, l.leader, l.action, l.detail]);
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '會長修改紀錄');
    XLSX.writeFile(wb, `聯盟點名修改紀錄_${getTodayDateStr()}.xlsx`);
  });
}

function renderAuditLogs() {
  const logs = appState.logs || [];
  document.getElementById('logCountBadge').textContent = logs.length;

  const leaderFilter = document.getElementById('logLeaderFilter').value;
  const kw = (document.getElementById('logSearchInput').value || '').trim().toLowerCase();

  const filtered = logs.filter((item) => {
    if (leaderFilter !== 'ALL' && item.leader !== leaderFilter) return false;
    if (
      kw &&
      !item.detail.toLowerCase().includes(kw) &&
      !item.action.toLowerCase().includes(kw) &&
      !item.leader.toLowerCase().includes(kw)
    ) {
      return false;
    }
    return true;
  });

  const listEl = document.getElementById('auditLogList');
  listEl.innerHTML = '';

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">目前沒有符合條件的修改紀錄</div>';
    return;
  }

  filtered.slice(0, 200).forEach((item) => {
    const div = document.createElement('div');
    div.className = 'log-item';
    div.innerHTML = `
      <div class="log-item-top">
        <span class="log-leader">👑 ${escapeHtml(item.leader)}</span>
        <span class="log-time">${escapeHtml(item.time)}</span>
      </div>
      <div>
        <span class="log-action-tag">${escapeHtml(item.action)}</span>
        <span>${escapeHtml(item.detail)}</span>
      </div>
    `;
    listEl.appendChild(div);
  });
}

// ================= 跨電腦／跨網路多人雲端即時同步引擎 (預設自動啟用) =================
let mqttClient = null;
let ntfyEventSource = null;
let ntfyPushTimer = null;

function countStateMembers(st) {
  if (!st || !Array.isArray(st.guilds)) return 0;
  return st.guilds.reduce((acc, g) => acc + (Array.isArray(g.members) ? g.members.length : 0), 0);
}

function loadSyncConfig() {
  const params = new URLSearchParams(window.location.search);
  const urlDb = params.get('db');
  const urlRoom = params.get('room');
  if (urlDb || urlRoom) {
    const cfg = {
      enabled: true,
      dbUrl: (urlDb || '').replace(/\/+$/, ''),
      roomKey: (urlRoom || 'cat-ab-alliance').replace(/[.#$[\]/\s]/g, '_')
    };
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
    return cfg;
  }

  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // 自動為舊設定開啟內建跨網雲端同步
      if (typeof parsed.enabled !== 'boolean' || (!parsed.dbUrl && parsed.enabled === false && !parsed.userDisabled)) {
        parsed.enabled = true;
      }
      if (!parsed.roomKey) parsed.roomKey = 'cat-ab-alliance';
      return parsed;
    }
  } catch (e) {}
  return { enabled: true, dbUrl: '', roomKey: 'cat-ab-alliance' };
}

function getSafeRoomKey() {
  return (syncConfig.roomKey || 'cat-ab-alliance').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getNtfyTopicUrl() {
  return `https://ntfy.sh/cat_ab_alliance_v2_${getSafeRoomKey()}`;
}

function getMqttTopic() {
  return `cat_ab_alliance_rollcall_v2/${getSafeRoomKey()}`;
}

function getCloudEndpointUrl() {
  if (!syncConfig.dbUrl) return null;
  const base = syncConfig.dbUrl.replace(/\/+$/, '');
  return `${base}/alliances/${encodeURIComponent(getSafeRoomKey())}.json`;
}

// 智慧型套用雲端狀態（保護已匯入成員名單不被空白預設值覆蓋）
function applyIncomingCloudState(remoteData, forceApply = false) {
  if (!remoteData || !Array.isArray(remoteData.guilds) || !remoteData.sessions) return false;

  const localMemberCount = countStateMembers(appState);
  const remoteMemberCount = countStateMembers(remoteData);
  const localUpdated = appState.updatedAt || 0;
  const remoteUpdated = remoteData.updatedAt || 0;

  if (!forceApply) {
    // 若雲端仍是出場預設 (<=3人且 isFactoryDefault)，但本機已有完整匯入名單 (>3人)，則自動把本機完整資料推上雲端！
    if (remoteData.isFactoryDefault && localMemberCount > 3) {
      pushStateToCloud(false);
      return false;
    }
    // 若時間戳相同則不重複渲染
    if (remoteUpdated > 0 && remoteUpdated === localUpdated) {
      return false;
    }
    // 若本機不是預設值，且本機時間戳比雲端更新，則保留本機並推上雲端
    if (!appState.isFactoryDefault && localUpdated > remoteUpdated && localMemberCount >= remoteMemberCount) {
      return false;
    }
  }

  isApplyingRemoteUpdate = true;
  appState = migrateAndRepairState(remoteData);
  appState.isFactoryDefault = false;
  saveState(true);
  renderAll();
  isApplyingRemoteUpdate = false;
  return true;
}

function initCloudSync() {
  const openSyncModal = () => {
    document.getElementById('firebaseDbUrlInput').value = syncConfig.dbUrl || '';
    document.getElementById('syncRoomKeyInput').value = syncConfig.roomKey || 'cat-ab-alliance';
    openModal('syncModal');
  };

  document.getElementById('openSyncModalBtn').addEventListener('click', openSyncModal);
  document.getElementById('syncStatusBadge').addEventListener('click', openSyncModal);

  document.getElementById('saveSyncConfigBtn').addEventListener('click', async () => {
    const rawUrl = document.getElementById('firebaseDbUrlInput').value.trim();
    const rawRoom = document.getElementById('syncRoomKeyInput').value.trim() || 'cat-ab-alliance';
    syncConfig = {
      enabled: true,
      userDisabled: false,
      dbUrl: rawUrl ? rawUrl.replace(/\/+$/, '') : '',
      roomKey: rawRoom.replace(/[.#$[\]/\s]/g, '_')
    };
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(syncConfig));
    updateSyncBadgeUI();
    closeModal('syncModal');
    await connectToCloudRealtime();
    showToast(`☁️ 已啟用跨網路即時同步（房間：${syncConfig.roomKey}）！`, 'success');
  });

  document.getElementById('disconnectCloudBtn').addEventListener('click', () => {
    disconnectAllCloudChannels();
    syncConfig.enabled = false;
    syncConfig.userDisabled = true;
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(syncConfig));
    updateSyncBadgeUI();
    closeModal('syncModal');
    showToast('已暫停雲端同步，切換為單機模式', 'info');
  });

  document.getElementById('copyShareUrlBtn').addEventListener('click', () => {
    const rawUrl = document.getElementById('firebaseDbUrlInput').value.trim() || syncConfig.dbUrl;
    const rawRoom =
      document.getElementById('syncRoomKeyInput').value.trim() ||
      syncConfig.roomKey ||
      'cat-ab-alliance';
    let shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(rawRoom)}`;
    if (rawUrl) {
      shareUrl += `&db=${encodeURIComponent(rawUrl)}`;
    }
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('🔗 已複製同步網址！任何人在不同電腦或網路點開此網址都能同步相同資料。', 'success');
    });
  });

  document.getElementById('forcePushCloudBtn').addEventListener('click', async () => {
    if (!requireLeaderPermission()) return;
    appState.updatedAt = Date.now();
    appState.isFactoryDefault = false;
    await pushStateToCloud(true);
  });

  document.getElementById('forcePullCloudBtn').addEventListener('click', async () => {
    await pullStateFromCloud(true);
  });

  if (broadcastChannel) {
    broadcastChannel.onmessage = (ev) => {
      if (ev.data?.type === 'STATE_UPDATED' && ev.data.state) {
        isApplyingRemoteUpdate = true;
        appState = ev.data.state;
        renderAll();
        isApplyingRemoteUpdate = false;
      }
    };
  }

  updateSyncBadgeUI();
  if (syncConfig.enabled) {
    connectToCloudRealtime();
  }
}

function disconnectAllCloudChannels() {
  if (cloudEventSource) {
    cloudEventSource.close();
    cloudEventSource = null;
  }
  if (ntfyEventSource) {
    ntfyEventSource.close();
    ntfyEventSource = null;
  }
  if (mqttClient) {
    try {
      mqttClient.end(true);
    } catch (e) {}
    mqttClient = null;
  }
}

function updateSyncBadgeUI() {
  const badge = document.getElementById('syncStatusBadge');
  if (syncConfig.enabled) {
    badge.className = 'sync-badge cloud';
    badge.textContent = `☁️ 跨網路即時同步中 (${syncConfig.roomKey})`;
  } else {
    badge.className = 'sync-badge local';
    badge.textContent = '💾 本機儲存模式 (點擊開啟跨網路同步)';
  }
}

async function pushStateToCloud(showSuccessToast = false) {
  if (!syncConfig.enabled) return;
  const payloadStr = JSON.stringify(appState);

  // 通道 1：MQTT WebSocket 即時推播 + Retain 永久保留最新狀態
  if (mqttClient && mqttClient.connected) {
    try {
      mqttClient.publish(getMqttTopic(), payloadStr, { qos: 1, retain: true });
    } catch (e) {
      console.warn('MQTT publish error:', e);
    }
  }

  // 通道 2：Ntfy 雲端快取 (防抖 350ms 避免連續打勾觸發頻率限制)
  if (ntfyPushTimer) clearTimeout(ntfyPushTimer);
  const doNtfyPush = async () => {
    try {
      const res = await fetch(getNtfyTopicUrl(), {
        method: 'POST',
        body: payloadStr
      });
      if (res.ok && showSuccessToast) {
        showToast('⬆️ 已成功將最新資料同步至雲端，所有電腦皆已更新！', 'success');
      }
    } catch (err) {
      console.warn('Ntfy push error:', err);
    }
  };

  if (showSuccessToast) {
    await doNtfyPush();
  } else {
    ntfyPushTimer = setTimeout(doNtfyPush, 350);
  }

  // 通道 3：若有設定自訂 Firebase Realtime Database，同步寫入
  const fbEndpoint = getCloudEndpointUrl();
  if (fbEndpoint) {
    try {
      await fetch(fbEndpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payloadStr
      });
    } catch (e) {
      console.warn('Firebase push error:', e);
    }
  }
}

async function parseNtfyPacketData(packet) {
  if (!packet || packet.event !== 'message') return null;
  if (packet.attachment && packet.attachment.url) {
    const attRes = await fetch(packet.attachment.url);
    if (!attRes.ok) return null;
    return await attRes.json();
  }
  if (packet.message && packet.message.startsWith('{')) {
    return JSON.parse(packet.message);
  }
  return null;
}

async function pullStateFromCloud(showSuccessToast = false) {
  if (!syncConfig.enabled) return;
  let pulledAny = false;

  // 1. 若有設定自訂 Firebase 優先讀取
  const fbEndpoint = getCloudEndpointUrl();
  if (fbEndpoint) {
    try {
      const res = await fetch(fbEndpoint);
      if (res.ok) {
        const remoteData = await res.json();
        if (remoteData && remoteData.guilds) {
          applyIncomingCloudState(remoteData, showSuccessToast);
          pulledAny = true;
        }
      }
    } catch (e) {}
  }

  // 2. 從內建 Ntfy 雲端快取拉取最新一筆狀態
  try {
    const res = await fetch(`${getNtfyTopicUrl()}/json?poll=1`);
    if (res.ok) {
      const text = await res.text();
      const lines = text
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const pkt = JSON.parse(lines[i]);
          const remoteData = await parseNtfyPacketData(pkt);
          if (remoteData && remoteData.guilds && remoteData.sessions) {
            applyIncomingCloudState(remoteData, showSuccessToast);
            pulledAny = true;
            break;
          }
        } catch (innerErr) {}
      }
    }
  } catch (err) {
    console.warn('Ntfy pull warning:', err);
  }

  if ( !pulledAny && !appState.isFactoryDefault ) {
    // 若雲端尚無任何紀錄且本機已有資料，主動將本機資料推上雲端初始化！
    await pushStateToCloud(false);
  } else if (showSuccessToast && pulledAny) {
    showToast('⬇️ 已從雲端同步最新點名資料！', 'success');
  }
}

async function connectToCloudRealtime() {
  disconnectAllCloudChannels();
  if (!syncConfig.enabled) return;

  // 1. 啟動 MQTT over WebSocket (連線至公開 EMQX 叢集，秒級接收 Retain 狀態與即時變更)
  if (typeof mqtt !== 'undefined') {
    try {
      const topic = getMqttTopic();
      mqttClient = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
        clientId: `cat_ab_${Math.random().toString(16).slice(2, 10)}`,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 4000
      });

      mqttClient.on('connect', () => {
        mqttClient.subscribe(topic, { qos: 1 }, (err) => {
          if (!err && !appState.isFactoryDefault && countStateMembers(appState) > 3) {
            // 若本機已有匯入名單，確保推播保留至 MQTT Retain
            mqttClient.publish(topic, JSON.stringify(appState), { qos: 1, retain: true });
          }
        });
      });

      mqttClient.on('message', (recvTopic, messageBuffer) => {
        if (recvTopic !== topic) return;
        try {
          const remoteData = JSON.parse(messageBuffer.toString());
          applyIncomingCloudState(remoteData, false);
        } catch (e) {}
      });
    } catch (e) {
      console.warn('MQTT init warning:', e);
    }
  }

  // 2. 拉取 Ntfy / Firebase 現有快取資料
  await pullStateFromCloud(false);

  // 3. 監聽 Ntfy SSE 即時串流
  try {
    ntfyEventSource = new EventSource(`${getNtfyTopicUrl()}/sse`);
    ntfyEventSource.onmessage = async (e) => {
      try {
        const pkt = JSON.parse(e.data);
        const remoteData = await parseNtfyPacketData(pkt);
        if (remoteData) {
          applyIncomingCloudState(remoteData, false);
        }
      } catch (err) {}
    };
  } catch (e) {}

  // 4. 若有設定自訂 Firebase，同步監聽 Firebase SSE
  const fbEndpoint = getCloudEndpointUrl();
  if (fbEndpoint) {
    try {
      cloudEventSource = new EventSource(fbEndpoint);
      cloudEventSource.addEventListener('put', (e) => {
        try {
          const packet = JSON.parse(e.data);
          if (packet.path === '/' && packet.data && packet.data.guilds) {
            applyIncomingCloudState(packet.data, false);
          } else if (packet.path !== '/') {
            pullStateFromCloud(false);
          }
        } catch (err) {}
      });
    } catch (err) {}
  }
}

// ================= 通用 Modal 與拖放工具 =================
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function setupDragAndDrop(zoneId, onFileCallback) {
  const zone = document.getElementById(zoneId);
  ['dragenter', 'dragover'].forEach((evt) => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('dragover');
    });
  });
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) onFileCallback(file);
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ================= 表格標題點擊排序功能 =================
function parseRankNumericValue(rankStr) {
  if (!rankStr || !String(rankStr).trim()) return null;
  const m = String(rankStr).match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  return 9999; // 自訂文字獎項如 MVP、參加獎排在數字名次之後、未得名之前
}

function compareValuesWithEmptyLast(valA, valB, dir, isNumeric = false) {
  const emptyA = valA === null || valA === undefined || valA === '' || valA === '-';
  const emptyB = valB === null || valB === undefined || valB === '' || valB === '-';
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1; // 空值永遠置底，方便檢視有效資料
  if (emptyB) return -1;

  const factor = dir === 'desc' ? -1 : 1;
  if (isNumeric) {
    return (Number(valA) - Number(valB)) * factor;
  }
  return String(valA).localeCompare(String(valB), 'zh-Hant-TW', { numeric: true }) * factor;
}

function sortMasterRows(rows, sortState) {
  if (!sortState || !sortState.key || !sortState.dir) return;
  const { key, dir } = sortState;

  rows.sort((a, b) => {
    if (key === 'memberName') {
      return compareValuesWithEmptyLast(a.memberName, b.memberName, dir);
    }
    if (key === 'memberJob') {
      const cmp = compareValuesWithEmptyLast(a.memberJob, b.memberJob, dir);
      return cmp !== 0 ? cmp : a.memberName.localeCompare(b.memberName, 'zh-Hant-TW');
    }
    if (key === 'guildName') {
      const cmp = compareValuesWithEmptyLast(a.guildName, b.guildName, dir);
      return cmp !== 0 ? cmp : a.memberName.localeCompare(b.memberName, 'zh-Hant-TW');
    }
    if (key === 'rank') {
      const numA = parseRankNumericValue(a.rank);
      const numB = parseRankNumericValue(b.rank);
      const cmp = compareValuesWithEmptyLast(numA, numB, dir, true);
      if (cmp !== 0) return cmp;
      return compareValuesWithEmptyLast(a.rank, b.rank, dir);
    }
    if (key === 'team') {
      const cmp = compareValuesWithEmptyLast(a.teamNum, b.teamNum, dir, true);
      return cmp !== 0 ? cmp : a.memberName.localeCompare(b.memberName, 'zh-Hant-TW');
    }
    if (key === 'isChecked') {
      const vA = a.isChecked ? 1 : 0;
      const vB = b.isChecked ? 1 : 0;
      const factor = dir === 'desc' ? -1 : 1;
      return (vB - vA) * factor;
    }
    if (key === 'time') {
      return compareValuesWithEmptyLast(a.time, b.time, dir);
    }
    return 0;
  });
}

function sortGuildMembers(members, records, sortState) {
  if (!sortState || !sortState.key || !sortState.dir) return;
  const { key, dir } = sortState;

  members.sort((a, b) => {
    const recA = records[a.id];
    const recB = records[b.id];
    const checkedA = !!(recA && recA.checked);
    const checkedB = !!(recB && recB.checked);

    if (key === 'name') {
      return compareValuesWithEmptyLast(a.name, b.name, dir);
    }
    if (key === 'job') {
      const cmp = compareValuesWithEmptyLast(a.job, b.job, dir);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name, 'zh-Hant-TW');
    }
    if (key === 'rank') {
      const numA = parseRankNumericValue(recA?.rank);
      const numB = parseRankNumericValue(recB?.rank);
      const cmp = compareValuesWithEmptyLast(numA, numB, dir, true);
      if (cmp !== 0) return cmp;
      return compareValuesWithEmptyLast(recA?.rank, recB?.rank, dir);
    }
    if (key === 'isChecked') {
      const vA = checkedA ? 1 : 0;
      const vB = checkedB ? 1 : 0;
      const factor = dir === 'desc' ? -1 : 1;
      return (vB - vA) * factor;
    }
    if (key === 'time') {
      const tA = checkedA ? recA.time : '';
      const tB = checkedB ? recB.time : '';
      return compareValuesWithEmptyLast(tA, tB, dir);
    }
    return 0;
  });
}

function updateSortHeadersUI(selector, datasetKey, sortState) {
  document.querySelectorAll(selector).forEach((th) => {
    const colKey = th.dataset[datasetKey];
    const icon = th.querySelector('.sort-icon');
    if (sortState.key === colKey && sortState.dir) {
      th.classList.add('sort-active');
      if (icon) icon.textContent = sortState.dir === 'asc' ? '▲' : '▼';
    } else {
      th.classList.remove('sort-active');
      if (icon) icon.textContent = '⇅';
    }
  });
}

function cycleSortState(stateObj, clickedKey) {
  if (stateObj.key !== clickedKey) {
    stateObj.key = clickedKey;
    stateObj.dir = 'asc';
  } else if (stateObj.dir === 'asc') {
    stateObj.dir = 'desc';
  } else {
    stateObj.key = null;
    stateObj.dir = null;
  }
}

function initTableSorting() {
  document.querySelectorAll('[data-master-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      cycleSortState(masterSortState, th.dataset.masterSort);
      renderMasterView();
    });
  });

  document.querySelectorAll('[data-guild-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      cycleSortState(guildSortState, th.dataset.guildSort);
      if (activeTab !== 'MASTER') renderGuildView(activeTab);
    });
  });
}

// ================= 初始化綁定 =================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  document.getElementById('confirmDeleteExecuteBtn').addEventListener('click', () => {
    if (typeof pendingDeleteAction === 'function') {
      pendingDeleteAction();
      pendingDeleteAction = null;
    }
    closeModal('confirmDeleteModal');
  });

  initAuth();
  initSubTabActions();
  initRankConfigModal();
  initRandomTeamActions();
  initGuildActions();
  initImportAndOcr();
  initExportActions();
  initAuditLogDrawer();
  initCloudSync();
  initTableSorting();
  renderAll();
});

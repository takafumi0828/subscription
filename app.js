const DB_NAME = 'subshelf-db';
const STORE_NAME = 'subscriptions';
const DB_VERSION = 1;

const FREQUENCIES = {
  weekly: { label: '週', days: 7, monthlyFactor: 52 / 12 },
  monthly: { label: '月', months: 1, monthlyFactor: 1 },
  bimonthly: { label: '隔月', months: 2, monthlyFactor: 1 / 2 },
  quarterly: { label: '四半期', months: 3, monthlyFactor: 1 / 3 },
  yearly: { label: '年', months: 12, monthlyFactor: 1 / 12 },
  oneTime: { label: '都度', months: null, monthlyFactor: 0 },
};

const CATEGORY_PRESETS = ['動画', '音楽', 'クラウド', '学習', '仕事', '健康', 'ユーティリティ'];
const PAYMENT_PRESETS = ['クレジットカード', 'デビットカード', 'Apple Pay', 'Google Pay', '銀行引落'];
const NAVS = [
  ['home', 'ホーム'],
  ['list', '一覧'],
  ['add', '追加'],
  ['dashboard', '集計'],
  ['data', 'データ'],
];

const state = {
  subscriptions: [],
  view: 'home',
  editingId: null,
  bulkMode: false,
  filters: {
    search: '',
    sort: 'nextBillingDate',
    category: 'all',
    frequency: 'all',
    autoRenew: 'all',
    status: 'active',
  },
};

const els = {};

function initEls() {
  [
    'this-week-list', 'overdue-list', 'subscription-list', 'search-input', 'sort-select',
    'filter-category', 'filter-frequency', 'filter-auto-renew', 'filter-status', 'bottom-nav',
    'subscription-form', 'frequency-input', 'next-billing-input', 'cancel-edit', 'form-title',
    'monthly-total', 'yearly-total', 'category-totals', 'top-subscriptions',
    'backup-json', 'export-csv', 'restore-json', 'bulk-process-toggle',
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbBulkPut(items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    items.forEach((item) => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function formatYen(v) { return `¥${Number(v || 0).toLocaleString('ja-JP')}`; }
function todayISO() { return new Date().toISOString().slice(0, 10); }

function addCycle(dateStr, frequency) {
  const def = FREQUENCIES[frequency];
  if (!def || frequency === 'oneTime') return dateStr;
  const d = new Date(`${dateStr}T00:00:00`);
  if (def.days) d.setDate(d.getDate() + def.days);
  if (def.months) d.setMonth(d.getMonth() + def.months);
  return d.toISOString().slice(0, 10);
}

function suggestNextDate(frequency) {
  return addCycle(todayISO(), frequency);
}

function toMonthly(amount, frequency) {
  const f = FREQUENCIES[frequency];
  return Number(amount || 0) * (f?.monthlyFactor ?? 0);
}

function filteredList() {
  return state.subscriptions
    .filter((s) => {
      const target = `${s.serviceName} ${(s.tags || []).join(' ')}`.toLowerCase();
      if (state.filters.search && !target.includes(state.filters.search.toLowerCase())) return false;
      if (state.filters.category !== 'all' && (s.category || '') !== state.filters.category) return false;
      if (state.filters.frequency !== 'all' && s.frequency !== state.filters.frequency) return false;
      if (state.filters.autoRenew !== 'all' && String(s.autoRenew) !== state.filters.autoRenew) return false;
      if (state.filters.status !== 'all' && s.status !== state.filters.status) return false;
      return true;
    })
    .sort((a, b) => {
      if (state.filters.sort === 'amount') return b.amount - a.amount;
      return a.nextBillingDate.localeCompare(b.nextBillingDate);
    });
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(`${view}-view`).classList.add('active');
  [...els['bottom-nav'].children].forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
}

function createActionButton(label, onClick, className = 'ghost') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.className = className;
  btn.onclick = onClick;
  return btn;
}

function renderHome() {
  const now = todayISO();
  const weekEnd = addCycle(now, 'weekly');
  const active = state.subscriptions.filter((s) => s.status === 'active');
  const thisWeek = active.filter((s) => s.nextBillingDate >= now && s.nextBillingDate <= weekEnd);
  const overdue = active.filter((s) => s.nextBillingDate < now);

  const weekEl = els['this-week-list'];
  weekEl.innerHTML = '';
  if (!thisWeek.length) weekEl.innerHTML = '<li class="empty">今週の請求予定はありません。</li>';
  thisWeek.forEach((s) => weekEl.appendChild(renderHomeItem(s, false)));

  const overEl = els['overdue-list'];
  overEl.innerHTML = '';
  if (!overdue.length) overEl.innerHTML = '<li class="empty">期限超過はありません。</li>';
  overdue.forEach((s) => overEl.appendChild(renderHomeItem(s, state.bulkMode)));
}

function renderHomeItem(sub, bulk) {
  const li = document.createElement('li');
  li.className = 'item';
  li.innerHTML = `
    <div>
      <strong>${sub.serviceName}</strong>
      <div class="meta">${formatYen(sub.amount)} / ${FREQUENCIES[sub.frequency].label} ・ ${sub.nextBillingDate}</div>
    </div>
  `;
  const actions = document.createElement('div');
  actions.className = 'row gap wrap';
  actions.appendChild(createActionButton('請求済', async () => { await markPaid(sub.id); }));
  if (bulk) {
    actions.appendChild(createActionButton('停止', async () => { await setStopped(sub.id); }));
    actions.appendChild(createActionButton('金額変更', () => { fillForm(sub.id); setView('add'); }, 'primary'));
  }
  li.appendChild(actions);
  return li;
}

function renderList() {
  const list = els['subscription-list'];
  list.innerHTML = '';
  const items = filteredList();
  if (!items.length) {
    list.innerHTML = '<li class="empty">条件に合うデータがありません。</li>';
    return;
  }
  items.forEach((s) => {
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = `
      <div>
        <strong>${s.serviceName}</strong>
        <div class="meta">${formatYen(s.amount)} / ${FREQUENCIES[s.frequency].label} ・ 次回 ${s.nextBillingDate}</div>
        <div class="meta">${s.category || '-'} / ${s.status === 'active' ? 'アクティブ' : '停止'} / ${s.autoRenew ? '自動更新' : '手動更新'}</div>
      </div>
    `;
    const actions = document.createElement('div');
    actions.className = 'row gap wrap';
    if (s.status === 'active') {
      actions.appendChild(createActionButton('請求済みにする', async () => markPaid(s.id), 'primary'));
      actions.appendChild(createActionButton('停止', async () => setStopped(s.id)));
    } else {
      actions.appendChild(createActionButton('再開', async () => setActive(s.id), 'primary'));
    }
    actions.appendChild(createActionButton('編集', () => { fillForm(s.id); setView('add'); }));
    li.appendChild(actions);
    list.appendChild(li);
  });
}

function renderDashboard() {
  const active = state.subscriptions.filter((s) => s.status === 'active');
  const monthly = active.reduce((sum, s) => sum + toMonthly(s.amount, s.frequency), 0);
  els['monthly-total'].textContent = formatYen(Math.round(monthly));
  els['yearly-total'].textContent = formatYen(Math.round(monthly * 12));

  const byCategory = {};
  active.forEach((s) => {
    const key = s.category || '未分類';
    byCategory[key] = (byCategory[key] || 0) + toMonthly(s.amount, s.frequency);
  });
  const catEl = els['category-totals'];
  catEl.innerHTML = '';
  Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    const li = document.createElement('li');
    li.className = 'item compact';
    li.textContent = `${k}: ${formatYen(Math.round(v))}`;
    catEl.appendChild(li);
  });
  if (!catEl.childElementCount) catEl.innerHTML = '<li class="empty">データがありません。</li>';

  const topEl = els['top-subscriptions'];
  topEl.innerHTML = '';
  active
    .map((s) => ({ ...s, monthly: toMonthly(s.amount, s.frequency) }))
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, 10)
    .forEach((s) => {
      const li = document.createElement('li');
      li.className = 'item compact';
      li.textContent = `${s.serviceName} (${formatYen(Math.round(s.monthly))}/月換算)`;
      topEl.appendChild(li);
    });
  if (!topEl.childElementCount) topEl.innerHTML = '<li class="empty">データがありません。</li>';
}

function render() {
  renderHome();
  renderList();
  renderDashboard();
}

function fillPresets() {
  const cat = document.getElementById('category-presets');
  cat.innerHTML = CATEGORY_PRESETS.map((c) => `<option value="${c}"></option>`).join('');
  const pay = document.getElementById('payment-presets');
  pay.innerHTML = PAYMENT_PRESETS.map((c) => `<option value="${c}"></option>`).join('');

  const freqSelect = els['frequency-input'];
  freqSelect.innerHTML = Object.entries(FREQUENCIES).map(([value, def]) => `<option value="${value}">${def.label}</option>`).join('');
  freqSelect.value = 'monthly';
  els['next-billing-input'].value = suggestNextDate('monthly');

  fillSelect(els['filter-category'], ['all', ...CATEGORY_PRESETS], { all: 'カテゴリ: すべて' });
  fillSelect(els['filter-frequency'], ['all', ...Object.keys(FREQUENCIES)], { all: '頻度: すべて', ...Object.fromEntries(Object.entries(FREQUENCIES).map(([k, v]) => [k, v.label])) });
  fillSelect(els['filter-auto-renew'], ['all', 'true', 'false'], { all: '自動更新: すべて', true: '自動更新: Yes', false: '自動更新: No' });
  fillSelect(els['filter-status'], ['all', 'active', 'stopped'], { all: '状態: すべて', active: '状態: アクティブ', stopped: '状態: 停止' });
}

function fillSelect(el, values, labels = {}) {
  el.innerHTML = values.map((v) => `<option value="${v}">${labels[v] || v}</option>`).join('');
}

function fillForm(id) {
  const target = state.subscriptions.find((s) => s.id === id);
  if (!target) return;
  state.editingId = id;
  els['form-title'].textContent = 'サブスクを編集';
  els['cancel-edit'].classList.remove('hidden');
  const f = els['subscription-form'];
  f.serviceName.value = target.serviceName;
  f.amount.value = target.amount;
  f.frequency.value = target.frequency;
  f.nextBillingDate.value = target.nextBillingDate;
  f.category.value = target.category || '';
  f.paymentMethod.value = target.paymentMethod || '';
  f.tags.value = (target.tags || []).join(', ');
  f.memo.value = target.memo || '';
  f.autoRenew.value = String(target.autoRenew);
}

function resetForm() {
  state.editingId = null;
  els['form-title'].textContent = '追加（最短30秒）';
  els['cancel-edit'].classList.add('hidden');
  els['subscription-form'].reset();
  els['frequency-input'].value = 'monthly';
  els['next-billing-input'].value = suggestNextDate('monthly');
}

async function markPaid(id) {
  const item = state.subscriptions.find((s) => s.id === id);
  if (!item) return;
  item.nextBillingDate = addCycle(item.nextBillingDate, item.frequency);
  item.lastConfirmedAt = new Date().toISOString();
  item.updatedAt = item.lastConfirmedAt;
  await dbPut(item);
  await refresh();
}

async function setStopped(id) {
  const item = state.subscriptions.find((s) => s.id === id);
  if (!item) return;
  item.status = 'stopped';
  item.updatedAt = new Date().toISOString();
  await dbPut(item);
  await refresh();
}

async function setActive(id) {
  const item = state.subscriptions.find((s) => s.id === id);
  if (!item) return;
  item.status = 'active';
  item.updatedAt = new Date().toISOString();
  await dbPut(item);
  await refresh();
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCSV(rows) {
  const headers = ['serviceName', 'amount', 'frequency', 'nextBillingDate', 'category', 'paymentMethod', 'tags', 'autoRenew', 'status', 'memo'];
  const body = rows.map((r) => headers.map((h) => {
    const val = h === 'tags' ? (r.tags || []).join('|') : (r[h] ?? '');
    return `"${String(val).replaceAll('"', '""')}"`;
  }).join(','));
  return [headers.join(','), ...body].join('\n');
}

async function refresh() {
  state.subscriptions = await dbAll();
  render();
}

function initNav() {
  els['bottom-nav'].innerHTML = '';
  NAVS.forEach(([view, label]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.view = view;
    btn.className = view === state.view ? 'active' : '';
    btn.onclick = () => setView(view);
    els['bottom-nav'].appendChild(btn);
  });
}

function bindEvents() {
  els['search-input'].oninput = (e) => { state.filters.search = e.target.value; renderList(); };
  els['sort-select'].onchange = (e) => { state.filters.sort = e.target.value; renderList(); };
  ['category', 'frequency', 'auto-renew', 'status'].forEach((k) => {
    const map = { 'auto-renew': 'autoRenew' };
    els[`filter-${k}`].onchange = (e) => { state.filters[map[k] || k] = e.target.value; renderList(); };
  });

  els['frequency-input'].onchange = (e) => {
    els['next-billing-input'].value = suggestNextDate(e.target.value);
  };

  els['subscription-form'].onsubmit = async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const now = new Date().toISOString();
    const data = {
      id: state.editingId || crypto.randomUUID(),
      serviceName: f.serviceName.value.trim(),
      amount: Number(f.amount.value),
      frequency: f.frequency.value,
      nextBillingDate: f.nextBillingDate.value,
      category: f.category.value.trim(),
      paymentMethod: f.paymentMethod.value.trim(),
      tags: f.tags.value.split(',').map((x) => x.trim()).filter(Boolean),
      memo: f.memo.value.trim(),
      autoRenew: f.autoRenew.value === 'true',
      status: state.editingId ? (state.subscriptions.find((s) => s.id === state.editingId)?.status || 'active') : 'active',
      lastConfirmedAt: state.editingId ? state.subscriptions.find((s) => s.id === state.editingId)?.lastConfirmedAt || null : null,
      createdAt: state.editingId ? state.subscriptions.find((s) => s.id === state.editingId)?.createdAt || now : now,
      updatedAt: now,
    };
    await dbPut(data);
    resetForm();
    await refresh();
    setView('list');
  };

  els['cancel-edit'].onclick = () => resetForm();

  els['backup-json'].onclick = () => {
    download(`subshelf-backup-${todayISO()}.json`, JSON.stringify(state.subscriptions, null, 2), 'application/json');
  };

  els['export-csv'].onclick = () => {
    download(`subshelf-${todayISO()}.csv`, toCSV(state.subscriptions), 'text/csv;charset=utf-8');
  };

  els['restore-json'].onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      alert('JSON形式が不正です');
      return;
    }
    await dbBulkPut(data);
    await refresh();
    alert('復元しました');
  };

  els['bulk-process-toggle'].onclick = () => {
    state.bulkMode = !state.bulkMode;
    els['bulk-process-toggle'].textContent = state.bulkMode ? '通常表示' : '一括処理';
    renderHome();
  };
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

async function init() {
  initEls();
  fillPresets();
  initNav();
  bindEvents();
  await refresh();
  registerSW();
}

init();

const STORAGE_KEY = 'fueltrack_data_v1';
const DEFAULT_STATE = {
  vehicles: [], activeVehicleId: null, fuelEntries: [],
  shifts: [],
  reminders: [], settings: { theme: 'dark', units: 'metric', currency: 'RUB', distanceUnit: 'km', volumeUnit: 'L' }
};
let state = loadState();
let charts = {};
let currentTab = 'dashboard';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function uid() { return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function fmt(n, d = 2) { if (n === null || n === undefined || isNaN(n)) return '—'; return Number(n).toFixed(d); }
function fmtMoney(n) { return fmt(n, 2) + ' ' + (state.settings.currency || '₽'); }
function today() { return new Date().toISOString().slice(0, 10); }
function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(100%)'; setTimeout(() => t.remove(), 300); }, 3000);
}
function openModal(html) {
  const o = document.getElementById('modalOverlay');
  const m = document.getElementById('modal');
  m.innerHTML = html;
  o.classList.add('open');
  m.querySelector('.modal-close')?.addEventListener('click', closeModal);
  o.addEventListener('click', (e) => { if (e.target === o) closeModal(); }, { once: true });
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }

function initNav() {
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.addEventListener('click', () => {
      const tab = b.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      currentTab = tab;
      renderTab(tab);
    });
  });
}
function renderTab(tab) {
  const el = document.getElementById('tab-' + tab);
  switch (tab) {
    case 'dashboard': renderDashboard(el); break;
    case 'vehicles': renderVehicles(el); break;
    case 'fuel': renderFuel(el); break;
    case 'stats': renderStats(el); break;
    case 'reminders': renderReminders(el); break;
    case 'shifts': renderShifts(el); break;
    case 'settings': renderSettings(el); break;
  }
}
function applyTheme() {
  document.body.classList.toggle('light', state.settings.theme === 'light');
  document.getElementById('themeBtn').textContent = state.settings.theme === 'light' ? '☀️' : '🌙';
}
function toggleTheme() {
  state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light';
  saveState(); applyTheme();
}
function activeVehicle() {
  return state.vehicles.find(v => v.id === state.activeVehicleId) || state.vehicles[0] || null;
}
function setActiveVehicle(id) { state.activeVehicleId = id; saveState(); renderTab(currentTab); }
function calcConsumption(entries) {
  const sorted = [...entries].sort((a, b) => a.odometer - b.odometer);
  const res = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], cur = sorted[i];
    if (cur.fullTank && prev.fullTank) {
      const dist = cur.odometer - prev.odometer;
      if (dist > 0) res.push({ date: cur.date, consumption: (cur.volume / dist) * 100, distance: dist, volume: cur.volume, cost: cur.total });
    }
  }
  return res;
}
function avgConsumption(entries) {
  const c = calcConsumption(entries);
  if (!c.length) return null;
  return c.reduce((s, x) => s + x.consumption, 0) / c.length;
}
function totalSpent() {
  return state.fuelEntries.reduce((s, e) => s + (e.total || 0), 0);
}
function co2FromLiters(liters, fuelType) {
  const factors = { gasoline: 2.31, diesel: 2.68, lpg: 1.51, cng: 1.9, electric: 0 };
  return liters * (factors[fuelType] || 2.31);
}
function init() {
  applyTheme();
  initNav();
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('voiceBtn').addEventListener('click', startVoice);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('fab').addEventListener('click', fabAction);
  if (!state.vehicles.length) seedDemo();
  renderTab('dashboard');
  if (firebaseReady) firebaseSyncLoad();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
window.addEventListener('DOMContentLoaded', init);

function seedDemo() {
  const v = { id: uid(), name: 'Моя машина', make: 'Toyota', model: 'Camry', year: 2020, plate: 'А123БВ77', fuelType: 'gasoline', tankCapacity: 60, odometer: 45000 };
  state.vehicles.push(v); state.activeVehicleId = v.id;
  const base = 45000;
  for (let i = 0; i < 8; i++) {
    state.fuelEntries.push({ id: uid(), vehicleId: v.id, date: new Date(Date.now() - (8 - i) * 12 * 86400000).toISOString().slice(0, 10), odometer: base + i * 420 + Math.round(Math.random() * 60), volume: 38 + Math.random() * 8, pricePerLiter: 52 + Math.random() * 4, total: 0, fuelType: 'gasoline', fullTank: true, station: ['Лукойл', 'Роснефть', 'Shell', 'Газпром'][i % 4], notes: '' });
  }
  state.fuelEntries.forEach(e => e.total = e.volume * e.pricePerLiter);
  state.reminders.push(
    { id: uid(), vehicleId: v.id, type: 'oil', title: 'Замена масла', dueOdometer: 50000, dueDate: null, intervalKm: 10000, done: false },
    { id: uid(), vehicleId: v.id, type: 'insurance', title: 'Страховка ОСАГО', dueOdometer: null, dueDate: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10), intervalKm: null, done: false },
    { id: uid(), vehicleId: v.id, type: 'inspection', title: 'Техосмотр', dueOdometer: null, dueDate: new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10), intervalKm: null, done: false }
  );
  saveState();
}
function renderDashboard(el) {
  const v = activeVehicle();
  const entries = state.fuelEntries.filter(e => e.vehicleId === v?.id);
  const sorted = [...entries].sort((a, b) => a.odometer - b.odometer);
  const last = [...entries].sort((a, b) => b.odometer - a.odometer)[0];
  const cons = avgConsumption(entries);
  const totalVol = entries.reduce((s, e) => s + (e.volume || 0), 0);
  const totalCost = entries.reduce((s, e) => s + (e.total || 0), 0);
  const co2 = entries.reduce((s, e) => s + co2FromLiters(e.volume || 0, e.fuelType), 0);
  const costPerKm = last && sorted.length > 1 ? totalCost / (last.odometer - sorted[0].odometer) : null;
  el.innerHTML = `<div class="card"><div class="card-title">🚗 ${v ? v.name : 'Нет авто'} <span class="badge badge-green">${v?.make || ''} ${v?.model || ''}</span></div>${v ? `<div class="vehicle-meta">Пробег: ${v.odometer} км • Бак: ${v.tankCapacity} л • ${v.fuelType}</div>` : ''}</div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Расход</div><div class="stat-value">${cons ? fmt(cons) : '—'}</div><div class="stat-sub">л / 100 км</div><div class="stat-icon">⛽</div></div>
      <div class="stat-card"><div class="stat-label">Потрачено</div><div class="stat-value">${fmtMoney(totalCost)}</div><div class="stat-sub">${entries.length} заправок</div><div class="stat-icon">💰</div></div>
      <div class="stat-card"><div class="stat-label">Залито</div><div class="stat-value">${fmt(totalVol, 1)} л</div><div class="stat-sub">всего</div><div class="stat-icon">🛢️</div></div>
      <div class="stat-card"><div class="stat-label">CO₂</div><div class="stat-value">${fmt(co2, 1)} кг</div><div class="stat-sub">выбросы</div><div class="stat-icon">🌿</div></div>
      <div class="stat-card"><div class="stat-label">Стоимость 1 км</div><div class="stat-value">${costPerKm ? fmtMoney(costPerKm) : '—'}</div><div class="stat-sub">топливо</div><div class="stat-icon">🛣️</div></div>
      <div class="stat-card"><div class="stat-label">Средняя цена</div><div class="stat-value">${entries.length ? fmt(entries.reduce((s,e)=>s+(e.pricePerLiter||0),0)/entries.length) : '—'}</div><div class="stat-sub">₽ / л</div><div class="stat-icon">📊</div></div>
    </div>
    <div class="card"><div class="card-title">📊 Последние заправки</div>
      ${entries.length ? `<div class="list">${[...entries].sort((a,b)=>b.odometer-a.odometer).slice(0,5).map(e=>`
        <div class="list-item"><div class="list-item-main"><div class="list-item-title">${e.date} • ${e.station || '—'}</div><div class="list-item-sub">${fmt(e.volume,2)} л × ${fmt(e.pricePerLiter,2)} ₽</div></div><div class="list-item-value"><div class="list-item-value-main">${fmtMoney(e.total)}</div><div class="list-item-value-sub">${e.odometer} км</div></div></div>`).join('')}</div>` : '<div class="empty"><div class="empty-icon">⛽</div><div class="empty-text">Нет заправок</div></div>'}
    </div>
    <div class="card"><div class="card-title">🔔 Ближайшие напоминания</div>${renderRemindersCompact(v)}</div>`;
}
function renderRemindersCompact(v) {
  const rems = state.reminders.filter(r => !r.done && (!v || r.vehicleId === v.id)).slice(0, 3);
  if (!rems.length) return '<div class="empty-text">Нет активных напоминаний</div>';
  return `<div class="list">${rems.map(r => {
    const cls = isReminderOverdue(r) ? 'reminder-overdue' : isReminderSoon(r) ? 'reminder-soon' : 'reminder-ok';
    return `<div class="list-item ${cls}"><div class="reminder-icon">${reminderIcon(r.type)}</div><div class="list-item-main"><div class="list-item-title">${r.title}</div><div class="list-item-sub">${reminderDueText(r)}</div></div></div>`;
  }).join('')}</div>`;
}
function reminderIcon(type) { return { oil: '🛢️', insurance: '🛡️', inspection: '🔍', tires: '🛞', service: '🔧', custom: '📌' }[type] || '📌'; }
function isReminderOverdue(r) { const v = activeVehicle(); if (r.dueDate && r.dueDate < today()) return true; if (r.dueOdometer && v && v.odometer >= r.dueOdometer) return true; return false; }
function isReminderSoon(r) { const v = activeVehicle(); if (r.dueDate) { const d = (new Date(r.dueDate) - new Date()) / 86400000; if (d >= 0 && d <= 14) return true; } if (r.dueOdometer && v) { const left = r.dueOdometer - v.odometer; if (left >= 0 && left <= 500) return true; } return false; }
function reminderDueText(r) { const v = activeVehicle(); const parts = []; if (r.dueDate) parts.push('📅 ' + r.dueDate); if (r.dueOdometer) parts.push('🛣️ ' + r.dueOdometer + ' км' + (v ? ' (осталось ' + (r.dueOdometer - v.odometer) + ' км)' : '')); return parts.join(' • ') || '—'; }

function renderVehicles(el) {
  el.innerHTML = `<div class="card"><div class="card-title">🚗 Мои автомобили</div>
    <button class="btn btn-primary btn-block" onclick="openVehicleModal()">➕ Добавить автомобиль</button></div>
    <div class="list" style="margin-top:12px">
      ${state.vehicles.map(v => {
        const entries = state.fuelEntries.filter(e => e.vehicleId === v.id);
        const cons = avgConsumption(entries);
        const totalCost = entries.reduce((s,e)=>s+(e.total||0),0);
        const active = v.id === state.activeVehicleId;
        return `<div class="vehicle-card ${active ? 'active' : ''}">
          <div class="vehicle-name">${v.name} ${active ? '✓' : ''}</div>
          <div class="vehicle-meta">${v.make} ${v.model} ${v.year} • ${v.plate}</div>
          <div class="vehicle-stats">
            <div class="vehicle-stat"><div class="vehicle-stat-val">${v.odometer}</div><div class="vehicle-stat-lbl">пробег км</div></div>
            <div class="vehicle-stat"><div class="vehicle-stat-val">${cons ? fmt(cons) : '—'}</div><div class="vehicle-stat-lbl">л/100км</div></div>
            <div class="vehicle-stat"><div class="vehicle-stat-val">${fmtMoney(totalCost)}</div><div class="vehicle-stat-lbl">потрачено</div></div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            ${!active ? `<button class="btn btn-sm btn-secondary" onclick="setActiveVehicle('${v.id}')">Сделать активным</button>` : ''}
            <button class="btn btn-sm btn-secondary" onclick="openVehicleModal('${v.id}')">✏️</button>
            <button class="btn btn-sm btn-danger" onclick="deleteVehicle('${v.id}')">🗑️</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    ${!state.vehicles.length ? '<div class="empty"><div class="empty-icon">🚗</div><div class="empty-text">Добавьте первый автомобиль</div></div>' : ''}`;
}
function openVehicleModal(id) {
  const v = id ? state.vehicles.find(x => x.id === id) : null;
  openModal(`
    <div class="modal-header"><div class="modal-title">${v ? 'Редактировать авто' : 'Новый автомобиль'}</div><button class="modal-close">×</button></div>
    <div class="form-group"><label class="form-label">Название</label><input class="form-input" id="v_name" value="${v?.name || ''}" placeholder="Моя машина"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Марка</label><input class="form-input" id="v_make" value="${v?.make || ''}" placeholder="Toyota"></div>
      <div class="form-group"><label class="form-label">Модель</label><input class="form-input" id="v_model" value="${v?.model || ''}" placeholder="Camry"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Год</label><input class="form-input" id="v_year" type="number" value="${v?.year || ''}"></div>
      <div class="form-group"><label class="form-label">Госномер</label><input class="form-input" id="v_plate" value="${v?.plate || ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Тип топлива</label><select class="form-select" id="v_fuel"><option value="gasoline" ${v?.fuelType==='gasoline'?'selected':''}>Бензин</option><option value="diesel" ${v?.fuelType==='diesel'?'selected':''}>Дизель</option><option value="lpg" ${v?.fuelType==='lpg'?'selected':''}>Газ (LPG)</option><option value="cng" ${v?.fuelType==='cng'?'selected':''}>Метан</option><option value="electric" ${v?.fuelType==='electric'?'selected':''}>Электро</option><option value="hybrid" ${v?.fuelType==='hybrid'?'selected':''}>Гибрид</option></select></div>
      <div class="form-group"><label class="form-label">Объём бака (л)</label><input class="form-input" id="v_tank" type="number" value="${v?.tankCapacity || 50}"></div>
    </div>
    <div class="form-group"><label class="form-label">Текущий пробег (км)</label><input class="form-input" id="v_odo" type="number" value="${v?.odometer || 0}"></div>
    <button class="btn btn-primary btn-block" onclick="saveVehicle('${id || ''}')">💾 Сохранить</button>
  `);
}
function saveVehicle(id) {
  const data = {
    name: document.getElementById('v_name').value || 'Авто',
    make: document.getElementById('v_make').value,
    model: document.getElementById('v_model').value,
    year: +document.getElementById('v_year').value,
    plate: document.getElementById('v_plate').value,
    fuelType: document.getElementById('v_fuel').value,
    tankCapacity: +document.getElementById('v_tank').value,
    odometer: +document.getElementById('v_odo').value
  };
  if (id) {
    const v = state.vehicles.find(x => x.id === id);
    Object.assign(v, data);
  } else {
    const v = { id: uid(), ...data };
    state.vehicles.push(v);
    if (!state.activeVehicleId) state.activeVehicleId = v.id;
  }
  saveState(); closeModal(); renderVehicles(document.getElementById('tab-vehicles'));
  toast('Автомобиль сохранён', 'success');
}
function deleteVehicle(id) {
  if (!confirm('Удалить автомобиль и все его данные?')) return;
  state.vehicles = state.vehicles.filter(v => v.id !== id);
  state.fuelEntries = state.fuelEntries.filter(e => e.vehicleId !== id);
  state.reminders = state.reminders.filter(r => r.vehicleId !== id);
  if (state.activeVehicleId === id) state.activeVehicleId = state.vehicles[0]?.id || null;
  saveState(); renderVehicles(document.getElementById('tab-vehicles'));
  toast('Удалено', 'info');
}

let fuelFilter = 'all';
function renderFuel(el) {
  const v = activeVehicle();
  const entries = state.fuelEntries.filter(e => e.vehicleId === v?.id).sort((a,b)=>b.odometer-a.odometer);
  el.innerHTML = `<div class="card"><div class="card-title">⛽ Заправки — ${v ? v.name : '—'}</div>
    <button class="btn btn-primary btn-block" onclick="openFuelModal()">➕ Добавить заправку</button></div>
    <div class="filter-bar">
      <button class="filter-chip ${fuelFilter==='all'?'active':''}" onclick="setFuelFilter('all')">Все</button>
      <button class="filter-chip ${fuelFilter==='full'?'active':''}" onclick="setFuelFilter('full')">Полный бак</button>
      <button class="filter-chip ${fuelFilter==='partial'?'active':''}" onclick="setFuelFilter('partial')">Частичные</button>
    </div>
    <div class="list">
      ${entries.filter(e=>fuelFilter==='all'||(fuelFilter==='full'&&e.fullTank)||(fuelFilter==='partial'&&!e.fullTank)).map(e=>`
        <div class="list-item">
          <div class="list-item-main">
            <div class="list-item-title">${e.date} ${e.fullTank ? '⛽' : '🔹'} ${e.station || ''}</div>
            <div class="list-item-sub">${fmt(e.volume,2)} л × ${fmt(e.pricePerLiter,2)} ₽ • ${e.odometer} км${e.notes ? ' • ' + e.notes : ''}</div>
          </div>
          <div class="list-item-value">
            <div class="list-item-value-main">${fmtMoney(e.total)}</div>
          </div>
          <div class="list-item-actions">
            <button class="btn btn-sm btn-secondary" onclick="openFuelModal('${e.id}')">✏️</button>
            <button class="btn btn-sm btn-danger" onclick="deleteFuelEntry('${e.id}')">🗑️</button>
          </div>
        </div>`).join('') || '<div class="empty"><div class="empty-icon">⛽</div><div class="empty-text">Нет заправок</div></div>'}
    </div>`;
}
function setFuelFilter(f) { fuelFilter = f; renderFuel(document.getElementById('tab-fuel')); }
function openFuelModal(id) {
  const e = id ? state.fuelEntries.find(x => x.id === id) : null;
  const v = activeVehicle();
  openModal(`
    <div class="modal-header"><div class="modal-title">${e ? 'Редактировать заправку' : 'Новая заправка'}</div><button class="modal-close">×</button></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Дата</label><input class="form-input" id="f_date" type="date" value="${e?.date || today()}"></div>
      <div class="form-group"><label class="form-label">Пробег (км)</label><input class="form-input" id="f_odo" type="number" value="${e?.odometer || (v?.odometer || 0)}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Объём (л)</label><input class="form-input" id="f_vol" type="number" step="0.01" value="${e?.volume || ''}" oninput="calcFuelTotal()"></div>
      <div class="form-group"><label class="form-label">Цена за л (₽)</label><input class="form-input" id="f_price" type="number" step="0.01" value="${e?.pricePerLiter || ''}" oninput="calcFuelTotal()"></div>
    </div>
    <div class="form-group"><label class="form-label">Итого (₽)</label><input class="form-input" id="f_total" type="number" step="0.01" value="${e?.total || ''}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">АЗС</label><input class="form-input" id="f_station" value="${e?.station || ''}" placeholder="Лукойл"></div>
      <div class="form-group"><label class="form-label">Тип топлива</label><select class="form-select" id="f_fuel"><option value="gasoline" ${e?.fuelType==='gasoline'?'selected':''}>Бензин</option><option value="diesel" ${e?.fuelType==='diesel'?'selected':''}>Дизель</option><option value="lpg" ${e?.fuelType==='lpg'?'selected':''}>Газ</option><option value="electric" ${e?.fuelType==='electric'?'selected':''}>Электро</option></select></div>
    </div>
    <div class="form-group"><label><input type="checkbox" id="f_full" ${e?.fullTank !== false ? 'checked' : ''}> Полный бак</label></div>
    <div class="form-group"><label class="form-label">Заметки</label><textarea class="form-textarea" id="f_notes">${e?.notes || ''}</textarea></div>
    <button class="btn btn-secondary btn-block" style="margin-bottom:8px" onclick="useGeolocation()">📍 Определить местоположение</button>
    <button class="btn btn-primary btn-block" onclick="saveFuelEntry('${id || ''}')">💾 Сохранить</button>
  `);
}
function calcFuelTotal() {
  const v = +document.getElementById('f_vol').value;
  const p = +document.getElementById('f_price').value;
  if (v && p) document.getElementById('f_total').value = (v * p).toFixed(2);
}
function useGeolocation() {
  if (!navigator.geolocation) { toast('Геолокация не поддерживается', 'error'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    toast(`Координаты: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`, 'info');
  }, () => toast('Не удалось получить местоположение', 'error'));
}

function saveFuelEntry(id) {
  const v = activeVehicle();
  if (!v) { toast('Сначала добавьте автомобиль', 'error'); return; }
  const data = {
    vehicleId: v.id,
    date: document.getElementById('f_date').value,
    odometer: +document.getElementById('f_odo').value,
    volume: +document.getElementById('f_vol').value,
    pricePerLiter: +document.getElementById('f_price').value,
    total: +document.getElementById('f_total').value,
    station: document.getElementById('f_station').value,
    fuelType: document.getElementById('f_fuel').value,
    fullTank: document.getElementById('f_full').checked,
    notes: document.getElementById('f_notes').value
  };
  if (!data.volume || !data.odometer) { toast('Заполните объём и пробег', 'error'); return; }
  if (!data.total) data.total = data.volume * data.pricePerLiter;
  if (id) {
    const e = state.fuelEntries.find(x => x.id === id);
    Object.assign(e, data);
  } else {
    state.fuelEntries.push({ id: uid(), ...data });
  }
  if (data.odometer > v.odometer) v.odometer = data.odometer;
  saveState(); closeModal(); renderFuel(document.getElementById('tab-fuel'));
  toast('Заправка сохранена', 'success');
}
function deleteFuelEntry(id) {
  if (!confirm('Удалить заправку?')) return;
  state.fuelEntries = state.fuelEntries.filter(e => e.id !== id);
  saveState(); renderFuel(document.getElementById('tab-fuel'));
  toast('Удалено', 'info');
}

function renderCosts(el) {
  const v = activeVehicle();
  const costs = state.costs.filter(c => c.vehicleId === v?.id).sort((a,b)=>b.date.localeCompare(a.date));
  const total = costs.reduce((s,c)=>s+(c.amount||0),0);
  el.innerHTML = `<div class="card"><div class="card-title">💰 Расходы — ${v ? v.name : '—'}</div>
    <button class="btn btn-primary btn-block" onclick="openCostModal()">➕ Добавить расход</button></div>
    <div class="stats-grid" style="margin:12px 0">
      <div class="stat-card"><div class="stat-label">Всего расходов</div><div class="stat-value">${fmtMoney(total)}</div><div class="stat-sub">${costs.length} записей</div></div>
      <div class="stat-card"><div class="stat-label">Категорий</div><div class="stat-value">${new Set(costs.map(c=>c.category)).size}</div></div>
    </div>
    <div class="list">
      ${costs.map(c=>`
        <div class="list-item">
          <div class="list-item-main">
            <div class="list-item-title">${c.date} • ${costCategoryName(c.category)}</div>
            <div class="list-item-sub">${c.description || ''}</div>
          </div>
          <div class="list-item-value">
            <div class="list-item-value-main">${fmtMoney(c.amount)}</div>
          </div>
          <div class="list-item-actions">
            <button class="btn btn-sm btn-danger" onclick="deleteCost('${c.id}')">🗑️</button>
          </div>
        </div>`).join('') || '<div class="empty"><div class="empty-icon">💰</div><div class="empty-text">Нет расходов</div></div>'}
    </div>`;
}
function costCategoryName(cat) {
  return { fuel: '⛽ Топливо', maintenance: '🔧 Обслуживание', repair: '🛠️ Ремонт', insurance: '🛡️ Страховка', tax: '📋 Налоги', wash: '🧼 Мойка', parking: '🅿️ Парковка', tires: '🛞 Шины', other: '📌 Прочее' }[cat] || cat;
}
function openCostModal() {
  openModal(`
    <div class="modal-header"><div class="modal-title">Новый расход</div><button class="modal-close">×</button></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Дата</label><input class="form-input" id="c_date" type="date" value="${today()}"></div>
      <div class="form-group"><label class="form-label">Сумма (₽)</label><input class="form-input" id="c_amount" type="number" step="0.01"></div>
    </div>
    <div class="form-group"><label class="form-label">Категория</label><select class="form-select" id="c_cat">
      <option value="fuel">⛽ Топливо</option><option value="maintenance">🔧 Обслуживание</option><option value="repair">🛠️ Ремонт</option>
      <option value="insurance">🛡️ Страховка</option><option value="tax">📋 Налоги</option><option value="wash">🧼 Мойка</option>
      <option value="parking">🅿️ Парковка</option><option value="tires">🛞 Шины</option><option value="other">📌 Прочее</option>
    </select></div>
    <div class="form-group"><label class="form-label">Описание</label><textarea class="form-textarea" id="c_desc"></textarea></div>
    <button class="btn btn-primary btn-block" onclick="saveCost()">💾 Сохранить</button>
  `);
}
function saveCost() {
  const v = activeVehicle();
  if (!v) { toast('Сначала добавьте автомобиль', 'error'); return; }
  const data = { vehicleId: v.id, date: document.getElementById('c_date').value, amount: +document.getElementById('c_amount').value, category: document.getElementById('c_cat').value, description: document.getElementById('c_desc').value };
  if (!data.amount) { toast('Введите сумму', 'error'); return; }
  state.costs.push({ id: uid(), ...data });
  saveState(); closeModal(); renderCosts(document.getElementById('tab-costs'));
  toast('Расход сохранён', 'success');
}
function deleteCost(id) {
  if (!confirm('Удалить?')) return;
  state.costs = state.costs.filter(c => c.id !== id);
  saveState(); renderCosts(document.getElementById('tab-costs'));
  toast('Удалено', 'info');
}

function renderStats(el) {
  const v = activeVehicle();
  const entries = state.fuelEntries.filter(e => e.vehicleId === v?.id).sort((a,b)=>a.odometer-b.odometer);
  const cons = calcConsumption(entries);
  el.innerHTML = `<div class="card"><div class="card-title">📈 Статистика — ${v ? v.name : '—'}</div></div>
    <div class="card"><div class="card-title">Расход топлива (л/100км)</div><div class="chart-container tall"><canvas id="chartCons"></canvas></div></div>
    <div class="card"><div class="card-title">Стоимость заправок</div><div class="chart-container"><canvas id="chartCost"></canvas></div></div>
    <div class="card"><div class="card-title">Цена за литр</div><div class="chart-container"><canvas id="chartPrice"></canvas></div></div>
    <div class="card"><div class="card-title">Заправки по АЗС</div><div class="chart-container"><canvas id="chartStation"></canvas></div></div>
    <div class="card"><div class="card-title">📊 Сводка</div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Всего заправок</div><div class="stat-value">${entries.length}</div></div>
        <div class="stat-card"><div class="stat-label">Средний расход</div><div class="stat-value">${avgConsumption(entries) ? fmt(avgConsumption(entries)) : '—'} л/100</div></div>
        <div class="stat-card"><div class="stat-label">Мин. расход</div><div class="stat-value">${cons.length ? fmt(Math.min(...cons.map(c=>c.consumption))) : '—'} л/100</div></div>
        <div class="stat-card"><div class="stat-label">Макс. расход</div><div class="stat-value">${cons.length ? fmt(Math.max(...cons.map(c=>c.consumption))) : '—'} л/100</div></div>
        <div class="stat-card"><div class="stat-label">Всего км</div><div class="stat-value">${entries.length > 1 ? entries[entries.length-1].odometer - entries[0].odometer : 0}</div></div>
        <div class="stat-card"><div class="stat-label">Всего литров</div><div class="stat-value">${fmt(entries.reduce((s,e)=>s+(e.volume||0),0),1)}</div></div>
        <div class="stat-card"><div class="stat-label">Всего потрачено</div><div class="stat-value">${fmtMoney(entries.reduce((s,e)=>s+(e.total||0),0))}</div></div>
        <div class="stat-card"><div class="stat-label">CO₂</div><div class="stat-value">${fmt(entries.reduce((s,e)=>s+co2FromLiters(e.volume||0,e.fuelType),0),1)} кг</div></div>
      </div>
    </div>`;
  setTimeout(() => drawCharts(entries, cons), 50);
}
function drawCharts(entries, cons) {
  const labels = cons.map(c => c.date);
  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
  charts = {};
  if (labels.length) {
    charts.cons = new Chart(document.getElementById('chartCons'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'л/100км', data: cons.map(c=>+c.consumption.toFixed(2)), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.15)', tension: .3, fill: true }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }
  charts.cost = new Chart(document.getElementById('chartCost'), {
    type: 'bar',
    data: { labels: entries.map(e=>e.date), datasets: [{ label: '₽', data: entries.map(e=>+e.total.toFixed(2)), backgroundColor: '#3b82f6' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
  charts.price = new Chart(document.getElementById('chartPrice'), {
    type: 'line',
    data: { labels: entries.map(e=>e.date), datasets: [{ label: '₽/л', data: entries.map(e=>+e.pricePerLiter.toFixed(2)), borderColor: '#f59e0b', tension: .3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
  const stationMap = {};
  entries.forEach(e => { const k = e.station || '—'; stationMap[k] = (stationMap[k]||0) + (e.total||0); });
  charts.station = new Chart(document.getElementById('chartStation'), {
    type: 'doughnut',
    data: { labels: Object.keys(stationMap), datasets: [{ data: Object.values(stationMap), backgroundColor: ['#10b981','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#ec4899'] }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderReminders(el) {
  const v = activeVehicle();
  const rems = state.reminders.filter(r => !v || r.vehicleId === v.id);
  el.innerHTML = `<div class="card"><div class="card-title">🔔 Напоминания — ${v ? v.name : '—'}</div>
    <button class="btn btn-primary btn-block" onclick="openReminderModal()">➕ Добавить напоминание</button></div>
    <div class="list" style="margin-top:12px">
      ${rems.map(r => {
        const overdue = isReminderOverdue(r);
        const soon = isReminderSoon(r);
        const cls = overdue ? 'reminder-overdue' : soon ? 'reminder-soon' : 'reminder-ok';
        return `<div class="list-item ${cls}">
          <div class="reminder-icon">${reminderIcon(r.type)}</div>
          <div class="list-item-main">
            <div class="list-item-title">${r.title} ${r.done ? '✅' : ''}</div>
            <div class="list-item-sub">${reminderDueText(r)}${r.intervalKm ? ' • каждые ' + r.intervalKm + ' км' : ''}</div>
          </div>
          <div class="list-item-actions">
            ${!r.done ? `<button class="btn btn-sm btn-secondary" onclick="markReminderDone('${r.id}')">✓</button>` : ''}
            <button class="btn btn-sm btn-danger" onclick="deleteReminder('${r.id}')">🗑️</button>
          </div>
        </div>`;
      }).join('') || '<div class="empty"><div class="empty-icon">🔔</div><div class="empty-text">Нет напоминаний</div></div>'}
    </div>`;
}
function openReminderModal() {
  openModal(`
    <div class="modal-header"><div class="modal-title">Новое напоминание</div><button class="modal-close">×</button></div>
    <div class="form-group"><label class="form-label">Название</label><input class="form-input" id="r_title" placeholder="Замена масла"></div>
    <div class="form-group"><label class="form-label">Тип</label><select class="form-select" id="r_type">
      <option value="oil">🛢️ Масло</option><option value="insurance">🛡️ Страховка</option><option value="inspection">🔍 Техосмотр</option>
      <option value="tires">🛞 Шины</option><option value="service">🔧 Сервис</option><option value="custom">📌 Другое</option>
    </select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Дата</label><input class="form-input" id="r_date" type="date"></div>
      <div class="form-group"><label class="form-label">Пробег (км)</label><input class="form-input" id="r_odo" type="number" placeholder="50000"></div>
    </div>
    <div class="form-group"><label class="form-label">Интервал (км)</label><input class="form-input" id="r_interval" type="number" placeholder="10000"></div>
    <button class="btn btn-primary btn-block" onclick="saveReminder()">💾 Сохранить</button>
  `);
}
function saveReminder() {
  const v = activeVehicle();
  if (!v) { toast('Сначала добавьте автомобиль', 'error'); return; }
  const data = { vehicleId: v.id, title: document.getElementById('r_title').value || 'Напоминание', type: document.getElementById('r_type').value, dueDate: document.getElementById('r_date').value || null, dueOdometer: +document.getElementById('r_odo').value || null, intervalKm: +document.getElementById('r_interval').value || null, done: false };
  state.reminders.push({ id: uid(), ...data });
  saveState(); closeModal(); renderReminders(document.getElementById('tab-reminders'));
  toast('Напоминание добавлено', 'success');
}
function markReminderDone(id) {
  const r = state.reminders.find(x => x.id === id);
  if (r) { r.done = true; if (r.intervalKm && r.dueOdometer) { r.dueOdometer += r.intervalKm; r.done = false; } }
  saveState(); renderReminders(document.getElementById('tab-reminders'));
  toast('Выполнено', 'success');
}
function deleteReminder(id) {
  if (!confirm('Удалить?')) return;
  state.reminders = state.reminders.filter(r => r.id !== id);
  saveState(); renderReminders(document.getElementById('tab-reminders'));
  toast('Удалено', 'info');
}

const ACHIEVEMENTS = [
  { id: 'first_fuel', name: 'Первая заправка', desc: 'Добавьте первую заправку', icon: '⛽', check: s => s.fuelEntries.length >= 1 },
  { id: 'ten_fuels', name: '10 заправок', desc: '10 заправок внесено', icon: '🔟', check: s => s.fuelEntries.length >= 10 },
  { id: 'fifty_fuels', name: '50 заправок', desc: '50 заправок внесено', icon: '🏆', check: s => s.fuelEntries.length >= 50 },
  { id: 'eco_driver', name: 'Эко-водитель', desc: 'Расход ниже 6 л/100км', icon: '🌿', check: s => { const v = activeVehicle(); if (!v) return false; const e = s.fuelEntries.filter(x=>x.vehicleId===v.id); return (avgConsumption(e)||99) < 6; } },
  { id: 'thousand_km', name: '1000 км', desc: 'Проедьте 1000 км', icon: '🛣️', check: s => { const v = activeVehicle(); if (!v) return false; const e = s.fuelEntries.filter(x=>x.vehicleId===v.id); return e.length > 1 && (e[e.length-1].odometer - e[0].odometer) >= 1000; } },
  { id: 'multi_car', name: 'Автопарк', desc: 'Добавьте 2+ авто', icon: '🚗', check: s => s.vehicles.length >= 2 },
  { id: 'tracker', name: 'Трекер', desc: 'Добавьте 5 расходов', icon: '💰', check: s => s.costs.length >= 5 },
  { id: 'full_tank', name: 'Полный бак', desc: '5 заправок полным баком', icon: '⛽', check: s => s.fuelEntries.filter(e=>e.fullTank).length >= 5 }
];
function checkAchievements() {
  ACHIEVEMENTS.forEach(a => {
    if (!state.achievements.includes(a.id) && a.check(state)) {
      state.achievements.push(a.id);
      toast('🏆 Достижение: ' + a.name, 'success');
    }
  });
  saveState();
}
function renderAchievements(el) {
  el.innerHTML = `<div class="card"><div class="card-title">🏆 Достижения</div>
    <div class="list">
      ${ACHIEVEMENTS.map(a => {
        const unlocked = state.achievements.includes(a.id);
        return `<div class="achievement ${unlocked ? '' : 'locked'}">
          <div class="achievement-icon">${a.icon}</div>
          <div class="achievement-info">
            <div class="achievement-name">${a.name}</div>
            <div class="achievement-desc">${a.desc}</div>
          </div>
          ${unlocked ? '<span class="badge badge-green">Открыто</span>' : '<span class="badge">Закрыто</span>'}
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:12px"><div class="progress"><div class="progress-bar" style="width:${(state.achievements.length / ACHIEVEMENTS.length * 100)}%"></div></div>
    <div class="stat-sub" style="margin-top:6px">${state.achievements.length} / ${ACHIEVEMENTS.length} открыто</div></div>
  </div>`;
}

function renderSettings(el) {
  el.innerHTML = `<div class="card"><div class="card-title">⚙️ Настройки</div>
    <div class="form-group"><label class="form-label">Тема</label><select class="form-select" id="s_theme" onchange="changeSetting('theme',this.value)">
      <option value="dark" ${state.settings.theme==='dark'?'selected':''}>Тёмная</option>
      <option value="light" ${state.settings.theme==='light'?'selected':''}>Светлая</option>
    </select></div>
    <div class="form-group"><label class="form-label">Валюта</label><select class="form-select" id="s_curr" onchange="changeSetting('currency',this.value)">
      <option value="RUB" ${state.settings.currency==='RUB'?'selected':''}>₽ Рубли</option>
      <option value="USD" ${state.settings.currency==='USD'?'selected':''}>$ Доллары</option>
      <option value="EUR" ${state.settings.currency==='EUR'?'selected':''}>€ Евро</option>
    </select></div>
    <div class="form-group"><label class="form-label">Экспорт данных</label>
      <button class="btn btn-secondary" onclick="exportData()">📤 Экспорт JSON</button>
      <button class="btn btn-secondary" onclick="exportCSV()">📊 Экспорт CSV</button>
    </div>
    <div class="form-group"><label class="form-label">Импорт данных</label>
      <input type="file" id="importFile" accept=".json" onchange="importData(event)" class="form-input">
    </div>
    <div class="form-group"><label class="form-label">Очистка данных</label>
      <button class="btn btn-danger" onclick="clearAllData()">🗑️ Удалить все данные</button>
    </div>
<div class="form-group"><label class="form-label">Синхронизация (Firebase)</label>
      <button class="btn btn-secondary" onclick="firebaseSignIn()">🔐 Войти через Google</button>
      <button class="btn btn-secondary" onclick="firebaseSignOut()">🚪 Выйти</button>
      <div class="empty-text" id="firebaseStatus">Не подключено</div>
    </div>
      <div class="empty-text">Fuel Tracker Pro v1.0<br>PWA — работает офлайн на ПК и телефоне<br>Данные хранятся локально в браузере</div>
    </div>
  </div>`;
}
function changeSetting(key, val) { state.settings[key] = val; saveState(); if (key === 'theme') applyTheme(); toast('Сохранено', 'success'); }
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'fueltrack_backup.json'; a.click();
  URL.revokeObjectURL(url);
  toast('Экспортировано', 'success');
}
function exportCSV() {
  const v = activeVehicle();
  const entries = state.fuelEntries.filter(e => e.vehicleId === v?.id);
  let csv = 'Дата,Пробег,Объём,Цена за л,Итого,АЗС,Полный бак,Заметки\n';
  entries.forEach(e => { csv += `${e.date},${e.odometer},${e.volume},${e.pricePerLiter},${e.total},${e.station||''},${e.fullTank?'да':'нет'},${(e.notes||'').replace(/,/g,';')}\n`; });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'fueltrack.csv'; a.click();
  URL.revokeObjectURL(url);
  toast('CSV экспортирован', 'success');
}
function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      Object.assign(state, data);
      saveState(); applyTheme();
      toast('Импортировано', 'success');
      renderTab(currentTab);
    } catch (err) { toast('Ошибка импорта', 'error'); }
  };
  reader.readAsText(file);
}
function clearAllData() {
  if (!confirm('Удалить ВСЕ данные? Это необратимо.')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  saveState(); renderTab(currentTab);
  toast('Данные очищены', 'info');
}
function fabAction() {
  if (currentTab === 'fuel') openFuelModal();
  else if (currentTab === 'vehicles') openVehicleModal();
  else if (currentTab === 'reminders') openReminderModal();
  else if (currentTab === 'shifts') openShiftModal();
  else { document.querySelector('.nav-btn[data-tab="fuel"]').click(); setTimeout(openFuelModal, 100); }
}
function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Голосовой ввод не поддерживается', 'error'); return; }
  const rec = new SR();
  rec.lang = 'ru-RU';
  rec.interimResults = false;
  const btn = document.getElementById('voiceBtn');
  btn.classList.add('voice-listening');
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript.toLowerCase();
    toast('Распознано: ' + text, 'info');
    if (text.includes('заправ') || text.includes('топлив')) { document.querySelector('.nav-btn[data-tab="fuel"]').click(); setTimeout(openFuelModal, 100); }
    else if (text.includes('расход') || text.includes('статист')) { document.querySelector('.nav-btn[data-tab="stats"]').click(); }
    else if (text.includes('авто')) { document.querySelector('.nav-btn[data-tab="vehicles"]').click(); }
    else if (text.includes('напомин')) { document.querySelector('.nav-btn[data-tab="reminders"]').click(); }
  };
  rec.onend = () => btn.classList.remove('voice-listening');
  rec.onerror = () => { btn.classList.remove('voice-listening'); toast('Ошибка распознавания', 'error'); };
  rec.start();
}

window.openVehicleModal = openVehicleModal;
window.saveVehicle = saveVehicle;
window.deleteVehicle = deleteVehicle;
window.setActiveVehicle = setActiveVehicle;
window.openFuelModal = openFuelModal;
window.saveFuelEntry = saveFuelEntry;
window.deleteFuelEntry = deleteFuelEntry;
window.setFuelFilter = setFuelFilter;
window.calcFuelTotal = calcFuelTotal;
window.useGeolocation = useGeolocation;
window.openCostModal = openCostModal;
window.saveCost = saveCost;
window.deleteCost = deleteCost;
window.openReminderModal = openReminderModal;
window.saveReminder = saveReminder;
window.markReminderDone = markReminderDone;
window.deleteReminder = deleteReminder;
window.changeSetting = changeSetting;
window.exportData = exportData;
window.exportCSV = exportCSV;
window.importData = importData;
window.clearAllData = clearAllData;
window.fabAction = fabAction;
function renderShifts(el) {
  const v = activeVehicle();
  const shifts = (state.shifts || []).filter(s => s.vehicleId === v?.id).sort((a,b)=>b.date.localeCompare(a.date));
  const totalDist = shifts.reduce((s, x) => s + (x.distance || 0), 0);
  const totalFuel = shifts.reduce((s, x) => s + (x.fuelUsed || 0), 0);
  const avgCons = totalDist > 0 ? (totalFuel / totalDist) * 100 : null;
  const lastOdo = shifts.length ? Math.max(...shifts.map(s=>s.endOdometer||0)) : (v?.odometer || 0);
  el.innerHTML = `<div class="card"><div class="card-title">🧮 Калькулятор смен — ${v ? v.name : '—'}</div>
    <div class="empty-text" style="margin-bottom:12px">Вбейте начальный пробег, расход на 100 км и пробег за смену — приложение само посчитает расход топлива и итоговый пробег.</div>
    <button class="btn btn-primary btn-block" onclick="openShiftModal()">➕ Добавить смену</button></div>
    <div class="stats-grid" style="margin:12px 0">
      <div class="stat-card"><div class="stat-label">Всего смен</div><div class="stat-value">${shifts.length}</div></div>
      <div class="stat-card"><div class="stat-label">Общий пробег</div><div class="stat-value">${totalDist} км</div><div class="stat-sub">итого ${lastOdo} км</div></div>
      <div class="stat-card"><div class="stat-label">Израсходовано</div><div class="stat-value">${fmt(totalFuel, 2)} л</div></div>
      <div class="stat-card"><div class="stat-label">Средний расход</div><div class="stat-value">${avgCons ? fmt(avgCons) : '—'} л/100</div></div>
    </div>
    <div class="list">
      ${shifts.map(s => `
        <div class="list-item">
          <div class="list-item-main">
            <div class="list-item-title">${s.date} • ${s.distance} км</div>
            <div class="list-item-sub">Пробег: ${s.startOdometer} → ${s.endOdometer} • Расход: ${fmt(s.consumption,2)} л/100 • Залито: ${fmt(s.fuelAdded||0,2)} л</div>
            <div class="list-item-sub">Израсходовано: ${fmt(s.fuelUsed,2)} л • В баке до: ${fmt(s.fuelLeftBefore||0,2)} л • Осталось: ${fmt(s.fuelLeft,2)} л${s.notes ? ' • ' + s.notes : ''}</div>
          </div>
          <div class="list-item-value">
            <div class="list-item-value-main">${fmt(s.fuelUsed,2)} л</div>
            <div class="list-item-value-sub">${s.endOdometer} км</div>
          </div>
          <div class="list-item-actions">
            <button class="btn btn-sm btn-secondary" onclick="openShiftModal('${s.id}')">✏️</button>
            <button class="btn btn-sm btn-danger" onclick="deleteShift('${s.id}')">🗑️</button>
          </div>
        </div>`).join('') || '<div class="empty"><div class="empty-icon">🧮</div><div class="empty-text">Добавьте первую смену</div></div>'}
    </div>` + renderShiftCalendar();
}
window.startVoice = startVoice;

window.startVoice = startVoice;

function openShiftModal(id) {
  const v = activeVehicle();
  const shift = id ? (state.shifts || []).find(x => x.id === id) : null;
  const lastShift = !id ? (state.shifts || []).filter(s => s.vehicleId === v?.id).sort((a,b)=>b.date.localeCompare(a.date))[0] : null;
  const startOdo = shift ? shift.startOdometer : (lastShift ? lastShift.endOdometer : (v?.odometer || 0));
  const leftBefore = shift ? (shift.fuelLeftBefore || 0) : (lastShift ? (lastShift.fuelLeft || 0) : 0);
  openModal(`
    <div class="modal-header"><div class="modal-title">${shift ? 'Редактировать смену' : 'Новая смена'}</div><button class="modal-close">×</button></div>
    <div class="form-group"><label class="form-label">Автомобиль</label><select class="form-select" id="sh_vehicle">
      ${state.vehicles.map(vv => `<option value="${vv.id}" ${ (shift?.vehicleId||v?.id)===vv.id?'selected':''}>${vv.name}</option>`).join('')}
    </select></div>
    <div class="form-group"><label class="form-label">Дата</label><input class="form-input" id="sh_date" type="date" value="${shift?.date || today()}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Пробег начало (км)</label><input class="form-input" id="sh_start" type="number" value="${startOdo}" oninput="calcShift()"></div>
      <div class="form-group"><label class="form-label">Пробег конец (км)</label><input class="form-input" id="sh_end" type="number" value="${shift?.endOdometer || startOdo}" oninput="calcShift()"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Расход на 100 км (л)</label><input class="form-input" id="sh_cons" type="number" step="0.01" value="${shift?.consumption || 8}" oninput="calcShift()"></div>
      <div class="form-group"><label class="form-label">Залито топлива (л)</label><input class="form-input" id="sh_fuel" type="number" step="0.01" value="${shift?.fuelAdded || 0}" oninput="calcShift()"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Цена за л (₽)</label><input class="form-input" id="sh_price" type="number" step="0.01" value="${shift?.pricePerLiter || 55}"></div>
      <div class="form-group"><label class="form-label">Остаток до смены (л)</label><input class="form-input" id="sh_left_before" type="number" step="0.01" value="${leftBefore}"></div>
    </div>
    <div class="form-group"><label class="form-label">Заметки</label><textarea class="form-textarea" id="sh_notes">${shift?.notes || ''}</textarea></div>
    <div id="sh_result" style="margin:12px 0;padding:12px;background:var(--bg3);border-radius:8px;font-weight:600"></div>
    <button class="btn btn-primary btn-block" onclick="saveShift('${id || ''}')">💾 Сохранить смену</button>
  `);
  calcShift();
}
function calcShift() {
  const start = +document.getElementById('sh_start').value;
  const end = +document.getElementById('sh_end').value;
  const cons = +document.getElementById('sh_cons').value;
  const fuelAdded = +document.getElementById('sh_fuel').value;
  const leftBefore = +document.getElementById('sh_left_before').value;
  const dist = Math.max(0, end - start);
  const fuelUsed = dist * (cons / 100);
  const fuelLeft = leftBefore + fuelAdded - fuelUsed;
  const actualCons = dist > 0 && fuelAdded > 0 ? (fuelAdded / dist) * 100 : null;
  const el = document.getElementById('sh_result');
  if (el) el.innerHTML = `Пробег за смену: <b>${dist} км</b><br>Израсходовано (по норме): <b>${fmt(fuelUsed,2)} л</b><br>Остаток топлива: <b>${fmt(fuelLeft,2)} л</b><br>Итоговый пробег: <b>${end} км</b>${actualCons ? `<br>Фактический расход: <b>${fmt(actualCons,2)} л/100</b>` : ''}${fuelLeft < 0 ? `<br><span style="color:var(--danger)">⚠️ Не хватает ${fmt(Math.abs(fuelLeft),2)} л</span>` : ''}`;
}
function saveShift(id) {
  const vid = document.getElementById('sh_vehicle').value;
  const v = state.vehicles.find(x=>x.id===vid) || activeVehicle();
  if (!v) { toast('Сначала добавьте автомобиль', 'error'); return; }
  const start = +document.getElementById('sh_start').value;
  const end = +document.getElementById('sh_end').value;
  const cons = +document.getElementById('sh_cons').value;
  const fuelAdded = +document.getElementById('sh_fuel').value;
  const leftBefore = +document.getElementById('sh_left_before').value;
  const price = +document.getElementById('sh_price').value;
  const dist = Math.max(0, end - start);
  const fuelUsed = dist * (cons / 100);
  const fuelLeft = leftBefore + fuelAdded - fuelUsed;
  if (!dist) { toast('Укажите пробег за смену', 'error'); return; }
  if (!state.shifts) state.shifts = [];
  const data = { vehicleId: v.id, date: document.getElementById('sh_date').value, startOdometer: start, endOdometer: end, distance: dist, consumption: cons, fuelAdded: fuelAdded, fuelUsed: fuelUsed, fuelLeftBefore: leftBefore, fuelLeft: fuelLeft, pricePerLiter: price, notes: document.getElementById('sh_notes').value };
  if (id) {
    const s = state.shifts.find(x => x.id === id);
    if (s) Object.assign(s, data);
  } else {
    state.shifts.push({ id: uid(), ...data });
  }
  if (end > v.odometer) v.odometer = end;
  saveState(); closeModal(); renderShifts(document.getElementById('tab-shifts'));
  toast('Смена сохранена', 'success');
}
function deleteShift(id) {
  if (!confirm('Удалить смену?')) return;
  state.shifts = (state.shifts || []).filter(s => s.id !== id);
  saveState(); renderShifts(document.getElementById('tab-shifts'));
  toast('Удалено', 'info');
}
const firebaseConfig = {
  apiKey: "AIzaSyAeRW9tuWUXwiqxQbZhQgl0gBSnywBJxhA",
  authDomain: "gasline-8f401.firebaseapp.com",
  projectId: "gasline-8f401",
  storageBucket: "gasline-8f401.firebasestorage.app",
  messagingSenderId: "497550147208",
  appId: "1:497550147208:web:aa5a3f4ac5b0b244e6293d",
  measurementId: "G-8XBSDF8C5G"
};

let firebaseReady = false;
try {
  if (typeof firebase !== 'undefined' && firebaseConfig.apiKey !== "YOUR_API_KEY") {
    firebase.initializeApp(firebaseConfig);
    firebaseReady = true;
  }
} catch (e) {}

function firebaseSignIn() {
  if (!firebaseReady) { toast('Сначала вставьте конфиг Firebase в app.js', 'error'); return; }
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).then(() => {
    toast('Вход выполнен', 'success');
    firebaseSyncLoad();
  }).catch(e => toast('Ошибка входа: ' + e.message, 'error'));
}
function firebaseSignOut() {
  if (!firebaseReady) return;
  firebase.auth().signOut().then(() => toast('Выход выполнен', 'info'));
}
function firebaseSyncLoad() {
  if (!firebaseReady) return;
  const db = firebase.firestore();
  db.collection('shared').doc('state').get().then(doc => {
    if (doc.exists) {
      const cloud = doc.data();
      const localTs = state.updatedAt || 0;
      const cloudTs = cloud.updatedAt || 0;
      if (cloudTs > localTs) {
        Object.assign(state, cloud);
        saveState();
        renderTab(currentTab);
        toast('Данные загружены из облака', 'success');
      }
    }
  });
}
function firebaseSyncSave() {
  if (!firebaseReady) return;
  state.updatedAt = Date.now();
  const db = firebase.firestore();
  db.collection('shared').doc('state').set(JSON.parse(JSON.stringify(state)));
}
if (firebaseReady) {
  firebase.auth().onAuthStateChanged(user => {
    const el = document.getElementById('firebaseStatus');
    if (el) el.textContent = user ? ('Вошли: ' + (user.email || user.uid)) : 'Не вошли';
    if (user) firebaseSyncLoad();
  });
}
const _origSaveState = saveState;
saveState = function() {
  state.updatedAt = Date.now();
  _origSaveState();
  if (firebaseReady) {
    const db = firebase.firestore();
    db.collection('shared').doc('state').set(JSON.parse(JSON.stringify(state)));
  }
};

window.firebaseSignIn = firebaseSignIn;
window.firebaseSignOut = firebaseSignOut;
window.openShiftModal = openShiftModal;
window.saveShift = saveShift;
window.deleteShift = deleteShift;
window.calcShift = calcShift;
let shiftCalMonth = new Date().toISOString().slice(0,7);
let shiftCalSelected = null;

function renderShiftCalendar() {
  const v = activeVehicle();
  const shifts = (state.shifts || []).filter(s => s.vehicleId === v?.id);
  const [y, m] = shiftCalMonth.split('-').map(Number);
  const first = new Date(y, m-1, 1);
  const lastDay = new Date(y, m, 0).getDate();
  const startWeekday = (first.getDay() + 6) % 7;
  const shiftByDate = {};
  shifts.forEach(s => { shiftByDate[s.date] = s; });
  let html = `<div class="card"><div class="card-title">📅 Календарь смен</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <button class="btn btn-sm btn-secondary" onclick="shiftCalPrev()">◀</button>
      <b>${first.toLocaleString('ru-RU',{month:'long',year:'numeric'})}</b>
      <button class="btn btn-sm btn-secondary" onclick="shiftCalNext()">▶</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;font-size:.8rem;color:var(--muted);margin-bottom:4px">
      ${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>`<div>${d}</div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">`;
  for (let i=0;i<startWeekday;i++) html += `<div></div>`;
  for (let d=1;d<=lastDay;d++) {
    const date = `${shiftCalMonth}-${String(d).padStart(2,'0')}`;
    const sh = shiftByDate[date];
    const sel = shiftCalSelected === date ? 'background:var(--accent);color:#fff;' : '';
    const has = sh ? 'border:1px solid var(--accent);' : '';
    html += `<button class="btn btn-sm" style="padding:6px;${has}${sel}" onclick="shiftCalSelect('${date}')">${d}${sh?' •':''}</button>`;
  }
  html += `</div>`;
  if (shiftCalSelected && shiftByDate[shiftCalSelected]) {
    const s = shiftByDate[shiftCalSelected];
    html += `<div style="margin-top:12px;padding:12px;background:var(--bg3);border-radius:8px">
      <div><b>${s.date}</b></div>
      <div>Пробег: ${s.startOdometer} → ${s.endOdometer} км</div>
      <div>За смену: ${s.distance} км</div>
      <div>Расход: ${fmt(s.consumption,2)} л/100</div>
      <div>Залито: ${fmt(s.fuelAdded||0,2)} л</div>
      <div>Израсходовано: ${fmt(s.fuelUsed,2)} л</div>
      <div>В баке до: ${fmt(s.fuelLeftBefore||0,2)} л</div>
      <div>Осталось: ${fmt(s.fuelLeft,2)} л</div>
      ${s.notes ? `<div>Заметки: ${s.notes}</div>` : ''}
    </div>`;
  } else if (shiftCalSelected) {
    html += `<div style="margin-top:12px;color:var(--muted)">Нет смены на ${shiftCalSelected}</div>`;
  }
  html += `</div>`;
  return html;
}

function shiftCalPrev(){const [y,m]=shiftCalMonth.split('-').map(Number);const d=new Date(y,m-2,1);shiftCalMonth=d.toISOString().slice(0,7);renderShifts(document.getElementById('tab-shifts'));}
function shiftCalNext(){const [y,m]=shiftCalMonth.split('-').map(Number);const d=new Date(y,m,1);shiftCalMonth=d.toISOString().slice(0,7);renderShifts(document.getElementById('tab-shifts'));}
function shiftCalSelect(date){shiftCalSelected=date;renderShifts(document.getElementById('tab-shifts'));}

window.shiftCalPrev=shiftCalPrev;window.shiftCalNext=shiftCalNext;window.shiftCalSelect=shiftCalSelect;

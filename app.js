(() => {
  'use strict';

  const LS_BOARD = 'saysay.board.v1';
  const LS_SET = 'saysay.settings.v1';
  const COLORS = ['teal', 'blue', 'orange', 'pink', 'purple', 'green', 'gray'];
  const COLOR_NAMES = { teal: '青', blue: '藍', orange: '橘', pink: '粉', purple: '紫', green: '綠', gray: '灰' };
  const DEFAULT_SETTINGS = {
    cols: 4, rows: 3, rate: 0.9, voiceURI: '', scanMs: 2500, scanSpeak: true, night: false, wake: true
  };

  const $ = (s) => document.querySelector(s);
  const uid = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const spoken = (item) => (item.say && item.say.trim()) || item.text;

  function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function normalizeBoard(b) {
    if (!b || !Array.isArray(b.categories) || !b.categories.length) return null;
    b.categories.forEach((c, i) => {
      c.id = c.id || uid();
      c.name = c.name || '分類';
      c.emoji = c.emoji || '';
      c.color = COLORS.includes(c.color) ? c.color : COLORS[i % COLORS.length];
      c.items = Array.isArray(c.items) ? c.items : [];
      c.items.forEach((it) => { it.id = it.id || uid(); it.text = it.text || ''; });
    });
    if (!Array.isArray(b.quick) || b.quick.length !== 3) b.quick = clone(window.DEFAULT_BOARD.quick);
    return b;
  }

  const state = {
    board: normalizeBoard(lsGet(LS_BOARD)) || normalizeBoard(clone(window.DEFAULT_BOARD)),
    settings: Object.assign({}, DEFAULT_SETTINGS,
      window.innerWidth < 600 ? { cols: 2, rows: 4 } : {}, // phones: fewer, bigger tiles on first run
      lsGet(LS_SET) || {}),
    cat: 0, page: 0, edit: false, last: null,
    scan: { on: false, idx: -1, timer: null },
    audioUrls: new Map() // itemId -> objectURL (preloaded so playback stays inside the tap gesture on iOS)
  };
  const saveBoard = () => lsSet(LS_BOARD, state.board);
  const saveSettings = () => lsSet(LS_SET, state.settings);
  saveBoard();

  // ---------------------------------------------------------------- audio storage (IndexedDB)
  const AudioDB = (() => {
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        if (!('indexedDB' in window)) { rej(new Error('no indexedDB')); return; }
        const r = indexedDB.open('saysay', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('audio');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      dbp.catch(() => { dbp = null; });
      return dbp;
    }
    async function run(mode, fn) {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('audio', mode);
        const req = fn(t.objectStore('audio'));
        t.oncomplete = () => res(req ? req.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    }
    return {
      get: (id) => run('readonly', (s) => s.get(id)).catch(() => null),
      put: (id, rec) => run('readwrite', (s) => s.put(rec, id)),
      del: (id) => run('readwrite', (s) => s.delete(id)).catch(() => {}),
      keys: () => run('readonly', (s) => s.getAllKeys()).catch(() => []),
      clear: () => run('readwrite', (s) => s.clear()).catch(() => {})
    };
  })();

  function setAudioUrl(id, rec) {
    const old = state.audioUrls.get(id);
    if (old) URL.revokeObjectURL(old);
    if (rec) state.audioUrls.set(id, URL.createObjectURL(new Blob([rec.buf], { type: rec.type })));
    else state.audioUrls.delete(id);
  }
  async function preloadAudio() {
    const keys = await AudioDB.keys();
    for (const k of keys) {
      const rec = await AudioDB.get(k);
      if (rec && rec.buf) setAudioUrl(k, rec);
    }
  }
  async function storeAudio(id, blob) {
    const rec = { type: blob.type || 'audio/mp4', buf: await blob.arrayBuffer() };
    await AudioDB.put(id, rec);
    setAudioUrl(id, rec);
  }
  async function removeAudio(id) { await AudioDB.del(id); setAudioUrl(id, null); }

  // ---------------------------------------------------------------- speech
  let voices = [];
  let currentAudio = null;
  const hasTTS = 'speechSynthesis' in window;

  function loadVoices() {
    if (!hasTTS) return;
    voices = (speechSynthesis.getVoices() || []).filter((v) => /^(zh|cmn|yue|nan)/i.test(v.lang));
    renderVoiceSelect();
  }
  function pickVoice() {
    const want = state.settings.voiceURI;
    return voices.find((v) => v.voiceURI === want)
      || voices.find((v) => /zh[-_]TW/i.test(v.lang))
      || voices.find((v) => /^zh/i.test(v.lang))
      || null;
  }
  let lastUtterance = null; // keep a reference: some WebKit builds drop utterances that get garbage-collected
  function stopSound() {
    // only cancel when something is queued: cancel() immediately followed by speak() can swallow the new utterance on iOS
    if (hasTTS && (speechSynthesis.speaking || speechSynthesis.pending)) {
      try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    }
    if (currentAudio) { try { currentAudio.pause(); } catch (e) { /* ignore */ } currentAudio = null; }
  }
  function tts(text, opts) {
    if (!hasTTS || !text) return;
    stopSound();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'zh-TW'; }
    u.rate = (opts && opts.rate) || state.settings.rate;
    u.volume = 1;
    if (opts && opts.on) Object.keys(opts.on).forEach((k) => u.addEventListener(k, opts.on[k]));
    lastUtterance = u;
    try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch (e) { /* ignore */ }
    speechSynthesis.speak(u);
  }
  function sayItem(item) {
    stopSound();
    const url = state.audioUrls.get(item.id);
    if (url) {
      currentAudio = new Audio(url);
      currentAudio.play().catch(() => tts(spoken(item)));
    } else {
      tts(spoken(item));
    }
  }

  // ---------------------------------------------------------------- helpers
  const curCat = () => state.board.categories[state.cat] || state.board.categories[0];
  const perPage = () => state.settings.cols * state.settings.rows;
  function listForCat() {
    const items = curCat().items.slice();
    if (state.edit) items.push({ id: '__add__', add: true });
    return items;
  }
  const pageCount = () => Math.max(1, Math.ceil(listForCat().length / perPage()));
  function findItem(id) {
    for (const c of state.board.categories) {
      const i = c.items.findIndex((x) => x.id === id);
      if (i >= 0) return { cat: c, index: i, item: c.items[i] };
    }
    const q = state.board.quick.find((x) => x.id === id);
    return q ? { cat: null, index: -1, item: q, quick: true } : null;
  }
  function flash(el) { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  function showBanner(text) {
    const b = $('#banner');
    $('#bannerText').textContent = text;
    b.classList.remove('idle', 'pop'); void b.offsetWidth; b.classList.add('pop');
  }

  // ---------------------------------------------------------------- render
  function renderTabs() {
    const nav = $('#tabs');
    nav.textContent = '';
    state.board.categories.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'tab c-' + c.color + (i === state.cat ? ' active' : '');
      const e = document.createElement('span'); e.textContent = c.emoji;
      const n = document.createElement('span'); n.className = 'tname'; n.textContent = c.name;
      b.append(e, n);
      b.addEventListener('click', () => {
        stopScan();
        state.cat = i; state.page = 0;
        render();
        b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
      nav.appendChild(b);
    });
  }

  function makeTile(item, color) {
    const b = document.createElement('button');
    b.className = 'tile c-' + color;
    if (item.add) {
      b.classList.add('add');
      const e = document.createElement('span'); e.className = 'em'; e.textContent = '＋';
      const t = document.createElement('span'); t.className = 'tx'; t.textContent = '新增';
      b.append(e, t);
      b.addEventListener('click', () => openItemDialog(null));
      return b;
    }
    b.dataset.id = item.id;
    const e = document.createElement('span'); e.className = 'em'; e.textContent = item.emoji || '';
    const t = document.createElement('span'); t.className = 'tx'; t.textContent = item.text;
    b.append(e, t);
    if (state.audioUrls.has(item.id)) {
      const bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = '🎙️'; b.appendChild(bd);
    }
    b.addEventListener('click', () => {
      if (state.edit) { openItemDialog(item.id); return; }
      if (state.scan.on) stopScan();
      activate(item, b);
    });
    return b;
  }

  function renderGrid() {
    const grid = $('#grid');
    const { cols, rows } = state.settings;
    const n = perPage();
    const pages = pageCount();
    if (state.page >= pages) state.page = pages - 1;
    const list = listForCat().slice(state.page * n, state.page * n + n);
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    grid.textContent = '';
    const color = curCat().color;
    list.forEach((it) => grid.appendChild(makeTile(it, color)));
    for (let i = list.length; i < n; i++) {
      const d = document.createElement('div'); d.className = 'tile empty'; grid.appendChild(d);
    }
    $('#pageInfo').textContent = `${state.page + 1} / ${pages}`;
    $('#prev').disabled = state.page === 0;
    $('#next').disabled = state.page >= pages - 1;
    $('#pager').classList.toggle('single', pages <= 1);
  }

  function renderQuick() {
    const q = $('#quick');
    q.textContent = '';
    const mk = (cls, emoji, text, onClick) => {
      const b = document.createElement('button');
      b.className = 'q ' + cls;
      const e = document.createElement('span'); e.className = 'em'; e.textContent = emoji;
      const t = document.createElement('span'); t.textContent = text;
      b.append(e, t);
      b.addEventListener('click', () => onClick(b));
      q.appendChild(b);
      return b;
    };
    state.board.quick.forEach((it) => {
      mk(it.kind || 'idk', it.emoji, it.text, (b) => {
        if (state.edit) { openItemDialog(it.id); return; }
        if (state.scan.on) stopScan();
        activate(it, b);
      });
    });
    mk('idk', '🔁', '再說一次', (b) => {
      if (state.last) { flash(b); showBanner(state.last.text); sayItem(state.last); }
    });
    mk('alert', '🔔', '叫人', () => startAlert());
  }

  function render() {
    document.body.classList.toggle('night', !!state.settings.night);
    document.body.classList.toggle('editing', state.edit);
    $('#editBar').hidden = !state.edit;
    renderTabs();
    renderGrid();
    renderQuick();
  }

  function activate(item, el) {
    state.last = item;
    flash(el);
    showBanner(item.text);
    sayItem(item);
  }

  // ---------------------------------------------------------------- paging
  $('#prev').addEventListener('click', () => { if (state.page > 0) { stopScan(); state.page--; renderGrid(); } });
  $('#next').addEventListener('click', () => { if (state.page < pageCount() - 1) { stopScan(); state.page++; renderGrid(); } });

  // ---------------------------------------------------------------- scan mode (partner-assisted)
  function scanTiles() { return Array.from(document.querySelectorAll('#grid .tile[data-id]')); }
  function clearScanHi() { document.querySelectorAll('.scan-hi').forEach((el) => el.classList.remove('scan-hi')); }
  function startScan() {
    if (state.edit) return;
    stopScan();
    if (!curCat().items.length) return;
    state.scan.on = true; state.scan.idx = -1;
    document.body.classList.add('scanning');
    $('#scanBar').hidden = false;
    $('#btnScan').classList.add('on');
    stepScan();
  }
  function stepScan() {
    if (!state.scan.on) return;
    let tiles = scanTiles();
    let i = state.scan.idx + 1;
    if (i >= tiles.length) {
      const pages = pageCount();
      if (pages > 1) { state.page = (state.page + 1) % pages; renderGrid(); tiles = scanTiles(); }
      i = 0;
    }
    if (!tiles.length) { stopScan(); return; }
    clearScanHi();
    state.scan.idx = i;
    const el = tiles[i];
    el.classList.add('scan-hi');
    const found = findItem(el.dataset.id);
    if (state.settings.scanSpeak && found) tts(found.item.text, { rate: Math.min(1.2, state.settings.rate + 0.1) });
    state.scan.timer = setTimeout(stepScan, state.settings.scanMs);
  }
  function stopScan() {
    if (state.scan.timer) clearTimeout(state.scan.timer);
    state.scan.timer = null;
    if (!state.scan.on) return;
    state.scan.on = false;
    clearScanHi();
    document.body.classList.remove('scanning');
    $('#scanBar').hidden = true;
    $('#btnScan').classList.remove('on');
  }
  function scanChoose() {
    const el = scanTiles()[state.scan.idx];
    stopScan();
    if (!el) return;
    const found = findItem(el.dataset.id);
    if (!found) return;
    el.classList.add('chosen');
    setTimeout(() => el.classList.remove('chosen'), 1500);
    activate(found.item, el);
  }
  $('#btnScan').addEventListener('click', () => (state.scan.on ? stopScan() : startScan()));
  $('#scanSelect').addEventListener('click', scanChoose);
  $('#scanStop').addEventListener('click', stopScan);

  // ---------------------------------------------------------------- alert
  let actx = null;
  let alertTimers = [];
  function beepOnce(at) {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(880, at);
    o.frequency.setValueAtTime(1175, at + 0.18);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.36);
    o.connect(g).connect(actx.destination);
    o.start(at); o.stop(at + 0.4);
  }
  function startAlert() {
    stopScan();
    stopSound();
    $('#alertOverlay').hidden = false;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime + 0.05;
      for (let i = 0; i < 6; i++) { beepOnce(t0 + i * 0.5); }
    } catch (e) { /* no web audio */ }
    alertTimers.push(setTimeout(() => tts('請過來一下'), 3200));
    alertTimers.push(setTimeout(() => {
      if (!$('#alertOverlay').hidden && actx) {
        const t = actx.currentTime + 0.05;
        for (let i = 0; i < 6; i++) beepOnce(t + i * 0.5);
      }
    }, 6000));
  }
  function stopAlert() {
    alertTimers.forEach(clearTimeout); alertTimers = [];
    stopSound();
    $('#alertOverlay').hidden = true;
  }
  $('#alertClose').addEventListener('click', stopAlert);

  // ---------------------------------------------------------------- settings (press and hold to open)
  (function holdToOpen() {
    const btn = $('#btnSettings');
    let t = null;
    const cancel = () => { btn.classList.remove('holding'); if (t) clearTimeout(t); t = null; };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cancel();
      btn.classList.add('holding');
      t = setTimeout(() => { cancel(); openSettings(); }, 1000);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, cancel));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.shiftKey) openSettings(); });
  })();

  function renderVoiceSelect() {
    const sel = $('#sVoice');
    if (!sel) return;
    sel.textContent = '';
    const auto = document.createElement('option'); auto.value = ''; auto.textContent = '自動（中文）'; sel.appendChild(auto);
    voices.forEach((v) => {
      const o = document.createElement('option');
      o.value = v.voiceURI; o.textContent = `${v.name}（${v.lang}）`;
      sel.appendChild(o);
    });
    sel.value = state.settings.voiceURI || '';
  }

  function renderCatList() {
    const box = $('#catList');
    box.textContent = '';
    const cats = state.board.categories;
    cats.forEach((c, i) => {
      const row = document.createElement('div'); row.className = 'cat-row';
      const em = document.createElement('input'); em.className = 'cat-emoji'; em.value = c.emoji; em.maxLength = 8;
      em.addEventListener('change', () => { c.emoji = em.value.trim(); saveBoard(); render(); });
      const nm = document.createElement('input'); nm.className = 'cat-name'; nm.value = c.name; nm.maxLength = 12;
      nm.addEventListener('change', () => { c.name = nm.value.trim() || '分類'; saveBoard(); render(); });
      const col = document.createElement('select');
      COLORS.forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = COLOR_NAMES[k]; col.appendChild(o); });
      col.value = c.color;
      col.addEventListener('change', () => { c.color = col.value; saveBoard(); render(); });
      const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.disabled = i === 0;
      up.addEventListener('click', () => { moveCat(i, -1); });
      const dn = document.createElement('button'); dn.type = 'button'; dn.textContent = '↓'; dn.disabled = i === cats.length - 1;
      dn.addEventListener('click', () => { moveCat(i, 1); });
      const del = document.createElement('button'); del.type = 'button'; del.textContent = '🗑️'; del.disabled = cats.length <= 1;
      del.addEventListener('click', async () => {
        if (!confirm(`刪除分類「${c.name}」和裡面 ${c.items.length} 格？`)) return;
        for (const it of c.items) await removeAudio(it.id);
        cats.splice(i, 1);
        state.cat = Math.min(state.cat, cats.length - 1);
        state.page = 0;
        saveBoard(); renderCatList(); render();
      });
      row.append(em, nm, col, up, dn, del);
      box.appendChild(row);
    });
  }
  function moveCat(i, d) {
    const cats = state.board.categories;
    const j = i + d;
    if (j < 0 || j >= cats.length) return;
    const curId = curCat().id;
    [cats[i], cats[j]] = [cats[j], cats[i]];
    state.cat = cats.findIndex((c) => c.id === curId);
    saveBoard(); renderCatList(); render();
  }

  function openSettings() {
    stopScan();
    const s = state.settings;
    $('#sCols').value = String(s.cols);
    $('#sRows').value = String(s.rows);
    $('#sNight').checked = !!s.night;
    $('#sWake').checked = !!s.wake;
    $('#sRate').value = String(s.rate);
    $('#sRateOut').textContent = s.rate.toFixed(1);
    $('#sScan').value = String(s.scanMs);
    $('#sScanSpeak').checked = !!s.scanSpeak;
    renderVoiceSelect();
    renderCatList();
    $('#dlgSettings').showModal();
  }
  function bindSetting(sel, key, parse, after) {
    $(sel).addEventListener('change', (e) => {
      const el = e.target;
      state.settings[key] = parse(el.type === 'checkbox' ? el.checked : el.value);
      saveSettings();
      if (after) after();
    });
  }
  bindSetting('#sCols', 'cols', Number, () => { state.page = 0; renderGrid(); });
  bindSetting('#sRows', 'rows', Number, () => { state.page = 0; renderGrid(); });
  bindSetting('#sNight', 'night', Boolean, render);
  bindSetting('#sWake', 'wake', Boolean, () => (state.settings.wake ? requestWake() : releaseWake()));
  bindSetting('#sRate', 'rate', Number);
  bindSetting('#sVoice', 'voiceURI', String);
  bindSetting('#sScan', 'scanMs', Number);
  bindSetting('#sScanSpeak', 'scanSpeak', Boolean);
  $('#sRate').addEventListener('input', (e) => { $('#sRateOut').textContent = Number(e.target.value).toFixed(1); });
  $('#sTest').addEventListener('click', () => tts('你好，我想喝水'));

  // ---------------------------------------------------------------- sound check (for remote troubleshooting)
  function beepWavUrl() {
    const rate = 22050, n = Math.floor(rate * 0.5);
    const b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / 400, (n - i) / 400);
      v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 880 * i / rate) * 12000 * env, true);
    }
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  const diag = { lines: {} };
  function diagSet(key, text) {
    diag.lines[key] = text;
    const order = ['sys', 'mode', 'tts', 'voices', 'voice', 'session', 'beep', 'speak'];
    $('#diagOut').textContent = order.filter((k) => diag.lines[k]).map((k) => diag.lines[k]).join('\n');
  }
  function diagInfo() {
    const ua = navigator.userAgent;
    const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const os = (ua.match(/OS (\d+(?:_\d+)*)/) || ua.match(/Version\/(\d+(?:\.\d+)*)/) || [])[1];
    const app = /CriOS/.test(ua) ? 'Chrome' : /FxiOS/.test(ua) ? 'Firefox' : /EdgiOS/.test(ua) ? 'Edge' : /Safari/.test(ua) && /Version\//.test(ua) ? 'Safari' : '其他';
    diagSet('sys', `裝置：${isIpad ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : '其他'}　系統版本：${os ? os.replace(/_/g, '.') : '不明'}　瀏覽器：${app}`);
    const standalone = navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    diagSet('mode', `開啟方式：${standalone ? '主畫面圖示' : '瀏覽器'}`);
    diagSet('tts', `電腦語音功能：${hasTTS ? '有' : '沒有'}`);
    const all = hasTTS ? speechSynthesis.getVoices() : [];
    diagSet('voices', `語音數量：全部 ${all.length}、中文 ${voices.length}`);
    const v = pickVoice();
    diagSet('voice', `使用的語音：${v ? `${v.name}（${v.lang}）` : '系統預設（zh-TW）'}`);
    diagSet('session', `音訊模式：${navigator.audioSession ? navigator.audioSession.type : '不支援設定'}`);
  }
  $('#sBeep').addEventListener('click', () => {
    diagInfo();
    stopSound();
    const a = new Audio(beepWavUrl());
    a.volume = 1;
    diagSet('beep', '① 提示音：播放中…');
    a.play().then(() => diagSet('beep', '① 提示音：已播放（有聽到「嗶」嗎？）'))
      .catch((e) => diagSet('beep', `① 提示音：播放失敗（${e.name}）`));
  });
  $('#sSpeak').addEventListener('click', () => {
    diagInfo();
    if (!hasTTS) { diagSet('speak', '② 說話：這個瀏覽器沒有語音功能\n　→ 可能開了「鎖定模式」：設定 → 隱私權與安全性 → 鎖定模式'); return; }
    let started = false;
    let failed = false;
    diagSet('speak', '② 說話：送出中…');
    tts('聲音測試，一二三', {
      on: {
        start: () => { started = true; diagSet('speak', '② 說話：開始唸了（有聽到嗎？）'); },
        end: () => { if (!failed) diagSet('speak', started ? '② 說話：唸完了（有聽到嗎？）' : '② 說話：結束但沒有開始'); },
        error: (e) => { failed = true; diagSet('speak', `② 說話：失敗（${e.error || 'error'}）`); }
      }
    });
    setTimeout(() => { if (!started && !failed) diagSet('speak', '② 說話：3 秒內沒有開始（語音被系統擋住或沒有中文語音）'); }, 3000);
  });
  $('#sClose').addEventListener('click', () => $('#dlgSettings').close());
  $('#catAdd').addEventListener('click', () => {
    const cats = state.board.categories;
    cats.push({ id: uid(), name: '新分類', emoji: '⭐', color: COLORS[cats.length % COLORS.length], items: [] });
    saveBoard(); renderCatList(); render();
  });
  $('#sEdit').addEventListener('click', () => { $('#dlgSettings').close(); setEdit(true); });
  $('#btnDoneEdit').addEventListener('click', () => setEdit(false));
  function setEdit(on) {
    stopScan();
    state.edit = on;
    if (!on && state.page >= pageCount()) state.page = pageCount() - 1;
    render();
  }

  // ---------------------------------------------------------------- backup
  function abToB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToAb(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out.buffer;
  }
  $('#sExport').addEventListener('click', async () => {
    const audio = {};
    for (const id of state.audioUrls.keys()) {
      const rec = await AudioDB.get(id);
      if (rec && rec.buf) audio[id] = { type: rec.type, b64: abToB64(rec.buf) };
    }
    const data = { app: 'saysay', v: 1, exported: new Date().toISOString(), board: state.board, settings: state.settings, audio };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    a.href = URL.createObjectURL(blob);
    a.download = `說說板備份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('#sImport').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const board = normalizeBoard(data && data.board);
      if (data.app !== 'saysay' || !board) throw new Error('格式不符');
      if (!confirm('匯入會取代這台平板目前的片語和錄音，確定嗎？')) return;
      await AudioDB.clear();
      for (const id of Array.from(state.audioUrls.keys())) setAudioUrl(id, null);
      const audio = data.audio || {};
      for (const id of Object.keys(audio)) {
        const rec = { type: audio[id].type || 'audio/mp4', buf: b64ToAb(audio[id].b64) };
        await AudioDB.put(id, rec);
        setAudioUrl(id, rec);
      }
      state.board = board;
      state.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
      state.cat = 0; state.page = 0;
      saveBoard(); saveSettings();
      $('#dlgSettings').close();
      render();
      alert('匯入完成');
    } catch (err) {
      alert('匯入失敗：' + err.message);
    }
  });
  $('#sReset').addEventListener('click', async () => {
    if (!confirm('還原成預設片語？你自己改的內容和所有錄音都會被清掉，無法復原。\n（建議先按「匯出備份」）')) return;
    await AudioDB.clear();
    for (const id of Array.from(state.audioUrls.keys())) setAudioUrl(id, null);
    state.board = normalizeBoard(clone(window.DEFAULT_BOARD));
    state.cat = 0; state.page = 0;
    saveBoard();
    $('#dlgSettings').close();
    render();
  });

  // ---------------------------------------------------------------- item editor
  const ed = { id: null, isNew: false, quick: false, recorder: null, stream: null, chunks: [], stopTimer: null, recordedNew: false };

  function openItemDialog(id) {
    const found = id ? findItem(id) : null;
    ed.isNew = !found;
    ed.quick = !!(found && found.quick);
    ed.id = found ? found.item.id : uid();
    ed.recordedNew = false;
    const item = found ? found.item : { emoji: '', text: '', say: '' };
    $('#itemTitle').textContent = ed.isNew ? '新增格子' : (ed.quick ? '編輯快捷鍵' : '編輯格子');
    $('#fEmoji').value = item.emoji || '';
    $('#fText').value = item.text || '';
    $('#fSay').value = item.say || '';
    $('#moveRow').hidden = ed.isNew || ed.quick;
    $('#itemDelete').hidden = ed.isNew || ed.quick;
    const sel = $('#fCat');
    sel.textContent = '';
    state.board.categories.forEach((c) => {
      const o = document.createElement('option'); o.value = c.id; o.textContent = `${c.emoji} ${c.name}`; sel.appendChild(o);
    });
    sel.value = found && found.cat ? found.cat.id : curCat().id;
    updateRecUi();
    $('#dlgItem').showModal();
  }
  function updateRecUi(msg) {
    const has = state.audioUrls.has(ed.id);
    const recording = ed.recorder && ed.recorder.state === 'recording';
    $('#recBtn').textContent = recording ? '⏹️ 停止錄音' : (has ? '🎙️ 重新錄音' : '🎙️ 開始錄音');
    $('#recBtn').classList.toggle('recording', !!recording);
    $('#recPlay').disabled = !has || recording;
    $('#recDel').disabled = !has || recording;
    $('#recStatus').textContent = msg || (recording ? '錄音中……說完按停止（最長 15 秒）' : (has ? '已有錄音，點格子時會播放錄音。' : '沒有錄音，會用電腦語音唸。'));
  }
  async function toggleRecord() {
    if (ed.recorder && ed.recorder.state === 'recording') { ed.recorder.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { updateRecUi('這個瀏覽器不支援錄音。'); return; }
    try {
      ed.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      updateRecUi('無法使用麥克風，請在系統設定允許 Safari 使用麥克風。');
      return;
    }
    const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
    const type = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(ed.stream, type ? { mimeType: type } : undefined);
    ed.recorder = rec;
    ed.chunks = [];
    const recId = ed.id;
    rec.ondataavailable = (e) => { if (e.data && e.data.size) ed.chunks.push(e.data); };
    rec.onstop = async () => {
      clearTimeout(ed.stopTimer);
      if (ed.stream) ed.stream.getTracks().forEach((t) => t.stop());
      ed.stream = null;
      const blob = new Blob(ed.chunks, { type: rec.mimeType || type || 'audio/mp4' });
      ed.recorder = null;
      if (blob.size < 500) { updateRecUi('錄音太短，請再試一次。'); return; }
      try {
        await storeAudio(recId, blob);
        if (ed.isNew) ed.recordedNew = true;
        updateRecUi('錄好了，可以按「試聽」。');
      } catch (e) {
        updateRecUi('儲存錄音失敗：' + e.message);
      }
    };
    rec.start();
    ed.stopTimer = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 15000);
    updateRecUi();
  }
  function stopRecordingIfAny() {
    if (ed.recorder && ed.recorder.state === 'recording') ed.recorder.stop();
  }
  $('#recBtn').addEventListener('click', toggleRecord);
  $('#recPlay').addEventListener('click', () => {
    const url = state.audioUrls.get(ed.id);
    if (url) { stopSound(); currentAudio = new Audio(url); currentAudio.play().catch(() => {}); }
  });
  $('#recDel').addEventListener('click', async () => { await removeAudio(ed.id); updateRecUi('錄音已刪除。'); });

  function readFields() {
    return { emoji: $('#fEmoji').value.trim(), text: $('#fText').value.trim(), say: $('#fSay').value.trim() };
  }
  $('#itemSave').addEventListener('click', () => {
    const f = readFields();
    if (!f.text) { $('#fText').focus(); return; }
    stopRecordingIfAny();
    if (ed.isNew) {
      const target = state.board.categories.find((c) => c.id === $('#fCat').value) || curCat();
      target.items.push({ id: ed.id, emoji: f.emoji, text: f.text, say: f.say || undefined });
    } else {
      const found = findItem(ed.id);
      if (found) {
        Object.assign(found.item, { emoji: f.emoji, text: f.text, say: f.say || undefined });
        const targetId = $('#fCat').value;
        if (!found.quick && found.cat.id !== targetId) {
          const target = state.board.categories.find((c) => c.id === targetId);
          if (target) { found.cat.items.splice(found.index, 1); target.items.push(found.item); }
        }
      }
    }
    saveBoard();
    $('#dlgItem').close();
    render();
  });
  $('#itemCancel').addEventListener('click', () => $('#dlgItem').close());
  $('#dlgItem').addEventListener('close', () => {
    stopRecordingIfAny();
    // a brand-new tile that was cancelled: drop its recording
    if (ed.isNew && ed.recordedNew && !findItem(ed.id)) removeAudio(ed.id);
  });
  $('#itemDelete').addEventListener('click', async () => {
    const found = findItem(ed.id);
    if (!found || found.quick) return;
    if (!confirm(`刪除「${found.item.text}」？`)) return;
    found.cat.items.splice(found.index, 1);
    await removeAudio(ed.id);
    saveBoard();
    $('#dlgItem').close();
    render();
  });
  function moveItem(d) {
    const found = findItem(ed.id);
    if (!found || found.quick) return;
    const items = found.cat.items;
    const j = found.index + d;
    if (j < 0 || j >= items.length) return;
    Object.assign(found.item, (() => { const f = readFields(); return f.text ? { emoji: f.emoji, text: f.text, say: f.say || undefined } : {}; })());
    [items[found.index], items[j]] = [items[j], items[found.index]];
    saveBoard();
    $('#dlgItem').close();
    const n = perPage();
    state.page = Math.floor(j / n);
    render();
  }
  $('#mvPrev').addEventListener('click', () => moveItem(-1));
  $('#mvNext').addEventListener('click', () => moveItem(1));

  // ---------------------------------------------------------------- screen wake lock
  let wakeLock = null;
  async function requestWake() {
    if (!state.settings.wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed yet */ }
  }
  function releaseWake() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWake();
    else stopScan();
  });
  document.addEventListener('pointerdown', () => { if (!wakeLock) requestWake(); }, { passive: true });

  // ---------------------------------------------------------------- boot
  // iOS/iPadOS 16.4+: treat our sound as media playback so it is not silenced by mute mode
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
  if (hasTTS) { loadVoices(); speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', loadVoices); }
  render();
  $('#banner').classList.add('idle');
  preloadAudio().then(renderGrid);
  requestWake();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

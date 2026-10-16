/* 銷售分析 — 介面邏輯 */
(function () {
  const { DIMS, MEASURES, ymDiff, ymLabel } = window.EngineMeta;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('dv.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('dv.' + k, JSON.stringify(v)); } catch (e) { /* 無法儲存時忽略 */ } },
  };

  // ---------- 數字格式 ----------
  const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const fmt = {
    money: (v) => v == null ? '—' : nf0.format(Math.round(v)),
    money2: (v) => v == null ? '—' : nf2.format(v),
    int: (v) => v == null ? '—' : nf0.format(v),
    pct: (v) => v == null || !isFinite(v) ? '—' : nf1.format(v * 100) + '%',
    big: (v) => {
      if (v == null) return '—';
      const a = Math.abs(v);
      if (a >= 1e8) return nf2.format(v / 1e8) + ' 億';
      if (a >= 1e4) return nf0.format(v / 1e4) + ' 萬';
      return nf0.format(v);
    },
    axis: (v) => (Math.abs(v) >= 1e8 ? nf1.format(v / 1e8) + '億' : Math.abs(v) >= 1e4 ? nf0.format(v / 1e4) + '萬' : nf0.format(v)),
    ym: ymLabel,
  };
  const fmtOf = (key) => (MEASURES.find((m) => m.key === key) || {}).fmt || 'int';
  const dimLabel = (k) => (DIMS.find((d) => d.key === k) || {}).label || k;
  const repName = (r) => (r ? '業務 ' + r : '（未填）');

  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- 狀態 ----------
  const S = {
    E: null, raw: null, vault: null, locked: false, // vault.key 只放記憶體，不會存下來
    view: 'overview',
    ref: store.get('ref', null),
    pivot: store.get('pivot', { src: 'all', rows: ['region'], col: 'year', measures: ['sales', 'returns', 'net', 'margin'], filters: {}, from: 0, to: 0, mode: 'agg' }),
    pvSort: null,
    cust: { idle: 'all', q: '', filters: {}, sort: { key: 'sales', dir: -1 } },
    prod: { idle: 'all', q: '', filters: {}, level: 'sku', sort: { key: 'sales', dir: -1 } },
  };
  const refYm = () => (S.ref && S.E && S.E.ymIndex.has(S.ref) ? S.ref : S.E ? S.E.maxYm : 0);

  // 篩選物件：{dimKey: [codes]} -> engine 的 Set
  const toDims = (f) => { const o = {}; for (const k in f) if (f[k] && f[k].length) o[k] = new Set(f[k]); return o; };

  // ---------- 主題 ----------
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('dv.theme', t); } catch (e) { /* */ }
    $$('#themePick button').forEach((b) => b.classList.toggle('on', b.dataset.theme === t));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = { indigo: '#26437A', night: '#0E1726', market: '#13805F' }[t];
    if (S.E) setTimeout(() => { if (S.view === 'overview') drawOverviewChart(); }, 30);
  }

  // ---------- 導覽 ----------
  function go(view) {
    if (!S.E && view !== 'data') view = 'data';
    S.view = view;
    $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + view; });
    $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
    if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
    renderView();
    window.scrollTo(0, 0);
  }
  function renderView() {
    if (!S.E) { renderData(); return; }
    ({ overview: renderOverview, pivot: renderPivot, customers: renderCustomers, products: renderProducts, data: renderData })[S.view]();
  }

  // ---------- 表格元件 ----------
  // cols: [{key,label,fmt?,n?,render?(row), cls?}] ; opts: {sort, onSort, onRow, limit, foot}
  function table(el, cols, rows, opts = {}) {
    const limit = opts.limit || 300;
    let shown = Math.min(rows.length, limit);
    const head = opts.headHtml || ('<tr>' + cols.map((c) => {
      const s = opts.sort && opts.sort.key === c.key;
      return `<th class="${c.n ? 'n' : ''} ${s ? 'sorted' + (opts.sort.dir > 0 ? ' asc' : '') : ''} ${c.cls || ''}" data-k="${esc(c.key)}">${esc(c.label)}</th>`;
    }).join('') + '</tr>');
    const cell = (c, r) => {
      const v = c.get ? c.get(r) : r[c.key];
      const html = c.render ? c.render(r, v) : esc(c.fmt ? fmt[c.fmt](v) : v);
      return `<td class="${c.n ? 'n' : ''} ${c.cls || ''}">${html}</td>`;
    };
    const body = (from, to) => { let h = ''; for (let i = from; i < to; i++) h += `<tr class="${opts.onRow ? 'click' : ''}" data-i="${i}">${cols.map((c) => cell(c, rows[i])).join('')}</tr>`; return h; };
    if (!rows.length) { el.innerHTML = `<div class="empty">${opts.empty || '沒有符合條件的資料'}</div>`; return; }
    el.innerHTML = `<table class="dt"><thead>${head}</thead><tbody>${body(0, shown)}</tbody>${opts.foot ? `<tfoot>${opts.foot}</tfoot>` : ''}</table>` +
      (rows.length > shown ? `<div class="more"><span>顯示 ${nf0.format(shown)} / ${nf0.format(rows.length)} 筆</span><button class="btn">再顯示 ${limit} 筆</button><button class="btn" data-all>全部顯示</button></div>` : '');
    const tb = $('tbody', el);
    const more = $('.more', el);
    if (more) {
      more.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const to = b.hasAttribute('data-all') ? rows.length : Math.min(rows.length, shown + limit);
        tb.insertAdjacentHTML('beforeend', body(shown, to)); shown = to;
        if (shown >= rows.length) more.remove(); else $('span', more).textContent = `顯示 ${nf0.format(shown)} / ${nf0.format(rows.length)} 筆`;
      });
    }
    if (opts.onSort) $('thead', el).addEventListener('click', (e) => { const th = e.target.closest('th[data-k]'); if (th) opts.onSort(th.dataset.k); });
    if (opts.onRow) tb.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) opts.onRow(rows[+tr.dataset.i]); });
  }
  function sortRows(rows, sort, getter) {
    if (!sort) return rows;
    const g = getter || ((r) => r[sort.key]);
    const coll = new Intl.Collator('zh-Hant', { numeric: true });
    return rows.slice().sort((a, b) => {
      const x = g(a), y = g(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
      return coll.compare(String(x), String(y)) * sort.dir;
    });
  }
  function toggleSort(cur, key) { return cur && cur.key === key ? { key, dir: -cur.dir } : { key, dir: -1 }; }
  const monthsCell = (v, kind, max = 24) => {
    const cls = kind === 'idle' ? (v <= 2 ? 'idle-0' : v <= 5 ? 'idle-1' : 'idle-2') : '';
    const w = Math.max(2, Math.min(60, (v / max) * 60));
    return `<span class="months ${cls}">${nf0.format(v)}<i style="width:${w}px"></i></span>`;
  };

  // ---------- CSV ----------
  function downloadCsv(name, header, rows) {
    const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = '﻿' + [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name + '.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------- 多選篩選（浮動選單）----------
  function openPicker(anchor, dimKey, selected, onApply, scopeFilter) {
    const pop = $('#popover');
    const d = S.E.dim(dimKey);
    // 計算每個值的筆數（依目前其他篩選）
    const idx = S.E.select(scopeFilter || {});
    const cnt = new Float64Array(d.labels.length);
    for (let j = 0; j < idx.length; j++) cnt[d.codes[idx[j]]]++;
    let opts = [];
    for (let c = 0; c < d.labels.length; c++) if (cnt[c] > 0 || selected.includes(c)) opts.push(c);
    if (dimKey === 'rep') opts.sort((a, b) => (+d.labels[a] || 999) - (+d.labels[b] || 999));
    else if (!d.ordered) { const coll = new Intl.Collator('zh-Hant', { numeric: true }); opts.sort((a, b) => coll.compare(d.labels[a], d.labels[b])); }
    const sel = new Set(selected);
    const label = (c) => (dimKey === 'rep' ? repName(d.labels[c]) : d.labels[c] || '（空白）');
    pop.innerHTML = `<header><strong>${esc(dimLabel(dimKey))}</strong><input type="search" placeholder="搜尋…" autofocus></header><div class="opts"></div>
      <footer><span class="row"><button class="btn" data-a="all">全選顯示的</button><button class="btn" data-a="none">清除</button></span><button class="btn primary" data-a="ok">套用</button></footer>`;
    const list = $('.opts', pop), inp = $('input', pop);
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      const shown = []; for (const c of opts) { if (!q || String(label(c)).toLowerCase().includes(q)) { shown.push(c); if (shown.length >= 400) break; } }
      list.innerHTML = shown.map((c) => `<label><input type="checkbox" value="${c}" ${sel.has(c) ? 'checked' : ''}><span>${esc(label(c))}</span><small>${nf0.format(cnt[c])}</small></label>`).join('') +
        (shown.length >= 400 ? '<p class="hint" style="padding:0 10px">只顯示前 400 項，請用搜尋縮小範圍</p>' : '') || '<p class="empty">沒有符合的項目</p>';
      list._shown = shown;
    };
    draw();
    inp.addEventListener('input', draw);
    list.addEventListener('change', (e) => { const c = +e.target.value; if (e.target.checked) sel.add(c); else sel.delete(c); });
    pop.onclick = (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'all') { list._shown.forEach((c) => sel.add(c)); draw(); }
      if (a.dataset.a === 'none') { sel.clear(); draw(); }
      if (a.dataset.a === 'ok') { closePop(); onApply([...sel]); }
    };
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px';
    const top = r.bottom + h + 8 < innerHeight ? r.bottom + 6 : r.top - h - 6;
    pop.style.top = Math.max(12, Math.min(innerHeight - h - 12, top)) + 'px';
    setTimeout(() => inp.focus(), 0);
  }
  function closePop() { $('#popover').hidden = true; }
  document.addEventListener('mousedown', (e) => { const p = $('#popover'); if (!p.hidden && !p.contains(e.target) && !e.target.closest('.chip,select.add')) closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePop(); closeDrawer(); } });

  // 篩選標籤列：filters = {dim:[codes]}
  function renderFilterChips(box, addSel, filters, dims, onChange, scopeFn) {
    const keys = Object.keys(filters).filter((k) => filters[k] && filters[k].length);
    box.innerHTML = keys.map((k) => {
      const d = S.E.dim(k); const codes = filters[k];
      const names = codes.slice(0, 2).map((c) => (k === 'rep' ? repName(d.labels[c]) : d.labels[c] || '（空白）')).join('、') + (codes.length > 2 ? ` 等 ${codes.length} 項` : '');
      return `<span class="chip" data-k="${k}"><b>${esc(dimLabel(k))}</b><span>${esc(names)}</span><button class="x" aria-label="移除篩選">✕</button></span>`;
    }).join('');
    addSel.innerHTML = '<option value="">' + (addSel.dataset.ph || '＋ 篩選') + '</option>' + dims.filter((k) => !keys.includes(k)).map((k) => `<option value="${k}">${esc(dimLabel(k))}</option>`).join('');
    box.onclick = (e) => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      const k = chip.dataset.k;
      if (e.target.closest('.x')) { delete filters[k]; onChange(); return; }
      openPicker(chip, k, filters[k] || [], (codes) => { filters[k] = codes; onChange(); }, scopeFn ? scopeFn(k) : {});
    };
    addSel.onchange = () => {
      const k = addSel.value; if (!k) return;
      openPicker(addSel, k, [], (codes) => { if (codes.length) filters[k] = codes; addSel.value = ''; onChange(); }, scopeFn ? scopeFn(k) : {});
    };
  }

  // =====================================================
  // 總覽
  // =====================================================
  function fillRefSelect(sel) {
    const E = S.E; const ref = refYm();
    sel.innerHTML = E.ymList.slice().reverse().map((y) => `<option value="${y}" ${y === ref ? 'selected' : ''}>${ymLabel(y)}</option>`).join('');
    sel.onchange = () => { S.ref = +sel.value; store.set('ref', S.ref); renderView(); };
  }
  function renderOverview() {
    const E = S.E; const ref = refYm();
    $('#ovPeriod').textContent = `資料期間 ${ymLabel(E.minYm)} – ${ymLabel(E.maxYm)}，共 ${nf0.format(E.ds.nSales)} 筆進貨、${nf0.format(E.ds.nReturns)} 筆退貨`;
    fillRefSelect($('#ovRef'));
    const y = Math.floor(ref / 100), mo = ref % 100;
    const sumRange = (from, to) => { const p = E.pivot({ rows: [], cols: null, measures: ['sales', 'returns', 'profit', 'custs'], filter: { ymFrom: from, ymTo: to } }); return p.grand; };
    const cur = sumRange(ref, ref), prevY = sumRange((y - 1) * 100 + mo, (y - 1) * 100 + mo);
    const ytd = sumRange(y * 100 + 1, ref), ytdPrev = sumRange((y - 1) * 100 + 1, (y - 1) * 100 + mo);
    const chg = (a, b) => (b ? (a - b) / b : null);
    const delta = (a, b, label) => { const c = chg(a, b); if (c == null) return `<span class="d">${label}：無資料</span>`; return `<span class="d">${label} <span class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '▲' : '▼'} ${fmt.pct(Math.abs(c))}</span></span>`; };
    const C = E.customers({}, ref).list;
    // 基準月若是最新月份且筆數明顯少於前一個月，提醒資料可能還沒滿月
    const cntOf = (ym) => E.pivot({ rows: [], cols: null, measures: ['rows'], filter: { src: 'sales', ymFrom: ym, ymTo: ym } }).grand[0];
    const pm = mo === 1 ? (y - 1) * 100 + 12 : ref - 1;
    const partial = ref === E.maxYm && cntOf(ref) < cntOf(pm) * 0.6;
    const pNote = partial ? '（本月資料可能未滿月）' : '';
    const active = C.filter((c) => c.idle <= 2).length;
    const k = [
      { k: `${ymLabel(ref)} 銷貨${pNote}`, v: fmt.big(cur[0]), d: delta(cur[0], prevY[0], '比去年同月') },
      { k: `${y} 年累計銷貨`, v: fmt.big(ytd[0]), d: delta(ytd[0], ytdPrev[0], '比去年同期') },
      { k: `${y} 年毛利率`, v: fmt.pct(ytd[0] ? ytd[2] / ytd[0] : null), d: `<span class="d">毛利 ${fmt.big(ytd[2])}</span>` },
      { k: `${y} 年退貨率`, v: fmt.pct(ytd[0] ? ytd[1] / ytd[0] : null), d: `<span class="d">退貨 ${fmt.big(ytd[1])}</span>` },
      { k: '近 3 個月有交易的客戶', v: nf0.format(active), d: `<span class="d">共 ${nf0.format(C.length)} 位客戶</span>` },
    ];
    $('#ovKpis').innerHTML = k.map((x) => `<div class="kpi"><div class="k">${x.k}</div><div class="v">${x.v}</div>${x.d}</div>`).join('');
    drawOverviewChart();
    // 漸漸沒來的客戶
    const idle = C.filter((c) => c.idle >= 3 && c.idle <= 12).sort((a, b) => b.sales - a.sales).slice(0, 8);
    table($('#ovIdleCust'), [
      { key: 'name', label: '客戶', get: (r) => r.code + ' ' + r.name, cls: 'lbl' },
      { key: 'last', label: '最近交易', fmt: 'ym' },
      { key: 'idle', label: '靜止月數', n: 1, render: (r) => monthsCell(r.idle, 'idle', 12) },
      { key: 'sales', label: '歷史銷貨', n: 1, fmt: 'money' },
    ], idle, { onRow: (r) => openCustomer(r), empty: '目前沒有靜止 3～12 個月的客戶' });
    const P = E.products({}, ref, 'sku2').list.filter((p) => p.idle >= 6).sort((a, b) => b.sales - a.sales).slice(0, 8);
    table($('#ovIdleProd'), [
      { key: 'code', label: '商品(簡化代碼)', cls: 'lbl' },
      { key: 'cat', label: '類別' },
      { key: 'idle', label: '滯銷月數', n: 1, render: (r) => monthsCell(r.idle, 'idle', 24) },
      { key: 'sales', label: '歷史銷貨', n: 1, fmt: 'money' },
    ], P, { onRow: (r) => openProduct(r, 'sku2') });
    // 區域
    const pr = E.pivot({ rows: ['region'], cols: null, measures: ['sales', 'returns', 'net', 'margin', 'retRate', 'custs'], filter: { ymFrom: y * 100 + 1, ymTo: ref } });
    const prev = E.pivot({ rows: ['region'], cols: null, measures: ['net'], filter: { ymFrom: (y - 1) * 100 + 1, ymTo: (y - 1) * 100 + mo } });
    const prevMap = new Map(prev.rows.map((r) => [r.labels[0], r.vals[0][0]]));
    const rr = pr.rows.map((r) => ({ region: r.labels[0], v: r.vals[0], prev: prevMap.get(r.labels[0]) })).sort((a, b) => b.v[2] - a.v[2]);
    table($('#ovRegion'), [
      { key: 'region', label: '區域' },
      { key: 's', label: '銷貨', n: 1, get: (r) => r.v[0], fmt: 'money' },
      { key: 'r', label: '退貨', n: 1, get: (r) => r.v[1], fmt: 'money' },
      { key: 'net', label: '淨銷售', n: 1, get: (r) => r.v[2], fmt: 'money' },
      { key: 'yoy', label: '比去年同期', n: 1, render: (r) => { const c = chg(r.v[2], r.prev); return c == null ? '—' : `<span class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '▲' : '▼'} ${fmt.pct(Math.abs(c))}</span>`; } },
      { key: 'm', label: '毛利率', n: 1, get: (r) => r.v[3], fmt: 'pct' },
      { key: 'rr', label: '退貨率', n: 1, get: (r) => r.v[4], fmt: 'pct' },
      { key: 'c', label: '客戶數', n: 1, get: (r) => r.v[5], fmt: 'int' },
    ], rr, {
      onRow: (r) => { S.pivot = { ...S.pivot, mode: 'agg', src: 'all', rows: ['cat'], col: 'year', measures: ['sales', 'returns', 'net', 'margin'], filters: { region: [S.E.dim('region').labels.indexOf(r.region)] } }; store.set('pivot', S.pivot); go('pivot'); },
    });
  }
  function drawOverviewChart() {
    const E = S.E; if (!E) return;
    const range = $('#ovRange .on').dataset.v;
    let t = E.trend({});
    if (range !== 'all') t = t.slice(-24);
    Charts.render($('#ovChart'), {
      labels: t.map((r) => r.label), title: '每月銷貨與退貨',
      series: [{ name: '銷貨', values: t.map((r) => r.sales), cls: 's1' }, { name: '退貨', values: t.map((r) => r.returns), cls: 's2' }],
      fmt: fmt.money, axisFmt: fmt.axis,
    });
  }

  // =====================================================
  // 樞紐分析
  // =====================================================
  const PRESETS = [
    { name: '區域 × 年', rows: ['region'], col: 'year', measures: ['sales', 'returns', 'net', 'margin'] },
    { name: '業務員 × 年', rows: ['rep'], col: 'year', measures: ['net', 'custs'] },
    { name: '類別 × 年 退貨率', rows: ['cat'], col: 'year', measures: ['sales', 'retRate'] },
    { name: '客戶排行', rows: ['ck'], col: null, measures: ['sales', 'returns', 'net', 'margin', 'orders'] },
    { name: '每月趨勢', rows: ['ym'], col: null, measures: ['sales', 'returns', 'net', 'profit', 'margin', 'custs'] },
    { name: '客戶 × 類別', rows: ['ck', 'cat'], col: null, measures: ['sales', 'soldQty', 'returns'] },
    { name: '商品排行', rows: ['sku2'], col: null, measures: ['soldQty', 'retQty', 'sales', 'retRate', 'custs'] },
    { name: '月份 × 年（季節性）', rows: ['month'], col: 'year', measures: ['net'] },
  ];
  const PIVOT_DIMS = DIMS.map((d) => d.key);

  function pivotFilter() {
    const p = S.pivot;
    return { src: p.src, ymFrom: p.from || 0, ymTo: p.to || 0, dims: toDims(p.filters) };
  }
  function savePivot() { store.set('pivot', S.pivot); }

  function renderPivotConfig() {
    const p = S.pivot, E = S.E;
    $('#pvPresets').innerHTML = PRESETS.map((x, i) => `<button data-i="${i}">${esc(x.name)}</button>`).join('');
    $$('#pvSrc button').forEach((b) => b.classList.toggle('on', b.dataset.v === p.src));
    $$('#pvMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === p.mode));
    $('.pivot-layout').classList.toggle('detail', p.mode === 'detail');
    const opt = (sel, val, first) => first + E.ymList.map((y) => `<option value="${y}" ${y === val ? 'selected' : ''}>${ymLabel(y)}</option>`).join('');
    $('#pvFrom').innerHTML = opt($('#pvFrom'), p.from, '<option value="0">最早</option>');
    $('#pvTo').innerHTML = opt($('#pvTo'), p.to, '<option value="0">最新</option>');
    // 列
    $('#pvRows').innerHTML = p.rows.map((k, i) => `<span class="chip" data-i="${i}"><span>${esc(dimLabel(k))}</span>${i > 0 ? '<button class="mv" data-mv="up" title="往前移">↑</button>' : ''}<button class="x" aria-label="移除">✕</button></span>`).join('') || '<span class="hint">未分組時顯示總計</span>';
    $('#pvAddRow').innerHTML = '<option value="">＋ 加入分組</option>' + PIVOT_DIMS.filter((k) => !p.rows.includes(k) && k !== p.col).map((k) => `<option value="${k}">${esc(dimLabel(k))}</option>`).join('');
    $('#pvCol').innerHTML = '<option value="">不展開</option>' + PIVOT_DIMS.filter((k) => !p.rows.includes(k) && !['ord', 'sku', 'ck', 'cust', 'cname'].includes(k)).map((k) => `<option value="${k}" ${p.col === k ? 'selected' : ''}>${esc(dimLabel(k))}</option>`).join('');
    $('#pvMeasures').innerHTML = MEASURES.map((m) => `<label><input type="checkbox" value="${m.key}" ${p.measures.includes(m.key) ? 'checked' : ''}>${esc(m.label)}</label>`).join('');
    const fAdd = $('#pvAddFilter'); fAdd.dataset.ph = '＋ 加入篩選';
    renderFilterChips($('#pvFilters'), fAdd, p.filters, PIVOT_DIMS.filter((k) => k !== 'ym'), () => { savePivot(); renderPivot(); },
      (k) => { const f = pivotFilter(); const d = { ...f.dims }; delete d[k]; return { ...f, dims: d }; });
  }

  function bindPivot() {
    $('#pvPresets').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const x = PRESETS[+b.dataset.i];
      Object.assign(S.pivot, { rows: x.rows.slice(), col: x.col, measures: x.measures.slice(), mode: 'agg' });
      S.pvSort = null; savePivot(); renderPivot();
    });
    $('#pvSrc').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.pivot.src = b.dataset.v; savePivot(); renderPivot(); });
    $('#pvMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.pivot.mode = b.dataset.v; savePivot(); renderPivot(); });
    $('#pvFrom').addEventListener('change', (e) => { S.pivot.from = +e.target.value; savePivot(); renderPivot(); });
    $('#pvTo').addEventListener('change', (e) => { S.pivot.to = +e.target.value; savePivot(); renderPivot(); });
    $('#pvAddRow').addEventListener('change', (e) => { if (!e.target.value) return; S.pivot.rows.push(e.target.value); S.pvSort = null; savePivot(); renderPivot(); });
    $('#pvCol').addEventListener('change', (e) => { S.pivot.col = e.target.value || null; S.pvSort = null; savePivot(); renderPivot(); });
    $('#pvRows').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip'); if (!chip) return; const i = +chip.dataset.i;
      if (e.target.closest('.x')) S.pivot.rows.splice(i, 1);
      else if (e.target.closest('[data-mv]')) { const r = S.pivot.rows; [r[i - 1], r[i]] = [r[i], r[i - 1]]; } else return;
      S.pvSort = null; savePivot(); renderPivot();
    });
    $('#pvMeasures').addEventListener('change', () => {
      S.pivot.measures = $$('#pvMeasures input:checked').map((i) => i.value);
      if (!S.pivot.measures.length) S.pivot.measures = ['net'];
      savePivot(); renderPivot();
    });
    let st; $('#pvSearch').addEventListener('input', () => { clearTimeout(st); st = setTimeout(renderPivotResult, 200); });
    $('#pvExport').addEventListener('click', exportPivot);
  }

  let lastPivot = null, lastPivotRows = null;
  function renderPivot() { renderPivotConfig(); renderPivotResult(); }

  function renderPivotResult() {
    const p = S.pivot, E = S.E;
    const box = $('#pvTable');
    if (p.mode === 'detail') return renderDetail();
    let res;
    try { res = E.pivot({ rows: p.rows, cols: p.col, measures: p.measures, filter: pivotFilter() }); } catch (err) {
      if (err.message !== 'TOO_BIG') throw err;
      lastPivot = null;
      $('#pvMeta').textContent = '';
      box.innerHTML = `<div class="empty"><strong>組合太大，無法一次顯示</strong><br>這個組合會產生約 ${nf0.format(err.groups)} 列 × ${nf0.format(err.cols)} 欄。<br>請減少一層分組、把「欄（橫向展開）」改成項目較少的欄位（例如年份、區域），或先加入篩選縮小範圍。</div>`;
      return;
    }
    lastPivot = res;
    const q = $('#pvSearch').value.trim().toLowerCase();
    let rows = res.rows;
    if (q) rows = rows.filter((r) => r.labels.some((l) => String(l).toLowerCase().includes(q)));
    let usedCols = res.usedCols || [0];
    // 橫向欄位太多時，畫面只顯示金額最大的 40 欄（合計與匯出仍包含全部）
    const MAXC = 40; let colNote = '';
    if (usedCols.length > MAXC) {
      const top = new Set(usedCols.slice().sort((a, b) => Math.abs(res.colTotals[b][0] || 0) - Math.abs(res.colTotals[a][0] || 0)).slice(0, MAXC));
      colNote = ` · 橫向共 ${nf0.format(usedCols.length)} 欄，畫面只顯示「${MEASURES.find((x) => x.key === res.measures[0]).label}」最高的 ${MAXC} 欄，合計與匯出 CSV 包含全部`;
      usedCols = usedCols.filter((c) => top.has(c));
    }
    const ms = res.measures;
    const multiCol = !!res.colDim;
    // 排序
    if (S.pvSort) {
      const { key, dir } = S.pvSort;
      let g;
      if (key.startsWith('d:')) { const d = +key.slice(2); g = (r) => r.labels[d]; } else {
        const [c, m] = key.split(':').map(Number); g = c === -1 ? (r) => r.rowTotal[m] : (r) => (multiCol ? r.vals[c][m] : r.vals[0][m]);
      }
      rows = sortRows(rows, { key, dir }, g);
    }
    lastPivotRows = rows;
    $('#pvMeta').textContent = `${nf0.format(rows.length)} 組 · 從 ${nf0.format(res.matched)} 筆資料計算 · ${Math.round(res.ms)} 毫秒` + colNote;
    const sortCls = (key) => (S.pvSort && S.pvSort.key === key ? 'sorted' + (S.pvSort.dir > 0 ? ' asc' : '') : '');
    const label = (d, v) => (res.rowDims[d] === 'rep' ? repName(v) : v === '' ? '（空白）' : v);
    // 表頭
    let head;
    const dimTh = res.rowDims.map((k, d) => `<th ${multiCol ? 'rowspan="2"' : ''} data-k="d:${d}" class="${sortCls('d:' + d)}">${esc(dimLabel(k))}</th>`).join('') || `<th ${multiCol ? 'rowspan="2"' : ''}>總計</th>`;
    if (multiCol) {
      const colName = (c) => (res.colDim === 'rep' ? repName(res.colLabels[c]) : res.colLabels[c] || '（空白）');
      head = `<tr>${dimTh}${usedCols.map((c) => `<th class="grp" colspan="${ms.length}">${esc(colName(c))}</th>`).join('')}<th class="grp" colspan="${ms.length}">合計</th></tr>` +
        `<tr>${[...usedCols, -1].map((c) => ms.map((m, mi) => `<th class="n ${mi === 0 ? 'sep' : ''} ${sortCls(c + ':' + mi)}" data-k="${c}:${mi}">${esc(MEASURES.find((x) => x.key === m).label)}</th>`).join('')).join('')}</tr>`;
    } else {
      head = `<tr>${dimTh}${ms.map((m, mi) => `<th class="n ${sortCls('0:' + mi)}" data-k="0:${mi}">${esc(MEASURES.find((x) => x.key === m).label)}</th>`).join('')}</tr>`;
    }
    const cols = res.rowDims.map((k, d) => ({ key: 'd' + d, label: '', cls: d ? 'lbl dim2' : 'lbl', render: (r) => esc(label(d, r.labels[d])) }));
    if (!res.rowDims.length) cols.push({ key: 't', label: '', render: () => '全部' });
    const fms = ms.map((m) => fmtOf(m));
    if (multiCol) {
      for (const c of usedCols) ms.forEach((m, mi) => cols.push({ key: c + ':' + mi, n: 1, cls: mi === 0 ? 'sep' : '', render: (r) => fmt[fms[mi]](r.vals[c][mi]) }));
      ms.forEach((m, mi) => cols.push({ key: '-1:' + mi, n: 1, cls: mi === 0 ? 'sep' : '', render: (r) => `<strong>${fmt[fms[mi]](r.rowTotal[mi])}</strong>` }));
    } else ms.forEach((m, mi) => cols.push({ key: '0:' + mi, n: 1, render: (r) => fmt[fms[mi]](r.vals[0][mi]) }));
    // 總計列
    const nd = Math.max(1, res.rowDims.length);
    let foot = `<tr><td colspan="${nd}">總計</td>`;
    if (multiCol) { for (const c of usedCols) ms.forEach((m, mi) => { foot += `<td class="n ${mi === 0 ? 'sep' : ''}">${fmt[fms[mi]](res.colTotals[c][mi])}</td>`; }); ms.forEach((m, mi) => { foot += `<td class="n ${mi === 0 ? 'sep' : ''}">${fmt[fms[mi]](res.grand[mi])}</td>`; }); } else ms.forEach((m, mi) => { foot += `<td class="n">${fmt[fms[mi]](res.grand[mi])}</td>`; });
    foot += '</tr>';
    if (!res.rowDims.length) { rows = [{ labels: [], codes: [], vals: res.colTotals, rowTotal: res.grand }]; foot = ''; }
    table(box, cols, rows, {
      headHtml: head, foot, limit: Math.max(30, Math.min(300, Math.floor(12000 / Math.max(1, cols.length)))),
      empty: '沒有符合條件的資料，試著放寬篩選或期間。',
      onSort: (k) => { S.pvSort = toggleSort(S.pvSort, k); renderPivotResult(); },
      onRow: res.rowDims.length ? (r) => drillPivot(res, r) : null,
    });
  }
  // 點一列 → 若是客戶或商品就開明細
  function drillPivot(res, r) {
    const d0 = res.rowDims.indexOf('ck');
    if (d0 >= 0) { const c = S.E.customers({ dims: { ck: new Set([r.codes[d0]]) } }, refYm()).list[0]; if (c) return openCustomer(c); }
    for (const lv of ['sku', 'sku2']) {
      const di = res.rowDims.indexOf(lv);
      if (di >= 0) { const pp = S.E.products({ dims: { [lv]: new Set([r.codes[di]]) } }, refYm(), lv).list[0]; if (pp) return openProduct(pp, lv); }
    }
    // 其他：把這一列設為篩選，看明細
    res.rowDims.forEach((k, d) => { if (k !== 'ym' && k !== 'year' && k !== 'month') S.pivot.filters[k] = [r.codes[d]]; });
    if (res.rowDims.includes('ym')) { const y = S.E.ymList[r.codes[res.rowDims.indexOf('ym')]]; S.pivot.from = y; S.pivot.to = y; }
    S.pivot.mode = 'detail'; savePivot(); renderPivot();
    toast('已切換到明細，並套用這一列當篩選');
  }

  const DETAIL_COLS = [
    { key: 'src', label: '來源' }, { key: 'ord', label: '單號' }, { key: 'ym', label: '年月', fmt: 'ym' },
    { key: 'cust', label: '客戶代號' }, { key: 'cname', label: '客戶名' }, { key: 'region', label: '區域' }, { key: 'rep', label: '業務員' },
    { key: 'cat', label: '類別' }, { key: 'sku', label: '商品代號' }, { key: 'color', label: '顏色' },
    { key: 'qty', label: '數量', n: 1, fmt: 'int' }, { key: 'unit', label: '單位' }, { key: 'sold', label: '賣出數', n: 1, fmt: 'int' },
    { key: 'cost', label: '單價', n: 1, fmt: 'money2' }, { key: 'price', label: '售價', n: 1, fmt: 'money2' },
    { key: 'amt', label: '金額', n: 1, fmt: 'money' }, { key: 'profit', label: '毛利', n: 1, fmt: 'money' },
  ];
  function detailRow(i) {
    const ds = S.E.ds; const o = { _i: i };
    for (const c of DETAIL_COLS) {
      const k = c.key;
      if (k === 'src') o.src = ds.src[i] ? '退貨' : '進貨';
      else if (ds.str[k]) o[k] = ds.str[k].dict[ds.str[k].codes[i]];
      else o[k] = ds.num[k][i];
    }
    return o;
  }
  let detailIdx = null;
  function renderDetail() {
    const box = $('#pvTable');
    const t0 = performance.now();
    let idx = S.E.select(pivotFilter());
    const q = $('#pvSearch').value.trim().toLowerCase();
    if (q) {
      const ds = S.E.ds; const keys = ['ord', 'cust', 'cname', 'sku', 'cat'];
      const hit = {}; for (const k of keys) hit[k] = ds.str[k].dict.map((s) => s.toLowerCase().includes(q));
      idx = idx.filter((i) => keys.some((k) => hit[k][ds.str[k].codes[i]]));
    }
    detailIdx = idx;
    const n = idx.length; const LIM = 500;
    const rows = []; for (let j = 0; j < Math.min(n, 5000); j++) rows.push(detailRow(idx[j]));
    $('#pvMeta').textContent = `${nf0.format(n)} 筆明細 · ${Math.round(performance.now() - t0)} 毫秒` + (n > 5000 ? '（畫面最多列出 5,000 筆，匯出可取得全部）' : '');
    table(box, DETAIL_COLS, rows, { limit: LIM, empty: '沒有符合條件的明細' });
  }

  function exportPivot() {
    const p = S.pivot;
    if (p.mode === 'detail') {
      const idx = detailIdx || S.E.select(pivotFilter());
      const rows = []; for (let j = 0; j < idx.length; j++) { const r = detailRow(idx[j]); rows.push(DETAIL_COLS.map((c) => (c.key === 'ym' ? ymLabel(r.ym) : r[c.key]))); }
      return downloadCsv('明細', DETAIL_COLS.map((c) => c.label), rows);
    }
    const res = lastPivot; if (!res) return;
    const ms = res.measures.map((m) => MEASURES.find((x) => x.key === m).label);
    const header = res.rowDims.map(dimLabel);
    const cols = res.usedCols || [0];
    if (res.colDim) { for (const c of cols) ms.forEach((m) => header.push(res.colLabels[c] + ' ' + m)); ms.forEach((m) => header.push('合計 ' + m)); } else header.push(...ms);
    const rows = (lastPivotRows || res.rows).map((r) => {
      const a = r.labels.slice();
      if (res.colDim) { for (const c of cols) a.push(...r.vals[c]); a.push(...r.rowTotal); } else a.push(...r.vals[0]);
      return a;
    });
    downloadCsv('樞紐分析', header, rows);
  }

  // =====================================================
  // 客戶
  // =====================================================
  const CUST_FILTER_DIMS = ['region', 'rep', 'cat', 'sku2', 'year'];
  function idleMatch(v, rule) {
    if (rule === 'all') return true;
    const [a, b] = rule.split('-'); return v >= +a && (b === '' || v <= +b);
  }
  function custData() {
    const f = { dims: toDims(S.cust.filters) };
    const res = S.E.customers(f, refYm());
    const q = S.cust.q.toLowerCase();
    let list = res.list.filter((c) => idleMatch(c.idle, S.cust.idle) && (!q || c.key.toLowerCase().includes(q)));
    list = sortRows(list, S.cust.sort);
    return { list, res };
  }
  const CUST_COLS = [
    { key: 'code', label: '客戶代號' }, { key: 'name', label: '客戶名', cls: 'lbl' }, { key: 'region', label: '區域' },
    { key: 'rep', label: '業務員', render: (r) => esc(repName(r.rep)) },
    { key: 'first', label: '第一筆交易', fmt: 'ym' }, { key: 'last', label: '最近交易', fmt: 'ym' },
    { key: 'tenure', label: '交易至今(月)', n: 1, fmt: 'int' },
    { key: 'idle', label: '靜止(月)', n: 1, render: (r) => monthsCell(r.idle, 'idle', 24) },
    { key: 'freq', label: '購買頻率(天)', n: 1, render: (r) => nf1.format(r.freq) },
    { key: 'orders', label: '訂單數', n: 1, fmt: 'int' },
    { key: 'sales', label: '銷貨金額', n: 1, fmt: 'money' }, { key: 'returns', label: '退貨金額', n: 1, fmt: 'money' },
    { key: 'margin', label: '毛利率', n: 1, fmt: 'pct' },
  ];
  function renderCustomers() {
    const { list, res } = custData();
    $('#cuSub').textContent = `以 ${ymLabel(res.ref)} 為基準月計算（可在總覽或設定中更改）。購買頻率 = 第一筆到最近一筆的月數 ÷ 訂單數 × 30。`;
    $$('#cuIdle button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.cust.idle));
    renderFilterChips($('#cuFilters'), $('#cuAddFilter'), S.cust.filters, CUST_FILTER_DIMS, renderCustomers, (k) => { const d = toDims(S.cust.filters); delete d[k]; return { src: 'sales', dims: d }; });
    table($('#cuTable'), CUST_COLS, list, {
      sort: S.cust.sort, onSort: (k) => { S.cust.sort = toggleSort(S.cust.sort, k); renderCustomers(); },
      onRow: openCustomer, limit: 300, empty: '沒有符合條件的客戶',
    });
  }
  function bindCustomers() {
    let t; $('#cuSearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.cust.q = e.target.value.trim(); renderCustomers(); }, 150); });
    $('#cuIdle').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.cust.idle = b.dataset.v; renderCustomers(); });
    $('#cuExport').addEventListener('click', () => {
      const { list } = custData();
      downloadCsv('客戶交易', CUST_COLS.map((c) => c.label), list.map((r) => CUST_COLS.map((c) => {
        const v = r[c.key]; if (c.fmt === 'ym') return ymLabel(v); if (c.key === 'freq') return Math.round(v * 100) / 100; if (c.key === 'margin') return v == null ? '' : Math.round(v * 10000) / 100 + '%'; if (c.key === 'rep') return repName(v); return v;
      })));
    });
  }

  // =====================================================
  // 商品
  // =====================================================
  const PROD_FILTER_DIMS = ['cat', 'region', 'rep', 'ck', 'color', 'year'];
  function prodData() {
    const res = S.E.products({ dims: toDims(S.prod.filters) }, refYm(), S.prod.level);
    const q = S.prod.q.toLowerCase();
    let list = res.list.filter((p) => idleMatch(p.idle, S.prod.idle) && (!q || p.code.toLowerCase().includes(q) || (p.sku2 || '').toLowerCase().includes(q)));
    list = sortRows(list, S.prod.sort, S.prod.sort.key === 'retRate' ? (r) => (r.sales ? r.returns / r.sales : null) : null);
    return { list, res };
  }
  function prodCols() {
    const c = [{ key: 'code', label: S.prod.level === 'sku' ? '商品代號' : '簡化代碼', cls: 'lbl' }];
    if (S.prod.level === 'sku') c.push({ key: 'sku2', label: '簡化代碼', cls: 'dim2' });
    c.push(
      { key: 'cat', label: '類別' },
      { key: 'first', label: '第一筆售出', fmt: 'ym' }, { key: 'last', label: '最近售出', fmt: 'ym' },
      { key: 'tenure', label: '已賣(月)', n: 1, fmt: 'int' },
      { key: 'idle', label: '滯銷/停售(月)', n: 1, render: (r) => monthsCell(r.idle, 'idle', 24) },
      { key: 'qty', label: '賣出數', n: 1, fmt: 'int' }, { key: 'recentQty', label: '近 12 月賣出', n: 1, fmt: 'int' },
      { key: 'sales', label: '銷貨金額', n: 1, fmt: 'money' }, { key: 'returns', label: '退貨金額', n: 1, fmt: 'money' },
      { key: 'retRate', label: '退貨率', n: 1, render: (r) => fmt.pct(r.sales ? r.returns / r.sales : null) },
      { key: 'custs', label: '客戶數', n: 1, fmt: 'int' },
    );
    return c;
  }
  function renderProducts() {
    const { list, res } = prodData();
    $('#prSub').textContent = `以 ${ymLabel(res.ref)} 為基準月。滯銷月數 = 基準月 − 最近一次售出的年月。`;
    $$('#prIdle button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.prod.idle));
    $$('#prLevel button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.prod.level));
    renderFilterChips($('#prFilters'), $('#prAddFilter'), S.prod.filters, PROD_FILTER_DIMS, renderProducts, (k) => { const d = toDims(S.prod.filters); delete d[k]; return { src: 'sales', dims: d }; });
    table($('#prTable'), prodCols(), list, {
      sort: S.prod.sort, onSort: (k) => { S.prod.sort = toggleSort(S.prod.sort, k); renderProducts(); },
      onRow: (r) => openProduct(r, S.prod.level), limit: 300, empty: '沒有符合條件的商品',
    });
  }
  function bindProducts() {
    let t; $('#prSearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.prod.q = e.target.value.trim(); renderProducts(); }, 150); });
    $('#prIdle').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.prod.idle = b.dataset.v; renderProducts(); });
    $('#prLevel').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.prod.level = b.dataset.v; renderProducts(); });
    $('#prExport').addEventListener('click', () => {
      const { list } = prodData(); const cols = prodCols();
      downloadCsv('商品銷售', cols.map((c) => c.label), list.map((r) => cols.map((c) => {
        if (c.fmt === 'ym') return ymLabel(r[c.key]); if (c.key === 'retRate') return r.sales ? Math.round(r.returns / r.sales * 10000) / 100 + '%' : ''; return r[c.key];
      })));
    });
  }

  // =====================================================
  // 明細抽屜
  // =====================================================
  function openDrawer(title, sub, html) {
    $('#drawerTitle').textContent = title; $('#drawerSub').textContent = sub;
    $('#drawerContent').innerHTML = html;
    const d = $('#drawer'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
    $('.drawer-body').scrollTop = 0;
  }
  function closeDrawer() { const d = $('#drawer'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
  $('#drawer').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });

  function monthlySeries(dims, n = 24) {
    const E = S.E; const ref = refYm();
    const p = E.pivot({ rows: ['ym'], cols: null, measures: ['sales', 'returns', 'soldQty'], filter: { dims } });
    const map = new Map(p.rows.map((r) => [E.ymList[r.codes[0]], r.vals[0]]));
    const labels = [], s = [], r = [], q = [];
    let y = Math.floor(ref / 100), m = ref % 100;
    const arr = [];
    for (let i = 0; i < n; i++) { arr.unshift(y * 100 + m); m--; if (m === 0) { m = 12; y--; } }
    for (const ym of arr) { const v = map.get(ym); labels.push(ymLabel(ym)); s.push(v ? v[0] : 0); r.push(v ? v[1] : 0); q.push(v ? v[2] : 0); }
    return { labels, s, r, q };
  }
  function kpiHtml(items) { return `<div class="kpis">${items.map((x) => `<div class="kpi"><div class="k">${x.k}</div><div class="v">${x.v}</div>${x.d ? `<span class="d">${x.d}</span>` : ''}</div>`).join('')}</div>`; }

  function openCustomer(c) {
    const dims = { ck: new Set([c.ck]) };
    const html = kpiHtml([
      { k: '最近交易', v: ymLabel(c.last), d: `靜止 ${c.idle} 個月` },
      { k: '第一筆交易', v: ymLabel(c.first), d: `交易至今 ${c.tenure} 個月` },
      { k: '購買頻率', v: nf1.format(c.freq) + ' 天', d: `${c.orders} 張訂單、${c.activeMonths} 個月有交易` },
      { k: '銷貨金額', v: fmt.big(c.sales), d: `毛利率 ${fmt.pct(c.margin)}` },
      { k: '退貨金額', v: fmt.big(c.returns), d: `退貨率 ${fmt.pct(c.sales ? c.returns / c.sales : null)}` },
      { k: '淨銷售', v: fmt.big(c.net), d: `${c.region}・${repName(c.rep)}` },
    ]) + `<div class="panel"><div class="panel-head"><h2>近 24 個月</h2></div><div class="chart" id="dwChart"></div></div>
      <div class="panel"><div class="panel-head"><h2>買最多的商品</h2><button class="btn" id="dwPivot">在樞紐分析中查看</button></div><div id="dwTop"></div></div>`;
    openDrawer(c.name || c.code, `${c.code}・${c.region}`, html);
    const ms = monthlySeries(dims);
    Charts.render($('#dwChart'), { type: 'bar', labels: ms.labels, series: [{ name: '銷貨', values: ms.s, cls: 's1' }, { name: '退貨', values: ms.r, cls: 's2' }], fmt: fmt.money, axisFmt: fmt.axis });
    const p = S.E.pivot({ rows: ['sku2'], cols: null, measures: ['soldQty', 'sales', 'returns'], filter: { dims } });
    const prodIdx = new Map(S.E.products({ dims }, refYm(), 'sku2').list.map((x) => [x.code, x]));
    const rows = p.rows.map((r) => ({ code: r.labels[0], qty: r.vals[0][0], sales: r.vals[0][1], ret: r.vals[0][2], last: (prodIdx.get(r.labels[0]) || {}).last })).sort((a, b) => b.sales - a.sales);
    table($('#dwTop'), [
      { key: 'code', label: '商品(簡化代碼)' }, { key: 'last', label: '最近購買', fmt: 'ym' },
      { key: 'qty', label: '賣出數', n: 1, fmt: 'int' }, { key: 'sales', label: '銷貨金額', n: 1, fmt: 'money' }, { key: 'ret', label: '退貨金額', n: 1, fmt: 'money' },
    ], rows, { limit: 20 });
    $('#dwPivot').onclick = () => { closeDrawer(); S.pivot = { ...S.pivot, mode: 'agg', rows: ['sku2'], col: 'year', measures: ['soldQty', 'net'], filters: { ck: [c.ck] } }; savePivot(); go('pivot'); };
  }

  function openProduct(pr, level) {
    const code = S.E.ds.str[level].dict.indexOf(pr.code);
    const dims = { [level]: new Set([code]) };
    const html = kpiHtml([
      { k: '最近售出', v: ymLabel(pr.last), d: `滯銷 ${pr.idle} 個月` },
      { k: '第一筆售出', v: ymLabel(pr.first), d: `已賣 ${pr.tenure} 個月` },
      { k: '賣出數', v: nf0.format(pr.qty), d: `近 12 個月 ${nf0.format(pr.recentQty)}` },
      { k: '銷貨金額', v: fmt.big(pr.sales), d: `毛利率 ${fmt.pct(pr.margin)}` },
      { k: '退貨金額', v: fmt.big(pr.returns), d: `退貨數 ${nf0.format(pr.retQty)}` },
      { k: '購買客戶', v: nf0.format(pr.custs), d: `類別 ${pr.cat}` },
    ]) + `<div class="panel"><div class="panel-head"><h2>近 24 個月賣出數</h2></div><div class="chart" id="dwChart"></div></div>
      <div class="panel"><div class="panel-head"><h2>誰在買</h2><button class="btn" id="dwPivot">在樞紐分析中查看</button></div><div id="dwTop"></div></div>`;
    openDrawer(pr.code, (level === 'sku' ? '商品代號' : '簡化代碼') + `・類別 ${pr.cat}`, html);
    const ms = monthlySeries(dims);
    Charts.render($('#dwChart'), { type: 'bar', labels: ms.labels, series: [{ name: '賣出數', values: ms.q, cls: 's1' }], fmt: fmt.int, axisFmt: fmt.axis });
    const cl = S.E.customers({ dims }, refYm()).list.sort((a, b) => b.sales - a.sales);
    table($('#dwTop'), [
      { key: 'name', label: '客戶', get: (r) => r.code + ' ' + r.name }, { key: 'last', label: '最近購買', fmt: 'ym' },
      { key: 'qty', label: '賣出數', n: 1, fmt: 'int' }, { key: 'sales', label: '銷貨金額', n: 1, fmt: 'money' },
    ], cl, { limit: 20, onRow: (c) => { const full = S.E.customers({ dims: { ck: new Set([c.ck]) } }, refYm()).list[0]; openCustomer(full); } });
    $('#dwPivot').onclick = () => { closeDrawer(); S.pivot = { ...S.pivot, mode: 'agg', rows: ['ck'], col: 'year', measures: ['soldQty', 'net'], filters: { [level]: [code] } }; savePivot(); go('pivot'); };
  }

  // =====================================================
  // 資料與設定
  // =====================================================
  let worker = null;
  function getWorker() { if (!worker) worker = new Worker('js/worker.js'); return worker; }
  function runWorker(msg, transfer, onProgress) {
    return new Promise((resolve, reject) => {
      const w = getWorker();
      w.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'progress') onProgress && onProgress(d);
        else if (d.type === 'error') { const er = new Error(d.message); er.code = d.code; reject(er); }
        else resolve(d);
      };
      w.onerror = (e) => reject(new Error(e.message || '背景處理失敗'));
      w.postMessage(msg, transfer || []);
    });
  }
  function showProgress(pct, text) {
    const p = $('#importProgress'); p.hidden = false;
    $('i', p).style.width = Math.round(pct * 100) + '%'; $('p', p).textContent = text;
  }

  // ---------- 密碼對話框 ----------
  // fields: [{ name, label, placeholder, autocomplete }]；check: { name, label, checked, hides: [欄位名] }
  // validate(values) 回傳錯誤訊息（可為 async）；關閉時清空輸入框，密碼不留在畫面上。
  function ask({ title, desc, fields, check, submit = '確定', error = '', validate }) {
    return new Promise((resolve) => {
      const dlg = $('#dlg'), form = $('#dlgForm');
      form.innerHTML = `<h2>${esc(title)}</h2>${desc ? `<div class="desc">${desc}</div>` : ''}` +
        fields.map((f) => `<div data-f="${f.name}"><label class="field-label" for="dlg_${f.name}">${esc(f.label)}</label>` +
          `<input type="password" id="dlg_${f.name}" name="${f.name}" placeholder="${esc(f.placeholder || '')}" autocomplete="${f.autocomplete || 'off'}"></div>` +
          (check && check.after === f.name ? `<label class="check"><input type="checkbox" id="dlg_check" ${check.checked ? 'checked' : ''}>${esc(check.label)}</label>` : '')).join('') +
        `<p class="form-err" id="dlgErr" role="alert">${esc(error)}</p>` +
        `<div class="actions"><button type="button" class="btn" value="cancel" id="dlgCancel">取消</button><button class="btn primary" id="dlgOk">${esc(submit)}</button></div>`;
      const cb = $('#dlg_check', form);
      const sync = () => { if (cb) check.hides.forEach((n) => { $(`[data-f="${n}"]`, form).hidden = cb.checked; }); };
      if (cb) cb.addEventListener('change', sync);
      sync();
      let done = false;
      const finish = (v) => {
        if (done) return; done = true;
        $$('input[type="password"]', form).forEach((i) => { i.value = ''; });
        if (dlg.open) dlg.close();
        form.innerHTML = '';
        resolve(v);
      };
      $('#dlgCancel', form).onclick = () => finish(null);
      dlg.oncancel = (e) => { e.preventDefault(); finish(null); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = {};
        fields.forEach((f) => { v[f.name] = $(`#dlg_${f.name}`, form).value; });
        if (cb) v[check.name] = cb.checked;
        const ok = $('#dlgOk', form), old = ok.textContent;
        ok.disabled = true; ok.textContent = '處理中…';
        const msg = validate ? await validate(v) : '';
        ok.disabled = false; ok.textContent = old;
        if (msg) { $('#dlgErr', form).textContent = msg; return; }
        finish(v);
      };
      dlg.showModal();
      const first = fields.find((f) => !$(`[data-f="${f.name}"]`, form).hidden);
      if (first) $(`#dlg_${first.name}`, form).focus();
    });
  }
  const MIN_PW = 4;
  const newPwError = (a, b) => (a.length < MIN_PW ? `開啟密碼至少 ${MIN_PW} 個字` : a !== b ? '兩次輸入的密碼不一樣' : '');
  const VAULT_NOTE = '<p>資料會加密保存在這台裝置上，之後<strong>每次開啟軟體都要輸入開啟密碼</strong>。</p><p>密碼忘記時無法找回，只能清除資料後重新匯入。</p>';

  // 匯入時要的密碼：Excel 的開啟密碼（檔案有加密時）、軟體的開啟密碼（這台裝置還沒設定時）
  function askImportPasswords(fileName, needXls, needApp, error) {
    const fields = [];
    if (needXls) fields.push({ name: 'xls', label: 'Excel 開啟密碼', autocomplete: 'off' });
    if (needApp) fields.push({ name: 'app', label: '設定軟體開啟密碼', placeholder: `至少 ${MIN_PW} 個字`, autocomplete: 'new-password' }, { name: 'app2', label: '再輸入一次', autocomplete: 'new-password' });
    const desc = (needXls ? `<p>「${esc(fileName)}」有開啟密碼。密碼只用來在瀏覽器內解密，不會儲存或傳送，也不會產生沒加密的副本。</p>` : '') + (needApp ? VAULT_NOTE : '');
    return ask({
      title: needXls ? '輸入 Excel 密碼' : '設定開啟密碼', desc, fields, error, submit: '開始匯入',
      check: needXls && needApp ? { name: 'same', after: 'xls', label: '軟體開啟密碼也用這組', checked: true, hides: ['app', 'app2'] } : null,
      validate: (v) => {
        if (needXls && !v.xls) return '請輸入 Excel 密碼';
        if (needApp && !(needXls && v.same)) return newPwError(v.app, v.app2);
        return '';
      },
    }).then((v) => (v ? { xlsPw: needXls ? v.xls : null, appPw: needApp ? (needXls && v.same ? v.xls : v.app) : null, same: !!(needXls && needApp && v.same) } : null));
  }

  async function isCfbFile(file) {
    const h = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return h[0] === 0xd0 && h[1] === 0xcf && h[2] === 0x11 && h[3] === 0xe0;
  }

  async function importXlsx(file) {
    if (!file) return;
    if (/\.xls$/i.test(file.name)) { toast('舊版 .xls 格式無法讀取，請在 Excel「另存新檔」為 .xlsx 再匯入', 5000); return; }
    if (!/\.xls[xm]$/i.test(file.name)) { toast('請選擇 .xlsx 檔案'); return; }
    go('data');
    const encrypted = await isCfbFile(file);
    let xlsPw = null, appPw = null, same = false;
    if (encrypted || !S.vault) {
      const r = await askImportPasswords(file.name, encrypted, !S.vault, '');
      if (!r) { toast('已取消匯入'); return; }
      ({ xlsPw, appPw, same } = r);
    }
    for (;;) {
      const t0 = performance.now();
      showProgress(0, '準備讀取 ' + file.name);
      try {
        const d = await runWorker({ type: 'ingest', file, password: xlsPw }, [], (s) => showProgress(s.pct || 0, `${s.stage}… ${s.rows ? nf0.format(s.rows) + ' 筆' : ''}`));
        xlsPw = null;
        showProgress(1, '加密並儲存到這台裝置…');
        if (appPw) { S.vault = await Dataset.Vault.create(appPw); appPw = null; }
        await loadBuffer(d.buf, { name: file.name, save: true });
        showProgress(1, `完成：${nf0.format(S.E.ds.nSales)} 筆進貨、${nf0.format(S.E.ds.nReturns)} 筆退貨，花了 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
        toast('資料已更新，已加密保存在這台裝置');
        return;
      } catch (err) {
        worker && worker.terminate(); worker = null;
        if (err.code === 'BAD_PASSWORD' || err.code === 'NEED_PASSWORD') {
          showProgress(0, 'Excel 密碼不正確');
          const r = await askImportPasswords(file.name, true, false, err.code === 'BAD_PASSWORD' ? 'Excel 密碼不正確，請再試一次。' : '');
          if (!r) { xlsPw = appPw = null; showProgress(0, '已取消匯入'); return; }
          xlsPw = r.xlsPw;
          if (same) appPw = r.xlsPw; // 開啟密碼選擇「也用這組」時，跟著改成正確的 Excel 密碼
          continue;
        }
        xlsPw = appPw = null;
        showProgress(0, '讀取失敗：' + err.message);
        return;
      }
    }
  }

  async function loadBuffer(buf, { save } = {}) {
    if (save) {
      if (!S.vault) throw new Error('尚未設定開啟密碼');
      await Dataset.Vault.save(S.vault, buf); // 只存加密後的內容
    }
    const raw = Dataset.deserialize(buf);
    S.raw = buf;
    S.E = new Engine(Dataset.hydrate(raw));
    if (S.ref && !S.E.ymIndex.has(S.ref)) S.ref = null;
    // 檢查樞紐設定中的期間仍有效
    if (S.pivot.from && !S.E.ymIndex.has(S.pivot.from)) S.pivot.from = 0;
    if (S.pivot.to && !S.E.ymIndex.has(S.pivot.to)) S.pivot.to = 0;
    S.pivot.filters = {}; S.cust.filters = {}; S.prod.filters = {};
    $('#brandSub').textContent = `資料到 ${ymLabel(S.E.maxYm)}`;
    renderData();
  }

  function renderData() {
    $$('#themePick button').forEach((b) => b.classList.toggle('on', b.dataset.theme === document.documentElement.dataset.theme));
    $('#lockState').textContent = S.vault
      ? '已啟用：資料加密保存在這台裝置上，每次開啟軟體都要輸入開啟密碼。'
      : '尚未設定：匯入 Excel（電腦）或開啟資料包（手機，會沿用資料包的密碼）時會設定。';
    $('#changePw').hidden = $('#lockNow').hidden = !S.vault;
    const f = $('#dataFacts');
    if (!S.E) { f.innerHTML = '<div><dt>目前狀態</dt><dd>尚未載入資料</dd></div>'; return; }
    const ds = S.E.ds;
    const items = [
      ['資料來源', ds.sourceName || '資料包'], ['轉換時間', new Date(ds.createdAt).toLocaleString('zh-TW')],
      ['資料期間', `${ymLabel(S.E.minYm)} – ${ymLabel(S.E.maxYm)}`], ['進貨筆數', nf0.format(ds.nSales)], ['退貨筆數', nf0.format(ds.nReturns)],
      ['客戶數', nf0.format(ds.str.ck.dict.length)], ['商品代號數', nf0.format(ds.str.sku.dict.length)],
    ];
    f.innerHTML = items.map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('') +
      `<div><dt>基準月（計算靜止、滯銷月數）</dt><dd><select id="dataRef"></select></dd></div>`;
    fillRefSelect($('#dataRef'));
  }

  function bindData() {
    const drop = $('#drop'), fx = $('#fileXlsx');
    $('#pickXlsx').addEventListener('click', () => fx.click());
    fx.addEventListener('change', () => { importXlsx(fx.files[0]); fx.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => importXlsx(e.dataTransfer.files[0]));
    // 整個視窗也可拖放
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { if (S.locked) { e.preventDefault(); return; } if (!drop.contains(e.target)) { e.preventDefault(); const f2 = e.dataTransfer.files[0]; if (f2) (/\.dvp$/i.test(f2.name) ? openPackFile(f2) : importXlsx(f2)); } });
    $('#themePick').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTheme(b.dataset.theme); });
    $('#packExport').addEventListener('click', async () => {
      if (!S.raw) { toast('請先載入資料'); return; }
      const pw = $('#packPw').value;
      if (pw && pw.length < 6) { toast('密碼至少 6 碼'); return; }
      const btn = $('#packExport');
      if (!pw && !btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = '不設密碼，再按一次匯出'; toast('沒有密碼的話，拿到檔案的人都能看到資料'); setTimeout(() => { delete btn.dataset.sure; btn.textContent = '匯出資料包'; }, 6000); return; }
      delete btn.dataset.sure; btn.textContent = '匯出資料包';
      toast('正在壓縮…');
      const copy = S.raw.slice(0);
      const d = await runWorker({ type: 'pack', buf: copy, password: pw }, [copy]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([d.pack], { type: 'application/octet-stream' }));
      a.download = 'pack.dvp'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`已匯出資料包（${(d.pack.byteLength / 1e6).toFixed(1)} MB）`);
    });
    const fp = $('#filePack');
    $('#pickPack').addEventListener('click', () => fp.click());
    fp.addEventListener('change', () => { openPackFile(fp.files[0]); fp.value = ''; });
    $('#urlPack').addEventListener('click', () => openPackUrl('data/pack.dvp', $('#openPw').value));
    $('#clearData').addEventListener('click', async () => {
      const b = $('#clearData');
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '確定要清除？再按一次'; setTimeout(() => { delete b.dataset.sure; b.textContent = '清除這台裝置上的資料'; }, 5000); return; }
      delete b.dataset.sure; b.textContent = '清除這台裝置上的資料';
      await Dataset.Vault.clear(); S.E = null; S.raw = null; S.vault = null; $('#brandSub').textContent = '尚未載入資料'; renderData(); toast('已清除這台裝置上的資料');
    });
    $('#lockNow').addEventListener('click', () => location.reload()); // 金鑰只在記憶體中，重新載入就會上鎖
    $('#changePw').addEventListener('click', async () => {
      if (!S.vault || !S.raw) return;
      const v = await ask({
        title: '更改開啟密碼', submit: '更改',
        fields: [{ name: 'cur', label: '目前的開啟密碼', autocomplete: 'current-password' }, { name: 'pw', label: '新的開啟密碼', placeholder: `至少 ${MIN_PW} 個字`, autocomplete: 'new-password' }, { name: 'pw2', label: '再輸入一次', autocomplete: 'new-password' }],
        validate: async (x) => {
          const e = newPwError(x.pw, x.pw2); if (e) return e;
          try { await Dataset.Vault.open(x.cur); } catch (er) { return er.code === 'BAD_PASSWORD' ? '目前的開啟密碼不正確' : er.message; }
          return '';
        },
      });
      if (!v) return;
      S.vault = await Dataset.Vault.create(v.pw);
      await Dataset.Vault.save(S.vault, S.raw);
      toast('開啟密碼已更改');
    });
  }

  async function openPackBuffer(buf, pw) {
    if (Dataset.packNeedsPassword(buf) && !pw) { toast('這個資料包有密碼，請先輸入密碼'); $('#openPw').focus(); return false; }
    toast('正在開啟資料包…');
    const d = await runWorker({ type: 'unpack', buf, password: pw }, [buf]);
    // 開啟密碼沿用資料包的密碼；資料包沒有密碼時，請使用者設定一組
    let appPw = pw;
    if (!appPw) {
      const v = await ask({ title: '設定開啟密碼', desc: VAULT_NOTE, submit: '確定',
        fields: [{ name: 'pw', label: '設定軟體開啟密碼', placeholder: `至少 ${MIN_PW} 個字`, autocomplete: 'new-password' }, { name: 'pw2', label: '再輸入一次', autocomplete: 'new-password' }],
        validate: (x) => newPwError(x.pw, x.pw2) });
      if (!v) { toast('已取消'); return false; }
      appPw = v.pw;
    }
    S.vault = await Dataset.Vault.create(appPw); appPw = null;
    await loadBuffer(d.buf, { save: true });
    $('#openPw').value = '';
    toast(pw ? '資料包已載入。之後開啟軟體，請輸入資料包的密碼' : '資料包已載入', 5000); go('overview');
    return true;
  }
  async function openPackFile(file) {
    if (!file) return;
    try { await openPackBuffer(await file.arrayBuffer(), $('#openPw').value); } catch (e) { toast(e.message); }
  }
  async function openPackUrl(url, pw) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) throw new Error('網站上還沒有資料包（' + r.status + '）');
      return await openPackBuffer(await r.arrayBuffer(), pw);
    } catch (e) { toast(e.message); return false; }
  }

  // ---------- 開鎖畫面 ----------
  // mode = 'unlock'：輸入密碼解開；'setup'：舊版未加密的資料，先設定密碼再加密保存
  function lockScreen(mode, legacyBuf) {
    return new Promise((resolve) => {
      S.locked = true;
      const lock = $('#lock'), shell = $('.shell');
      const pw = $('#lockPw'), pw2 = $('#lockPw2'), err = $('#lockErr'), go1 = $('#lockGo');
      const setup = mode === 'setup';
      $('#lockSub').innerHTML = setup ? '為了保護資料，請設定開啟密碼。設定後資料會加密保存，<strong>每次開啟軟體都要輸入</strong>。' : '資料已上鎖，請輸入開啟密碼。';
      $('#lockPwLabel').textContent = setup ? '設定開啟密碼' : '開啟密碼';
      pw.autocomplete = setup ? 'new-password' : 'current-password';
      pw.placeholder = setup ? `至少 ${MIN_PW} 個字` : '';
      $('#lockPw2Wrap').hidden = !setup;
      go1.textContent = setup ? '設定並開啟' : '開啟';
      $('#lockForgot').textContent = setup ? '不想設定？' : '忘記密碼？';
      $('#lockForgotBox').hidden = true;
      shell.hidden = true; lock.hidden = false;
      pw.focus();
      const done = () => {
        pw.value = pw2.value = ''; err.textContent = '';
        lock.hidden = true; shell.hidden = false; S.locked = false;
        $('#lockForm').onsubmit = null;
        resolve();
      };
      $('#lockForm').onsubmit = async (e) => {
        e.preventDefault();
        err.textContent = '';
        if (setup) { const m = newPwError(pw.value, pw2.value); if (m) { err.textContent = m; return; } }
        else if (!pw.value) { err.textContent = '請輸入開啟密碼'; return; }
        go1.disabled = true; const label = go1.textContent; go1.textContent = setup ? '加密中…' : '解鎖中…';
        try {
          if (setup) {
            S.vault = await Dataset.Vault.create(pw.value);
            await loadBuffer(legacyBuf, { save: true });
          } else {
            const r = await Dataset.Vault.open(pw.value);
            S.vault = r.vault;
            await loadBuffer(r.buf);
          }
          done();
        } catch (er) {
          err.textContent = er.code === 'BAD_PASSWORD' ? '密碼不正確，請再試一次' : '無法開啟：' + er.message;
          pw.select();
        } finally { go1.disabled = false; go1.textContent = label; }
      };
      $('#lockForgot').onclick = () => { const b = $('#lockForgotBox'); b.hidden = !b.hidden; };
      const reset = $('#lockReset');
      reset.textContent = '清除資料，重新開始';
      reset.onclick = async () => {
        if (!reset.dataset.sure) { reset.dataset.sure = '1'; reset.textContent = '確定要清除？再按一次'; setTimeout(() => { delete reset.dataset.sure; reset.textContent = '清除資料，重新開始'; }, 5000); return; }
        delete reset.dataset.sure;
        await Dataset.Vault.clear();
        S.E = null; S.raw = null; S.vault = null;
        done();
        toast('已清除。電腦請重新匯入 Excel；手機請重新開啟資料包', 6000);
      };
    });
  }

  // ---------- 啟動 ----------
  async function boot() {
    setTheme(document.documentElement.dataset.theme || 'indigo');
    bindPivot(); bindCustomers(); bindProducts(); bindData();
    $('#ovRange').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('#ovRange button').forEach((x) => x.classList.toggle('on', x === b)); drawOverviewChart(); });
    $$('[data-goto]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      if (a.dataset.goto === 'cust-idle') { S.cust.idle = '3-5'; S.cust.sort = { key: 'sales', dir: -1 }; go('customers'); }
      else { S.prod.idle = '6-11'; S.prod.level = 'sku2'; go('products'); }
    }));
    $$('.tabs a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.view); }));
    window.addEventListener('hashchange', () => go(location.hash.slice(1) || 'overview'));
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.view === 'overview' && S.E) drawOverviewChart(); }, 200); });
    const start = (location.hash.slice(1) || 'overview');
    try {
      if (await Dataset.Vault.exists()) await lockScreen('unlock');
      else {
        const legacy = await Dataset.Vault.legacy(); // 舊版存下的未加密資料：先設定密碼加密
        if (legacy) await lockScreen('setup', legacy);
      }
    } catch (e) { console.warn(e); }
    go(start);
    if (!S.E) {
      // 手機上：若網站有資料包，提示輸入密碼
      try {
        const h = await fetch('data/pack.dvp', { method: 'HEAD', cache: 'no-cache' });
        if (h.ok) { toast('網站上有資料包，輸入密碼後按「從網站載入」', 6000); $('#openPw').focus(); }
      } catch (e) { /* 沒有網路或沒有資料包 */ }
    }
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__app = S;
  boot();
})();

/* 比較：給經營者看的完整比較。
   1. 每年・每季・每月：所有年份排在一起，每一格都有和「去年同期」或「上一期」的變化；可以只看某個區域、業務、大類、類別、客戶
   2. 每年的「1～N 月同期」：今年還沒過完時，和往年同一段期間比才公平
   3. 自選兩段期間：任選期間 A、B，依業務、區域、大類、類別、客戶、款號拆開比較 */
(function (root) {
  const { ymLabel } = root.EngineMeta;
  const MS = ['sales', 'returns', 'net', 'profit', 'netProfit', 'orders', 'custs'];
  const obj = (v) => { const o = {}; MS.forEach((k, i) => { o[k] = v ? v[i] || 0 : 0; }); return o; };
  const rate = (a, b) => (b ? a / b : null);
  const METRICS = [
    { k: 'net', label: '淨銷售', f: (v) => v.net, kind: 'money', up: true },
    { k: 'netProfit', label: '淨毛利', f: (v) => v.netProfit, kind: 'money', up: true },
    { k: 'margin', label: '毛利率', f: (v) => rate(v.profit, v.sales), kind: 'pct', up: true },
    { k: 'retRate', label: '退貨率', f: (v) => rate(v.returns, v.sales), kind: 'pct', up: false },
    { k: 'sales', label: '銷貨', f: (v) => v.sales, kind: 'money', up: true },
    { k: 'returns', label: '退貨', f: (v) => v.returns, kind: 'money', up: false },
    { k: 'orders', label: '出貨單數', f: (v) => v.orders, kind: 'int', up: true },
    { k: 'custs', label: '交易客戶數', f: (v) => v.custs, kind: 'int', up: true },
    { k: 'avg', label: '平均每單', f: (v) => rate(v.sales, v.orders), kind: 'money', up: true },
  ];
  const BY = [
    { k: '', label: '總計' }, { k: 'rep', label: '業務員' }, { k: 'region', label: '區域' }, { k: 'big', label: '商品大類' },
    { k: 'cat', label: '商品類別' }, { k: 'ck', label: '客戶' }, { k: 'style', label: '款號' },
  ];
  const FILTER_DIMS = ['region', 'rep', 'big', 'cat', 'ck', 'style'];
  const COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

  function render(ctx) {
    const { S, E, fmt, nf0, nf1, esc, $, $$, Charts, repName } = ctx;
    const st = S.cmp;
    const met = METRICS.find((x) => x.k === st.metric) || METRICS[0];
    const ref = ctx.refYm(), refM = ref % 100;
    const vfmt = (v) => (v == null ? '—' : met.kind === 'pct' ? fmt.pct(v) : met.kind === 'int' ? nf0.format(v) : fmt.big(v));
    const vfull = (v) => (v == null ? '—' : met.kind === 'pct' ? fmt.pct(v) : met.kind === 'int' ? nf0.format(v) : fmt.money(v));
    // 變化：金額、數量用 %，比率用「個百分點」
    const delta = (x, px) => (x == null || px == null ? null : met.kind === 'pct' ? x - px : px ? (x - px) / Math.abs(px) : null);
    const arrow = (d, small) => {
      if (d == null || !isFinite(d)) return '';
      const up = d >= 0, good = up === met.up;
      const txt = met.kind === 'pct' ? nf1.format(Math.abs(d * 100)) + (small ? '' : ' 個百分點') : fmt.pct(Math.abs(d));
      return `<span class="${Math.abs(d) < 1e-9 ? '' : good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${txt}</span>`;
    };
    const dims = ctx.toDims(st.filters);
    const piv = (rows, extra = {}) => E.pivot({ rows, cols: null, measures: MS, filter: { ...extra, dims: { ...dims, ...(extra.dims || {}) } } });
    const years = E.yearList.slice(-6);
    const vsName = st.vs === 'prev' ? (st.gran === 'quarter' ? '上一季' : st.gran === 'month' ? '上個月' : '前一年') : '去年同期';

    // ---------- 控制項 ----------
    const seg = (id, list, cur) => `<div class="seg" id="${id}">${list.map((x) => `<button data-v="${x.v}" class="${x.v === cur ? 'on' : ''}">${x.label}</button>`).join('')}</div>`;
    $('#cmpControls').innerHTML = `<div class="cfg-row"><span class="cfg-l">看什麼</span>${seg('cmpMetric', METRICS.map((m) => ({ v: m.k, label: m.label })), met.k)}</div>
      <div class="cfg-row"><span class="cfg-l">怎麼排</span>${seg('cmpGran', [{ v: 'year', label: '每年' }, { v: 'quarter', label: '每季' }, { v: 'month', label: '每月' }], st.gran)}
      <span class="cfg-l">和誰比</span>${seg('cmpVs', [{ v: 'yoy', label: '去年同期' }, { v: 'prev', label: '上一期' }], st.vs)}</div>
      <div class="cfg-row"><span class="cfg-l">只看</span><div class="chips" id="cmpFilters"></div><select class="add" id="cmpAddFilter"><option value="">＋ 全公司（可加篩選）</option></select></div>`;
    const set = (k, v) => { st[k] = v; ctx.save(); ctx.rerender(); };
    $('#cmpMetric').onclick = (e) => { const b = e.target.closest('button'); if (b) set('metric', b.dataset.v); };
    $('#cmpGran').onclick = (e) => { const b = e.target.closest('button'); if (b) set('gran', b.dataset.v); };
    $('#cmpVs').onclick = (e) => { const b = e.target.closest('button'); if (b) set('vs', b.dataset.v); };
    const fa = $('#cmpAddFilter'); fa.dataset.ph = '＋ 全公司（可加篩選）';
    ctx.renderFilterChips($('#cmpFilters'), fa, st.filters, FILTER_DIMS, () => { ctx.save(); ctx.rerender(); }, (k) => { const d = { ...dims }; delete d[k]; return { dims: d }; });
    const scope = Object.keys(dims).length ? '（已篩選）' : '';

    // ---------- 每年・每季・每月 ----------
    const html = [];
    const cell = new Map(); // `${年}|${欄}` → 數值物件；欄：每年 = 0，每季 = 1～4，每月 = 1～12
    const full = new Map(); // 年 → 全年
    piv(['year']).rows.forEach((r) => full.set(parseInt(r.labels[0], 10), obj(r.vals[0])));
    let cols;
    if (st.gran === 'quarter') {
      const qd = E.dim('quarter');
      piv(['quarter']).rows.forEach((r) => { const q = qd.raw[r.codes[0]]; cell.set(Math.floor(q / 10) + '|' + (q % 10), obj(r.vals[0])); });
      cols = [1, 2, 3, 4].map((q) => ({ c: q, label: 'Q' + q }));
    } else if (st.gran === 'month') {
      piv(['ym']).rows.forEach((r) => { const v = E.ymList[r.codes[0]]; cell.set(Math.floor(v / 100) + '|' + (v % 100), obj(r.vals[0])); });
      cols = Array.from({ length: 12 }, (_, i) => ({ c: i + 1, label: (i + 1) + '月' }));
    } else cols = [];
    // 每年的 1～refM 月同期
    const ytd = new Map();
    if (refM < 12) piv(['year'], { dims: { month: new Set(Array.from({ length: refM }, (_, i) => i)) } }).rows.forEach((r) => ytd.set(parseInt(r.labels[0], 10), obj(r.vals[0])));
    // 最新一年還沒過完：它的「全年」改和前一年同樣月份比（例如 1～9 月比 1～9 月）
    const partialY = Math.floor(E.maxYm / 100), partialN = E.maxYm % 100 < 12 ? E.maxYm % 100 : 0;
    const same = new Map();
    if (partialN) piv(['year'], { dims: { month: new Set(Array.from({ length: partialN }, (_, i) => i)) } }).rows.forEach((r) => same.set(parseInt(r.labels[0], 10), obj(r.vals[0])));
    const fullDelta = (yy) => (partialN && yy === partialY ? delta(val(same, yy), val(same, yy - 1)) : delta(val(full, yy), val(full, yy - 1)));
    const fullNote = (yy) => (partialN && yy === partialY ? `<small class="muted">（1～${partialN} 月）</small>` : '');
    const prevKey = (yy, c) => {
      if (st.vs === 'yoy' || st.gran === 'year') return [yy - 1, c];
      const n = st.gran === 'quarter' ? 4 : 12;
      return c === 1 ? [yy - 1, n] : [yy, c - 1];
    };
    const val = (map, k) => { const v = map.get(k); return v && (v.sales || v.returns) ? met.f(v) : null; };
    const td = (x, px, strong) => (x == null ? '<td class="n muted">—</td>' : `<td class="n"><div>${strong ? '<b>' : ''}${vfmt(x)}${strong ? '</b>' : ''}</div><small>${arrow(delta(x, px), true)}</small></td>`);
    let head, body;
    if (st.gran === 'year') {
      head = `<tr><th>年</th><th class="n">全年</th><th class="n">比前一年</th>${refM < 12 ? `<th class="n sep">1～${refM} 月</th><th class="n">比去年同期</th>` : ''}<th class="n sep">每月平均</th></tr>`;
      body = years.map((yy) => {
        const x = val(full, yy), a = val(ytd, yy), pa = val(ytd, yy - 1);
        const nM = E.ymList.filter((v) => Math.floor(v / 100) === yy).length;
        const avg = full.get(yy) && met.kind !== 'pct' && met.k !== 'avg' && met.k !== 'custs' ? x / Math.max(1, nM) : null;
        return `<tr><td class="lbl">${yy} 年${yy === partialY && E.maxYm % 100 < 12 ? `<small class="muted">（到 ${E.maxYm % 100} 月）</small>` : ''}</td><td class="n">${vfmt(x)}</td><td class="n">${arrow(fullDelta(yy))}${partialN && yy === partialY ? '<small class="muted">（同期）</small>' : ''}</td>` +
          (refM < 12 ? `<td class="n sep">${vfmt(a)}</td><td class="n">${arrow(delta(a, pa))}</td>` : '') + `<td class="n sep">${avg == null ? '—' : vfmt(avg)}</td></tr>`;
      }).join('');
    } else {
      head = `<tr><th>年</th>${cols.map((c) => `<th class="n">${c.label}</th>`).join('')}<th class="n sep">全年</th></tr>`;
      body = years.map((yy) => `<tr><td class="lbl">${yy} 年</td>${cols.map((c) => { const [py, pc] = prevKey(yy, c.c); return td(val(cell, yy + '|' + c.c), val(cell, py + '|' + pc)); }).join('')}` +
        `<td class="n sep"><div><b>${vfmt(val(full, yy))}</b>${fullNote(yy)}</div><small>${arrow(fullDelta(yy), true)}</small></td></tr>`).join('');
    }
    const granName = { year: '每年', quarter: '每季', month: '每月' }[st.gran];
    html.push(`<div class="panel" id="cmpMain"><div class="panel-head"><h2>${met.label}：${granName}${scope}</h2></div>
      <p class="hint">${st.gran === 'year' ? '每一年的全年數字，和前一年比較。' : `每一格下面的 ▲▼ 是和${vsName}比較。`}${met.kind === 'pct' ? '比率的變化是「個百分點」。' : ''}${met.up ? '綠色是變好、紅色是變差。' : '這個數字越低越好：紅色的 ▲ 是變差。'}${partialN && st.gran !== 'year' ? `${partialY} 年還沒過完，它的「全年」只到 ${partialN} 月，和去年 1～${partialN} 月比。` : ''}${st.gran === 'year' && refM < 12 ? `「1～${refM} 月」是每年同一段期間，今年還沒過完時用它比才公平（${refM} 月是基準月，可在資料與設定更改）。` : ''}</p>
      <div class="table-wrap db-scroll"><table class="dt cmp">${head}${body}</table></div>
      <div class="chart" id="cmpChart"></div></div>`);

    // ---------- 自選兩段期間 ----------
    const yms = E.ymList;
    const def = (k, v) => (st.ab[k] && E.ymIndex.has(st.ab[k]) ? st.ab[k] : v);
    const y0 = Math.floor(ref / 100);
    const aF = def('aFrom', E.ymIndex.has(y0 * 100 + 1) ? y0 * 100 + 1 : yms[0]), aT = def('aTo', ref);
    const bF = def('bFrom', E.ymIndex.has((y0 - 1) * 100 + 1) ? (y0 - 1) * 100 + 1 : yms[0]), bT = def('bTo', E.ymIndex.has(ref - 100) ? ref - 100 : yms[0]);
    const opt = (v) => yms.map((x) => `<option value="${x}" ${x === v ? 'selected' : ''}>${ymLabel(x)}</option>`).join('');
    html.push(`<div class="panel" id="cmpAB"><div class="panel-head"><h2>自選兩段期間比較：${met.label}${scope}</h2></div>
      <p class="hint">例如今年 1～${refM} 月和去年 1～${refM} 月、這一季和上一季、今年和三年前。拆開看是誰造成差異。</p>
      <div class="ab-pick"><span class="ab-a">期間 A</span><select id="abAF">${opt(aF)}</select><span>到</span><select id="abAT">${opt(aT)}</select>
        <span class="ab-b">期間 B</span><select id="abBF">${opt(bF)}</select><span>到</span><select id="abBT">${opt(bT)}</select></div>
      <div class="cfg-row"><span class="cfg-l">拆開看</span>${seg('abBy', BY.map((x) => ({ v: x.k, label: x.label })), st.ab.by)}</div>
      <div id="abTable" class="db-scroll"></div></div>`);
    $('#cmpBody').innerHTML = html.join('');

    // 圖：每年 → 長條（全年、同期）；每季／每月 → 每年一條線
    const drawChart = () => {
      const el = $('#cmpChart'); if (!el) return;
      if (st.gran === 'year') {
        const series = [{ name: '全年', cls: 's1', values: years.map((yy) => val(full, yy)) }];
        if (refM < 12) series.push({ name: `1～${refM} 月`, cls: 's3', values: years.map((yy) => val(ytd, yy)) });
        Charts.render(el, { type: 'bar', labels: years.map((yy) => yy + '年'), series, fmt: vfull, axisFmt: met.kind === 'pct' ? (v) => nf1.format(v * 100) + '%' : met.kind === 'int' ? (v) => nf0.format(v) : fmt.axis, title: met.label });
      } else {
        const ys = years.slice(-COLORS.length);
        const series = ys.map((yy, i) => ({ name: yy + '年', cls: COLORS[COLORS.length - ys.length + i], values: cols.map((c) => val(cell, yy + '|' + c.c)) }));
        Charts.render(el, { type: 'line', labels: cols.map((c) => c.label), series, fmt: vfull, axisFmt: met.kind === 'pct' ? (v) => nf1.format(v * 100) + '%' : met.kind === 'int' ? (v) => nf0.format(v) : fmt.axis, title: met.label });
      }
    };
    drawChart();

    // 兩段期間的表
    const drawAB = () => {
      const g = (id) => +$('#' + id).value;
      const A = [g('abAF'), g('abAT')].sort((a, b) => a - b), B = [g('abBF'), g('abBT')].sort((a, b) => a - b);
      Object.assign(st.ab, { aFrom: A[0], aTo: A[1], bFrom: B[0], bTo: B[1] }); ctx.save();
      const by = st.ab.by;
      const run = (r) => piv(by ? [by] : [], { ymFrom: r[0], ymTo: r[1] });
      const pa = run(A), pb = run(B);
      const label = (l) => (by === 'rep' ? repName(l) : l || '（空白）');
      const rows = new Map();
      const put = (p, side) => { if (!by) { rows.set('all', { ...(rows.get('all') || { label: '全部', code: -1 }), [side]: obj(p.grand) }); return; } p.rows.forEach((r) => { const k = r.codes[0]; rows.set(k, { ...(rows.get(k) || { label: label(r.labels[0]), code: k }), [side]: obj(r.vals[0]) }); }); };
      put(pa, 'a'); put(pb, 'b');
      const list = [...rows.values()].map((r) => {
        const a = r.a ? met.f(r.a) : null, b = r.b ? met.f(r.b) : null;
        return { ...r, va: a, vb: b, diff: a != null && b != null ? a - b : met.kind === 'pct' ? null : (a || 0) - (b || 0), chg: delta(a, b), netA: r.a ? r.a.net : 0 };
      }).sort((x, y) => (met.kind === 'pct' ? y.netA - x.netA : (y.va || 0) - (x.va || 0)));
      const tA = obj(pa.grand), tB = obj(pb.grand);
      const pt = (r) => (r[0] === r[1] ? ymLabel(r[0]) : `${ymLabel(r[0])}～${ymLabel(r[1])}`);
      const cols = [
        { key: 'label', label: BY.find((x) => x.k === by).label, cls: 'lbl' },
        { key: 'va', label: `A：${pt(A)}`, n: 1, render: (r) => vfull(r.va) },
        { key: 'vb', label: `B：${pt(B)}`, n: 1, render: (r) => vfull(r.vb) },
        { key: 'diff', label: met.kind === 'pct' ? 'A − B' : '差額（A − B）', n: 1, render: (r) => (r.diff == null ? '—' : met.kind === 'pct' ? arrow(r.diff) : `<span class="${r.diff >= 0 === met.up ? 'up' : 'down'}">${r.diff >= 0 ? '+' : '−'}${vfull(Math.abs(r.diff))}</span>`) },
        { key: 'chg', label: '變化', n: 1, render: (r) => (r.vb == null || r.vb === 0 ? (r.va ? '<span class="muted">B 沒有</span>' : '—') : r.va == null ? '<span class="muted">A 沒有</span>' : arrow(r.chg)) },
      ];
      if (met.kind !== 'pct' && by) cols.push({ key: 'share', label: 'A 佔比', n: 1, render: (r) => fmt.pct(rate(r.va, met.f(tA))) });
      const foot = by ? `<tr><td>合計</td><td class="n">${vfull(met.f(tA))}</td><td class="n">${vfull(met.f(tB))}</td><td class="n">${met.kind === 'pct' ? arrow(met.f(tA) - met.f(tB)) : vfull(met.f(tA) - met.f(tB))}</td><td class="n">${arrow(delta(met.f(tA), met.f(tB)))}</td>${met.kind !== 'pct' ? '<td></td>' : ''}</tr>` : '';
      ctx.table($('#abTable'), cols, list, { limit: 30, foot, onRow: by === 'ck' ? (r) => ctx.drill('ck', r.code, r.label) : by === 'style' ? (r) => ctx.drill('style', r.code, r.label) : by === 'rep' ? (r) => ctx.goRep(E.dim('rep').labels[r.code]) : null });
      window.__cmpAB = { A, B, by, metric: met.k, total: [met.f(tA), met.f(tB)], rows: list.length };
    };
    drawAB();
    ['abAF', 'abAT', 'abBF', 'abBT'].forEach((id) => { $('#' + id).onchange = drawAB; });
    $('#abBy').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.ab.by = b.dataset.v; ctx.save(); $$('#abBy button').forEach((x) => x.classList.toggle('on', x === b)); drawAB(); };

    // 測試用：表格裡的數字
    return { metric: met.k, gran: st.gran, years, cell: Object.fromEntries([...cell].map(([k, v]) => [k, met.f(v)])), full: Object.fromEntries([...full].map(([k, v]) => [k, met.f(v)])), redraw: drawChart };
  }

  root.Compare = { render, METRICS };
})(window);

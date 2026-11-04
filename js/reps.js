/* 業務：每位業務的銷售狀況、每月曲線、每年曲線；上面可以搜尋，查單一業務的詳細情形。
   業績算在每一張單上填的業務員（同一位客戶換過業務時，各算各的）。 */
(function (root) {
  const { ymLabel } = root.EngineMeta;
  const MS = ['sales', 'returns', 'net', 'profit', 'netProfit', 'orders', 'custs'];
  const obj = (v) => { const o = {}; MS.forEach((k, i) => { o[k] = v ? v[i] || 0 : 0; }); return o; };
  const rate = (a, b) => (b ? a / b : null);
  const chg = (a, b) => (b ? (a - b) / Math.abs(b) : null);
  const COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

  function render(ctx) {
    const { S, E, fmt, nf0, nf1, esc, $, $$, table, Charts, repName } = ctx;
    const { addM } = root.Period;
    const st = S.rep;
    const ref = ctx.refYm();
    const R = root.Period.mount($('#rsPeriod'), S.span, E, ref, () => { ctx.saveSpan(); ctx.rerender(); }, esc);
    const F = R.F, hasPrev = !!R.pf;
    const periodText = () => R.label;
    const rd = E.dim('rep');
    const arrow = (d, goodUp = true, pp = false) => {
      if (d == null || !isFinite(d)) return '<span class="muted">—</span>';
      const up = d >= 0;
      return `<span class="${Math.abs(d) < 1e-9 ? '' : (up === goodUp ? 'up' : 'down')}">${up ? '▲' : '▼'} ${pp ? nf1.format(Math.abs(d * 100)) + ' 個百分點' : fmt.pct(Math.abs(d))}</span>`;
    };
    const byRep = (f) => new Map(E.pivot({ rows: ['rep'], cols: null, measures: MS, filter: f }).rows.map((r) => [r.labels[0], obj(r.vals[0])]));
    const cur = byRep(R.f), prev = hasPrev ? byRep(R.pf) : new Map();
    const totNet = [...cur.values()].reduce((s, v) => s + v.net, 0);
    // 有出現過的業務（全部期間）
    const allReps = E.pivot({ rows: ['rep'], cols: null, measures: ['net'], filter: {} }).rows.map((r) => r.labels[0]);
    const sortRep = (a, b) => (+a || 9e9) - (+b || 9e9) || String(a).localeCompare(String(b));
    allReps.sort(sortRep);

    $('#rsList').innerHTML = allReps.map((r) => `<option value="${esc(repName(r))}">`).join('');
    const sel = st.sel != null && allReps.includes(st.sel) ? st.sel : null;
    $('#rsSearch').value = sel != null ? repName(sel) : (st.q || '');
    $('#rsSub').textContent = `期間 ${R.label}${hasPrev ? `，和去年同期 ${R.prevLabel} 比較` : ''}。業績算在每張單上填的業務員。`;
    const body = $('#rsBody');

    // 年 × 月（某位業務或全部）
    const yearMonth = (dims) => {
      const p = E.pivot({ rows: ['ym'], cols: null, measures: ['net'], filter: { dims } });
      return new Map(p.rows.map((r) => [E.ymList[r.codes[0]], r.vals[0][0]]));
    };
    const last24 = Array.from({ length: 24 }, (_, i) => addM(ref, i - 23));
    const years = E.yearList.slice(-6);

    if (sel == null) {
      // ---------- 全部業務 ----------
      const q = (st.q || '').trim().toLowerCase();
      const rows = allReps.filter((r) => !q || repName(r).toLowerCase().includes(q) || String(r).toLowerCase().includes(q)).map((r) => {
        const v = cur.get(r) || obj(null), pv = prev.get(r) || obj(null);
        return { rep: r, label: repName(r), ...v, share: rate(v.net, totNet), prevNet: pv.net, yoy: chg(v.net, pv.net), margin: rate(v.profit, v.sales), retRate: rate(v.returns, v.sales), avg: rate(v.sales, v.orders), prevCusts: pv.custs };
      }).filter((r) => r.sales || r.returns || r.prevNet).sort((a, b) => b.net - a.net);
      body.innerHTML = `<div class="panel"><div class="panel-head"><h2>每位業務的銷售狀況</h2></div><p class="hint">點圖或名字看那位業務的詳細情形；也可以在上面搜尋。</p>
        <div class="grid2 tight"><div><h3>佔全公司淨銷售</h3><div id="rsPie"></div></div><div><h3>淨銷售${hasPrev ? '（細線 = 去年同期）' : ''}</h3><div id="rsBars"></div></div></div>
        <details class="numtab"><summary>數字表（淨毛利、毛利率、退貨率、客戶數、單數）</summary><div id="rsTable" class="db-scroll"></div></details></div>
        <div class="panel"><div class="panel-head"><h2>每月淨銷售（近 24 個月）</h2></div><p class="hint">這段期間淨銷售最高的 ${Math.min(COLORS.length, rows.length)} 位業務，每人一條線。</p><div class="chart tall" id="rsMonthChart"></div></div>
        <div class="panel"><div class="panel-head"><h2>每年淨銷售</h2></div><p class="hint">每位業務每一年的淨銷售，▲▼ 是和前一年比。${ref % 100 < 12 ? `今年還沒過完（到 ${ymLabel(E.maxYm)}），最右邊另外列出每年 1～${ref % 100} 月的同期比較；圖上有 * 的年份還沒過完。` : ''}</p><div class="chart" id="rsYearChart"></div><details class="numtab"><summary>數字表</summary><div id="rsYears" class="table-wrap db-scroll"></div></details></div>`;
      const cols = [
        { key: 'label', label: '業務員', cls: 'lbl' },
        { key: 'net', label: '淨銷售', n: 1, fmt: 'money' },
        { key: 'share', label: '佔比', n: 1, render: (r) => `<span class="pbar"><i style="width:${Math.max(0, Math.min(100, (r.share || 0) * 100))}%"></i>${fmt.pct(r.share)}</span>` },
      ];
      if (hasPrev) cols.push({ key: 'prevNet', label: '去年同期', n: 1, fmt: 'money' }, { key: 'yoy', label: '成長', n: 1, render: (r) => (r.prevNet ? arrow(r.yoy) : '<span class="muted">新</span>') });
      cols.push(
        { key: 'netProfit', label: '淨毛利', n: 1, fmt: 'money' }, { key: 'margin', label: '毛利率', n: 1, fmt: 'pct' }, { key: 'retRate', label: '退貨率', n: 1, fmt: 'pct' },
        { key: 'custs', label: '客戶數', n: 1, render: (r) => nf0.format(r.custs) + (hasPrev ? `<small class="muted">（去年 ${nf0.format(r.prevCusts)}）</small>` : '') },
        { key: 'orders', label: '出貨單數', n: 1, fmt: 'int' }, { key: 'avg', label: '平均每單', n: 1, fmt: 'money' },
      );
      const pick = (r) => { st.sel = r.rep; st.q = ''; ctx.save(); ctx.rerender(); window.scrollTo(0, 0); };
      table($('#rsTable'), cols, rows, { limit: 50, onRow: pick, empty: '找不到符合的業務' });
      Charts.donut($('#rsPie'), { items: rows.filter((r) => r.net > 0).map((r) => ({ label: r.label, value: r.net, cls: ctx.colorOf('rep', r.rep), rep: r.rep })), fmt: fmt.big, title: '各業務佔比', center: { value: fmt.big(totNet), label: '全公司' }, onClick: pick });
      Charts.hbars($('#rsBars'), { rows: rows.map((r) => ({ label: r.label, value: r.net, prev: hasPrev ? r.prevNet : null, cls: ctx.colorOf('rep', r.rep), rep: r.rep, note: hasPrev ? (r.prevNet ? arrow(r.yoy) : '<span class="muted">新</span>') : '' })), fmt: fmt.big, onClick: pick, limit: 20 });
      const top = rows.slice(0, COLORS.length);
      const ymByRep = new Map(top.map((r) => [r.rep, yearMonth({ rep: new Set([rd.labels.indexOf(r.rep)]) })]));
      // 每年
      const byYear = (extra) => { const m = new Map(); E.pivot({ rows: ['rep', 'year'], cols: null, measures: ['net'], filter: extra }).rows.forEach((r) => m.set(r.labels[0] + '|' + parseInt(r.labels[1], 10), r.vals[0][0])); return m; };
      const yFull = byYear({}), refM = ref % 100;
      const ySame = refM < 12 ? byYear({ dims: { month: new Set(Array.from({ length: refM }, (_, i) => i)) } }) : null;
      const yr = (m, r, yy) => m.get(r + '|' + yy);
      const cellY = (m, r, yy) => { const v = yr(m, r, yy), pv = yr(m, r, yy - 1); return v == null ? '<td class="n muted">—</td>' : `<td class="n"><div>${fmt.big(v)}</div><small>${pv ? arrow(chg(v, pv)) : ''}</small></td>`; };
      const lastY = years[years.length - 1];
      $('#rsYears').innerHTML = `<table class="dt cmp"><tr><th>業務員</th>${years.map((yy) => `<th class="n">${yy} 年</th>`).join('')}${ySame ? `<th class="n sep">${lastY} 年 1～${refM} 月</th><th class="n">${lastY - 1} 年 1～${refM} 月</th><th class="n">成長</th>` : ''}</tr>` +
        rows.map((r) => `<tr class="click" data-rep="${esc(r.rep)}"><td class="lbl">${esc(r.label)}</td>${years.map((yy) => cellY(yFull, r.rep, yy)).join('')}` +
          (ySame ? `<td class="n sep">${fmt.big(yr(ySame, r.rep, lastY) || 0)}</td><td class="n">${fmt.big(yr(ySame, r.rep, lastY - 1) || 0)}</td><td class="n">${yr(ySame, r.rep, lastY - 1) ? arrow(chg(yr(ySame, r.rep, lastY) || 0, yr(ySame, r.rep, lastY - 1))) : '<span class="muted">—</span>'}</td>` : '') + '</tr>').join('') + '</table>';
      $('#rsYears').onclick = (e) => { const tr = e.target.closest('tr[data-rep]'); if (!tr) return; st.sel = tr.dataset.rep; ctx.save(); ctx.rerender(); window.scrollTo(0, 0); };
      const draw = () => {
        Charts.render($('#rsMonthChart'), { type: 'line', labels: last24.map(ymLabel), series: top.map((r) => ({ name: r.label, cls: ctx.colorOf('rep', r.rep), values: last24.map((m) => (E.ymIndex.has(m) ? ymByRep.get(r.rep).get(m) || 0 : null)) })), fmt: fmt.money, axisFmt: fmt.axis, title: '每位業務每月淨銷售' });
        // 每位業務一組長條，每一年一個顏色
        const ys = years.slice(-COLORS.length);
        Charts.render($('#rsYearChart'), { type: 'bar', labels: rows.slice(0, 10).map((r) => r.label), series: ys.map((yy, i) => ({ name: yy + '年' + (yy === Math.floor(E.maxYm / 100) && E.maxYm % 100 < 12 ? '*' : ''), cls: COLORS[(i + COLORS.length - ys.length) % COLORS.length], values: rows.slice(0, 10).map((r) => yr(yFull, r.rep, yy) ?? null) })), fmt: fmt.money, axisFmt: fmt.axis, title: '每位業務每年淨銷售' });
      };
      draw();
      return { mode: 'all', rows: rows.map((r) => ({ rep: r.rep, net: r.net, prevNet: r.prevNet, custs: r.custs })), redraw: draw };
    }

    // ---------- 單一業務 ----------
    const code = rd.labels.indexOf(sel);
    const dims = { rep: new Set([code]) };
    const tot = (f) => obj(E.pivot({ rows: [], cols: null, measures: MS, filter: { ...f, dims } }).grand);
    const c = tot(R.f), p = hasPrev ? tot(R.pf) : null;
    // 客戶：這段期間或去年同期有買過的（去年有、今年沒有 = 沒再買）
    const custBy = (f) => new Map(E.pivot({ rows: ['ck'], cols: null, measures: ['net', 'netProfit', 'sales', 'profit'], filter: { ...f, dims } }).rows.map((x) => [x.codes[0], x.vals[0]]));
    const cc = custBy(R.f), pc = hasPrev ? custBy(R.pf) : new Map();
    const allC = new Map(E.customers({}, ref).list.map((x) => [x.ck, x]));
    const firstWithRep = new Map(E.customers({ dims }, ref).list.map((x) => [x.ck, x.first]));
    const isNewC = (k) => { const f = firstWithRep.get(k); return f >= F[0] && f <= F[1]; };
    const newC = [...cc.keys()].filter(isNewC).length;
    const custRows = [...new Set([...cc.keys(), ...pc.keys()])].map((k) => {
      const v = cc.get(k) || [0, 0, 0, 0], pv = pc.get(k) || [0];
      const info = allC.get(k) || {};
      return { ck: k, name: (info.code || '') + ' ' + (info.name || E.ds.str.ck.dict[k]), net: v[0], netProfit: v[1], margin: rate(v[3], v[2]), prevNet: pv[0], last: info.last, idle: info.idle, info };
    }).sort((a, b) => b.net - a.net || b.prevNet - a.prevNet);
    const lost = custRows.filter((r) => !r.net && r.prevNet > 0);
    const prevStyle = hasPrev ? new Map(E.pivot({ rows: ['style'], cols: null, measures: ['net'], filter: { ...R.pf, dims } }).rows.map((x) => [x.codes[0], x.vals[0][0]])) : new Map();
    const prodRows = E.pivot({ rows: ['style'], cols: null, measures: ['net', 'soldQty', 'custs'], filter: { ...R.f, dims } }).rows
      .map((x) => ({ code: x.codes[0], label: x.labels[0], net: x.vals[0][0], qty: x.vals[0][1], custs: x.vals[0][2], prevNet: prevStyle.get(x.codes[0]) || 0 })).sort((a, b) => b.net - a.net);
    const mix = (dim) => E.pivot({ rows: [dim], cols: null, measures: ['net'], filter: { ...R.f, dims } }).rows.map((x) => ({ label: x.labels[0] || '（空白）', net: x.vals[0][0] })).sort((a, b) => b.net - a.net);
    const kpi = (k, v, ...d) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>${d.filter(Boolean).map((x) => `<span class="d">${x}</span>`).join('')}</div>`;
    const rank = [...cur.entries()].sort((a, b) => b[1].net - a[1].net).findIndex(([k]) => k === sel) + 1;
    const shareRows = (rows) => { const t = rows.reduce((s, r) => s + Math.max(0, r.net), 0) || 1; return rows.slice(0, 8).map((r) => `<div class="srow"><div class="sl"><span>${esc(r.label)}</span><b>${fmt.pct(Math.max(0, r.net) / t)}</b></div><div class="sb"><i class="b1" style="width:${Math.max(0, r.net) / t * 100}%"></i></div></div>`).join('') || '<p class="hint">沒有資料</p>'; };
    body.innerHTML = `<div class="panel rs-head"><div class="panel-head"><h2>${esc(repName(sel))} 的詳細情形</h2><button class="btn" id="rsBack">‹ 全部業務</button></div>
        <div class="kpis">${[
          kpi('淨銷售', fmt.big(c.net), hasPrev ? `比去年同期 ${arrow(chg(c.net, p.net))}` : '', rank ? `第 ${rank} 名，佔全公司 ${fmt.pct(rate(c.net, totNet))}` : ''),
          kpi('淨毛利', fmt.big(c.netProfit), `毛利率 ${fmt.pct(rate(c.profit, c.sales))}`, hasPrev ? `去年同期 ${fmt.pct(rate(p.profit, p.sales))} ${arrow(rate(c.profit, c.sales) - rate(p.profit, p.sales), true, true)}` : ''),
          kpi('退貨率', fmt.pct(rate(c.returns, c.sales)), `退貨 ${fmt.big(c.returns)}`, hasPrev ? `去年同期 ${fmt.pct(rate(p.returns, p.sales))}` : ''),
          kpi('交易客戶數', nf0.format(c.custs), `新客戶 ${nf0.format(newC)} 位`, hasPrev ? `去年同期 ${nf0.format(p.custs)} 位、沒再買 ${nf0.format(lost.length)} 位` : ''),
          kpi('出貨單數', nf0.format(c.orders), `平均每單 ${fmt.money(rate(c.sales, c.orders))}`, hasPrev ? `去年同期 ${nf0.format(p.orders)} 張` : ''),
        ].join('')}</div></div>
      <div class="panel"><div class="panel-head"><h2>這段期間的走勢 <span class="linked">跟著期間</span></h2></div><p class="hint" id="rsTrendHint"></p><div class="chart" id="rsTrend"></div></div>
      <div class="grid2"><div class="panel"><div class="panel-head"><h2>前 10 大客戶 <span class="linked">跟著期間</span></h2></div><p class="hint">長條是這段期間，細線是去年同期。點一列看客戶明細。</p><div id="rsTopCust"></div></div>
        <div class="panel"><div class="panel-head"><h2>賣最多的款號 <span class="linked">跟著期間</span></h2></div><p class="hint">長條是這段期間，細線是去年同期。點一列看款號。</p><div id="rsTopProd"></div></div></div>
      <div class="panel"><div class="panel-head"><h2>業績從哪裡來 <span class="linked">跟著期間</span></h2></div><div class="donuts three"><div><h3>新客戶／老客戶</h3><div id="rsNewOld"></div></div><div><h3>商品大類</h3><div id="rsBig"></div></div><div><h3>區域</h3><div id="rsRegion"></div></div></div></div>
      <div class="panel"><div class="panel-head"><h2>客戶 <span class="linked">跟著期間</span></h2></div><p class="hint">包含去年同期有買、這段期間沒再買的客戶。點一列看客戶明細。</p><div id="rsCust" class="db-scroll"></div></div>
      <div class="panel"><div class="panel-head"><h2>款號 <span class="linked">跟著期間</span></h2></div><div id="rsProd" class="db-scroll"></div></div>
      <h2 class="section-title">長期趨勢 <small>不跟著上面的期間變，看整體走向</small></h2>
      <div class="grid2"><div class="panel"><div class="panel-head"><h2>近 24 個月每月淨銷售</h2></div><p class="hint">長條是每個月，虛線是前一年同一個月。</p><div class="chart" id="rsOneMonth"></div></div>
        <div class="panel"><div class="panel-head"><h2>每年的每月曲線</h2></div><p class="hint">每一年一條線，同一個月份上下比就是和往年同期比。</p><div class="chart" id="rsOneYears"></div></div></div>
      <div class="panel"><div class="panel-head"><h2>每年</h2></div><div id="rsOneYearTbl" class="db-scroll"></div></div>`;
    Charts.donut($('#rsBig'), { items: mix('big').map((r) => ({ label: r.label, value: r.net, cls: ctx.colorOf('big', r.label) })), fmt: fmt.big, title: '商品大類' });
    Charts.donut($('#rsRegion'), { items: mix('region').map((r) => ({ label: r.label, value: r.net, cls: ctx.colorOf('region', r.label) })), fmt: fmt.big, title: '區域' });
    void shareRows;
    const newNet = [...cc.entries()].filter(([k]) => isNewC(k)).reduce((t, [, v]) => t + v[0], 0);
    Charts.donut($('#rsNewOld'), { items: [{ label: '老客戶', value: c.net - newNet, cls: 'c1' }, { label: '新客戶（這段期間第一次跟他買）', value: newNet, cls: 'c3' }].filter((x) => x.value > 0), fmt: fmt.big, title: '新客戶／老客戶', sort: false });
    Charts.hbars($('#rsTopCust'), { rows: custRows.filter((r) => r.net > 0).slice(0, 10).map((r) => ({ label: r.name, value: r.net, prev: hasPrev ? r.prevNet : null, cls: 'c1', r, note: hasPrev ? (r.prevNet ? arrow(chg(r.net, r.prevNet)) : '<span class="muted">新</span>') : '' })), fmt: fmt.big, limit: 10, onClick: (x) => { if (x.r.info && x.r.info.ck != null) ctx.openCustomer(x.r.info); } });
    Charts.hbars($('#rsTopProd'), { rows: prodRows.filter((r) => r.net > 0).slice(0, 10).map((r) => ({ label: r.label, value: r.net, prev: hasPrev ? r.prevNet : null, cls: 'c4', r, note: hasPrev ? (r.prevNet ? arrow(chg(r.net, r.prevNet)) : '<span class="muted">新</span>') : '' })), fmt: fmt.big, limit: 10, onClick: (x) => ctx.drill('style', x.r.code, x.r.label) });
    $('#rsBack').onclick = () => { st.sel = null; ctx.save(); ctx.rerender(); };
    // 每年表
    const yp = E.pivot({ rows: ['year'], cols: null, measures: MS, filter: { dims } }).rows.map((r) => ({ y: parseInt(r.labels[0], 10), ...obj(r.vals[0]) }));
    const ypm = new Map(yp.map((r) => [r.y, r]));
    const pY = Math.floor(E.maxYm / 100), pN = E.maxYm % 100 < 12 ? E.maxYm % 100 : 0; // 最新一年還沒過完 → 和前一年同樣月份比
    const ySame = pN ? new Map(E.pivot({ rows: ['year'], cols: null, measures: ['net'], filter: { dims: { ...dims, month: new Set(Array.from({ length: pN }, (_, i) => i)) } } }).rows.map((r) => [parseInt(r.labels[0], 10), r.vals[0][0]])) : null;
    table($('#rsOneYearTbl'), [
      { key: 'y', label: '年', cls: 'lbl', render: (r) => r.y + ' 年' + (r.y === Math.floor(E.maxYm / 100) && E.maxYm % 100 < 12 ? `<small class="muted">（到 ${E.maxYm % 100} 月）</small>` : '') },
      { key: 'net', label: '淨銷售', n: 1, fmt: 'money' },
      { key: 'g', label: '比前一年', n: 1, render: (r) => (!ypm.get(r.y - 1) ? '<span class="muted">—</span>' : pN && r.y === pY ? arrow(chg(ySame.get(r.y) || 0, ySame.get(r.y - 1))) + `<small class="muted">（1～${pN} 月同期）</small>` : arrow(chg(r.net, ypm.get(r.y - 1).net))) },
      { key: 'netProfit', label: '淨毛利', n: 1, fmt: 'money' },
      { key: 'm', label: '毛利率', n: 1, render: (r) => fmt.pct(rate(r.profit, r.sales)) },
      { key: 'rr', label: '退貨率', n: 1, render: (r) => fmt.pct(rate(r.returns, r.sales)) },
      { key: 'custs', label: '客戶數', n: 1, fmt: 'int' }, { key: 'orders', label: '出貨單數', n: 1, fmt: 'int' },
    ], yp.slice().reverse(), {});
    // 客戶表
    const ccols = [{ key: 'name', label: '客戶', cls: 'lbl' }, { key: 'net', label: '淨銷售', n: 1, fmt: 'money' }];
    if (hasPrev) ccols.push({ key: 'prevNet', label: '去年同期', n: 1, fmt: 'money' }, { key: 'x', label: '變化', n: 1, render: (r) => (!r.net && r.prevNet > 0 ? '<span class="down">沒再買</span>' : r.prevNet ? arrow(chg(r.net, r.prevNet)) : '<span class="muted">新</span>') });
    ccols.push({ key: 'margin', label: '毛利率', n: 1, fmt: 'pct' }, { key: 'last', label: '最近交易', fmt: 'ym' }, { key: 'idle', label: '靜止(月)', n: 1, fmt: 'int' });
    table($('#rsCust'), ccols, custRows, { limit: 30, onRow: (r) => { if (r.info && r.info.ck != null) ctx.openCustomer(r.info); }, empty: '這段期間沒有客戶' });
    table($('#rsProd'), [{ key: 'label', label: '款號', cls: 'lbl' }, { key: 'net', label: '淨銷售', n: 1, fmt: 'money' }, ...(hasPrev ? [{ key: 'prevNet', label: '去年同期', n: 1, fmt: 'money' }, { key: 'g', label: '變化', n: 1, render: (r) => (r.prevNet ? arrow(chg(r.net, r.prevNet)) : '<span class="muted">新</span>') }] : []), { key: 'qty', label: '賣出數', n: 1, fmt: 'int' }, { key: 'custs', label: '客戶數', n: 1, fmt: 'int' }],
      prodRows, { limit: 15, onRow: (r) => ctx.drill('style', r.code, r.label), empty: '沒有' });
    const ym = yearMonth(dims);
    const trend = root.Period.trend(E, R, dims, 'net');
    $('#rsTrendHint').textContent = trend.hint;
    const draw = () => {
      Charts.render($('#rsTrend'), { type: hasPrev ? 'combo' : 'bar', labels: trend.labels, series: [{ name: '淨銷售', kind: 'bar', cls: ctx.colorOf('rep', sel), values: trend.cur }, ...(hasPrev ? [{ name: '去年同期', kind: 'line', dash: true, cls: 's3', values: trend.prev }] : [])], fmt: fmt.money, axisFmt: fmt.axis, title: '這段期間的走勢' });
      Charts.render($('#rsOneMonth'), { type: 'combo', labels: last24.map(ymLabel), series: [{ name: '淨銷售', kind: 'bar', cls: ctx.colorOf('rep', sel), values: last24.map((m) => ym.get(m) || 0) }, { name: '前一年同月', kind: 'line', dash: true, cls: 's3', values: last24.map((m) => (E.ymIndex.has(m - 100) ? ym.get(m - 100) || 0 : null)) }], fmt: fmt.money, axisFmt: fmt.axis, title: '近 24 個月每月淨銷售' });
      const ys = years.slice(-COLORS.length);
      Charts.render($('#rsOneYears'), { type: 'line', labels: Array.from({ length: 12 }, (_, i) => (i + 1) + '月'), series: ys.map((yy, i) => ({ name: yy + '年', cls: COLORS[(i + COLORS.length - ys.length) % COLORS.length], values: Array.from({ length: 12 }, (_, k) => (E.ymIndex.has(yy * 100 + k + 1) ? ym.get(yy * 100 + k + 1) || 0 : null)) })), fmt: fmt.money, axisFmt: fmt.axis, title: '每年的每月曲線' });
    };
    draw();
    return { mode: 'one', rep: sel, cur: c, prev: p, custs: custRows.length, lost: lost.length, years: yp, trend, period: R.label, redraw: draw };
  }

  root.Reps = { render };
})(window);

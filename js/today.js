/* 今日：用實際出貨／退貨日期看「現在」的表現。
   - 選一天（預設最新一天）：當天、本月累計（和上月同期、去年同月同期比）、今年累計、月底預估
   - 本月累計走勢（本月、上個月、去年同月，同一個刻度）、最近 30 天每天的淨銷售
   - 本月各業務、本月前 10 大客戶、最近幾個出貨日、當天的單、該來買卻還沒來的客戶
   資料沒有實際日期（舊的總表）時，改用月份顯示，並說明怎麼補上日期。 */
(function (root) {
  const { ymLabel, dayLabel, dayNum, fromDayNum, daysInMonth, weekday } = root.EngineMeta;
  const M = ['sales', 'returns', 'net', 'profit', 'netProfit', 'orders', 'custs'];

  function render(ctx) {
    const { S, E, fmt, nf0, nf1, esc, $, table, Charts, repName } = ctx;
    const addM = root.Dashboard.addM;
    const rate = (a, b) => (b ? a / b : null);
    const chg = (a, b) => (b ? (a - b) / Math.abs(b) : null);
    const arrow = (d, goodUp = true, pp = false) => {
      if (d == null || !isFinite(d)) return '<span class="muted">—</span>';
      const up = d >= 0;
      return `<span class="${Math.abs(d) < 1e-9 ? '' : (up === goodUp ? 'up' : 'down')}">${up ? '▲' : '▼'} ${pp ? nf1.format(Math.abs(d * 100)) + ' 個百分點' : fmt.pct(Math.abs(d))}</span>`;
    };
    const tot = (f) => { const g = E.pivot({ rows: [], cols: null, measures: M, filter: f }).grand; const o = {}; M.forEach((k, i) => { o[k] = g[i] || 0; }); return o; };
    const kpi = (k, v, ...d) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>${d.filter(Boolean).map((x) => `<span class="d">${x}</span>`).join('')}</div>`;
    const box = $('#tdBody');

    // ---------- 沒有實際日期：用月份 ----------
    if (!E.maxDate) {
      const ref = ctx.refYm(), y = Math.floor(ref / 100), mo = ref % 100;
      $('#tdDay').hidden = true;
      $('#tdSub').textContent = `資料期間 ${ymLabel(E.minYm)} – ${ymLabel(E.maxYm)}，以 ${ymLabel(ref)} 為基準月`;
      const cur = tot({ ymFrom: ref, ymTo: ref }), ly = tot({ ymFrom: ref - 100, ymTo: ref - 100 });
      const ytd = tot({ ymFrom: y * 100 + 1, ymTo: ref }), ytdP = tot({ ymFrom: (y - 1) * 100 + 1, ymTo: (y - 1) * 100 + mo });
      box.innerHTML = `<div class="panel notice"><b>這份資料沒有實際出貨日期，所以看不到每一天的數字。</b>
        <p class="hint">總表沒有 DELIVDATE。改匯入系統原始資料 JMSSAL、JMSSBK（.DBF），或用總表更新工具補上「實際出貨日期」欄，這一頁就會顯示每天的業績、本月累計和上月同期的比較。下面先用月份顯示。</p></div>
        <div class="kpis">${[
          kpi(`${ymLabel(ref)} 淨銷售`, fmt.big(cur.net), `比去年同月 ${arrow(chg(cur.net, ly.net))}`),
          kpi(`${ymLabel(ref)} 交易客戶`, nf0.format(cur.custs), `去年同月 ${nf0.format(ly.custs)} 位`),
        ].join('')}</div>
        <div class="panel"><div class="panel-head"><h2>每月淨銷售（近 24 個月）</h2></div><div class="chart" id="tdMonthChart"></div></div>`;
      const t = E.trend({}).slice(-24);
      Charts.render($('#tdMonthChart'), { type: 'bar', labels: t.map((r) => r.label), series: [{ name: '淨銷售', values: t.map((r) => r.net), cls: 's1' }], fmt: fmt.money, axisFmt: fmt.axis });
      return { mode: 'month', cur, ytd };
    }

    // ---------- 選哪一天 ----------
    const allDays = E.dim('day').raw.filter(Boolean);
    let D = S.today.date && allDays.includes(S.today.date) ? S.today.date : E.maxSalesDate;
    const sel = $('#tdDay'); sel.hidden = false;
    sel.innerHTML = allDays.slice(-120).reverse().map((d) => `<option value="${d}" ${d === D ? 'selected' : ''}>${dayLabel(d)}（${weekday(d)}）</option>`).join('');
    const ym = Math.floor(D / 100), y = Math.floor(ym / 100), m = ym % 100, dd = D % 100;
    const same = (yy) => yy * 100 + Math.min(dd, daysInMonth(yy)); // 某個月的「同一天」（小月取月底）
    const pm = addM(ym, -1), lm = ym - 100;
    const R = {
      day: [D, D], mtd: [ym * 100 + 1, D], pmtd: [pm * 100 + 1, same(pm)], lmtd: [lm * 100 + 1, same(lm)],
      ytd: [y * 10000 + 101, D], lytd: [(y - 1) * 10000 + 101, (y - 1) * 10000 + m * 100 + Math.min(dd, daysInMonth(lm))],
      pmFull: [pm * 100 + 1, pm * 100 + 31], lmFull: [lm * 100 + 1, lm * 100 + 31],
    };
    const T = {}; for (const k in R) T[k] = tot({ dFrom: R[k][0], dTo: R[k][1] });
    const hasPm = T.pmFull.sales > 0, hasLm = T.lmFull.sales > 0;
    const isLatest = D === E.maxSalesDate;
    $('#tdSub').textContent = `${isLatest ? '最新有出貨的一天' : '你選的日期'}：${dayLabel(D)}（星期${weekday(D)}）。依實際出貨／退貨日期；「同期」是每個月 1 日到 ${dd} 日。`;

    // 每天（某段期間）的淨銷售
    const daily = (r) => {
      const p = E.pivot({ rows: ['day'], cols: null, measures: ['sales', 'returns', 'net', 'orders', 'custs'], filter: { dFrom: r[0], dTo: r[1] } });
      const raw = E.dim('day').raw;
      return new Map(p.rows.map((x) => [raw[x.codes[0]], { sales: x.vals[0][0], returns: x.vals[0][1], net: x.vals[0][2], orders: x.vals[0][3], custs: x.vals[0][4] }]));
    };
    const mtdDays = daily(R.mtd);
    const shipDays = [...mtdDays.values()].filter((v) => v.sales > 0).length;
    const avgDay = shipDays ? T.mtd.net / shipDays : null;
    const dim = daysInMonth(ym);
    const pace = T.mtd.net / dd * dim;

    const html = [];
    html.push(`<div class="kpis td-kpis">${[
      kpi(`${dayLabel(D)}（${weekday(D)}）`, fmt.big(T.day.net), `${nf0.format(T.day.orders)} 張單・${nf0.format(T.day.custs)} 位客戶`, avgDay ? `比本月平均每個出貨日 ${arrow(chg(T.day.net, avgDay))}` : ''),
      kpi(`本月到今天（${m}/1～${m}/${dd}）`, fmt.big(T.mtd.net), `${nf0.format(T.mtd.orders)} 張單・${nf0.format(T.mtd.custs)} 位客戶`, hasPm ? `比上月同期 ${arrow(chg(T.mtd.net, T.pmtd.net))}` : '上個月沒有資料', hasLm ? `比去年同月同期 ${arrow(chg(T.mtd.net, T.lmtd.net))}` : '去年同月沒有資料'),
      kpi(`本月預估${dd >= dim ? '（已過完）' : ''}`, fmt.big(dd >= dim ? T.mtd.net : pace), dd >= dim ? '' : `照目前每天的速度估算到 ${m}/${dim}`, hasLm ? `去年 ${m} 月全月 ${fmt.big(T.lmFull.net)}` : '', hasPm ? `上個月全月 ${fmt.big(T.pmFull.net)}` : ''),
    ].join('')}</div>`);
    html.push(`<div class="grid2"><div class="panel"><div class="panel-head"><h2>本月累計走勢</h2></div><p class="hint">每一天加起來的淨銷售。本月的線在上個月、去年同月的上面，就是表現比較好。</p><div class="chart" id="tdCumChart"></div></div>
      <div class="panel"><div class="panel-head"><h2>最近 30 天每天的淨銷售</h2></div><p class="hint">長條是每天的淨銷售，線是前 7 天的平均（看趨勢）。沒有出貨的日子是空的。</p><div class="chart" id="tdDayChart"></div></div></div>`);
    html.push(`<div class="panel"><div class="panel-head"><h2>本月各業務（${m}/1～${m}/${dd}）</h2><a href="#reps" class="link" id="tdAllReps">業務頁</a></div>
      <div class="grid2 tight"><div><h3>佔本月的比例</h3><div id="tdRepPie"></div></div><div><h3>本月到今天${hasPm ? '（細線 = 上月同期）' : ''}</h3><div id="tdRepBars"></div></div></div>
      <details class="numtab"><summary>數字表</summary><div id="tdReps" class="db-scroll"></div></details></div>`);
    html.push(`<div class="panel"><div class="panel-head"><h2>本月前 10 大客戶</h2></div>${hasLm ? '<p class="hint">細線是去年同月同期。點客戶看明細。</p>' : ''}<div id="tdCust"></div></div>`);
    html.push(`<div class="panel"><div class="panel-head"><h2>${dayLabel(D)} 的單</h2></div><div id="tdOrders" class="db-scroll"></div></div>`);
    box.innerHTML = html.join('');

    // ---------- 圖 ----------
    const pmDays = hasPm ? daily(R.pmFull) : new Map(), lmDays = hasLm ? daily(R.lmFull) : new Map();
    const cum = (map, yymm, upto) => { let s = 0; const out = []; for (let i = 1; i <= 31; i++) { if (i > daysInMonth(yymm)) { out.push(null); continue; } s += (map.get(yymm * 100 + i) || {}).net || 0; out.push(i <= upto ? s : null); } return out; };
    const labels = Array.from({ length: dim }, (_, i) => (i + 1) + '日');
    const series = [];
    if (hasLm) series.push({ name: `去年${m}月`, cls: 's3', values: cum(lmDays, lm, 31).slice(0, dim) });
    if (hasPm) series.push({ name: `上個月`, cls: 's2', values: cum(pmDays, pm, 31).slice(0, dim) });
    series.push({ name: `本月`, cls: 's1', values: cum(mtdDays, ym, dd).slice(0, dim) });
    const drawCharts = () => {
      Charts.render($('#tdCumChart'), { type: 'line', labels, series, fmt: fmt.money, axisFmt: fmt.axis, title: '本月累計走勢' });
      const d0 = dayNum(D) - 29, last30 = [];
      for (let k = 0; k < 30; k++) last30.push(fromDayNum(d0 + k));
      const m30 = daily([last30[0], D]);
      // 7 天平均：往前 7 個日曆天（含今天）的淨銷售 ÷ 7
      const d7 = daily([fromDayNum(d0 - 6), D]);
      const avg7 = last30.map((d) => { let s2 = 0; for (let k = 0; k < 7; k++) s2 += (d7.get(fromDayNum(dayNum(d) - k)) || {}).net || 0; return s2 / 7; });
      Charts.render($('#tdDayChart'), { type: 'combo', labels: last30.map((d) => `${Math.floor(d / 100) % 100}/${d % 100}`), series: [{ name: '每天', kind: 'bar', cls: 'c1', values: last30.map((d) => (m30.get(d) || {}).net || 0) }, { name: '7 天平均', kind: 'line', cls: 'c2', values: avg7 }], fmt: fmt.money, axisFmt: fmt.axis, title: '最近 30 天每天的淨銷售' });
    };
    drawCharts();

    // ---------- 本月各業務 ----------
    const byRep = (r) => new Map(E.pivot({ rows: ['rep'], cols: null, measures: ['net', 'sales', 'profit', 'custs'], filter: { dFrom: r[0], dTo: r[1] } }).rows.map((x) => [x.labels[0], x.vals[0]]));
    const rM = byRep(R.mtd), rP = hasPm ? byRep(R.pmtd) : new Map(), rL = hasLm ? byRep(R.lmtd) : new Map(), rD = byRep(R.day);
    const reps = [...new Set([...rM.keys(), ...rP.keys(), ...rL.keys()])].map((k) => {
      const v = rM.get(k) || [0, 0, 0, 0];
      return { rep: k, label: repName(k), today: (rD.get(k) || [0])[0], net: v[0], share: rate(v[0], T.mtd.net), margin: rate(v[2], v[1]), custs: v[3],
        pnet: (rP.get(k) || [0])[0], lnet: (rL.get(k) || [0])[0] };
    }).sort((a, b) => b.net - a.net);
    const rcols = [
      { key: 'label', label: '業務員', cls: 'lbl' },
      { key: 'today', label: `${m}/${dd} 當天`, n: 1, fmt: 'money' },
      { key: 'net', label: '本月累計', n: 1, fmt: 'money' },
      { key: 'share', label: '佔比', n: 1, fmt: 'pct' },
    ];
    if (hasPm) rcols.push({ key: 'pnet', label: '上月同期', n: 1, fmt: 'money' }, { key: 'pchg', label: '比上月', n: 1, render: (r) => (r.pnet ? arrow(chg(r.net, r.pnet)) : '<span class="muted">—</span>') });
    if (hasLm) rcols.push({ key: 'lnet', label: '去年同月同期', n: 1, fmt: 'money' }, { key: 'lchg', label: '比去年', n: 1, render: (r) => (r.lnet ? arrow(chg(r.net, r.lnet)) : '<span class="muted">新</span>') });
    rcols.push({ key: 'margin', label: '毛利率', n: 1, fmt: 'pct' }, { key: 'custs', label: '客戶數', n: 1, fmt: 'int' });
    table($('#tdReps'), rcols, reps, { limit: 30, onRow: (r) => ctx.goRep(r.rep), empty: '這個月還沒有資料' });
    Charts.donut($('#tdRepPie'), { items: reps.filter((r) => r.net > 0).map((r) => ({ label: r.label, value: r.net, cls: ctx.colorOf('rep', r.rep), rep: r.rep })), fmt: fmt.big, title: '各業務佔本月的比例', center: { value: fmt.big(T.mtd.net), label: '本月' }, onClick: (d) => ctx.goRep(d.rep) });
    Charts.hbars($('#tdRepBars'), { rows: reps.map((r) => ({ label: r.label, value: r.net, prev: hasPm ? r.pnet : null, cls: ctx.colorOf('rep', r.rep), rep: r.rep, note: hasPm && r.pnet ? arrow(chg(r.net, r.pnet)) : '' })), fmt: fmt.big, prevLabel: '上月同期', onClick: (r) => ctx.goRep(r.rep) });
    $('#tdAllReps').onclick = (e) => { e.preventDefault(); ctx.goRep(null); };

    // ---------- 本月前 10 大客戶 ----------
    const cM = E.pivot({ rows: ['ck'], cols: null, measures: ['net'], filter: { dFrom: R.mtd[0], dTo: R.mtd[1] } });
    const cL = hasLm ? new Map(E.pivot({ rows: ['ck'], cols: null, measures: ['net'], filter: { dFrom: R.lmtd[0], dTo: R.lmtd[1] } }).rows.map((x) => [x.codes[0], x.vals[0][0]])) : new Map();
    const ckD = E.ds.str.ck.dict;
    const top = cM.rows.map((x) => ({ ck: x.codes[0], name: ckD[x.codes[0]], net: x.vals[0][0], lnet: cL.get(x.codes[0]) || 0 })).sort((a, b) => b.net - a.net).slice(0, 10);
    const ccols = [{ key: 'name', label: '客戶', cls: 'lbl' }, { key: 'net', label: '本月累計', n: 1, fmt: 'money' }, { key: 'share', label: '佔比', n: 1, render: (r) => fmt.pct(rate(r.net, T.mtd.net)) }];
    if (hasLm) ccols.push({ key: 'lnet', label: '去年同月同期', n: 1, fmt: 'money' }, { key: 'x', label: '變化', n: 1, render: (r) => (r.lnet ? arrow(chg(r.net, r.lnet)) : '<span class="muted">新</span>') });
    const openCk = (r) => { const c = E.customers({ dims: { ck: new Set([r.ck]) } }, ctx.refYm()).list[0]; if (c) ctx.openCustomer(c); };
    void ccols;
    Charts.hbars($('#tdCust'), { rows: top.map((r) => ({ label: r.name, value: r.net, prev: hasLm ? r.lnet : null, ck: r.ck, cls: 'c1', note: hasLm ? (r.lnet ? arrow(chg(r.net, r.lnet)) : '<span class="muted">新</span>') : '' })), fmt: fmt.big, prevLabel: '去年同月同期', onClick: openCk, limit: 10 });

    // ---------- 當天的單 ----------
    const od = E.pivot({ rows: ['ord', 'src', 'ck', 'rep'], cols: null, measures: ['sales', 'returns', 'rows'], filter: { dFrom: D, dTo: D } });
    const ords = od.rows.map((x) => ({ ord: x.labels[0], src: x.labels[1], ck: x.codes[2], name: x.labels[2], rep: x.labels[3], amt: x.vals[0][0] - x.vals[0][1], lines: x.vals[0][2] })).sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt));
    table($('#tdOrders'), [
      { key: 'ord', label: '單號' }, { key: 'src', label: '' }, { key: 'name', label: '客戶', cls: 'lbl' },
      { key: 'rep', label: '業務', render: (r) => esc(repName(r.rep)) }, { key: 'lines', label: '品項', n: 1, fmt: 'int' }, { key: 'amt', label: '金額', n: 1, fmt: 'money' },
    ], ords, { limit: 15, onRow: openCk, empty: '這一天沒有單' });

    return { mode: 'day', date: D, T, reps: reps.map((r) => ({ rep: r.rep, net: r.net, pnet: r.pnet, lnet: r.lnet })), redraw: drawCharts };
  }

  root.Today = { render };
})(window);

/* 儀表板（試看）：依 Dashboard Design skill 做的三個版面，讓使用者挑選。
   共同原則（skill 的規則）：一個畫面只回答一個問題、3 秒看懂；每個大數字都有一個比較基準；
   問題直接標在資料上（暖色），說明放在滑鼠提示裡，畫面上不寫長句子；顏色跟著名稱。
   A 經營概況：業績有沒有成長？是誰帶動的？（重點數字可以點，下面的大圖跟著換）
   B 每日監控：現在有沒有要處理的問題？（業務 × 月份的熱度表，掉下來的格子標暖色）
   C 業績結構：錢從哪裡來？（堆疊長條、圓餅、各業務的大類組成） */
(function (root) {
  const { ymLabel, dayNum, daysInMonth } = root.EngineMeta;
  const MS = ['sales', 'returns', 'net', 'profit', 'netProfit', 'orders', 'custs'];
  const obj = (v) => { const o = {}; MS.forEach((k, i) => { o[k] = v ? v[i] || 0 : 0; }); return o; };
  const rate = (a, b) => (b ? a / b : null);
  const chg = (a, b) => (b ? (a - b) / Math.abs(b) : null);
  const METRIC = {
    net: { label: '淨銷售', f: (v) => v.net, kind: 'money', up: true },
    netProfit: { label: '毛利（扣退貨）', f: (v) => v.netProfit, kind: 'money', up: true },
    margin: { label: '總毛利率', f: (v) => rate(v.profit, v.sales), kind: 'pct', up: true },
    retRate: { label: '退貨率', f: (v) => rate(v.returns, v.sales), kind: 'pct', up: false },
    custs: { label: '交易客戶', f: (v) => v.custs, kind: 'int', up: true },
  };
  const OPTS = [{ v: 'A', label: 'A 經營概況' }, { v: 'B', label: 'B 每日監控' }, { v: 'C', label: 'C 業績結構' }];
  const PERS = [{ v: 'month', label: '本月' }, { v: 'ytd', label: '今年' }, { v: 'r12', label: '近 12 個月' }];

  function render(ctx) {
    const { S, E, fmt, nf0, nf1, esc, $, Charts, repName, colorOf } = ctx;
    const st = S.board;
    const ref = ctx.refYm();
    const { addM, range, periodText } = root.Dashboard;
    const { F, P, hasPrev } = range(E, ref, st.period);
    const seg = (id, list, cur) => `<div class="seg" id="${id}">${list.map((x) => `<button data-v="${x.v}" class="${x.v === cur ? 'on' : ''}">${x.label}</button>`).join('')}</div>`;
    $('#bdHead').innerHTML = seg('bdOpt', OPTS, st.opt) + (st.opt === 'B' ? '' : seg('bdPer', PERS, st.period));
    $('#bdOpt').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.opt = b.dataset.v; ctx.save(); ctx.rerender(); } };
    if ($('#bdPer')) $('#bdPer').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.period = b.dataset.v; ctx.save(); ctx.rerender(); } };
    const vfmt = (k, v) => (v == null ? '—' : METRIC[k].kind === 'pct' ? fmt.pct(v) : METRIC[k].kind === 'int' ? nf0.format(v) : fmt.big(v));
    // 變化小標籤：金額用 %，比率用百分點；基數太小（< 5）不顯示紅綠
    const delta = (k, x, px, base = '去年') => {
      if (x == null || px == null) return `<span class="bd-delta muted">${base} —</span>`;
      const pct = METRIC[k].kind === 'pct', d = pct ? x - px : chg(x, px);
      if (d == null || !isFinite(d)) return `<span class="bd-delta muted">${base} ${vfmt(k, px)}</span>`;
      if (!pct && Math.abs(px) < 5) return `<span class="bd-delta muted">${base} ${vfmt(k, px)}</span>`;
      const good = (d >= 0) === METRIC[k].up, flat = Math.abs(d) < 0.0005;
      return `<span class="bd-delta ${flat ? 'muted' : good ? 'good' : 'bad'}" title="${base}：${vfmt(k, px)}">${d >= 0 ? '▲' : '▼'} ${pct ? nf1.format(Math.abs(d * 100)) + ' 點' : fmt.pct(Math.abs(d))}<small>${base}</small></span>`;
    };
    // 迷你走勢線（近 12 個月）
    const spark = (vals, cls = 'c1') => {
      const v = vals.map((x) => (x == null ? null : x)); const ok = v.filter((x) => x != null);
      if (ok.length < 2) return '';
      const mn = Math.min(...ok), mx = Math.max(...ok), sp = mx - mn || 1;
      let d = '', pen = false;
      v.forEach((x, i) => { if (x == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${(i / (v.length - 1) * 100).toFixed(1)},${(26 - (x - mn) / sp * 22).toFixed(1)}`; pen = true; });
      return `<svg class="bd-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" style="stroke:var(--${cls})"/></svg>`;
    };
    const months12 = Array.from({ length: 12 }, (_, i) => addM(ref, i - 11));
    const byYm = (dims = {}) => new Map(E.pivot({ rows: ['ym'], cols: null, measures: MS, filter: { dims } }).rows.map((r) => [E.ymList[r.codes[0]], obj(r.vals[0])]));
    const tot = (r, dims = {}) => obj(E.pivot({ rows: [], cols: null, measures: MS, filter: { ymFrom: r[0], ymTo: r[1], dims } }).grand);
    const rowsBy = (dim, r) => E.pivot({ rows: [dim], cols: null, measures: MS, filter: { ymFrom: r[0], ymTo: r[1] } }).rows.map((x) => ({ code: x.codes[0], label: x.labels[0] || '（空白）', ...obj(x.vals[0]) }));
    const box = $('#bdBody');
    const out = { opt: st.opt };

    // =========================================================
    if (st.opt === 'A') {
      const cur = tot(F), prev = hasPrev ? tot(P) : null, mon = byYm();
      const keys = ['net', 'netProfit', 'margin', 'retRate', 'custs'];
      const sel = keys.includes(st.metric) ? st.metric : 'net';
      box.innerHTML = `<div class="bd-q">業績有沒有成長？是誰帶動的？<small>${periodText(F)}${hasPrev ? `，和去年同期比` : ''}</small></div>
        <div class="bd-kpis">${keys.map((k) => `<button class="bd-kpi${k === sel ? ' on' : ''}" data-k="${k}" title="點一下，下面的圖改看「${METRIC[k].label}」">
          <span class="k">${METRIC[k].label}</span><span class="v">${vfmt(k, METRIC[k].f(cur))}</span>${delta(k, METRIC[k].f(cur), prev ? METRIC[k].f(prev) : null)}
          ${spark(months12.map((m) => (mon.has(m) ? METRIC[k].f(mon.get(m)) : null)), k === sel ? 'c1' : 's3')}</button>`).join('')}</div>
        <div class="panel"><div class="panel-head"><h2>${METRIC[sel].label}：近 12 個月</h2><span class="legend-inline muted">長條 今年・虛線 前一年同月</span></div><div class="chart" id="bdMain"></div></div>
        <div class="bd-grid4">
          <div class="panel"><div class="panel-head"><h2>區域</h2></div><div id="bdRegion"></div></div>
          <div class="panel"><div class="panel-head"><h2>商品大類</h2></div><div id="bdBig"></div></div>
          <div class="panel"><div class="panel-head"><h2>業務</h2></div><div id="bdRep"></div></div>
          <div class="panel"><div class="panel-head"><h2>前 10 大客戶</h2></div><div id="bdCust"></div></div></div>`;
      box.querySelectorAll('.bd-kpi').forEach((b) => { b.onclick = () => { st.metric = b.dataset.k; ctx.save(); ctx.rerender(); }; });
      const m = METRIC[sel];
      const draw = () => Charts.render($('#bdMain'), { type: 'combo', labels: months12.map(ymLabel),
        series: [{ name: m.label, kind: 'bar', cls: 'c1', values: months12.map((x) => (mon.has(x) ? m.f(mon.get(x)) : null)) },
          { name: '前一年同月', kind: 'line', dash: true, cls: 's3', values: months12.map((x) => (mon.has(x - 100) ? m.f(mon.get(x - 100)) : null)) }],
        fmt: (v) => vfmt(sel, v), axisFmt: m.kind === 'pct' ? (v) => nf1.format(v * 100) + '%' : m.kind === 'int' ? (v) => nf0.format(v) : fmt.axis, title: m.label });
      draw(); out.redraw = draw;
      const pie = (dim, el) => Charts.donut($(el), { items: rowsBy(dim, F).map((r) => ({ label: r.label, value: r.net, cls: colorOf(dim, r.label) })), fmt: fmt.big, title: dim, onClick: (d) => { const r = rowsBy(dim, F).find((x) => x.label === d.label); if (r) ctx.drill(dim, r.code, r.label); } });
      pie('region', '#bdRegion'); pie('big', '#bdBig');
      const pRep = hasPrev ? new Map(rowsBy('rep', P).map((r) => [r.label, r.net])) : new Map();
      Charts.hbars($('#bdRep'), { rows: rowsBy('rep', F).sort((a, b) => b.net - a.net).map((r) => ({ label: repName(r.label === '（空白）' ? '' : r.label), rep: r.label, value: r.net, prev: hasPrev ? pRep.get(r.label) || 0 : null, cls: colorOf('rep', r.label) })), fmt: fmt.big, onClick: (r) => ctx.goRep(r.rep === '（空白）' ? '' : r.rep), limit: 8 });
      const pC = hasPrev ? new Map(rowsBy('ck', P).map((r) => [r.code, r.net])) : new Map();
      Charts.hbars($('#bdCust'), { rows: rowsBy('ck', F).sort((a, b) => b.net - a.net).slice(0, 10).map((r) => ({ label: r.label, code: r.code, value: r.net, prev: hasPrev ? pC.get(r.code) || 0 : null, cls: ctx.custColor(r.code) })), fmt: fmt.big, onClick: (r) => ctx.drill('ck', r.code, r.label), limit: 10 });
      Object.assign(out, { cur, prev, metric: sel });
    }

    // =========================================================
    if (st.opt === 'B') {
      // 本月到今天（有實際日期）或基準月（沒有日期）
      const D = E.maxSalesDate, dated = !!D;
      const ym = dated ? Math.floor(D / 100) : ref, dd = dated ? D % 100 : daysInMonth(ref), dim = daysInMonth(ym), pm = addM(ym, -1), lm = ym - 100;
      const same = (yy) => yy * 100 + Math.min(dd, daysInMonth(yy));
      const tD = (a, b) => obj(E.pivot({ rows: [], cols: null, measures: MS, filter: dated ? { dFrom: a, dTo: b } : { ymFrom: Math.floor(a / 100), ymTo: Math.floor(b / 100) } }).grand);
      const mtd = tD(ym * 100 + 1, dated ? D : ym * 100 + 31), pmtd = tD(pm * 100 + 1, same(pm)), lmFull = tD(lm * 100 + 1, lm * 100 + 31);
      const pace = dated && dd < dim ? mtd.net / dd * dim : mtd.net;
      const allC = E.customers({}, ref).list;
      const due = dated ? allC.filter((c) => c.freq != null && c.buyDays >= 3 && c.lastDate && c.lastDate <= D).map((c) => ({ ...c, since: dayNum(D) - dayNum(c.lastDate) })).filter((c) => c.since > c.freq * 1.5 && c.since <= 180).sort((a, b) => b.sales - a.sales) : [];
      const lost = allC.filter((c) => c.idle >= 2 && c.idle <= 6 && c.sales > 0).sort((a, b) => b.sales - a.sales);
      const rrNow = rate(mtd.returns, mtd.sales), rrPrev = rate(pmtd.returns, pmtd.sales);
      const target = lmFull.net, pctT = target > 0 ? pace / target : null;
      const bullet = target > 0 ? `<div class="bd-bullet" title="本月預估 ${fmt.money(pace)}；去年同月全月 ${fmt.money(target)}"><i class="bb-bar" style="width:${Math.min(100, pace / Math.max(pace, target) * 100)}%"></i><i class="bb-mark" style="left:${Math.min(100, target / Math.max(pace, target) * 100)}%"></i></div>` : '';
      box.innerHTML = `<div class="bd-q">現在有沒有要處理的問題？<small>${dated ? `資料到 ${root.EngineMeta.dayLabel(D)}` : `${ymLabel(ref)}（沒有實際日期，用月份）`}</small></div>
        <div class="bd-kpis">
          <div class="bd-kpi"><span class="k">本月到今天</span><span class="v">${fmt.big(mtd.net)}</span>${delta('net', mtd.net, pmtd.sales ? pmtd.net : null, '上月同期')}</div>
          <div class="bd-kpi"><span class="k">本月預估</span><span class="v">${fmt.big(pace)}</span>${bullet}<span class="bd-delta ${pctT == null ? 'muted' : pctT >= 1 ? 'good' : 'bad'}" title="和去年同月全月比">${pctT == null ? '去年 —' : `${fmt.pct(pctT)}<small>去年全月</small>`}</span></div>
          <div class="bd-kpi"><span class="k">本月退貨率</span><span class="v">${fmt.pct(rrNow)}</span>${delta('retRate', rrNow, rrPrev, '上月')}</div>
          <div class="bd-kpi${due.length ? ' warn' : ''}"><span class="k">該來買沒來</span><span class="v">${dated ? nf0.format(due.length) + ' 位' : '—'}</span><span class="bd-delta muted" title="超過平常購買間隔 1.5 倍還沒來買的客戶（需要實際日期）">${dated ? '超過平常間隔' : '需要實際日期'}</span></div>
          <div class="bd-kpi${lost.length ? ' warn' : ''}"><span class="k">2～6 個月沒來</span><span class="v">${nf0.format(lost.length)} 位</span><span class="bd-delta muted" title="最近一次交易在 2～6 個月前、過去有買的客戶">合計 ${fmt.big(lost.reduce((s2, c) => s2 + c.sales, 0))}</span></div>
        </div>
        <div class="panel"><div class="panel-head"><h2>業務 × 月份</h2><span class="legend-inline"><i class="hm-key"></i>越深越多　<i class="hm-key warn"></i>比自己前 6 個月平均少 30% 以上</span></div><div id="bdHeat" class="db-scroll"></div></div>
        <div class="grid2"><div class="panel"><div class="panel-head"><h2>該來買沒來</h2></div><div id="bdDue" class="db-scroll"></div></div>
          <div class="panel"><div class="panel-head"><h2>2～6 個月沒來</h2></div><div id="bdLost" class="db-scroll"></div></div></div>`;
      // 熱度表：每位業務近 12 個月；比自己前 6 個月平均少 30% 以上 → 暖色
      const reps = E.pivot({ rows: ['rep'], cols: null, measures: ['net'], filter: { ymFrom: months12[0], ymTo: ref } }).rows.map((r) => r.labels[0]).sort((a, b) => (+a || 9e9) - (+b || 9e9));
      const hm = new Map(); E.pivot({ rows: ['rep', 'ym'], cols: null, measures: ['net'], filter: { ymFrom: addM(months12[0], -6), ymTo: ref } }).rows.forEach((r) => hm.set(r.labels[0] + '|' + E.ymList[r.codes[1]], r.vals[0][0]));
      const mx = Math.max(1, ...reps.flatMap((r) => months12.map((m) => hm.get(r + '|' + m) || 0)));
      let warn = 0;
      $('#bdHeat').innerHTML = `<table class="bd-heat"><tr><th></th>${months12.map((m) => `<th>${m % 100}月</th>`).join('')}</tr>${reps.map((r) => `<tr><th class="rl"><a href="#reps" data-rep="${esc(r)}">${esc(repName(r))}</a></th>${months12.map((m) => {
        const v = hm.get(r + '|' + m) || 0;
        const base = [1, 2, 3, 4, 5, 6].map((k) => hm.get(r + '|' + addM(m, -k)) || 0); const avg = base.reduce((a, b) => a + b, 0) / 6;
        const bad = avg > 0 && v < avg * 0.7 && E.ymIndex.has(m); if (bad) warn++;
        return `<td class="${bad ? 'warn' : ''}" style="--h:${Math.max(0, v / mx).toFixed(2)}" title="${esc(repName(r))} ${ymLabel(m)}：${fmt.money(v)}${avg ? `（前 6 個月平均 ${fmt.money(avg)}）` : ''}">${v ? fmt.axis(v) : ''}</td>`;
      }).join('')}</tr>`).join('')}</table>`;
      $('#bdHeat').onclick = (e) => { const a = e.target.closest('a[data-rep]'); if (a) { e.preventDefault(); ctx.goRep(a.dataset.rep); } };
      const ccols = (extra) => [{ key: 'name', label: '客戶', cls: 'lbl', get: (r) => r.code + ' ' + r.name }, { key: 'rep', label: '業務', render: (r) => esc(repName(r.rep)) }, ...extra, { key: 'sales', label: '歷史銷貨', n: 1, fmt: 'money' }];
      ctx.table($('#bdDue'), ccols([{ key: 'freq', label: '平常', n: 1, render: (r) => nf0.format(r.freq) + ' 天' }, { key: 'since', label: '已經', n: 1, render: (r) => `<b class="down">${nf0.format(r.since)} 天</b>` }]), due, { limit: 8, onRow: (r) => ctx.openCustomer(r), empty: dated ? '沒有' : '需要實際出貨日期' });
      ctx.table($('#bdLost'), ccols([{ key: 'last', label: '最近', fmt: 'ym' }, { key: 'idle', label: '沒來', n: 1, render: (r) => `<b class="down">${r.idle} 個月</b>` }]), lost, { limit: 8, onRow: (r) => ctx.openCustomer(r), empty: '沒有' });
      Object.assign(out, { mtd, pace, due: due.length, lost: lost.length, warn, reps: reps.length });
    }

    // =========================================================
    if (st.opt === 'C') {
      const cur = tot(F);
      const bigs = rowsBy('big', [months12[0], ref]).sort((a, b) => b.net - a.net).map((r) => r.label);
      const bm = new Map(); E.pivot({ rows: ['big', 'ym'], cols: null, measures: ['net'], filter: { ymFrom: months12[0], ymTo: ref } }).rows.forEach((r) => bm.set((r.labels[0] || '（空白）') + '|' + E.ymList[r.codes[1]], r.vals[0][0]));
      const reps = rowsBy('rep', F).sort((a, b) => b.net - a.net).slice(0, 8);
      const rb = new Map(); E.pivot({ rows: ['rep', 'big'], cols: null, measures: ['net'], filter: { ymFrom: F[0], ymTo: F[1] } }).rows.forEach((r) => rb.set(r.labels[0] + '|' + (r.labels[1] || '（空白）'), r.vals[0][0]));
      const custs = rowsBy('ck', F).sort((a, b) => b.net - a.net);
      const top10 = rate(custs.slice(0, 10).reduce((s2, r) => s2 + r.net, 0), cur.net);
      box.innerHTML = `<div class="bd-q">錢從哪裡來？<small>${periodText(F)}</small></div>
        <div class="bd-kpis three">
          <div class="bd-kpi"><span class="k">淨銷售</span><span class="v">${fmt.big(cur.net)}</span><span class="bd-delta muted">毛利（扣退貨） ${fmt.big(cur.netProfit)}</span></div>
          <div class="bd-kpi"><span class="k">總毛利率</span><span class="v">${fmt.pct(rate(cur.profit, cur.sales))}</span><span class="bd-delta muted">退貨率 ${fmt.pct(rate(cur.returns, cur.sales))}</span></div>
          <div class="bd-kpi${top10 > 0.5 ? ' warn' : ''}"><span class="k">前 10 大客戶佔</span><span class="v">${fmt.pct(top10)}</span><span class="bd-delta muted" title="超過 50% 代表太依賴少數客戶">共 ${nf0.format(custs.length)} 位</span></div></div>
        <div class="panel"><div class="panel-head"><h2>每月淨銷售，依商品大類</h2></div><div class="chart" id="bdStack"></div></div>
        <div class="bd-grid3">
          <div class="panel"><div class="panel-head"><h2>區域</h2></div><div id="bdRegion"></div></div>
          <div class="panel"><div class="panel-head"><h2>業務</h2></div><div id="bdRepPie"></div></div>
          <div class="panel"><div class="panel-head"><h2>商品大類</h2></div><div id="bdBigPie"></div></div></div>
        <div class="grid2"><div class="panel"><div class="panel-head"><h2>各業務賣什麼</h2></div><div class="chart" id="bdRepBig"></div></div>
          <div class="panel"><div class="panel-head"><h2>前 12 個款號</h2></div><div id="bdStyle"></div></div></div>`;
      const draw = () => {
        Charts.render($('#bdStack'), { type: 'stacked', labels: months12.map(ymLabel), series: bigs.map((b) => ({ name: b, cls: colorOf('big', b), values: months12.map((m) => bm.get(b + '|' + m) || 0) })), fmt: fmt.money, axisFmt: fmt.axis, title: '每月淨銷售，依商品大類' });
        Charts.render($('#bdRepBig'), { type: 'stacked', labels: reps.map((r) => repName(r.label === '（空白）' ? '' : r.label)), series: bigs.map((b) => ({ name: b, cls: colorOf('big', b), values: reps.map((r) => rb.get(r.label + '|' + b) || 0) })), fmt: fmt.money, axisFmt: fmt.axis, title: '各業務賣什麼' });
      };
      draw(); out.redraw = draw;
      Charts.donut($('#bdRegion'), { items: rowsBy('region', F).map((r) => ({ label: r.label, value: r.net, cls: colorOf('region', r.label) })), fmt: fmt.big, title: '區域' });
      Charts.donut($('#bdRepPie'), { items: rowsBy('rep', F).map((r) => ({ label: repName(r.label === '（空白）' ? '' : r.label), value: r.net, cls: colorOf('rep', r.label), rep: r.label })), fmt: fmt.big, title: '業務', onClick: (d) => ctx.goRep(d.rep === '（空白）' ? '' : d.rep) });
      Charts.donut($('#bdBigPie'), { items: rowsBy('big', F).map((r) => ({ label: r.label, value: r.net, cls: colorOf('big', r.label) })), fmt: fmt.big, title: '商品大類' });
      // 款號：顏色 = 這個款號的大類
      const sb = new Map(); E.pivot({ rows: ['style', 'big'], cols: null, measures: ['net'], filter: { ymFrom: F[0], ymTo: F[1] } }).rows.forEach((r) => { const k = r.labels[0]; if (!sb.has(k) || sb.get(k)[1] < r.vals[0][0]) sb.set(k, [r.labels[1], r.vals[0][0]]); });
      Charts.hbars($('#bdStyle'), { rows: rowsBy('style', F).sort((a, b) => b.net - a.net).slice(0, 12).map((r) => ({ label: r.label, code: r.code, value: r.net, cls: colorOf('big', (sb.get(r.label) || [''])[0]), note: `<span class="muted">${esc((sb.get(r.label) || [''])[0])}</span>` })), fmt: fmt.big, onClick: (r) => ctx.drill('style', r.code, r.label), limit: 12 });
      Object.assign(out, { cur, top10, bigs });
    }
    return out;
  }

  root.Board = { render };
})(window);

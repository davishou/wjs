/* 儀表板：重點提醒、核心數字、排名與毛利貢獻、佔比、毛利率／退貨率比較、損益兩平、應收帳款天數、客戶動態、商品結構、缺少的資料。
   每一區都附「這代表什麼／該注意什麼」。所有計算都在瀏覽器內用 Engine 完成。 */
(function (root) {
  const { ymLabel, ymDiff } = root.EngineMeta;

  // 年月加減 k 個月（民國年月，例如 11401 + (-1) = 11312）
  const addM = (ym, k) => { let y = Math.floor(ym / 100), m = ym % 100 + k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y * 100 + m; };
  const M = ['sales', 'returns', 'net', 'profit', 'netProfit', 'orders', 'soldQty'];
  const PERIODS = [
    { v: 'month', label: '基準月' }, { v: 'ytd', label: '今年累計' }, { v: 'r12', label: '近 12 個月' }, { v: 'all', label: '全部期間' },
  ];
  // 排名可選的維度
  const RANK_DIMS = [
    { key: 'ck', label: '客戶' }, { key: 'style', label: '商品（款號）' }, { key: 'rep', label: '業務員' },
    { key: 'region', label: '區域' }, { key: 'big', label: '商品大類' }, { key: 'cat', label: '商品類別' },
  ];

  // 說明文字：代表什麼／該注意什麼
  const HELP = {
    net: ['銷貨金額減掉退貨金額，也就是這段期間實際賣出去的金額。', '和去年同期比較最準（避開淡旺季）。連續幾個月下滑，就要從下面的排名找出是哪些客戶、業務或商品掉下來。'],
    netProfit: ['淨銷售扣掉商品成本後賺到的錢（毛利），已扣掉退貨的部分。', '銷售成長但毛利沒跟著成長，代表賣的多是低毛利商品或折扣變多。'],
    margin: ['每賣 100 元，扣掉商品成本後剩多少。算法：毛利 ÷ 銷貨金額（和總覽、Excel 相同，未扣退貨）。', '比去年同期下降 1 個百分點以上就要注意：可能是進貨成本上漲、折扣變多，或低毛利商品賣得比較多。'],
    retRate: ['退貨金額 ÷ 銷貨金額。', '比去年同期高，或某個客戶、商品特別高，要查原因：品質、尺寸不合、出錯貨，或客戶壓庫存後退回。'],
    orders: ['有開出貨單的張數，以及平均每張單的金額。', '單數變少但每單變大，可能是客戶改成一次叫多一點；單數和每單金額都變少，就要注意客戶在流失。'],
    custs: ['這段期間有買東西的客戶數，以及其中第一次跟我們買的新客戶。', '交易客戶數下滑代表客戶在流失；新客戶太少，長期業績會越來越依賴老客戶。'],
    top10: ['銷售額前 10 大客戶加起來佔全部淨銷售的比例。', '超過 50% 代表太依賴少數大客戶，其中一家減少叫貨，業績就會明顯下滑。'],
    rank: ['依淨銷售或毛利貢獻排序。「佔比」是佔全部淨銷售的比例，「累計」是從第一名加到這一名的比例；「毛利貢獻」是這一項賺到的淨毛利，「毛利貢獻率」是佔全部淨毛利的比例。', '銷售排名高、但毛利貢獻率明顯低於銷售佔比的，代表賣很多但不太賺錢（價格太低或退貨多）。反過來，毛利貢獻率高於銷售佔比的，是值得多推的對象。'],
    share: ['各區域、商品大類、商品類別佔淨銷售（深色）和淨毛利（淺色）的比例。', '某一塊的毛利比例明顯低於銷售比例，代表那一塊比較不賺錢。比例和去年差很多時，要看是那一塊成長，還是其他塊衰退。'],
    compare: ['毛利率和退貨率按年、季、月排開，同一欄上下比較就是「和去年同期比」。▲▼ 是和前一年同期相差幾個百分點。', '毛利率看紅色的 ▼（變差），退貨率看紅色的 ▲（變差）。同一個月份每年都偏高或偏低，是季節性；只有今年異常，才需要追原因。'],
    bep: ['損益兩平（BEP）：每個月至少要賣到多少淨銷售，賺的毛利才夠付固定費用（房租、薪資、保險、水電等不論賣多少都要付的錢）。算法：每月固定費用 ÷ 淨毛利率。', '這裡假設除了商品成本以外沒有其他「賣越多花越多」的費用；如果有運費、佣金等，實際的損益兩平會更高。安全邊際越低，業績稍微下滑就會虧損。'],
    dso: ['應收帳款天數：客戶平均要多少天才付款。算法：應收帳款餘額 ÷ 近 3 個月淨銷售 × 91 天。', '比給客戶的收款條件（例如月結 60 天）長很多，代表有客戶拖款，資金會被卡住。超過 90 天要特別注意呆帳風險。'],
    custMove: ['新客戶：這段期間第一次跟我們買。可能流失：去年同期有買、這段期間都沒買的客戶。衰退的大客戶：去年同期前 20 大、今年少了 30% 以上。', '可能流失和衰退的大客戶，請業務主動聯絡了解原因。'],
    abc: ['把款號依淨銷售由高到低排，看要幾個款號就能做到 80% 的業績（ABC 分析）；新品是這段期間才第一次賣出的款號。', '少數款號撐起大部分業績時，這些款號要確保不缺貨；很多款號只賣一點點，可以考慮精簡。退貨率高的款號要檢查品質或尺寸。'],
  };

  function render(ctx) {
    const { S, E, fmt, nf0, nf1, esc, $, $$, table, Charts, refYm, repName } = ctx;
    const ref = refYm();
    const per = S.dash.period;
    const y = Math.floor(ref / 100), mo = ref % 100;
    let F, P;
    if (per === 'month') { F = [ref, ref]; P = [addM(ref, -12), addM(ref, -12)]; }
    else if (per === 'ytd') { F = [y * 100 + 1, ref]; P = [(y - 1) * 100 + 1, (y - 1) * 100 + mo]; }
    else if (per === 'r12') { F = [addM(ref, -11), ref]; P = [addM(ref, -23), addM(ref, -12)]; }
    else { F = [E.minYm, E.maxYm]; P = null; }
    const hasPrev = P && E.ymList.some((v) => v >= P[0] && v <= P[1]);
    const fil = (r) => ({ ymFrom: r[0], ymTo: r[1] });
    const periodText = (r) => (r[0] === r[1] ? ymLabel(r[0]) : `${ymLabel(r[0])}～${ymLabel(r[1])}`);

    // ---------- 計算 ----------
    const tot = (r) => { const g = E.pivot({ rows: [], cols: null, measures: M, filter: fil(r) }).grand; const o = {}; M.forEach((k, i) => { o[k] = g[i] || 0; }); return o; };
    const cur = tot(F), prev = hasPrev ? tot(P) : null;
    const rate = (a, b) => (b ? a / b : null);
    const mg = (t) => (t ? rate(t.profit, t.sales) : null), rr = (t) => (t ? rate(t.returns, t.sales) : null);
    const allCust = E.customers({}, ref).list;
    const custIn = (r) => E.customers(fil(r), ref).list; // 期間內的客戶（只算進貨）
    const cCur = custIn(F), cPrev = hasPrev ? custIn(P) : [];
    const firstOf = new Map(allCust.map((c) => [c.ck, c.first]));
    const newCust = cCur.filter((c) => firstOf.get(c.ck) >= F[0] && firstOf.get(c.ck) <= F[1]);
    const prevNewCust = hasPrev ? cPrev.filter((c) => firstOf.get(c.ck) >= P[0] && firstOf.get(c.ck) <= P[1]) : [];
    const byNet = cCur.slice().sort((a, b) => b.net - a.net);
    const top10 = byNet.slice(0, 10).reduce((s, c) => s + c.net, 0);
    const top10Share = rate(top10, cur.net);
    const prevByNet = cPrev.slice().sort((a, b) => b.net - a.net);
    const prevTop10Share = hasPrev ? rate(prevByNet.slice(0, 10).reduce((s, c) => s + c.net, 0), prev.net) : null;
    // 期間內每月的資料月數（算每月平均用）
    const monthsIn = E.ymList.filter((v) => v >= F[0] && v <= F[1]);
    // 本月是否未滿月
    const cntOf = (ym) => E.pivot({ rows: [], cols: null, measures: ['rows'], filter: { src: 'sales', ymFrom: ym, ymTo: ym } }).grand[0];
    const partial = ref === E.maxYm && cntOf(ref) < cntOf(addM(ref, -1)) * 0.6;

    // ---------- 小工具 ----------
    const chgPct = (a, b) => (b ? (a - b) / Math.abs(b) : null);
    const arrow = (d, goodUp = true, kind = 'pct') => {
      if (d == null || !isFinite(d)) return '<span class="muted">—</span>';
      const up = d >= 0, good = up === goodUp;
      const txt = kind === 'pp' ? nf1.format(Math.abs(d * 100)) + ' 個百分點' : fmt.pct(Math.abs(d));
      return `<span class="${Math.abs(d) < 1e-9 ? '' : good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${txt}</span>`;
    };
    const help = (k) => `<details class="explain"><summary>這代表什麼？該注意什麼？</summary><div class="pop"><p><b>代表：</b>${HELP[k][0]}</p><p><b>注意：</b>${HELP[k][1]}</p></div></details>`;
    const card = (k, label, val, sub, delta) => `<div class="kpi db-kpi"><div class="k">${label}</div><div class="v">${val}</div><span class="d">${delta || ''}</span>${sub ? `<span class="d">${sub}</span>` : ''}${help(k)}</div>`;
    const vsTxt = hasPrev ? `比去年同期（${periodText(P)}）` : '';

    // ---------- 重點提醒 ----------
    const alerts = []; // {lv:'bad'|'warn'|'good', t, s}
    if (partial && (per === 'month' || per === 'ytd' || per === 'r12')) alerts.push({ lv: 'warn', t: `${ymLabel(ref)} 的資料筆數比上個月少很多，可能還沒滿月`, s: '比較時請把基準月改成上一個完整的月份。' });
    if (hasPrev) {
      const g = chgPct(cur.net, prev.net);
      if (g != null && g <= -0.1) alerts.push({ lv: 'bad', t: `淨銷售比去年同期少 ${fmt.pct(-g)}`, s: '看下面「排名」，切換「比去年同期」排序，找出掉最多的客戶、業務或商品。' });
      else if (g != null && g >= 0.1) alerts.push({ lv: 'good', t: `淨銷售比去年同期成長 ${fmt.pct(g)}`, s: '確認成長是來自少數大客戶，還是普遍成長。' });
      const dm = mg(cur) - mg(prev);
      if (isFinite(dm) && dm <= -0.01) alerts.push({ lv: 'bad', t: `毛利率下降 ${nf1.format(-dm * 100)} 個百分點（${fmt.pct(mg(prev))} → ${fmt.pct(mg(cur))}）`, s: '檢查進貨成本、折扣，以及低毛利商品是否賣得比較多（看排名的「毛利率」欄）。' });
      const dr = rr(cur) - rr(prev);
      if (isFinite(dr) && dr >= 0.01) alerts.push({ lv: 'bad', t: `退貨率上升 ${nf1.format(dr * 100)} 個百分點（${fmt.pct(rr(prev))} → ${fmt.pct(rr(cur))}）`, s: '在「商品結構」看退貨率最高的款號，或到樞紐分析用「類別 × 年 退貨率」。' });
    }
    if (top10Share != null && top10Share > 0.5) alerts.push({ lv: 'warn', t: `前 10 大客戶佔淨銷售 ${fmt.pct(top10Share)}`, s: '太依賴少數客戶，建議分散：開發新客戶、加強中型客戶。' });

    // ---------- 排名 ----------
    function rankRows(dim) {
      const ms = ['sales', 'returns', 'net', 'profit', 'netProfit'];
      const p = E.pivot({ rows: [dim], cols: null, measures: ms, filter: fil(F) });
      const prevMap = new Map();
      if (hasPrev) E.pivot({ rows: [dim], cols: null, measures: ['net', 'netProfit'], filter: fil(P) }).rows.forEach((r) => prevMap.set(r.codes[0], r.vals[0]));
      const totNet = cur.net, totNP = cur.netProfit;
      const rows = p.rows.map((r) => {
        const [s, rt, n, pf, np] = r.vals[0]; const pv = prevMap.get(r.codes[0]);
        let label = r.labels[0];
        if (dim === 'rep') label = repName(label);
        return { code: r.codes[0], label: label || '（空白）', sales: s, returns: rt, net: n, profit: pf, netProfit: np,
          share: rate(n, totNet), npShare: rate(np, totNP), margin: rate(pf, s), retRate: rate(rt, s),
          prevNet: pv ? pv[0] : 0, yoy: pv && pv[0] ? (n - pv[0]) / Math.abs(pv[0]) : null, diff: n - (pv ? pv[0] : 0) };
      });
      return rows;
    }

    // ---------- 版面 ----------
    const html = [];
    html.push(`<p class="db-note">期間：<b>${periodText(F)}</b>${hasPrev ? `　對照：去年同期 ${periodText(P)}` : '　（全部期間沒有去年同期可比）'}</p>`);
    // 提醒（後面 BEP、應收、分類表會再補）
    html.push('<div class="panel" id="dbAlerts"></div>');
    // 核心數字
    const avgOrder = rate(cur.sales, cur.orders), prevAvgOrder = prev ? rate(prev.sales, prev.orders) : null;
    html.push(`<div class="kpis db-kpis">${[
      card('net', '淨銷售額', fmt.big(cur.net), `銷貨 ${fmt.big(cur.sales)}・退貨 ${fmt.big(cur.returns)}`, hasPrev ? `${vsTxt} ${arrow(chgPct(cur.net, prev.net))}` : ''),
      card('netProfit', '淨毛利', fmt.big(cur.netProfit), `淨毛利率 ${fmt.pct(rate(cur.netProfit, cur.net))}`, hasPrev ? `比去年同期 ${arrow(chgPct(cur.netProfit, prev.netProfit))}` : ''),
      card('margin', '毛利率', fmt.pct(mg(cur)), hasPrev ? `去年同期 ${fmt.pct(mg(prev))}` : '', hasPrev ? arrow(mg(cur) - mg(prev), true, 'pp') : ''),
      card('retRate', '退貨率', fmt.pct(rr(cur)), hasPrev ? `去年同期 ${fmt.pct(rr(prev))}` : '', hasPrev ? arrow(rr(cur) - rr(prev), false, 'pp') : ''),
      card('orders', '出貨單數', nf0.format(cur.orders), `平均每單 ${fmt.money(avgOrder)}${hasPrev ? '（去年 ' + fmt.money(prevAvgOrder) + '）' : ''}`, hasPrev ? arrow(chgPct(cur.orders, prev.orders)) : ''),
      card('custs', '交易客戶數', nf0.format(cCur.length), `新客戶 ${nf0.format(newCust.length)} 位${hasPrev ? '（去年同期 ' + nf0.format(prevNewCust.length) + ' 位）' : ''}`, hasPrev ? arrow(chgPct(cCur.length, cPrev.length)) : ''),
      card('top10', '前 10 大客戶佔比', fmt.pct(top10Share), `共 ${nf0.format(cCur.length)} 位客戶`, hasPrev ? arrow(top10Share - prevTop10Share, false, 'pp') : ''),
    ].join('')}</div>`);

    // 排名
    const rd = S.dash.rankDim, rs = S.dash.rankSort;
    html.push(`<div class="panel"><div class="panel-head"><h2>排名與毛利貢獻</h2>
      <div class="row"><div class="seg" id="dbRankDim">${RANK_DIMS.map((d) => `<button data-v="${d.key}" class="${d.key === rd ? 'on' : ''}">${d.label}</button>`).join('')}</div>
      <div class="seg" id="dbRankSort"><button data-v="net" class="${rs === 'net' ? 'on' : ''}">依淨銷售</button><button data-v="netProfit" class="${rs === 'netProfit' ? 'on' : ''}">依毛利貢獻</button>${hasPrev ? `<button data-v="diff" class="${rs === 'diff' ? 'on' : ''}">比去年少最多</button>` : ''}</div></div></div>
      ${help('rank')}<div id="dbRank" class="db-scroll"></div></div>`);

    // 佔比
    html.push(`<div class="panel"><div class="panel-head"><h2>佔比：區域、商品大類、商品類別</h2><span class="legend-inline"><i class="b1"></i>淨銷售 <i class="b2"></i>淨毛利</span></div>${help('share')}
      <div class="grid3" id="dbShare"></div></div>`);

    // 毛利率、退貨率比較
    const cv = S.dash.cmp;
    html.push(`<div class="panel"><div class="panel-head"><h2>毛利率、退貨率：每年・每季・每月比較</h2>
      <div class="seg" id="dbCmp"><button data-v="year" class="${cv === 'year' ? 'on' : ''}">每年</button><button data-v="quarter" class="${cv === 'quarter' ? 'on' : ''}">每季</button><button data-v="month" class="${cv === 'month' ? 'on' : ''}">每月</button></div></div>
      ${help('compare')}<div id="dbCmpBody"></div>
      <div class="grid2 tight db-charts"><div><h3>毛利率（每月，近 3 年）</h3><div class="chart" id="dbMgChart"></div></div><div><h3>退貨率（每月，近 3 年）</h3><div class="chart" id="dbRrChart"></div></div></div></div>`);

    // BEP、應收帳款
    html.push('<div class="grid2"><div class="panel" id="dbBep"></div><div class="panel" id="dbDso"></div></div>');
    // 客戶動態、商品結構
    html.push(`<div class="panel"><div class="panel-head"><h2>客戶動態</h2></div>${help('custMove')}<div class="grid3" id="dbCust"></div></div>`);
    html.push(`<div class="panel"><div class="panel-head"><h2>商品結構（款號）</h2></div>${help('abc')}<div id="dbAbc"></div></div>`);
    html.push('<div class="panel" id="dbMissing"></div>');
    $('#dbBody').innerHTML = html.join('');
    $('#dbBody').ontoggle = null;
    $$('.db-kpi .explain').forEach((d) => d.addEventListener('toggle', () => { if (d.open) $$('.db-kpi .explain[open]').forEach((o) => { if (o !== d) o.open = false; }); }));

    // ---------- 排名表 ----------
    const drawRank = () => {
      const dim = S.dash.rankDim, sortKey = S.dash.rankSort;
      let rows = rankRows(dim);
      if (sortKey === 'diff') rows.sort((a, b) => a.diff - b.diff); else rows.sort((a, b) => b[sortKey] - a[sortKey]);
      let cum = 0; const shareKey = sortKey === 'netProfit' ? 'npShare' : 'share';
      rows.forEach((r, i) => { r.rank = i + 1; cum += r[shareKey] || 0; r.cum = cum; });
      const label = RANK_DIMS.find((d) => d.key === dim).label;
      const cols = [
        { key: 'rank', label: '#', n: 1 },
        { key: 'label', label, cls: 'lbl' },
        { key: 'net', label: '淨銷售', n: 1, fmt: 'money' },
        { key: 'share', label: '銷售佔比', n: 1, render: (r) => `<span class="pbar"><i style="width:${Math.max(0, Math.min(100, (r.share || 0) * 100))}%"></i>${fmt.pct(r.share)}</span>` },
        { key: 'netProfit', label: '毛利貢獻', n: 1, fmt: 'money' },
        { key: 'npShare', label: '毛利貢獻率', n: 1, render: (r) => `<span class="pbar p2"><i style="width:${Math.max(0, Math.min(100, (r.npShare || 0) * 100))}%"></i>${fmt.pct(r.npShare)}</span>` },
        { key: 'cum', label: sortKey === 'netProfit' ? '累計(毛利)' : '累計(銷售)', n: 1, fmt: 'pct' },
        { key: 'margin', label: '毛利率', n: 1, fmt: 'pct' },
        { key: 'retRate', label: '退貨率', n: 1, fmt: 'pct' },
      ];
      if (hasPrev) cols.push({ key: 'yoy', label: '比去年同期', n: 1, render: (r) => (r.prevNet ? arrow(r.yoy) : '<span class="muted">新</span>') });
      table($('#dbRank'), cols, rows, {
        limit: 20,
        onRow: (r) => ctx.drill(dim, r.code, r.label),
        empty: '這段期間沒有資料',
      });
    };
    drawRank();
    $('#dbRankDim').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.dash.rankDim = b.dataset.v; ctx.saveDash(); $$('#dbRankDim button').forEach((x) => x.classList.toggle('on', x === b)); drawRank(); };
    $('#dbRankSort').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.dash.rankSort = b.dataset.v; ctx.saveDash(); $$('#dbRankSort button').forEach((x) => x.classList.toggle('on', x === b)); drawRank(); };

    // ---------- 佔比 ----------
    const shareBlock = (dim, title, max = 8) => {
      const rows = rankRows(dim).sort((a, b) => b.net - a.net);
      let shown = rows.slice(0, max);
      if (rows.length > max) {
        const rest = rows.slice(max);
        shown = shown.concat([{ label: `其他 ${rest.length} 項`, share: rest.reduce((s, r) => s + (r.share || 0), 0), npShare: rest.reduce((s, r) => s + (r.npShare || 0), 0), net: rest.reduce((s, r) => s + r.net, 0), other: true }]);
      }
      const w = (v) => Math.max(0, Math.min(100, (v || 0) * 100));
      return `<div class="share"><h3>${title}</h3>${shown.map((r) => `<div class="srow${r.other ? ' other' : ''}" ${r.other ? '' : `data-dim="${dim}" data-code="${r.code}" data-label="${esc(r.label)}"`} title="淨銷售 ${fmt.money(r.net)}">
        <div class="sl"><span>${esc(r.label)}</span><b>${fmt.pct(r.share)}</b></div>
        <div class="sb"><i class="b1" style="width:${w(r.share)}%"></i></div><div class="sb thin"><i class="b2" style="width:${w(r.npShare)}%"></i><em>毛利 ${fmt.pct(r.npShare)}</em></div></div>`).join('')}</div>`;
    };
    $('#dbShare').innerHTML = shareBlock('region', '區域') + shareBlock('big', '商品大類') + shareBlock('cat', '商品類別（前 8）');
    $('#dbShare').onclick = (e) => { const r = e.target.closest('.srow[data-dim]'); if (r) ctx.drill(r.dataset.dim, +r.dataset.code, r.dataset.label); };

    // ---------- 比較表 ----------
    const drawCmp = () => {
      const mode = S.dash.cmp;
      const years = E.yearList.slice(-5);
      const colsOf = mode === 'year' ? [''] : mode === 'quarter' ? ['Q1', 'Q2', 'Q3', 'Q4'] : Array.from({ length: 12 }, (_, i) => (i + 1) + '月');
      const dim2 = mode === 'quarter' ? 'quarter' : 'month';
      const p = E.pivot({ rows: mode === 'year' ? ['year'] : (mode === 'quarter' ? ['quarter'] : ['year', 'month']), cols: null, measures: ['sales', 'returns', 'profit', 'net'], filter: { ymFrom: years[0] * 100 + 1 } });
      const cell = new Map(); // `${year}|${col}` -> vals
      const qd = E.dim('quarter'), yd = E.dim('year');
      p.rows.forEach((r) => {
        let yy, cc;
        if (mode === 'year') { yy = parseInt(r.labels[0], 10); cc = 0; }
        else if (mode === 'quarter') { const q = qd.raw[r.codes[0]]; yy = Math.floor(q / 10); cc = q % 10 - 1; }
        else { yy = parseInt(yd.labels[r.codes[0]], 10); cc = r.codes[1]; }
        cell.set(yy + '|' + cc, r.vals[0]);
      });
      void dim2;
      const mk = (title, f, goodUp) => {
        const head = `<tr><th>${title}</th>${colsOf.map((c) => `<th class="n">${c || '全年'}</th>`).join('')}</tr>`;
        const body = years.map((yy) => `<tr><td class="lbl">${yy} 年</td>${colsOf.map((_, ci) => {
          const v = cell.get(yy + '|' + ci), pv = cell.get((yy - 1) + '|' + ci);
          const x = v ? f(v) : null, px = pv ? f(pv) : null;
          if (x == null) return '<td class="n muted">—</td>';
          const d = px == null ? null : x - px;
          return `<td class="n"><div>${fmt.pct(x)}</div>${d == null ? '' : `<small>${arrow(d, goodUp, 'pp').replace(' 個百分點', '')}</small>`}</td>`;
        }).join('')}</tr>`).join('');
        return `<div class="table-wrap db-scroll"><table class="dt cmp">${head}${body}</table></div>`;
      };
      $('#dbCmpBody').innerHTML = `<div class="grid2 tight"><div><h3>毛利率</h3>${mk('年', (v) => rate(v[2], v[0]), true)}</div><div><h3>退貨率</h3>${mk('年', (v) => rate(v[1], v[0]), false)}</div></div>` +
        (mode === 'year' && partial ? `<p class="hint">${Math.floor(ref / 100)} 年還沒過完，全年數字只到 ${ymLabel(E.maxYm)}。</p>` : '');
    };
    drawCmp();
    $('#dbCmp').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.dash.cmp = b.dataset.v; ctx.saveDash(); $$('#dbCmp button').forEach((x) => x.classList.toggle('on', x === b)); drawCmp(); };
    // 每月折線：近 3 年，每年一條
    const drawLines = () => {
      const yrs = E.yearList.slice(-3);
      const p = E.pivot({ rows: ['year', 'month'], cols: null, measures: ['sales', 'returns', 'profit'], filter: { ymFrom: yrs[0] * 100 + 1 } });
      const yd = E.dim('year'); const map = new Map();
      p.rows.forEach((r) => map.set(parseInt(yd.labels[r.codes[0]], 10) + '|' + r.codes[1], r.vals[0]));
      const labels = Array.from({ length: 12 }, (_, i) => (i + 1) + '月');
      const cls = ['s3', 's2', 's1'];
      const ser = (f) => yrs.map((yy, i) => ({ name: yy + '年', cls: cls[cls.length - yrs.length + i], values: labels.map((_, m) => { const v = map.get(yy + '|' + m); return v && v[0] ? f(v) : null; }) }));
      Charts.render($('#dbMgChart'), { type: 'line', labels, series: ser((v) => v[2] / v[0]), fmt: fmt.pct, axisFmt: (v) => Math.round(v * 100) + '%' });
      Charts.render($('#dbRrChart'), { type: 'line', labels, series: ser((v) => v[1] / v[0]), fmt: fmt.pct, axisFmt: (v) => nf1.format(v * 100) + '%' });
    };
    drawLines();
    ctx.redraw = drawLines;

    // ---------- 損益兩平 ----------
    const meta = S.meta || {};
    const fixed = meta.fixedCost > 0 ? meta.fixedCost : null;
    const npRate = rate(cur.netProfit, cur.net);
    const months12 = Array.from({ length: 12 }, (_, i) => addM(ref, i - 11));
    const mp = new Map(E.pivot({ rows: ['ym'], cols: null, measures: ['net', 'netProfit'], filter: { ymFrom: months12[0], ymTo: ref } }).rows.map((r) => [E.ymList[r.codes[0]], r.vals[0]]));
    let bepHtml = `<div class="panel-head"><h2>損益兩平（BEP）</h2></div>${help('bep')}
      <form class="row db-input" id="dbFixedForm"><label class="field-label" for="dbFixed">每月固定費用（元）</label><input type="text" inputmode="numeric" id="dbFixed" value="${fixed ? nf0.format(fixed) : ''}" placeholder="例如 800,000"><button class="btn primary">套用</button></form>`;
    if (!fixed) bepHtml += '<p class="missing">缺少：每月固定費用（房租、薪資、勞健保、水電、租車等）。輸入後就會算出每月至少要賣多少。只存在這台裝置，會加密。</p>';
    else if (!(npRate > 0)) bepHtml += '<p class="missing">這段期間的淨毛利率不是正數，無法計算損益兩平。</p>';
    else {
      const bep = fixed / npRate;
      const avg = cur.net / Math.max(1, monthsIn.length);
      const safety = (avg - bep) / avg;
      const below = months12.filter((m) => mp.has(m) && mp.get(m)[0] < bep);
      bepHtml += `<div class="kpis two">
        <div class="kpi"><div class="k">每月損益兩平銷售額</div><div class="v">${fmt.big(bep)}</div><span class="d">= ${fmt.money(fixed)} ÷ 淨毛利率 ${fmt.pct(npRate)}</span></div>
        <div class="kpi"><div class="k">安全邊際</div><div class="v ${safety < 0 ? 'neg' : ''}">${fmt.pct(safety)}</div><span class="d">期間平均每月淨銷售 ${fmt.big(avg)}</span></div></div>
        <p class="hint">近 12 個月有 <b>${below.length}</b> 個月的淨銷售低於損益兩平${below.length ? '：' + below.map(ymLabel).join('、') : ''}。</p>
        <div class="chart short" id="dbBepChart"></div>`;
      if (safety < 0) alerts.push({ lv: 'bad', t: `平均每月淨銷售 ${fmt.big(avg)}，低於損益兩平 ${fmt.big(bep)}`, s: '毛利不夠付固定費用：要提高銷售或毛利率，或降低固定費用。' });
      else if (safety < 0.1) alerts.push({ lv: 'warn', t: `安全邊際只有 ${fmt.pct(safety)}`, s: '業績再掉一點就會虧損。' });
      if (below.length >= 3) alerts.push({ lv: 'warn', t: `近 12 個月有 ${below.length} 個月低於損益兩平`, s: '看這些月份是淡季還是特殊原因。' });
      ctx.after.push(() => Charts.render($('#dbBepChart'), { type: 'bar', labels: months12.map(ymLabel), series: [{ name: '淨銷售', cls: 's1', values: months12.map((m) => (mp.get(m) || [0])[0]) }, { name: '損益兩平', cls: 's2', values: months12.map(() => bep) }], fmt: fmt.money, axisFmt: fmt.axis }));
    }
    $('#dbBep').innerHTML = bepHtml;

    // ---------- 應收帳款天數 ----------
    const ar = meta.ar && meta.ar.amount > 0 ? meta.ar : null;
    const arYm = ar && E.ymIndex.has(ar.ym) ? ar.ym : ref;
    let dsoHtml = `<div class="panel-head"><h2>應收帳款天數</h2></div>${help('dso')}
      <form class="row db-input" id="dbArForm"><label class="field-label" for="dbAr">應收帳款餘額（元），截至</label><select id="dbArYm">${E.ymList.slice().reverse().slice(0, 24).map((v) => `<option value="${v}" ${v === arYm ? 'selected' : ''}>${ymLabel(v)} 月底</option>`).join('')}</select><input type="text" inputmode="numeric" id="dbAr" value="${ar ? nf0.format(ar.amount) : ''}" placeholder="例如 3,500,000"><button class="btn primary">套用</button></form>`;
    if (!ar) dsoHtml += '<p class="missing">缺少：應收帳款餘額（還沒收到的貨款總額，會計或對帳單上有）。總表裡的 RECEIVE、PAY 欄看起來像收款紀錄，如果確認它們的意思，之後可以改成自動計算，還能列出每位客戶的未收金額。</p>';
    else {
      const s3 = [addM(arYm, -2), addM(arYm, -1), arYm].reduce((s, m) => s + ((E.pivot({ rows: [], cols: null, measures: ['net'], filter: { ymFrom: m, ymTo: m } }).grand[0]) || 0), 0);
      const dso = s3 > 0 ? ar.amount / s3 * 91 : null;
      dsoHtml += `<div class="kpis two"><div class="kpi"><div class="k">應收帳款天數</div><div class="v ${dso > 90 ? 'neg' : ''}">${dso == null ? '—' : nf0.format(dso) + ' 天'}</div><span class="d">${fmt.money(ar.amount)} ÷ ${fmt.money(s3)} × 91</span></div>
        <div class="kpi"><div class="k">近 3 個月淨銷售</div><div class="v">${fmt.big(s3)}</div><span class="d">${ymLabel(addM(arYm, -2))}～${ymLabel(arYm)}</span></div></div>`;
      if (dso > 90) alerts.push({ lv: 'bad', t: `應收帳款天數 ${nf0.format(dso)} 天`, s: '收款太慢，請會計列出逾期的客戶，業務協助催收。' });
      else if (dso > 60) alerts.push({ lv: 'warn', t: `應收帳款天數 ${nf0.format(dso)} 天`, s: '比一般月結 30～60 天長，檢查是否有客戶拖款。' });
    }
    $('#dbDso').innerHTML = dsoHtml;
    const num = (s) => { const v = parseFloat(String(s).replace(/[,\s，元]/g, '')); return isFinite(v) && v >= 0 ? v : null; };
    $('#dbFixedForm').onsubmit = async (e) => { e.preventDefault(); const v = num($('#dbFixed').value); await ctx.saveMeta({ fixedCost: v || null }); ctx.toast(v ? '已套用每月固定費用' : '已清除每月固定費用'); };
    $('#dbArForm').onsubmit = async (e) => { e.preventDefault(); const v = num($('#dbAr').value); await ctx.saveMeta({ ar: v ? { amount: v, ym: +$('#dbArYm').value } : null }); ctx.toast(v ? '已套用應收帳款餘額' : '已清除應收帳款餘額'); };

    // ---------- 客戶動態 ----------
    const custTable = (title, rows, cols, empty) => `<div><h3>${title}</h3><div class="db-mini" data-t="${title}"></div></div>`;
    $('#dbCust').innerHTML = custTable('新客戶') + custTable('可能流失（去年同期有買，這段期間沒買）') + custTable('衰退的大客戶（少 30% 以上）');
    const minis = $$('#dbCust .db-mini');
    const fullCust = new Map(allCust.map((c) => [c.ck, c]));
    const open = (c) => ctx.openCustomer(fullCust.get(c.ck) || c);
    table(minis[0], [{ key: 'name', label: '客戶', cls: 'lbl', get: (r) => r.code + ' ' + r.name }, { key: 'net', label: '淨銷售', n: 1, fmt: 'money' }], newCust.slice().sort((a, b) => b.net - a.net), { limit: 8, onRow: open, empty: '這段期間沒有新客戶' });
    let lost = [], down = [];
    if (hasPrev) {
      const curSet = new Map(cCur.map((c) => [c.ck, c]));
      lost = cPrev.filter((c) => !curSet.has(c.ck) && c.net > 0).sort((a, b) => b.net - a.net);
      down = prevByNet.slice(0, 20).map((c) => ({ ...c, now: (curSet.get(c.ck) || { net: 0 }).net })).filter((c) => c.now > 0 && c.now < c.net * 0.7).map((c) => ({ ...c, chg: (c.now - c.net) / c.net }));
      const lostAmt = lost.reduce((s, c) => s + c.net, 0);
      if (lost.length && rate(lostAmt, prev.net) > 0.05) alerts.push({ lv: 'warn', t: `${lost.length} 位去年同期有買的客戶，這段期間都沒買（去年合計 ${fmt.big(lostAmt)}）`, s: '見「客戶動態」的可能流失名單，請業務聯絡。' });
      if (down.length) alerts.push({ lv: 'warn', t: `${down.length} 位去年同期前 20 大的客戶，今年少了 30% 以上`, s: '見「客戶動態」的衰退名單。' });
    }
    table(minis[1], [{ key: 'name', label: '客戶', cls: 'lbl', get: (r) => r.code + ' ' + r.name }, { key: 'net', label: '去年同期淨銷售', n: 1, fmt: 'money' }, { key: 'last', label: '最近交易', get: (r) => (fullCust.get(r.ck) || r).last, fmt: 'ym' }], lost, { limit: 8, onRow: open, empty: hasPrev ? '沒有' : '全部期間無法比較' });
    table(minis[2], [{ key: 'name', label: '客戶', cls: 'lbl', get: (r) => r.code + ' ' + r.name }, { key: 'net', label: '去年同期', n: 1, fmt: 'money' }, { key: 'now', label: '這段期間', n: 1, fmt: 'money' }, { key: 'chg', label: '變化', n: 1, render: (r) => arrow(r.chg) }], down, { limit: 8, onRow: open, empty: hasPrev ? '沒有' : '全部期間無法比較' });

    // ---------- 商品結構 ----------
    const st = rankRows('style').sort((a, b) => b.net - a.net);
    let acc = 0, nA = 0; const totPos = st.reduce((s, r) => s + Math.max(0, r.net), 0);
    for (const r of st) { if (acc >= totPos * 0.8) break; acc += Math.max(0, r.net); nA++; }
    const prodAll = E.products({}, ref, 'style').list;
    const firstStyle = new Map(prodAll.map((p) => [p.code, p.first]));
    const newStyles = st.filter((r) => { const f = firstStyle.get(r.label); return f >= F[0] && f <= F[1]; });
    const newAmt = newStyles.reduce((s, r) => s + r.net, 0);
    const highRet = st.filter((r) => r.sales >= totPos * 0.005 && r.retRate > 0).sort((a, b) => b.retRate - a.retRate).slice(0, 8);
    $('#dbAbc').innerHTML = `<div class="kpis three">
      <div class="kpi"><div class="k">撐起 80% 業績的款號</div><div class="v">${nf0.format(nA)} 個</div><span class="d">共 ${nf0.format(st.length)} 個款號有銷售，佔 ${fmt.pct(rate(nA, st.length))}</span></div>
      <div class="kpi"><div class="k">新品（這段期間第一次賣出）</div><div class="v">${nf0.format(newStyles.length)} 個</div><span class="d">淨銷售 ${fmt.big(newAmt)}，佔 ${fmt.pct(rate(newAmt, cur.net))}</span></div>
      <div class="kpi"><div class="k">只賣一點點的款號</div><div class="v">${nf0.format(st.filter((r) => r.share != null && r.share < 0.0005).length)} 個</div><span class="d">各佔不到 0.05% 的淨銷售</span></div></div>
      <h3>退貨率最高的款號（銷售額至少佔 0.5%）</h3><div id="dbHighRet"></div>`;
    table($('#dbHighRet'), [{ key: 'label', label: '款號', cls: 'lbl' }, { key: 'sales', label: '銷貨', n: 1, fmt: 'money' }, { key: 'returns', label: '退貨', n: 1, fmt: 'money' }, { key: 'retRate', label: '退貨率', n: 1, fmt: 'pct' }],
      highRet, { onRow: (r) => ctx.drill('style', r.code, r.label), empty: '沒有' });

    // ---------- 缺少的資料與說明 ----------
    const miss = [];
    const ds = E.ds;
    if (!(meta.cat && meta.cat.map)) miss.push(['商品類別代碼表', '還沒匯入。匯入後才會顯示類別名稱，以及商品大類（男、女、童、配件）的佔比。到「資料與設定」→「商品類別代碼表」匯入。']);
    else {
      const unm = E.pivot({ rows: ['cat'], cols: null, measures: ['net'], filter: {} }).rows.filter((r) => !ds.str.cat.mapped[r.codes[0]] && r.labels[0] !== '（空白）');
      if (unm.length) {
        miss.push(['分類表裡沒有名稱或大類的類別代碼', unm.sort((a, b) => b.vals[0][0] - a.vals[0][0]).map((r) => `${esc(r.labels[0])}（${fmt.big(r.vals[0][0])}）`).join('、') + '。這些會算在「未分類」，請在分類表補上後重新匯入。']);
        alerts.push({ lv: 'warn', t: `有 ${unm.length} 個商品類別代碼沒有分類`, s: '見最下面「缺少的資料」。' });
      }
    }
    if (!fixed) miss.push(['每月固定費用', '損益兩平需要。在上面「損益兩平」輸入。']);
    if (!ar) miss.push(['應收帳款餘額', '應收帳款天數需要。在上面「應收帳款天數」輸入；或確認總表 RECEIVE、PAY 欄的意思後改成自動計算。']);
    miss.push(['庫存與進貨（採購）資料', '總表只有銷貨和退貨，所以無法算存貨週轉天數、缺貨或庫存過多。若有庫存表，可以再加進來。']);
    miss.push(['交易日期（日）', '單號前 5 碼只到「年月」，所以天數類的指標（購買頻率、應收帳款天數）是用月份推估。']);
    const noSize = (() => { let c = 0; ds.str.sku.dict.forEach((s) => { if (!Dataset.splitSku(s)[1]) c++; }); return c; })();
    if (noSize) miss.push(['看不出尺寸的商品代號', `${nf0.format(noSize)} 個商品代號後面沒有尺寸（例如配件、運費），尺寸分析會顯示「（無尺寸）」。`]);
    const otherRegion = (E.pivot({ rows: ['region'], cols: null, measures: ['net'], filter: fil(F) }).rows.find((r) => r.labels[0] === '其他地區') || { vals: [[0]] }).vals[0][0];
    if (otherRegion) miss.push(['區域', `區域是用客戶代號的第一碼判斷，有 ${fmt.big(otherRegion)} 的淨銷售歸在「其他地區」（客戶代號不是 1～8 開頭）。`]);
    $('#dbMissing').innerHTML = `<div class="panel-head"><h2>缺少的資料與說明</h2></div><ul class="missing-list">${miss.map(([a, b]) => `<li><b>${a}</b>${b}</li>`).join('')}</ul>`;

    // ---------- 提醒（最後才畫，因為上面會補）----------
    const lvName = { bad: '要注意', warn: '留意', good: '不錯' };
    const order = { bad: 0, warn: 1, good: 2 };
    alerts.sort((a, b) => order[a.lv] - order[b.lv]);
    $('#dbAlerts').innerHTML = `<div class="panel-head"><h2>重點提醒</h2></div>` + (alerts.length
      ? `<ul class="alerts">${alerts.map((a) => `<li class="${a.lv}"><span class="tag">${lvName[a.lv]}</span><div><b>${a.t}</b><p>${a.s}</p></div></li>`).join('')}</ul>`
      : '<p class="hint">這段期間沒有特別需要注意的地方。</p>');
    return { cur, prev, alerts, top10Share, newCust: newCust.length, nA };
  }

  root.Dashboard = { render, PERIODS, addM };
})(window);

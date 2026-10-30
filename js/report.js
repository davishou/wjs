/* 圖表報告：給管理人員看的比較圖。一年一份（今年可看累計到基準月），每張圖都和去年同期比較。
   圖的選法：
   - 排名（客戶、商品、品項、毛利貢獻）用由大到小的橫條，比圓餅圖好比較；去年同期用細線標在同一條上
   - 只有幾塊的佔比（區域、男女童）用分段長條，今年和去年上下並排，一眼看出比例的變化
   - 金額和百分比不放在同一張圖的兩個刻度上（容易看錯），毛利率寫在每一條旁邊
   有「簡報模式」（一張圖一頁，開會投影用）和「列印／存成 PDF」。 */
(function (root) {
  const { ymLabel } = root.EngineMeta;
  // 分類固定配色：同一個區域、同一個大類，在每張圖、每一年都是同一個顏色
  const REGION_ORDER = ['大台北地區', '桃竹苗', '中部', '南部', '其他地區'];
  const BIG_ORDER = ['男', '女', '童', '百貨', '配件', '未分類', '（未匯入分類表）'];

  function render(ctx) {
    const { S, E, fmt, nf0, nf1, esc, $, $$, refYm } = ctx;
    const ref = refYm();
    const refY = Math.floor(ref / 100);
    const years = E.yearList.slice().reverse();
    let year = S.report.year && years.includes(S.report.year) ? S.report.year : refY;
    if (!years.includes(year)) year = years[0];
    // 期間：選的年份 1 月起，到基準月（今年）或該年最後一個有資料的月份
    const lastOfYear = Math.max(...E.ymList.filter((v) => Math.floor(v / 100) === year));
    const endYm = year === refY ? Math.min(ref, lastOfYear) : lastOfYear;
    const endM = endYm % 100;
    const F = { ymFrom: year * 100 + 1, ymTo: endYm };
    const P = { ymFrom: (year - 1) * 100 + 1, ymTo: (year - 1) * 100 + endM };
    const hasPrev = E.ymList.some((v) => v >= P.ymFrom && v <= P.ymTo);
    const full = endM === 12;
    const pLabel = full ? `${year}年` : `${year}年 1～${endM}月`;
    const prevLabel = full ? `${year - 1}年` : `${year - 1}年 1～${endM}月`;

    $('#rpYear').innerHTML = years.map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}年${y === refY && ref % 100 !== 12 ? `（1～${ref % 100}月）` : ''}</option>`).join('');
    $('#rpSub').textContent = `${pLabel}，和${hasPrev ? '去年同期（' + prevLabel + '）' : '去年（沒有資料）'}比較。金額是淨營收（銷貨減退貨）。`;

    // ---------- 計算 ----------
    const M = ['sales', 'returns', 'net', 'profit', 'netProfit'];
    const tot = (f) => { const g = E.pivot({ rows: [], cols: null, measures: M, filter: f }).grand; const o = {}; M.forEach((k, i) => { o[k] = g[i] || 0; }); return o; };
    const cur = tot(F), prev = hasPrev ? tot(P) : null;
    const rate = (a, b) => (b ? a / b : null);
    const chg = (a, b) => (b ? (a - b) / Math.abs(b) : null);
    function rows(dim, f, sortKey = 'net') {
      return E.pivot({ rows: [dim], cols: null, measures: M, filter: f }).rows
        .map((r) => ({ code: r.codes[0], label: dim === 'rep' ? ctx.repName(r.labels[0]) : (r.labels[0] || '（空白）'), sales: r.vals[0][0], returns: r.vals[0][1], net: r.vals[0][2], profit: r.vals[0][3], netProfit: r.vals[0][4] }))
        .sort((a, b) => b[sortKey] - a[sortKey]);
    }
    function withPrev(dim, sortKey = 'net') {
      const a = rows(dim, F, sortKey);
      const pm = new Map(hasPrev ? rows(dim, P).map((r) => [r.code, r]) : []);
      a.forEach((r) => { const p = pm.get(r.code); r.prevNet = p ? p.net : 0; r.prevNP = p ? p.netProfit : 0; r.share = rate(r.net, cur.net); r.npShare = rate(r.netProfit, cur.netProfit); r.margin = rate(r.profit, r.sales); });
      return { list: a, prevMap: pm };
    }

    // ---------- 小元件 ----------
    const pct = (v) => fmt.pct(v);
    const arrow = (d, goodUp = true, pp = false) => {
      if (d == null || !isFinite(d)) return '<span class="muted">—</span>';
      const up = d >= 0;
      return `<span class="${Math.abs(d) < 1e-9 ? '' : (up === goodUp ? 'up' : 'down')}">${up ? '▲' : '▼'} ${pp ? nf1.format(Math.abs(d * 100)) + ' 個百分點' : fmt.pct(Math.abs(d))}</span>`;
    };
    const tipAttr = (lines) => `data-tip="${esc(lines.join('\n'))}"`;
    // 由大到小的橫條：bar = 今年，細線 = 去年同期；同一個刻度
    function rankBars(list, { value = 'net', prevKey = 'prevNet', label = (r) => r.label, share = (r) => r.share, extra = null, onClick = null, inner = null } = {}) {
      const max = Math.max(1, ...list.map((r) => Math.max(r[value] || 0, hasPrev ? r[prevKey] || 0 : 0, inner ? 0 : 0)));
      const w = (v) => Math.max(0, Math.min(100, (v / max) * 100));
      return `<div class="rb" role="list">${list.map((r, i) => {
        const tip = [label(r), `今年：${fmt.money(r[value])}`].concat(hasPrev && !r.other ? [`去年同期：${fmt.money(r[prevKey])}`] : []).concat(share(r) != null ? [`佔比：${pct(share(r))}`] : []).concat(extra ? [extra.tip(r)] : []);
        return `<div class="rb-row${r.other ? ' other' : ''}${onClick && !r.other ? ' click' : ''}" role="listitem" data-i="${i}" ${tipAttr(tip)}>
          <span class="rb-n">${r.other ? '' : i + 1}</span><span class="rb-name">${esc(label(r))}</span>
          <span class="rb-track">${inner ? `<i class="rb-bar soft" style="width:${w(r[value])}%"></i><i class="rb-bar" style="width:${w(r[inner])}%"></i>` : `<i class="rb-bar" style="width:${w(r[value])}%"></i>`}${hasPrev && !r.other && r[prevKey] > 0 ? `<i class="rb-prev" style="left:${w(r[prevKey])}%"></i>` : ''}</span>
          <span class="rb-val">${fmt.big(inner ? r[inner] : r[value])}</span><span class="rb-pct">${share(r) != null ? pct(share(r)) : ''}</span>
          <span class="rb-x">${extra ? extra.html(r) : (hasPrev && !r.other ? (r[prevKey] ? arrow(chg(r[value], r[prevKey])) : '<span class="muted">新</span>') : '')}</span></div>`;
      }).join('')}</div>`;
    }
    // 分段長條：今年、去年同期上下並排；每個區塊的顏色跟著名稱，不跟著名次
    function segBars(dim, order) {
      const cRows = rows(dim, F), pRows = hasPrev ? rows(dim, P) : [];
      const names = [...new Set(cRows.concat(pRows).map((r) => r.label))].sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'zh-Hant');
      });
      const slot = new Map(names.map((n, i) => [n, Math.min(6, i + 1)]));
      const bar = (rs, total, title) => {
        const by = new Map(rs.map((r) => [r.label, r.net]));
        const blocks = names.map((n) => ({ n, v: Math.max(0, by.get(n) || 0) })).filter((b) => b.v > 0);
        const sum = blocks.reduce((s, b) => s + b.v, 0) || 1;
        return `<div class="sg"><div class="sg-title">${title}<small>${fmt.big(total)}</small></div><div class="sg-bar" role="img" aria-label="${esc(title + '：' + blocks.map((b) => `${b.n} ${pct(b.v / sum)}`).join('、'))}">${blocks.map((b) => {
          const sh = b.v / sum;
          return `<i class="c${slot.get(b.n)}" style="flex:${b.v}" ${tipAttr([b.n, `${title}：${fmt.money(b.v)}`, `佔比：${pct(sh)}`])}>${sh >= 0.07 ? `<b>${pct(sh)}</b>` : ''}</i>`;
        }).join('')}</div></div>`;
      };
      const legend = `<div class="sg-legend">${names.map((n) => `<span><i class="c${slot.get(n)}"></i>${esc(n)}</span>`).join('')}</div>`;
      const cMap = new Map(cRows.map((r) => [r.label, r.net])), pMap = new Map(pRows.map((r) => [r.label, r.net]));
      const pTot = pRows.reduce((s, r) => s + Math.max(0, r.net), 0), cTot = cRows.reduce((s, r) => s + Math.max(0, r.net), 0);
      const table = names.map((n) => ({ n, c: cMap.get(n) || 0, p: pMap.get(n) || 0 }));
      const shiftRows = table.map((t) => ({ ...t, cs: rate(Math.max(0, t.c), cTot), ps: hasPrev ? rate(Math.max(0, t.p), pTot) : null }));
      return {
        html: bar(cRows, cur.net, pLabel) + (hasPrev ? bar(pRows, prev.net, prevLabel) : '') + legend,
        rows: shiftRows,
        tableHtml: `<table class="dt"><tr><th>${esc(dim === 'region' ? '區域' : '大類')}</th><th class="n">${pLabel}</th><th class="n">佔比</th>${hasPrev ? `<th class="n">${prevLabel}</th><th class="n">佔比</th><th class="n">比例變化</th>` : ''}</tr>${shiftRows.map((t) => `<tr><td>${esc(t.n)}</td><td class="n">${fmt.money(t.c)}</td><td class="n">${pct(t.cs)}</td>${hasPrev ? `<td class="n">${fmt.money(t.p)}</td><td class="n">${pct(t.ps)}</td><td class="n">${arrow(t.cs - t.ps, true, true)}</td>` : ''}</tr>`).join('')}</table>`,
      };
    }
    const table = (head, body) => `<table class="dt"><tr>${head.map((h, i) => `<th class="${i > 1 ? 'n' : ''}">${h}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((c, i) => `<td class="${i > 1 ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table>`;
    const card = (id, title, take, body, tableHtml, legend = '') => `<article class="panel rp-card" id="${id}"><header class="rp-head"><h2>${title}</h2><p class="rp-take">${take}</p>${legend}</header>
      <div class="rp-body">${body}</div>${tableHtml ? `<details class="rp-table"><summary>數字表</summary><div class="table-wrap">${tableHtml}</div></details>` : ''}</article>`;
    const prevLegend = hasPrev ? `<p class="rp-legend"><span><i class="lg-bar"></i>${pLabel}</span><span><i class="lg-prev"></i>${prevLabel}（同一刻度）</span></p>` : '';

    const cards = [];
    // 封面：重點數字
    const C = E.customers(F, ref).list.sort((a, b) => b.net - a.net);
    const top10 = rate(C.slice(0, 10).reduce((s, c) => s + c.net, 0), cur.net);
    const meta = S.meta || {};
    const kp = [
      ['淨營收', fmt.big(cur.net), hasPrev ? `比去年同期 ${arrow(chg(cur.net, prev.net))}` : ''],
      ['淨毛利', fmt.big(cur.netProfit), hasPrev ? `比去年同期 ${arrow(chg(cur.netProfit, prev.netProfit))}` : ''],
      ['毛利率', pct(rate(cur.profit, cur.sales)), hasPrev ? `去年 ${pct(rate(prev.profit, prev.sales))}　${arrow(rate(cur.profit, cur.sales) - rate(prev.profit, prev.sales), true, true)}` : ''],
      ['退貨率', pct(rate(cur.returns, cur.sales)), hasPrev ? `去年 ${pct(rate(prev.returns, prev.sales))}　${arrow(rate(cur.returns, cur.sales) - rate(prev.returns, prev.sales), false, true)}` : ''],
      ['交易客戶數', nf0.format(C.length), `前 10 大客戶佔 ${pct(top10)}`],
    ];
    if (meta.ar && meta.ar.amount > 0) {
      const s3 = [-2, -1, 0].reduce((s, k) => { const m = root.Dashboard.addM(meta.ar.ym, k); return s + (E.pivot({ rows: [], cols: null, measures: ['net'], filter: { ymFrom: m, ymTo: m } }).grand[0] || 0); }, 0);
      if (s3 > 0) kp.push(['應收帳款天數', nf0.format(meta.ar.amount / s3 * 91) + ' 天', `${ymLabel(meta.ar.ym)} 月底`]);
    }
    cards.push(`<article class="panel rp-card rp-cover" id="rpCover"><header class="rp-head"><p class="rp-kicker">銷售報告</p><h2 class="rp-title">${pLabel}</h2>
      <p class="rp-take">${hasPrev ? `和去年同期（${prevLabel}）比較` : '沒有去年同期的資料可以比較'}・製表 ${new Date().toLocaleDateString('zh-TW')}</p></header>
      <div class="rp-kpis">${kp.map(([k, v, d]) => `<div class="rp-kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('')}</div></article>`);

    // 每月淨營收：今年與去年
    cards.push(card('rpMonthly', '每月淨營收', hasPrev ? `${pLabel}合計 ${fmt.big(cur.net)}，${chg(cur.net, prev.net) >= 0 ? '比去年同期多' : '比去年同期少'} ${pct(Math.abs(chg(cur.net, prev.net)))}` : `${pLabel}合計 ${fmt.big(cur.net)}`,
      '<div class="chart" id="rpMonthChart"></div>', ''));

    // TOP10 客戶
    const cu = withPrev('ck');
    const t10 = cu.list.slice(0, 10);
    const t10s = t10.reduce((s, r) => s + (r.share || 0), 0);
    cards.push(card('rpCust', 'TOP 10 客戶', t10.length ? `前 10 大客戶合計佔淨營收 <b>${pct(t10s)}</b>；第一名「${esc(t10[0].label)}」佔 ${pct(t10[0].share)}` : '沒有資料',
      rankBars(t10, { onClick: true }), table(['#', '客戶', '淨營收', '佔比', ...(hasPrev ? ['去年同期', '成長'] : [])], t10.map((r, i) => [i + 1, esc(r.label), fmt.money(r.net), pct(r.share), ...(hasPrev ? [fmt.money(r.prevNet), arrow(chg(r.net, r.prevNet))] : [])])), prevLegend));

    // TOP15 商品（款號）
    const st = withPrev('style');
    const t15 = st.list.slice(0, 15);
    const t15s = t15.reduce((s, r) => s + (r.share || 0), 0);
    cards.push(card('rpProd', 'TOP 15 商品（款號）', t15.length ? `${st.list.length > 15 ? `前 15 個款號合計佔 <b>${pct(t15s)}</b>，其餘 ${nf0.format(st.list.length - 15)} 個款號佔 ${pct(1 - t15s)}` : `共 ${st.list.length} 個款號`}；第一名 ${esc(t15[0].label)} 佔 ${pct(t15[0].share)}` : '沒有資料',
      rankBars(t15, { onClick: true }), table(['#', '款號', '淨營收', '佔比', ...(hasPrev ? ['去年同期', '成長'] : [])], t15.map((r, i) => [i + 1, esc(r.label), fmt.money(r.net), pct(r.share), ...(hasPrev ? [fmt.money(r.prevNet), arrow(chg(r.net, r.prevNet))] : [])])), prevLegend));

    // 區域佔比
    const rg = segBars('region', REGION_ORDER);
    const rTop = rg.rows.slice().sort((a, b) => (b.cs || 0) - (a.cs || 0))[0];
    const rMove = hasPrev ? rg.rows.slice().sort((a, b) => Math.abs((b.cs || 0) - (b.ps || 0)) - Math.abs((a.cs || 0) - (a.ps || 0)))[0] : null;
    cards.push(card('rpRegion', '區域佔比', rTop ? `最大是${esc(rTop.n)}（${pct(rTop.cs)}）${rMove && rMove.ps != null ? `；比例變化最大的是${esc(rMove.n)}（${pct(rMove.ps)} → ${pct(rMove.cs)}）` : ''}` : '沒有資料', rg.html, rg.tableHtml));

    // 各品項（商品類別）佔比
    const ct = withPrev('cat');
    let cl = ct.list.slice(0, 12);
    if (ct.list.length > 12) {
      const rest = ct.list.slice(12);
      cl = cl.concat([{ other: true, label: `其他 ${rest.length} 項`, net: rest.reduce((s, r) => s + r.net, 0), share: rest.reduce((s, r) => s + (r.share || 0), 0), prevNet: 0 }]);
    }
    const noCat = !(meta.cat && meta.cat.map);
    cards.push(card('rpCat', '各品項佔比（商品類別）', ct.list.length ? `最大的品項是「${esc(ct.list[0].label)}」，佔 ${pct(ct.list[0].share)}${noCat ? '。<span class="muted">還沒匯入商品類別代碼表，所以只顯示代碼。</span>' : ''}` : '沒有資料',
      rankBars(cl), table(['#', '品項', '淨營收', '佔比', ...(hasPrev ? ['去年同期', '成長'] : [])], ct.list.map((r, i) => [i + 1, esc(r.label), fmt.money(r.net), pct(r.share), ...(hasPrev ? [fmt.money(r.prevNet), arrow(chg(r.net, r.prevNet))] : [])])), prevLegend));

    // 男女童百貨比例（大類）
    let bigRows = null;
    if (noCat) {
      cards.push(card('rpBig', '男女童百貨比例', '需要先匯入商品類別代碼表（資料與設定 → 商品類別代碼表），才分得出男、女、童、百貨。', '<p class="missing">缺少：商品類別代碼表</p>', ''));
    } else {
      const bg = segBars('big', BIG_ORDER); bigRows = bg.rows;
      const bTop = bg.rows.slice().sort((a, b) => (b.cs || 0) - (a.cs || 0));
      cards.push(card('rpBig', '男女童百貨比例', bTop.length ? bTop.slice(0, 3).map((t) => `${esc(t.n)} ${pct(t.cs)}${t.ps != null ? `（去年 ${pct(t.ps)}）` : ''}`).join('、') : '沒有資料', bg.html, bg.tableHtml));
    }

    // 商品毛利貢獻排行（款號）：淺色 = 淨營收、深色 = 其中的淨毛利（同一個金額刻度）；毛利率寫在旁邊
    const gp = withPrev('style', 'netProfit').list.slice(0, 15);
    const gpTop = gp[0];
    cards.push(card('rpProfit', '商品毛利貢獻排行（款號）', gpTop ? `毛利貢獻第一名 ${esc(gpTop.label)}：淨毛利 ${fmt.big(gpTop.netProfit)}，佔全部毛利 <b>${pct(gpTop.npShare)}</b>，毛利率 ${pct(gpTop.margin)}` : '沒有資料',
      rankBars(gp, { value: 'net', inner: 'netProfit', prevKey: 'prevNet', share: (r) => r.npShare, onClick: true,
        extra: { html: (r) => `<span class="rb-margin">毛利率 ${pct(r.margin)}</span>`, tip: (r) => `淨毛利：${fmt.money(r.netProfit)}（毛利率 ${pct(r.margin)}）` } }),
      table(['#', '款號', '淨毛利', '佔全部毛利', '淨營收', '毛利率'], gp.map((r, i) => [i + 1, esc(r.label), fmt.money(r.netProfit), pct(r.npShare), fmt.money(r.net), pct(r.margin)])),
      `<p class="rp-legend"><span><i class="lg-bar soft"></i>淨營收</span><span><i class="lg-bar"></i>其中的淨毛利</span>${hasPrev ? `<span><i class="lg-prev"></i>去年同期淨營收</span>` : ''}　右邊的 % 是佔全部毛利的比例</p>`));

    $('#rpBody').innerHTML = cards.join('');

    // 每月折線（今年 vs 去年，同一個刻度）
    const drawMonthly = () => {
      const el = $('#rpMonthChart'); if (!el) return;
      const p = E.pivot({ rows: ['ym'], cols: null, measures: ['net'], filter: { ymFrom: (year - 1) * 100 + 1, ymTo: year * 100 + 12 } });
      const by = new Map(p.rows.map((r) => [E.ymList[r.codes[0]], r.vals[0][0]]));
      const labels = Array.from({ length: 12 }, (_, i) => (i + 1) + '月');
      const series = [{ name: year + '年', cls: 's1', values: labels.map((_, i) => (i + 1 <= endM || year !== refY) && by.has(year * 100 + i + 1) ? by.get(year * 100 + i + 1) : null) }];
      if (hasPrev) series.unshift({ name: (year - 1) + '年', cls: 's3', values: labels.map((_, i) => (by.has((year - 1) * 100 + i + 1) ? by.get((year - 1) * 100 + i + 1) : null)) });
      root.Charts.render(el, { type: 'line', labels, series, fmt: fmt.money, axisFmt: fmt.axis, title: '每月淨營收' });
    };
    drawMonthly();

    // 點排名看明細
    const lists = { rpCust: [t10, 'ck'], rpProd: [t15, 'style'], rpProfit: [gp, 'style'] };
    for (const id in lists) {
      const box = $('#' + id + ' .rb'); if (!box) continue;
      box.onclick = (e) => {
        if (document.body.classList.contains('presenting')) return;
        const row = e.target.closest('.rb-row.click'); if (!row) return;
        const r = lists[id][0][+row.dataset.i]; ctx.drill(lists[id][1], r.code, r.label);
      };
    }
    return { redraw: drawMonthly, cur, prev, top10Share: t10s, top15Share: t15s, region: rg.rows, big: bigRows };
  }

  // ---------- 提示框（滑鼠移到長條上）----------
  function bindTips(container) {
    let tip = document.getElementById('rpTip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'rpTip'; tip.className = 'rp-tip'; tip.hidden = true; document.body.appendChild(tip); }
    container.addEventListener('mousemove', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) { tip.hidden = true; return; }
      tip.innerHTML = t.dataset.tip.split('\n').map((l, i) => (i ? `<div>${l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>` : `<b>${l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</b>`)).join('');
      tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + 'px';
      tip.style.top = Math.max(8, Math.min(innerHeight - h - 8, e.clientY + 14)) + 'px';
    });
    container.addEventListener('mouseleave', () => { tip.hidden = true; });
  }

  root.Report = { render, bindTips };
})(window);

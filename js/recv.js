/* 應收帳款：收款登記（照紅單／Excel「客戶應收帳款明細表」的欄位輸入，網站自動算、自動抓錯）與應收分析。
   資料存在 S.meta.recv（跟銷售資料一起用開啟密碼加密、跟著資料包到手機；重新匯入銷售資料不會不見）。
   算法和使用者的 Excel 一樣（2026-11-10）：
     應收淨額（自動結算）= 應收帳款 − 退貨 − 補價 − 折率 + 稅金 − 其他
     對得上 ⇔ 應收淨額 = 實收 + 前先入 + 前溢入 + 溢入 + 保留 + 不足 + 多入 + 運金（調整欄照輸入的正負號直接加，和 Excel 一樣）
   折率可以輸入「6%」：用（應收 − 退貨）× 6% 四捨五入算出金額。 */
(function (root) {
  const ADJ = [['preAdv', '前先入', '+'], ['preOver', '前溢入', '+'], ['over', '溢入', '−'], ['hold', '保留', '+'], ['short', '不足', '+'], ['more', '多入', '−'], ['freight', '運金', '+']];
  const MAIN = [['ar', '應收帳款'], ['ret', '退貨'], ['bu', '補價'], ['disc', '折率'], ['tax', '稅金'], ['other', '其他'], ['paid', '實收']];
  const NUMK = MAIN.map((x) => x[0]).concat(ADJ.map((x) => x[0]));
  const v = (r, k) => +r[k] || 0;
  const r2 = (x) => Math.round(x * 100) / 100;
  function calc(r) {
    const due = v(r, 'ar') - v(r, 'ret') - v(r, 'bu') - v(r, 'disc') + v(r, 'tax') - v(r, 'other');
    const adj = ADJ.reduce((t, [k]) => t + v(r, k), 0);
    return { due: r2(due), adj: r2(adj), diff: r2(due - v(r, 'paid') - adj) };
  }
  // 同一位客戶同一個月可能有好幾行（Excel 裡代號寫「-------」的續行），合起來對得上就算對（使用者的 Excel 也是這樣記）
  const gkey = (r) => r.ym + '|' + r.code;
  function groupDiffs(rows) { const m = new Map(); rows.forEach((r) => m.set(gkey(r), r2((m.get(gkey(r)) || 0) + calc(r).diff))); return m; }
  const isBad = (r, gd) => Math.abs(calc(r).diff) >= 0.5 && Math.abs(gd.get(gkey(r)) || 0) >= 0.5;
  const store = () => { const S = root.__app; S.meta = S.meta || {}; if (!S.meta.recv) S.meta.recv = { v: 1, rows: [] }; return S.meta.recv; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const ymOf = (S) => S.recvYm || 0;

  // 銷售資料（銷售分析）裡這位客戶這個月的出貨、退貨：用來核對應收
  function salesOf(ctx, code, ym) {
    const E = ctx.E; if (!E) return null;
    const ck = ctx.custByCode().get(code); if (!ck) return null;
    const res = E.pivot({ rows: ['ck'], cols: null, measures: ['sales', 'returns'], filter: { ymFrom: ym, ymTo: ym, dims: { ck: new Set([ck.ck]) } } }).rows[0];
    return res ? { sales: res.vals[0][0], returns: res.vals[0][1] } : { sales: 0, returns: 0 };
  }

  // ================= 收款登記 =================
  function renderEntry(ctx) {
    const { S, $, $$, esc, fmt, nf0, ymLabel } = ctx;
    const R = store();
    const yms = [...new Set(R.rows.map((r) => r.ym).concat(ctx.E ? ctx.E.ymList : []))].sort((a, b) => b - a);
    if (!S.recvYm || !yms.includes(S.recvYm)) S.recvYm = (R.rows.length ? Math.max(...R.rows.map((r) => r.ym)) : yms[0]) || 0;
    const ym = ymOf(S);
    const regions = [...new Set(R.rows.filter((r) => r.ym === ym).map((r) => r.region).filter(Boolean))];
    const f = S.recvF || (S.recvF = { region: '', q: '' });
    const rows = R.rows.filter((r) => r.ym === ym && (!f.region || r.region === f.region) && (!f.q || (r.code + r.name).toLowerCase().includes(f.q.toLowerCase())))
      .sort((a, b) => (a.region || '').localeCompare(b.region || '') || String(a.rep).localeCompare(String(b.rep)) || a.code.localeCompare(b.code));
    const custs = ctx.custList();
    let gd = groupDiffs(R.rows.filter((r) => r.ym === ym));
    const el = $('#recvBody');
    el.innerHTML = `
      <div class="toolbar recv-bar">
        <label class="inline">月份 <select id="rcYm">${yms.map((m) => `<option value="${m}" ${m === ym ? 'selected' : ''}>${ymLabel(m)}</option>`).join('')}</select></label>
        <div class="seg" id="rcRegion"><button data-v="" class="${!f.region ? 'on' : ''}">全部地區</button>${regions.map((g) => `<button data-v="${esc(g)}" class="${f.region === g ? 'on' : ''}">${esc(g)}</button>`).join('')}</div>
        <input type="search" id="rcSearch" placeholder="搜尋客戶代號或名稱" value="${esc(f.q)}">
        <span class="grow"></span><span id="recvSaved" class="hint"></span>
        <button class="btn" id="rcImport">匯入應收帳款 Excel</button><input type="file" id="rcFile" accept=".xlsx,.xlsm" hidden>
        <button class="btn" id="rcExport">匯出 CSV</button>
      </div>
      <div class="panel recv-add"><div class="row">
        <input id="rcNew" list="rcCusts" placeholder="輸入客戶代號或名稱，加入這個月" autocomplete="off">
        <datalist id="rcCusts">${custs.map((c) => `<option value="${esc(c.code)} ${esc(c.name)}">`).join('')}</datalist>
        <button class="btn primary" id="rcAdd">加入 ${ymLabel(ym)}</button>
        <span class="hint">輸入客戶時，下面會出現這位客戶前幾個月的明細。</span></div></div>
      <div id="rcSum"></div>
      <div class="panel"><div class="table-wrap recv-wrap"><table class="dt recv-t"><thead><tr>
        <th class="stick">代號</th><th class="stick2">客戶</th>${MAIN.map(([k, l]) => `<th class="n">${l}</th>`).join('')}
        ${ADJ.map(([k, l, s]) => `<th class="n adj">${l}<small>(${s})</small></th>`).join('')}
        <th class="n">應收淨額<small>自動</small></th><th>檢查</th><th>備註</th><th></th></tr></thead>
        <tbody>${rows.map((r) => rowHtml(r, ctx, gd)).join('') || `<tr><td colspan="22" class="empty">${ymLabel(ym)} 還沒有登記。上面輸入客戶加入，或匯入原本的應收帳款 Excel。</td></tr>`}</tbody></table></div>
        <p class="hint">算法和 Excel 一樣：應收淨額 = 應收 − 退貨 − 補價 − 折率 + 稅金 − 其他；對得上 = 應收淨額 等於 實收 + 右邊各項調整（照輸入的正負號相加）。折率可以直接打「6%」。黃色的格子 = 和銷售資料的出貨、退貨不一樣。代號「↳ 同上」= 同一位客戶的第二行，幾行加起來對得上就算對。</p></div>
      <div class="panel" id="rcHist" hidden></div>`;
    drawSum(ctx, rows);
    const save = () => ctx.saveRecv();
    $('#rcYm').onchange = (e) => { S.recvYm = +e.target.value; renderEntry(ctx); };
    $('#rcRegion').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; f.region = b.dataset.v; renderEntry(ctx); };
    $('#rcSearch').oninput = (e) => { f.q = e.target.value; clearTimeout(f._t); f._t = setTimeout(() => { renderEntry(ctx); const s = $('#rcSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250); };
    $('#rcImport').onclick = () => $('#rcFile').click();
    $('#rcFile').onchange = (e) => { const file = e.target.files[0]; e.target.value = ''; if (file) ctx.importRecv(file); };
    $('#rcExport').onclick = () => exportCsv(ctx, ym);
    const pick = () => {
      const t = $('#rcNew').value.trim(); if (!t) return null;
      const code = t.split(/\s+/)[0];
      return custs.find((c) => c.code === code) || custs.find((c) => (c.code + ' ' + c.name) === t) || { code, name: t.slice(code.length).trim(), region: '', rep: '' };
    };
    $('#rcNew').oninput = () => { const c = pick(); if (c && custs.some((x) => x.code === c.code)) showHist(ctx, c.code, c.name); };
    const add = () => {
      const c = pick(); if (!c) return;
      if (R.rows.some((r) => r.ym === ym && r.code === c.code) && !confirm(`${c.code} ${c.name} 這個月已經有一筆了，還要再加一筆嗎？`)) return;
      const s = salesOf(ctx, c.code, ym);
      const row = { id: uid(), ym, code: c.code, name: c.name, region: c.region || '', rep: c.rep || '', note: '', ar: s ? Math.round(s.sales) : 0, ret: s ? Math.round(s.returns) : 0 };
      NUMK.forEach((k) => { if (row[k] == null) row[k] = 0; });
      R.rows.push(row); save(); $('#rcNew').value = '';
      f.q = ''; renderEntry(ctx);
      const inp = $(`#recvBody tr[data-id="${row.id}"] input[data-k="paid"]`); if (inp) inp.focus();
      showHist(ctx, row.code, row.name);
    };
    $('#rcAdd').onclick = add;
    $('#rcNew').onkeydown = (e) => { if (e.key === 'Enter') add(); };
    // 編輯
    const tb = $('#recvBody tbody');
    tb.addEventListener('focusin', (e) => { const tr = e.target.closest('tr[data-id]'); if (!tr) return; const r = R.rows.find((x) => x.id === tr.dataset.id); if (r) showHist(ctx, r.code, r.name, r.id); });
    tb.addEventListener('change', (e) => {
      const inp = e.target.closest('[data-k]'); const tr = e.target.closest('tr[data-id]'); if (!inp || !tr) return;
      const r = R.rows.find((x) => x.id === tr.dataset.id); if (!r) return;
      const k = inp.dataset.k; let val = inp.value.trim();
      if (k === 'note') r.note = val;
      else if (k === 'disc' && /%$/.test(val)) {
        const pct = parseFloat(val); r.discPct = pct; r.disc = Math.round((v(r, 'ar') - v(r, 'ret')) * pct / 100);
      } else { const n = Number(val.replace(/[,\s$]/g, '')); r[k] = Number.isFinite(n) ? n : 0; if (k === 'disc') delete r.discPct; }
      r.updatedAt = new Date().toISOString();
      gd = groupDiffs(R.rows.filter((x) => x.ym === ym));
      R.rows.filter((x) => x.ym === ym && x.code === r.code).forEach((x) => { const t = el.querySelector(`tr[data-id="${x.id}"]`); if (t) t.outerHTML = rowHtml(x, ctx, gd); });
      drawSum(ctx, rows); save();
    });
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      const tr = b.closest('tr[data-id]'); const r = R.rows.find((x) => x.id === tr.dataset.id);
      if (!r || !confirm(`刪除 ${r.code} ${r.name} 在 ${ymLabel(r.ym)} 的這一筆？`)) return;
      R.rows.splice(R.rows.indexOf(r), 1); save(); renderEntry(ctx);
    });
    window.__recv = { ym, rows: rows.map((r) => ({ code: r.code, ...calc(r), group: gd.get(gkey(r)) })) }; // 測試用
  }

  function rowHtml(r, ctx, gd) {
    const { esc, fmt } = ctx;
    const c = calc(r);
    const gdiff = gd ? gd.get(gkey(r)) || 0 : c.diff;
    const s = salesOf(ctx, r.code, r.ym);
    const offA = s && Math.abs(v(r, 'ar') - s.sales) > 1, offR = s && Math.abs(v(r, 'ret') - s.returns) > 1;
    const inp = (k, warn, tip) => `<td class="n ${warn ? 'warn-cell' : ''}" ${tip ? `title="${esc(tip)}"` : ''}><input data-k="${k}" inputmode="decimal" value="${r[k] ? r[k] : ''}" ${k === 'disc' && r.discPct ? `placeholder="${r.discPct}%"` : ''}></td>`;
    const ok = Math.abs(c.diff) < 0.5, gok = Math.abs(gdiff) < 0.5;
    return `<tr data-id="${r.id}" class="${ok || gok ? '' : 'bad-row'} ${r.cont ? 'cont' : ''}"><td class="stick">${r.cont ? '<span class="muted">↳ 同上</span>' : esc(r.code)}</td><td class="stick2 lbl">${esc(r.name)}<small>${esc([r.region, r.rep && '業務 ' + r.rep].filter(Boolean).join('・'))}</small></td>` +
      MAIN.map(([k]) => inp(k, (k === 'ar' && offA) || (k === 'ret' && offR), k === 'ar' && offA ? `銷售資料這個月出貨 ${fmt.money(s.sales)}` : k === 'ret' && offR ? `銷售資料這個月退貨 ${fmt.money(s.returns)}` : (k === 'disc' && r.discPct ? `${r.discPct}%` : ''))).join('') +
      ADJ.map(([k]) => inp(k)).join('') +
      `<td class="n due">${fmt.money(c.due)}</td><td class="chk">${ok ? '<span class="ok">✓ 對得上</span>' : gok ? '<span class="ok" title="這位客戶這個月的幾行加起來對得上">✓ 合計對得上</span>' : `<span class="bad">差 ${fmt.money(gdiff)}</span>`}</td>` +
      `<td class="note"><input data-k="note" value="${esc(r.note || '')}" placeholder="特殊狀況寫這裡"></td><td><button class="icon-btn" data-del title="刪除這一筆">✕</button></td></tr>`;
  }

  function drawSum(ctx, rows) {
    const { $, fmt, nf0 } = ctx;
    const gd = groupDiffs(rows);
    const t = rows.reduce((a, r) => { const c = calc(r); a.due += c.due; a.paid += v(r, 'paid'); a.adj += c.adj; a.disc += v(r, 'disc'); return a; }, { due: 0, paid: 0, adj: 0, disc: 0 });
    t.bad = [...gd.values()].filter((d) => Math.abs(d) >= 0.5).length;
    $('#rcSum').innerHTML = `<div class="kpis recv-kpis">
      <div class="kpi"><div class="k">登記筆數</div><div class="v">${nf0.format(rows.length)}</div></div>
      <div class="kpi"><div class="k">應收淨額合計</div><div class="v">${fmt.money(t.due)}</div></div>
      <div class="kpi"><div class="k">實收合計</div><div class="v">${fmt.money(t.paid)}</div><div class="d">調整合計 ${fmt.money(t.adj)}</div></div>
      <div class="kpi"><div class="k">折讓合計</div><div class="v">${fmt.money(t.disc)}</div></div>
      <div class="kpi ${t.bad ? 'alert' : ''}"><div class="k">對不上（客戶）</div><div class="v">${t.bad ? `<span class="bad">${nf0.format(t.bad)} 位</span>` : '<span class="ok">全部對得上</span>'}</div><div class="d">差額合計 ${fmt.money(t.due - t.paid - t.adj)}</div></div></div>`;
  }

  // 客戶前幾個月的明細（使用者要求 A：輸入特定客人時，顯示之前幾個月的詳細資料）
  function showHist(ctx, code, name, curId) {
    const { $, esc, fmt, ymLabel } = ctx;
    const el = $('#rcHist'); if (!el) return;
    const all = store().rows.filter((r) => r.code === code).sort((a, b) => b.ym - a.ym);
    const ym = ymOf(ctx.S);
    const prevYms = [...new Set(all.filter((r) => r.ym < ym).map((r) => r.ym))].slice(0, 6);
    const prev = all.filter((r) => prevYms.includes(r.ym));
    const hgd = groupDiffs(store().rows.filter((r) => prevYms.includes(r.ym)));
    const last = prev[0];
    const s = salesOf(ctx, code, ym);
    const carry = last ? ADJ.filter(([k]) => ['over', 'hold', 'short', 'more', 'preAdv'].includes(k) && v(last, k)).map(([k, l]) => `${l} ${fmt.money(v(last, k))}`) : [];
    el.hidden = false;
    el.innerHTML = `<div class="panel-head"><h2>${esc(code)} ${esc(name || '')} 前幾個月的明細</h2><button class="icon-btn" id="rcHistX" title="關閉">✕</button></div>
      <p class="hint">${s ? `銷售資料 ${ymLabel(ym)}：出貨 <b>${fmt.money(s.sales)}</b>、退貨 <b>${fmt.money(s.returns)}</b>。` : ''}${last ? `上一次登記（${ymLabel(last.ym)}）留下：${carry.length ? carry.join('、') : '沒有不足、溢入、保留'}${last.note ? `；備註「${esc(last.note)}」` : ''}。` : '這位客戶之前沒有登記過。'}</p>
      ${prev.length ? `<div class="table-wrap"><table class="dt hist-t"><thead><tr><th>月份</th>${MAIN.map(([, l]) => `<th class="n">${l}</th>`).join('')}${ADJ.map(([, l]) => `<th class="n">${l}</th>`).join('')}<th class="n">應收淨額</th><th>檢查</th><th>備註</th></tr></thead><tbody>
        ${prev.map((r) => { const c = calc(r); return `<tr><td>${ymLabel(r.ym)}</td>${MAIN.map(([k]) => `<td class="n">${r[k] ? fmt.money(r[k]) : ''}</td>`).join('')}${ADJ.map(([k]) => `<td class="n">${r[k] ? fmt.money(r[k]) : ''}</td>`).join('')}<td class="n">${fmt.money(c.due)}</td><td>${!isBad(r, hgd) ? '<span class="ok">✓</span>' : `<span class="bad">差 ${fmt.money(hgd.get(gkey(r)))}</span>`}</td><td class="lbl">${esc(r.note || '')}</td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
    $('#rcHistX').onclick = () => { el.hidden = true; };
    window.__recvHist = { code, months: prevYms }; // 測試用
  }

  function exportCsv(ctx, ym) {
    const rows = store().rows.filter((r) => r.ym === ym);
    const head = ['月份', '地區', '業務員', '代號', '客戶名稱'].concat(MAIN.map((x) => x[1]), ADJ.map((x) => x[1]), ['應收淨額', '差額', '備註']);
    ctx.downloadCsv(`應收帳款_${ym}`, head, rows.map((r) => { const c = calc(r); return [ctx.ymLabel(r.ym), r.region, r.rep, r.code, r.name].concat(NUMK.map((k) => v(r, k)), [c.due, c.diff, r.note || '']); }));
  }

  // ================= 應收分析 =================
  function renderAnalysis(ctx) {
    const { S, $, esc, fmt, nf0, ymLabel, Charts } = ctx;
    const R = store();
    const el = $('#recvABody');
    if (!R.rows.length) { el.innerHTML = '<div class="panel"><p class="empty">還沒有應收帳款資料。到「收款登記」輸入，或匯入原本的應收帳款 Excel。</p></div>'; return; }
    const years = [...new Set(R.rows.map((r) => Math.floor(r.ym / 100)))].sort((a, b) => b - a);
    if (!years.includes(S.recvYear)) S.recvYear = years[0];
    const Y = S.recvYear;
    const rows = R.rows.filter((r) => Math.floor(r.ym / 100) === Y);
    const gdAll = groupDiffs(rows);
    const sum = (list) => { const a = list.reduce((a, r) => { const c = calc(r); NUMK.forEach((k) => { a[k] = (a[k] || 0) + v(r, k); }); a.due += c.due; a.adj += c.adj; a.diff += c.diff; a.n++; return a; }, { due: 0, adj: 0, diff: 0, n: 0 });
      a.bad = new Set(list.filter((r) => isBad(r, gdAll)).map(gkey)).size; return a; };
    const T = sum(rows);
    const months = [...new Set(rows.map((r) => r.ym))].sort((a, b) => a - b);
    const byM = months.map((m) => ({ ym: m, ...sum(rows.filter((r) => r.ym === m)) }));
    const pct = (a, b) => (b ? fmt.pct(a / b) : '—');
    const group = (key) => [...new Set(rows.map((r) => r[key] || '（空白）'))].map((g) => ({ g, ...sum(rows.filter((r) => (r[key] || '（空白）') === g)) })).sort((a, b) => b.due - a.due);
    // 每位客戶最近一次登記還有不足、保留、溢入的
    const latest = new Map(); R.rows.slice().sort((a, b) => a.ym - b.ym).forEach((r) => latest.set(r.code, r));
    const open = [...latest.values()].filter((r) => v(r, 'short') || v(r, 'hold') || v(r, 'over') || v(r, 'more')).sort((a, b) => b.ym - a.ym);
    const seen = new Set(); const bads = rows.filter((r) => isBad(r, gdAll) && !seen.has(gkey(r)) && seen.add(gkey(r))).sort((a, b) => b.ym - a.ym);
    el.innerHTML = `
      <div class="toolbar"><label class="inline">年度 <select id="raYear">${years.map((y) => `<option value="${y}" ${y === Y ? 'selected' : ''}>${y}年</option>`).join('')}</select></label></div>
      <div class="kpis">
        <div class="kpi"><div class="k">應收淨額</div><div class="v">${fmt.big(T.due)}</div><div class="d">${nf0.format(T.n)} 筆、${months.length} 個月</div></div>
        <div class="kpi"><div class="k">實收</div><div class="v">${fmt.big(T.paid || 0)}</div><div class="d">實收 ÷ 應收淨額 ${pct(T.paid || 0, T.due)}</div></div>
        <div class="kpi"><div class="k">折讓</div><div class="v">${fmt.big(T.disc || 0)}</div><div class="d">折讓率 ${pct(T.disc || 0, (T.ar || 0) - (T.ret || 0))}（÷ 應收−退貨）</div></div>
        <div class="kpi"><div class="k">退貨＋補價</div><div class="v">${fmt.big((T.ret || 0) + (T.bu || 0))}</div><div class="d">退貨 ${fmt.big(T.ret || 0)}、補價 ${fmt.big(T.bu || 0)}</div></div>
        <div class="kpi ${T.bad ? 'alert' : ''}"><div class="k">對不上（客戶・月）</div><div class="v">${T.bad ? `<span class="bad">${T.bad} 位</span>` : '<span class="ok">0 位</span>'}</div><div class="d">差額合計 ${fmt.money(T.diff)}</div></div>
      </div>
      <div class="panel"><div class="panel-head"><h2>每月應收淨額與實收</h2></div><p class="hint">深紅長條是應收淨額，藍線是實收。兩者差的部分是不足、保留、溢入等調整。</p><div class="chart" id="raChart"></div>
        <details class="num-table"><summary>數字表</summary><div class="table-wrap" id="raMonths"></div></details></div>
      <div class="grid2"><div class="panel"><div class="panel-head"><h2>各地區</h2></div><div class="table-wrap" id="raRegion"></div></div>
        <div class="panel"><div class="panel-head"><h2>各業務</h2></div><div class="table-wrap" id="raRep"></div></div></div>
      <div class="panel"><div class="panel-head"><h2>還有不足、保留、溢入的客戶</h2></div><p class="hint">每位客戶最近一次登記的狀況。點一列到那個月的收款登記。</p><div class="table-wrap" id="raOpen"></div></div>
      <div class="panel"><div class="panel-head"><h2>${Y}年對不上的客戶</h2></div><p class="hint">同一位客戶同一個月的幾行加起來，應收淨額 ≠ 實收 + 調整。點一列到那個月去改。</p><div class="table-wrap" id="raBad"></div></div>`;
    $('#raYear').onchange = (e) => { S.recvYear = +e.target.value; renderAnalysis(ctx); };
    Charts.render($('#raChart'), { type: 'combo', labels: byM.map((m) => ymLabel(m.ym)), series: [{ name: '應收淨額', kind: 'bar', cls: 'total', values: byM.map((m) => m.due) }, { name: '實收', kind: 'line', cls: 'c1', values: byM.map((m) => m.paid || 0) }], fmt: fmt.money, axisFmt: fmt.axis, title: '每月應收淨額與實收' });
    const cols = [{ key: 'due', label: '應收淨額', n: 1, fmt: 'money' }, { key: 'paid', label: '實收', n: 1, fmt: 'money' }, { key: 'disc', label: '折讓', n: 1, fmt: 'money' },
      { key: 'rate', label: '折讓率', n: 1, render: (r) => pct(r.disc || 0, (r.ar || 0) - (r.ret || 0)) }, { key: 'adj', label: '調整', n: 1, fmt: 'money' }, { key: 'bad', label: '對不上', n: 1, render: (r) => (r.bad ? `<span class="bad">${r.bad}</span>` : '0') }];
    ctx.table($('#raMonths'), [{ key: 'ym', label: '月份', render: (r) => ymLabel(r.ym) }, { key: 'ar', label: '應收', n: 1, fmt: 'money' }, { key: 'ret', label: '退貨', n: 1, fmt: 'money' }, { key: 'bu', label: '補價', n: 1, fmt: 'money' }, { key: 'tax', label: '稅金', n: 1, fmt: 'money' }, { key: 'other', label: '其他', n: 1, fmt: 'money' }].concat(cols), byM);
    ctx.table($('#raRegion'), [{ key: 'g', label: '地區', cls: 'lbl' }].concat(cols), group('region'));
    ctx.table($('#raRep'), [{ key: 'g', label: '業務', cls: 'lbl', render: (r) => esc(r.g === '（空白）' ? r.g : '業務 ' + r.g) }].concat(cols), group('rep'));
    const goTo = (r) => { S.recvYm = r.ym; S.recvF = { region: '', q: r.code }; ctx.go('recv'); };
    ctx.table($('#raOpen'), [{ key: 'ym', label: '月份', render: (r) => ymLabel(r.ym) }, { key: 'code', label: '代號' }, { key: 'name', label: '客戶', cls: 'lbl' }, { key: 'short', label: '不足', n: 1, fmt: 'money' }, { key: 'hold', label: '保留', n: 1, fmt: 'money' }, { key: 'over', label: '溢入', n: 1, fmt: 'money' }, { key: 'more', label: '多入', n: 1, fmt: 'money' }, { key: 'note', label: '備註', cls: 'lbl' }], open, { onRow: goTo, empty: '沒有。' });
    ctx.table($('#raBad'), [{ key: 'ym', label: '月份', render: (r) => ymLabel(r.ym) }, { key: 'code', label: '代號' }, { key: 'name', label: '客戶', cls: 'lbl' }, { key: 'due', label: '應收淨額', n: 1, render: (r) => fmt.money(calc(r).due) }, { key: 'paid', label: '實收', n: 1, fmt: 'money' }, { key: 'diff', label: '差額（這位客戶這個月合計）', n: 1, render: (r) => `<span class="bad">${fmt.money(gdAll.get(gkey(r)))}</span>` }, { key: 'note', label: '備註', cls: 'lbl' }], bads, { onRow: goTo, empty: '全部對得上。' });
    window.__recvA = { year: Y, due: T.due, paid: T.paid || 0, bad: T.bad, open: open.length }; // 測試用
  }

  root.Recv = { renderEntry, renderAnalysis, calc, groupDiffs, ADJ, MAIN };
})(window);

/* 應收帳款：收款登記（照紅單／Excel「客戶應收帳款明細表」的欄位輸入，網站自動算、自動抓錯）與應收分析。
   資料存在 S.meta.recv（跟銷售資料一起用開啟密碼加密、跟著資料包到手機；重新匯入銷售資料不會不見）。
   算法和使用者的 Excel 一樣（2026-11-10）：
     應收淨額（自動結算）= 應收帳款 − 退貨 − 補價 − 折率 + 稅金 − 其他
     對得上 ⇔ 應收淨額 = 實收 + 前先入 + 前溢入 + 溢入 + 保留 + 不足 + 多入 + 運金（調整欄照輸入的正負號直接加，和 Excel 一樣）
   折率（2026-11-10 使用者確認）：「折率%」欄填 6 或 6+1；第一次 =（應收 − 退貨 − 補價）× 6%，第二次 = 第一次折完後的金額 × 1%，各自四捨五入，
   折率金額 = 兩次相加。每位客人的折率記在 S.meta.recvRates[代號]，下次加入這位客人自動帶入。直接改折率金額 = 手動，不再自動算。
   「其他」改叫「尾數」（使用者要求，欄位 key 仍是 other）。
   支票／現金（使用者要求）：row.cash、row.checks = [{ no 支票號碼, acct 帳號, bank 付款銀行, kind 客|本（客票／本人票）, due 到期日 yyymmdd, amt 金額 }]；
   （2026-11-11 起不再自動算實收，只是記錄）
   2026-11-11 使用者修改：
   1.「折率」改叫「折讓」，金額可以自己打；「折率%」照打的保留。實際金額算到小數第二位顯示在下面，自己打的只要是「去掉小數」或「進位」都算對。
     （6+1：第一次 = 基數 × 6%，第二次 =（基數 − 第一次）× 1%，都不先四捨五入；自動填的 = 四捨五入）
   2. 實收直接輸入；「詳細」（現金、支票）只是記錄，不一定要填、也不用和實收一樣。
   3. 原本實收後面的 7 個調整欄，改成 ⊕／⊖ 一行一行加（不限幾行）：項目下拉選、金額、詳細。row.adj = [{ s: 1|-1, k 項目, amt 金額, note 詳細 }]，
     調整 = Σ s × amt。打過的新項目存在 S.meta.recvItems，下次可以選。舊資料（preAdv… 7 個欄位）打開時自動轉過來（照原本的正負號）。 */
(function (root) {
  const ADJ = [['preAdv', '前先入', '+'], ['preOver', '前溢入', '+'], ['over', '溢入', '−'], ['hold', '保留', '+'], ['short', '不足', '+'], ['more', '多入', '−'], ['freight', '運金', '+']];
  const MAIN = [['ar', '應收帳款'], ['ret', '退貨'], ['bu', '補價'], ['disc', '折讓'], ['tax', '稅金'], ['other', '尾數'], ['paid', '實收']];
  const NUMK = MAIN.map((x) => x[0]);
  const v = (r, k) => +r[k] || 0;
  const NF2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const r2 = (x) => Math.round(x * 100) / 100;
  // 調整：一行一行（⊕ 加、⊖ 減）
  const adjSum = (r) => (r.adj || []).reduce((t, a) => t + (a.s < 0 ? -1 : 1) * (+a.amt || 0), 0);
  const adjOf = (r, k) => (r.adj || []).filter((a) => a.k === k).reduce((t, a) => t + (a.s < 0 ? -1 : 1) * (+a.amt || 0), 0);
  // 舊格式（7 個欄位）→ 一行一行；匯入 Excel 時也用這個
  function normRow(r) {
    if (!Array.isArray(r.adj)) r.adj = [];
    ADJ.forEach(([k, l]) => { const x = +r[k] || 0; if (x) r.adj.push({ s: x < 0 ? -1 : 1, k: l, amt: Math.abs(x), note: '' }); delete r[k]; });
    if (r.disc && r.pct && !r.discParts) r.discManual = true; // 舊資料：折讓金額照原本的，不自動改
    return r;
  }
  function calc(r) {
    const due = v(r, 'ar') - v(r, 'ret') - v(r, 'bu') - v(r, 'disc') + v(r, 'tax') - v(r, 'other');
    const adj = adjSum(r);
    return { due: r2(due), adj: r2(adj), diff: r2(due - v(r, 'paid') - adj) };
  }
  // 同一位客戶同一個月可能有好幾行（Excel 裡代號寫「-------」的續行），合起來對得上就算對（使用者的 Excel 也是這樣記）
  const gkey = (r) => r.ym + '|' + r.code;
  function groupDiffs(rows) { const m = new Map(); rows.forEach((r) => m.set(gkey(r), r2((m.get(gkey(r)) || 0) + calc(r).diff))); return m; }
  const isBad = (r, gd) => Math.abs(calc(r).diff) >= 0.5 && Math.abs(gd.get(gkey(r)) || 0) >= 0.5;
  // 詳細（現金、支票）：不填沒關係；填了，合計就要等於實收（2026-11-11 第三次，使用者要求）
  const payBad = (r) => !!hasPay(r) && Math.abs(payTotal(r) - v(r, 'paid')) >= 0.5;
  // 折率：'6+1' → [6, 1]
  const parsePct = (t) => String(t || '').replace(/%/g, '').split(/[+＋,，、]/).map((x) => parseFloat(x)).filter((x) => Number.isFinite(x) && x > 0).slice(0, 2);
  // 實際的折讓金額（不先四捨五入）
  function discExact(r) {
    const p = parsePct(r.pct); if (!p.length) return null;
    const base = v(r, 'ar') - v(r, 'ret') - v(r, 'bu');
    const e1 = base * p[0] / 100, e2 = p[1] ? (base - e1) * p[1] / 100 : 0;
    return { total: e1 + e2, parts: p[1] ? [e1, e2] : null };
  }
  // 自己打的折讓：去掉小數或進位都算對
  function discOk(r) {
    const x = discExact(r); if (!x) return true;
    const d = v(r, 'disc'), t = x.total;
    return d === Math.floor(t + 1e-9) || d === Math.ceil(t - 1e-9) || Math.abs(d - t) < 0.005;
  }
  function applyPct(r) { const x = discExact(r); if (!x) return; r.disc = Math.round(x.total); delete r.discParts; }
  // 調整項目清單：⊕（加的）、⊖（減的）分開，使用者可以自己增刪（2026-11-11 第三次）。存在 S.meta.recvItemSets = { plus: [], minus: [] }
  // 第一次：預設照原本 Excel 的正負號分（前先入、前溢入、保留、不足、運金 → 加；溢入、多入 → 減）；之前自己打的新項目，用過減的放減、其他放加。
  function itemLists() {
    const S = root.__app; S.meta = S.meta || {};
    let L = S.meta.recvItemSets;
    if (!L || !Array.isArray(L.plus) || !Array.isArray(L.minus)) {
      L = S.meta.recvItemSets = { plus: ADJ.filter((x) => x[2] === '+').map((x) => x[1]), minus: ADJ.filter((x) => x[2] !== '+').map((x) => x[1]) };
      (S.meta.recvItems || []).forEach((k) => {
        if (L.plus.includes(k) || L.minus.includes(k)) return;
        const neg = store().rows.some((r) => (r.adj || []).some((a) => a.k === k && a.s < 0));
        (neg ? L.minus : L.plus).push(k);
      });
      delete S.meta.recvItems;
    }
    return L;
  }
  const itemsOf = (sg) => itemLists()[sg < 0 ? 'minus' : 'plus'];
  const addItem = (sg, k) => { const l = itemsOf(sg); if (k && !l.includes(k)) l.push(k); };
  const allItems = () => [...new Set(itemLists().plus.concat(itemLists().minus))];
  const rates = () => { const S = root.__app; S.meta = S.meta || {}; return S.meta.recvRates || (S.meta.recvRates = {}); };
  // 支票＋現金
  const hasPay = (r) => (r.checks && r.checks.length) || r.cash;
  const payTotal = (r) => (+r.cash || 0) + (r.checks || []).reduce((t, c) => t + (+c.amt || 0), 0);
  const store = () => {
    const S = root.__app; S.meta = S.meta || {}; if (!S.meta.recv) S.meta.recv = { v: 2, rows: [] };
    const R = S.meta.recv; if ((R.v || 1) < 2) { R.rows.forEach(normRow); R.v = 2; } // 舊資料轉成一行一行的調整
    return R;
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const ymOf = (S) => S.recvYm || 0;

  // 「保留」提醒（2026-11-11 使用者要求）：上次登記有保留 → 下個月要算，連同備註一起提醒輸入資料的人。
  // 每位客戶取「M 月以前最近一次登記」那個月（同月幾行合計）；保留不是 0 就提醒。M 月以後已經登記過的就不再出現在更後面的月份。
  // 按「算好了」記在那幾行的 holdDone（跟著資料加密存）。M = Infinity：每位客戶最近一次登記（首頁用）。
  function holdReminders(ctx, M) {
    const last = new Map();
    store().rows.forEach((r) => { if (r.ym >= M) return; const c = last.get(r.code); if (!c || r.ym > c.ym) last.set(r.code, { ym: r.ym, rows: [r] }); else if (r.ym === c.ym) c.rows.push(r); });
    const out = [];
    last.forEach((g, code) => {
      const hold = r2(g.rows.reduce((t, r) => t + adjOf(r, '保留'), 0));
      if (Math.abs(hold) < 0.5) return;
      const f = g.rows[0];
      out.push({ code, name: f.name, region: f.region || '', rep: f.rep || '', ym: g.ym, hold, note: g.rows.flatMap((r) => (r.adj || []).filter((a) => a.k === '保留' && a.note).map((a) => a.note).concat(r.note ? [r.note] : [])).join('；'),
        done: g.rows.every((r) => r.holdDone), ids: g.rows.map((r) => r.id), here: Number.isFinite(M) && store().rows.some((r) => r.ym === M && r.code === code) });
    });
    return out.sort((a, b) => a.done - b.done || a.region.localeCompare(b.region) || a.code.localeCompare(b.code));
  }
  let curHolds = new Map(); // 目前這個月：代號 → 上次的保留提醒（表格、卡片上標示用）
  // 版面：手機預設「卡片」（一位客戶一張，點開一格一格填），電腦預設「表格」；可以自己切換
  const layout = (S) => {
    if (S.recvLayout == null) { try { S.recvLayout = JSON.parse(localStorage.getItem('dv.recvLayout')) || ''; } catch (e) { S.recvLayout = ''; } }
    return S.recvLayout || (window.innerWidth <= 760 ? 'cards' : 'table');
  };

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
    curHolds = new Map(holdReminders(ctx, ym).map((h) => [h.code, h]));
    const cards = layout(S) === 'cards';
    const el = $('#recvBody');
    el.innerHTML = `
      <div class="toolbar recv-bar">
        <label class="inline">月份 <select id="rcYm">${yms.map((m) => `<option value="${m}" ${m === ym ? 'selected' : ''}>${ymLabel(m)}</option>`).join('')}</select></label>
        <div class="seg" id="rcRegion"><button data-v="" class="${!f.region ? 'on' : ''}">全部地區</button>${regions.map((g) => `<button data-v="${esc(g)}" class="${f.region === g ? 'on' : ''}">${esc(g)}</button>`).join('')}</div>
        <input type="search" id="rcSearch" placeholder="搜尋客戶代號或名稱" value="${esc(f.q)}">
        <div class="seg" id="rcLayout" title="手機建議用卡片"><button data-v="table" class="${layout(S) === 'table' ? 'on' : ''}">表格</button><button data-v="cards" class="${layout(S) === 'cards' ? 'on' : ''}">卡片</button></div>
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
      ${holdPanel(ctx, ym)}
      ${cards ? `<div class="panel rc-cards-panel"><div class="rc-cards" id="rcList">${rows.map((r) => cardHtml(r, ctx, gd, r.id === S.recvOpen)).join('') || `<p class="empty">${ymLabel(ym)} 還沒有登記。上面輸入客戶加入，或匯入原本的應收帳款 Excel。</p>`}</div>
        <p class="hint">點一位客戶打開來填。應收淨額 = 應收 − 退貨 − 補價 − 折讓 + 稅金 − 尾數；要等於 實收 + 調整（⊕ 加、⊖ 減）。黃色 = 和銷售資料的出貨、退貨不一樣。</p></div>` :
      `<div class="panel"><div class="table-wrap recv-wrap" id="rcList"><table class="dt recv-t"><thead><tr>
        <th class="stick">代號</th><th class="stick2">客戶</th>${MAIN.map(([k, l]) => (k === 'disc' ? '<th class="n pct">折率%</th>' : '') + `<th class="n c-${k}">${l}</th>` + (k === 'paid' ? '<th class="det">詳細</th>' : '')).join('')}
        <th class="adj-h">調整 <button type="button" class="it-btn" data-items title="增刪 ⊕／⊖ 的項目">⚙ 項目</button></th>
        <th class="n due">應收淨額</th><th class="note">備註</th><th></th></tr></thead>
        <tbody>${rows.map((r) => rowHtml(r, ctx, gd)).join('') || `<tr><td colspan="24" class="empty">${ymLabel(ym)} 還沒有登記。上面輸入客戶加入，或匯入原本的應收帳款 Excel。</td></tr>`}</tbody></table></div>
        <p class="hint">應收淨額 = 應收 − 退貨 − 補價 − 折讓 + 稅金 − 尾數；對得上 = 應收淨額 等於 實收 + 調整（⊕ 加、⊖ 減）。「折率%」填 6 或 6+1，折讓會自動算，也可以自己打：下面小字是實際金額（算到小數第二位），去掉小數或進位都算對。「詳細」記現金、支票：不填沒關係，填了現金＋支票的合計就要和實收一樣。黃色的格子 = 和銷售資料的出貨、退貨不一樣。代號「↳ 同上」= 同一位客戶的第二行，幾行加起來對得上就算對。</p></div>`}
      <div id="rcPanels">
      <div class="panel" id="rcItems" hidden></div>
      <div class="panel" id="rcPay" hidden></div>
      <div class="panel" id="rcHist" hidden></div></div>
      `;
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
    const park = () => { const home = $('#rcPanels'); ['#rcPay', '#rcHist', '#rcItems'].forEach((q) => { const n = $(q); if (n && n.parentNode !== home) { n.hidden = true; home.appendChild(n); } }); };
    // 卡片：點開一位客戶（同時只開一張）
    const openCard = (id) => {
      park();
      const prev = S.recvOpen; S.recvOpen = id;
      [prev, id].filter(Boolean).forEach((x) => { const r = R.rows.find((y) => y.id === x); const n = el.querySelector(`.rc-card[data-id="${x}"]`); if (r && n) n.outerHTML = cardHtml(r, ctx, gd, r.id === S.recvOpen); });
      const n = id && el.querySelector(`.rc-card[data-id="${id}"]`);
      if (n) { n.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    };
    const addCust = (c) => {
      if (R.rows.some((r) => r.ym === ym && r.code === c.code) && !confirm(`${c.code} ${c.name} 這個月已經有一筆了，還要再加一筆嗎？`)) return;
      const s = salesOf(ctx, c.code, ym);
      const row = { id: uid(), ym, code: c.code, name: c.name, region: c.region || '', rep: c.rep || '', note: '', adj: [], ar: s ? Math.round(s.sales) : 0, ret: s ? Math.round(s.returns) : 0 };
      NUMK.forEach((k) => { if (row[k] == null) row[k] = 0; });
      if (rates()[c.code]) { row.pct = rates()[c.code]; applyPct(row); }
      R.rows.push(row); save(); $('#rcNew').value = '';
      f.q = ''; S.recvOpen = row.id; renderEntry(ctx);
      const inp = $(`#recvBody [data-id="${row.id}"] input[data-k="paid"]`); if (inp) inp.focus();
      if (layout(S) === 'table') showHist(ctx, row.code, row.name);
      else { const n = $(`#recvBody .rc-card[data-id="${row.id}"]`); if (n) n.scrollIntoView({ block: 'start' }); }
    };
    const add = () => { const c = pick(); if (c) addCust(c); };
    $('#rcAdd').onclick = add;
    $('#rcNew').onkeydown = (e) => { if (e.key === 'Enter') add(); };
    $('#rcLayout').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.recvLayout = b.dataset.v; try { localStorage.setItem('dv.recvLayout', JSON.stringify(b.dataset.v)); } catch (er) { /* */ } renderEntry(ctx); };
    // 保留提醒：加入這個月、算好了
    const hp = $('#rcHold');
    if (hp) hp.addEventListener('click', (e) => {
      const ab = e.target.closest('[data-hold-add]');
      if (ab) { const code = ab.dataset.holdAdd; const h = curHolds.get(code); addCust(custs.find((c) => c.code === code) || { code, name: h ? h.name : '', region: h ? h.region : '', rep: h ? h.rep : '' }); return; }
      const gb = e.target.closest('[data-hold-go]');
      if (gb) { const x = R.rows.find((r) => r.ym === ym && r.code === gb.dataset.holdGo); if (!x) return; if (layout(S) === 'cards') openCard(x.id); else { const t = el.querySelector(`tr[data-id="${x.id}"]`); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); const i = t.querySelector('input[data-k="paid"]'); if (i) i.focus({ preventScroll: true }); } } }
    });
    if (hp) hp.addEventListener('change', (e) => {
      const cb = e.target.closest('[data-hold-done]'); if (!cb) return;
      const h = curHolds.get(cb.dataset.holdDone); if (!h) return;
      R.rows.filter((r) => h.ids.includes(r.id)).forEach((r) => { if (cb.checked) r.holdDone = true; else delete r.holdDone; });
      save(); renderEntry(ctx);
    });
    // 改了一列：重算同一位客戶這個月的幾行、上面的合計，再存檔。
    // 只更新算出來的地方（應收淨額、檢查、折讓小字、合計），正在打的那一格不動，按 Tab 到下一格不會跳掉。
    // full = true：調整多一行／少一行，整個調整區重畫
    const refresh = (r, full) => {
      r.updatedAt = new Date().toISOString();
      gd = groupDiffs(R.rows.filter((x) => x.ym === ym));
      const ae = document.activeElement;
      R.rows.filter((x) => x.ym === ym && x.code === r.code).forEach((x) => {
        const n = el.querySelector(`[data-id="${x.id}"]`); if (!n) return;
        if (n.classList.contains('rc-card') && !n.classList.contains('open')) { n.outerHTML = cardHtml(x, ctx, gd, false); return; }
        n.classList.toggle(n.tagName === 'TR' ? 'bad-row' : 'bad', isBad(x, gd) || payBad(x));
        n.querySelectorAll('[data-k]').forEach((i) => { if (i !== ae) i.value = valOf(x, i.dataset.k); });
        const di = n.querySelector('input[data-k="disc"]');
        if (di) {
          const box = n.tagName === 'TR' ? di.closest('td') : di.closest('.rc-f');
          const old = box.querySelector('.disc-note'); if (old) old.remove();
          di.insertAdjacentHTML('afterend', discNote(x, ctx));
          box.classList.toggle(n.tagName === 'TR' ? 'bad-cell' : 'bad', !discOk(x));
        }
        const ab = n.querySelector('.adj-box');
        if (ab && (full || x !== r)) ab.innerHTML = adjBox(x, ctx);
        else if (ab) { const t = ab.querySelector('.adj-foot'); const tmp = document.createElement('div'); tmp.innerHTML = adjBox(x, ctx); t.replaceWith(tmp.querySelector('.adj-foot')); }
        const pb = n.querySelector('[data-pay]'); if (pb) { pb.textContent = payLabel(x); pb.classList.toggle('on', !!hasPay(x)); pb.classList.toggle('bad', payBad(x)); }
        if (n.tagName === 'TR') { n.querySelector('.due-n').textContent = ctx.fmt.money(calc(x).due); n.querySelector('.chk').innerHTML = chkHtml(x, gd, ctx); }
        else { n.querySelector('.rc-head').innerHTML = cardHead(x, ctx, gd); n.querySelector('.rc-live').innerHTML = cardLive(x, ctx, gd); }
      });
      drawSum(ctx, rows); save();
      window.__recv = { ym, rows: rows.map((x) => ({ code: x.code, ...calc(x), group: gd.get(gkey(x)) })) };
    };
    // 增刪項目後，所有調整的下拉重畫
    const redrawAdj = () => el.querySelectorAll('[data-id]').forEach((n) => { const x = R.rows.find((y) => y.id === n.dataset.id); const ab = n.querySelector('.adj-box'); if (x && ab) ab.innerHTML = adjBox(x, ctx); });
    const openItems = (from) => {
      showItems(ctx, redrawAdj);
      const card = from && from.closest('.rc-card'); const slot = card && card.querySelector('.rc-slot');
      if (slot) { slot.appendChild($('#rcItems')); $('#rcItems').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    };
    // 編輯（表格的一列或一張卡片都有 data-id）
    const list = $('#rcList');
    const rowOf = (t) => { const n = t.closest('[data-id]'); return n ? R.rows.find((x) => x.id === n.dataset.id) : null; };
    const num = (t) => { const n = Number(String(t).replace(/[,\s$]/g, '')); return Number.isFinite(n) ? n : 0; };
    list.addEventListener('focusin', (e) => { if (layout(S) !== 'table') return; const r = rowOf(e.target); if (r) showHist(ctx, r.code, r.name, r.id); });
    list.addEventListener('change', (e) => {
      const r = rowOf(e.target); if (!r) return;
      // 調整的一行
      const ai = e.target.closest('[data-a]');
      if (ai) {
        const line = r.adj[+ai.closest('.adj-line').dataset.i]; if (!line) return;
        const f = ai.dataset.a;
        if (f === 'k') {
          if (ai.value === '__edit') { ai.value = line.k || ''; openItems(ai); return; }
          if (ai.value === '__new') {
            const name = (prompt('新項目的名稱（例如：代墊運費）') || '').trim();
            if (!name) { ai.value = line.k || ''; return; }
            line.k = name; addItem(line.s, name);
            refresh(r, true); return;
          }
          line.k = ai.value;
          refresh(r, true); // 項目改成「保留」時，詳細欄的提示要換
          return;
        }
        if (f === 'amt') line.amt = num(ai.value); else line.note = ai.value.trim();
        refresh(r); return;
      }
      const inp = e.target.closest('[data-k]'); if (!inp) return;
      const k = inp.dataset.k; const val = inp.value.trim();
      if (k === 'note') r.note = val;
      else if (k === 'pct' || (k === 'disc' && /%$/.test(val))) {
        r.pct = parsePct(val).join('+');
        if (r.pct) { rates()[r.code] = r.pct; delete r.discManual; applyPct(r); } else { delete r.pct; delete r.discManual; }
      } else if (k === 'disc') {
        if (val === '') { delete r.discManual; r.disc = 0; if (r.pct) applyPct(r); } // 清空 = 回到自動算
        else { r.disc = num(val); if (r.pct) r.discManual = true; } // 自己打的折讓：折率% 留著，下面顯示實際金額
      } else {
        r[k] = num(val);
        if ((k === 'ar' || k === 'ret' || k === 'bu') && r.pct && !r.discManual) applyPct(r); // 金額改了，折讓跟著重算（自己打的不動，只檢查）
      }
      refresh(r);
    });
    list.addEventListener('click', (e) => {
      if (e.target.closest('[data-open]')) { const n = e.target.closest('.rc-card'); openCard(n.classList.contains('open') ? null : n.dataset.id); return; }
      if (e.target.closest('[data-close]')) { openCard(null); return; }
      const ib = e.target.closest('[data-items]'); if (ib) { openItems(ib); return; }
      // 調整：⊕／⊖ 加一行、切換加減、刪一行
      const aa = e.target.closest('[data-aadd]');
      if (aa) {
        const r = rowOf(aa); if (!r) return; r.adj = r.adj || [];
        r.adj.push({ s: +aa.dataset.aadd < 0 ? -1 : 1, k: '', amt: 0, note: '' });
        refresh(r, true);
        const box = el.querySelector(`[data-id="${r.id}"] .adj-box`); const sel = box && box.querySelectorAll('select[data-a="k"]');
        if (sel && sel.length) sel[sel.length - 1].focus();
        return;
      }
      const sg = e.target.closest('[data-sg]');
      if (sg) { const r = rowOf(sg); const line = r && r.adj[+sg.closest('.adj-line').dataset.i]; if (!line) return; line.s = line.s < 0 ? 1 : -1; refresh(r, true); return; }
      const ad = e.target.closest('[data-adel]');
      if (ad) { const r = rowOf(ad); if (!r) return; r.adj.splice(+ad.closest('.adj-line').dataset.i, 1); refresh(r, true); return; }
      const pb = e.target.closest('[data-pay]');
      if (pb) { const r = rowOf(pb); if (!r) return; showPay(ctx, r, refresh); const slot = pb.closest('.rc-card') && pb.closest('.rc-card').querySelector('.rc-slot'); if (slot) { slot.appendChild($('#rcPay')); $('#rcPay').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } return; }
      const hb = e.target.closest('[data-hist]');
      if (hb) { const r = rowOf(hb); if (!r) return; showHist(ctx, r.code, r.name, r.id); const slot = hb.closest('.rc-card').querySelector('.rc-slot'); slot.appendChild($('#rcHist')); $('#rcHist').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      const b = e.target.closest('[data-del]'); if (!b) return;
      const r = rowOf(b);
      if (!r || !confirm(`刪除 ${r.code} ${r.name} 在 ${ymLabel(r.ym)} 的這一筆？`)) return;
      R.rows.splice(R.rows.indexOf(r), 1); save(); renderEntry(ctx);
    });
    window.__recv = { ym, rows: rows.map((r) => ({ code: r.code, ...calc(r), group: gd.get(gkey(r)) })) }; // 測試用
  }

  // 折讓下面的小字：實際金額（小數第二位）；自己打的不是「去掉小數」或「進位」就標紅
  function discNote(r, ctx) {
    const x = discExact(r); if (!x) return '';
    const f2 = (n) => NF2.format(n);
    const ok = discOk(r);
    return `<small class="disc-note ${ok ? '' : 'bad'}" title="${x.parts ? `第一次 ${f2(x.parts[0])}＋第二次 ${f2(x.parts[1])}` : ''}">實際 ${f2(x.total)}${ok ? '' : `，可填 ${Math.floor(x.total + 1e-9)} 或 ${Math.ceil(x.total - 1e-9)}`}</small>`;
  }
  const chkHtml = (r, gd, ctx) => {
    const c = calc(r), gdiff = gd ? gd.get(gkey(r)) || 0 : c.diff;
    return (Math.abs(c.diff) < 0.5 ? '<span class="ok">✓ 對得上</span>' : Math.abs(gdiff) < 0.5 ? '<span class="ok" title="這位客戶這個月的幾行加起來對得上">✓ 合計對得上</span>' : `<span class="bad">差 ${ctx.fmt.money(gdiff)}</span>`) +
      (payBad(r) ? `<span class="bad pay-bad" title="現金＋支票 ${ctx.fmt.money(payTotal(r))}，實收 ${ctx.fmt.money(v(r, 'paid'))}">詳細≠實收</span>` : '');
  };
  const adjTxt = (a, ctx) => `${a.s < 0 ? '−' : '+'} ${ctx.esc(a.k || '（沒選項目）')} ${ctx.fmt.money(+a.amt || 0)}${a.note ? `（${ctx.esc(a.note)}）` : ''}`;
  // 調整：一行一行（⊕／⊖、項目、金額、詳細），下面 ⊕ ⊖ 加一行、合計
  function adjBox(r, ctx) {
    const { esc, fmt } = ctx;
    const list = r.adj || [];
    const opts = (sg, k) => { const l = itemsOf(sg); return `<option value="" ${!k ? 'selected' : ''} disabled>選項目</option>` + l.concat(k && !l.includes(k) ? [k] : []).map((x) => `<option ${x === k ? 'selected' : ''}>${esc(x)}</option>`).join('') + `<option value="__new">＋ 新項目…</option><option value="__edit">⚙ 增刪${sg < 0 ? '減' : '加'}的項目…</option>`; };
    const tot = adjSum(r);
    return list.map((a, i) => `<div class="adj-line ${a.s < 0 ? 'neg' : 'pos'}" data-i="${i}">
        <button type="button" class="sgn ${a.s < 0 ? 'minus' : 'plus'}" data-sg title="按一下切換 加／減">${a.s < 0 ? '−' : '+'}</button>
        <select data-a="k">${opts(a.s, a.k)}</select>
        <input data-a="amt" inputmode="decimal" value="${a.amt ? a.amt : ''}" placeholder="金額" autocomplete="off">
        <input data-a="note" value="${esc(a.note || '')}" placeholder="${a.k === '保留' ? '原因（下個月會提醒）' : '詳細'}" autocomplete="off">
        <button type="button" class="icon-btn" data-adel title="刪掉這一行">✕</button></div>`).join('') +
      `<div class="adj-foot"><button type="button" class="sgn plus" data-aadd="1" title="加一行（加）">+</button><button type="button" class="sgn minus" data-aadd="-1" title="加一行（減）">−</button>
        <span class="adj-tot">${list.length ? `調整合計 <b>${tot > 0 ? '+' : ''}${fmt.money(tot)}</b>` : '<span class="muted">沒有調整就不用加</span>'}</span>${adjOf(r, '保留') ? '<small class="hold-next">保留：下個月要算</small>' : ''}</div>`;
  }

  function rowHtml(r, ctx, gd) {
    const { esc, fmt } = ctx;
    const c = calc(r);
    const s = salesOf(ctx, r.code, r.ym);
    const offA = s && Math.abs(v(r, 'ar') - s.sales) > 1, offR = s && Math.abs(v(r, 'ret') - s.returns) > 1;
    const inp = (k) => {
      const warn = (k === 'ar' && offA) || (k === 'ret' && offR) || (k === 'disc' && !discOk(r));
      const tip = k === 'ar' && offA ? `銷售資料這個月出貨 ${fmt.money(s.sales)}` : k === 'ret' && offR ? `銷售資料這個月退貨 ${fmt.money(s.returns)}` : '';
      const cell = `<td class="n c-${k} ${warn ? (k === 'disc' ? 'bad-cell' : 'warn-cell') : ''}" ${tip ? `title="${esc(tip)}"` : ''}><input data-k="${k}" inputmode="decimal" value="${r[k] ? r[k] : ''}">` +
        (k === 'disc' ? discNote(r, ctx) : '') + '</td>';
      return (k === 'disc' ? `<td class="n pct"><input data-k="pct" value="${esc(r.pct || '')}" placeholder="%"></td>` : '') + cell +
        (k === 'paid' ? `<td class="det"><button class="pay-btn ${hasPay(r) ? 'on' : ''} ${payBad(r) ? 'bad' : ''}" data-pay title="記下現金、支票（不填沒關係；填了合計要等於實收）">${payLabel(r)}</button></td>` : '');
    };
    const bad = isBad(r, gd) || payBad(r);
    return `<tr data-id="${r.id}" class="${bad ? 'bad-row' : ''} ${r.cont ? 'cont' : ''}"><td class="stick">${r.cont ? '<span class="muted">↳ 同上</span>' : esc(r.code)}</td><td class="stick2 lbl">${esc(r.name)}<small>${esc([r.region, r.rep && '業務 ' + r.rep].filter(Boolean).join('・'))}</small>${r.cont ? '' : holdTag(r, ctx)}</td>` +
      MAIN.map(([k]) => inp(k)).join('') +
      `<td class="adj-cell"><div class="adj-box">${adjBox(r, ctx)}</div></td>` +
      `<td class="n due"><b class="due-n">${fmt.money(c.due)}</b><div class="chk">${chkHtml(r, gd, ctx)}</div></td>` +
      `<td class="note"><input data-k="note" value="${esc(r.note || '')}" placeholder="${adjOf(r, '保留') ? '寫保留的原因，下個月會提醒' : '特殊狀況寫這裡'}"></td><td><button class="icon-btn" data-del title="刪除這一筆">✕</button></td></tr>`;
  }

  const payLabel = (r) => (payBad(r) ? '詳細 ≠' : hasPay(r) ? '詳細 ✓' : '詳細');
  const valOf = (r, k) => (k === 'pct' ? r.pct || '' : k === 'note' ? r.note || '' : r[k] ? r[k] : '');
  // 這位客戶上次登記有保留 → 這個月要算（表格的客戶名下面、卡片上都標出來，滑過去看備註）
  function holdTag(r, ctx) {
    const h = curHolds.get(r.code); if (!h || h.ym >= r.ym) return '';
    return `<span class="hold-tag ${h.done ? 'done' : ''}" title="${ctx.esc(h.note ? '備註：' + h.note : '沒有備註')}">${h.done ? '✓ ' : ''}${ctx.ymLabel(h.ym)} 保留 ${ctx.fmt.money(h.hold)}${h.done ? ' 已算' : ' 要算'}</span>`;
  }
  function holdPanel(ctx, ym) {
    const { esc, fmt, ymLabel } = ctx;
    const list = [...curHolds.values()];
    if (!list.length) return '';
    const todo = list.filter((h) => !h.done);
    return `<div class="panel hold-panel ${todo.length ? '' : 'all-done'}" id="rcHold">
      <div class="panel-head"><h2>${todo.length ? `<span class="hold-ic">!</span> 有 ${todo.length} 位客戶上次「保留」，${ymLabel(ym)} 要算` : `上次的「保留」都算好了`}</h2></div>
      <p class="hint">保留的錢要在下個月一起算。算進去以後勾「算好了」，這裡就不會再提醒。</p>
      <div class="hold-list">${list.map((h) => `<div class="hold-item ${h.done ? 'done' : ''}">
        <div class="hi-who"><b>${esc(h.code)}</b> ${esc(h.name || '')}<small>${esc([h.region, h.rep && '業務 ' + h.rep].filter(Boolean).join('・'))}</small></div>
        <div class="hi-amt">${ymLabel(h.ym)} 保留 <b>${fmt.money(h.hold)}</b></div>
        <div class="hi-note">${h.note ? `備註：${esc(h.note)}` : '<span class="muted">（沒有寫備註）</span>'}</div>
        <div class="hi-act">${h.here ? `<button class="btn small" data-hold-go="${esc(h.code)}">這個月已加入 → 去填</button>` : `<button class="btn small primary" data-hold-add="${esc(h.code)}">加入 ${ymLabel(ym)}</button>`}
          <label class="hi-done"><input type="checkbox" data-hold-done="${esc(h.code)}" ${h.done ? 'checked' : ''}> 算好了</label></div></div>`).join('')}</div></div>`;
  }

  // ===== 手機版：一位客戶一張卡片 =====
  const CARD_MAIN = [['ar', '應收帳款'], ['ret', '退貨'], ['bu', '補價'], ['pct', '折率%'], ['disc', '折讓'], ['tax', '稅金'], ['other', '尾數']];
  function cardHead(r, ctx, gd) {
    const { esc, fmt } = ctx;
    const c = calc(r), gdiff = gd.get(gkey(r)) || 0, ok = Math.abs(c.diff) < 0.5 || Math.abs(gdiff) < 0.5;
    const blank = !v(r, 'paid') && !(r.adj || []).length;
    return `<span class="rh-who"><b>${r.cont ? '↳ 同上' : esc(r.code)}</b> ${esc(r.name)}<small>${esc([r.region, r.rep && '業務 ' + r.rep].filter(Boolean).join('・'))}</small></span>
      <span class="rh-amt"><small>應收淨額</small>${fmt.money(c.due)}</span>
      <span class="rh-st">${ok ? '<span class="ok">✓ 對得上</span>' : blank ? '<span class="todo">還沒填實收</span>' : `<span class="bad">差 ${fmt.money(gdiff)}</span>`}${payBad(r) ? '<span class="bad">詳細≠實收</span>' : ''}
        ${r.cont ? '' : holdTag(r, ctx)}${adjOf(r, '保留') ? `<span class="hold-tag now">本月保留 ${fmt.money(adjOf(r, '保留'))}・下個月要算</span>` : ''}</span>
      ${r.note ? `<span class="rh-note">備註：${esc(r.note)}</span>` : ''}`;
  }
  function cardLive(r, ctx, gd) {
    const { fmt } = ctx;
    const c = calc(r), gdiff = gd.get(gkey(r)) || 0;
    return `<div><small>應收淨額</small><b>${fmt.money(c.due)}</b></div><div><small>實收＋調整</small><b>${fmt.money(v(r, 'paid') + c.adj)}</b></div>
      <div class="${Math.abs(c.diff) < 0.5 || Math.abs(gdiff) < 0.5 ? 'ok' : 'bad'}"><small>差額</small><b>${Math.abs(c.diff) < 0.5 ? '0 ✓' : fmt.money(c.diff)}</b></div>`;
  }
  function cardHtml(r, ctx, gd, open) {
    const { esc, fmt } = ctx;
    const c = calc(r), gdiff = gd.get(gkey(r)) || 0;
    const bad = (Math.abs(c.diff) >= 0.5 && Math.abs(gdiff) >= 0.5 && (v(r, 'paid') || (r.adj || []).length)) || payBad(r);
    const head = `<button type="button" class="rc-head" data-open aria-expanded="${open ? 'true' : 'false'}">${cardHead(r, ctx, gd)}</button>`;
    if (!open) return `<div class="rc-card ${bad ? 'bad' : ''}" data-id="${r.id}">${head}</div>`;
    const s = salesOf(ctx, r.code, r.ym);
    const offA = s && Math.abs(v(r, 'ar') - s.sales) > 1, offR = s && Math.abs(v(r, 'ret') - s.returns) > 1;
    const field = (k, label) => {
      const warn = (k === 'ar' && offA) || (k === 'ret' && offR);
      const tip = k === 'ar' && offA ? `銷售資料出貨 ${fmt.money(s.sales)}` : k === 'ret' && offR ? `銷售資料退貨 ${fmt.money(s.returns)}` : k === 'pct' ? '填 6 或 6+1' : '';
      return `<label class="rc-f ${warn ? 'warn' : ''} ${k === 'disc' && !discOk(r) ? 'bad' : ''}"><span>${label}</span><input data-k="${k}" ${k === 'pct' ? 'inputmode="text" placeholder="6+1"' : 'inputmode="decimal"'} value="${esc(valOf(r, k))}" autocomplete="off">${k === 'disc' ? `<span class="disc-slot">${discNote(r, ctx)}</span>` : tip ? `<small>${esc(tip)}</small>` : ''}</label>`;
    };
    const nAdj = (r.adj || []).length;
    return `<div class="rc-card open ${bad ? 'bad' : ''}" data-id="${r.id}">${head}<div class="rc-body">
      <div class="rc-sec"><h4>應收</h4><div class="rc-grid">${CARD_MAIN.map(([k, l]) => field(k, l)).join('')}</div></div>
      <div class="rc-sec"><h4>實收</h4><div class="rc-grid">${field('paid', '實收金額')}<div class="rc-f"><span>現金、支票</span><button type="button" class="btn pay-btn2 ${hasPay(r) ? 'on' : ''}" data-pay>${payLabel(r)}</button><small>不填沒關係；填了合計要等於實收</small></div></div></div>
      <div class="rc-sec"><h4>調整 <small class="muted">${nAdj ? '' : '沒有就不用加'}</small> <button type="button" class="it-btn" data-items>⚙ 項目</button></h4><div class="adj-box">${adjBox(r, ctx)}</div></div>
      <div class="rc-sec"><label class="rc-f wide"><span>備註</span><textarea data-k="note" rows="2" placeholder="${adjOf(r, '保留') ? '寫保留的原因，下個月會提醒' : '特殊狀況寫這裡'}">${esc(r.note || '')}</textarea></label></div>
      <div class="rc-live">${cardLive(r, ctx, gd)}</div>
      <div class="rc-acts"><button type="button" class="btn" data-hist>前幾個月</button><button type="button" class="btn danger" data-del>刪除</button><span class="grow"></span><button type="button" class="btn primary" data-close>填好了，收起</button></div>
      <div class="rc-slot"></div></div></div>`;
  }

  function drawSum(ctx, rows) {
    const { $, fmt, nf0 } = ctx;
    const gd = groupDiffs(rows);
    const t = rows.reduce((a, r) => { const c = calc(r); a.due += c.due; a.paid += v(r, 'paid'); a.adj += c.adj; a.disc += v(r, 'disc'); return a; }, { due: 0, paid: 0, adj: 0, disc: 0 });
    t.bad = [...gd.values()].filter((d) => Math.abs(d) >= 0.5).length;
    t.pay = rows.filter(payBad).length;
    // 調整依項目加總（上面的總數自動加總）
    const by = new Map(); rows.forEach((r) => (r.adj || []).forEach((a) => { const k = a.k || '（沒選項目）'; by.set(k, (by.get(k) || 0) + (a.s < 0 ? -1 : 1) * (+a.amt || 0)); }));
    const byTxt = [...by].filter(([, x]) => Math.abs(x) >= 0.5).map(([k, x]) => `${ctx.esc(k)} ${x > 0 ? '+' : ''}${fmt.money(x)}`).join('、');
    $('#rcSum').innerHTML = `<div class="kpis recv-kpis">
      <div class="kpi"><div class="k">登記筆數</div><div class="v">${nf0.format(rows.length)}</div></div>
      <div class="kpi"><div class="k">應收淨額合計</div><div class="v">${fmt.money(t.due)}</div></div>
      <div class="kpi"><div class="k">實收合計</div><div class="v">${fmt.money(t.paid)}</div></div>
      <div class="kpi"><div class="k">調整合計</div><div class="v">${t.adj > 0 ? '+' : ''}${fmt.money(t.adj)}</div><div class="d adj-by">${byTxt || '沒有調整'}</div></div>
      <div class="kpi"><div class="k">折讓合計</div><div class="v">${fmt.money(t.disc)}</div></div>
      <div class="kpi ${t.bad || t.pay ? 'alert' : ''}"><div class="k">對不上（客戶）</div><div class="v">${t.bad ? `<span class="bad">${nf0.format(t.bad)} 位</span>` : '<span class="ok">全部對得上</span>'}</div><div class="d">差額合計 ${fmt.money(t.due - t.paid - t.adj)}${t.pay ? `<br><span class="bad">${t.pay} 筆「詳細」合計和實收不一樣</span>` : ''}</div></div></div>`;
  }

  // 紅單下半部：支票（號碼、帳號、付款銀行、客票／本人票、到期日、金額）和現金。不填沒關係，填了合計要等於實收
  const EM = () => root.EngineMeta;
  function parseDue(t) {
    const d = String(t || '').replace(/[^\d/\-.]/g, ''); if (!d) return 0;
    let y, m, dd; const parts = d.split(/[/\-.]/);
    if (parts.length === 3) [y, m, dd] = parts.map(Number); else if (/^\d{7}$/.test(d)) { y = +d.slice(0, 3); m = +d.slice(3, 5); dd = +d.slice(5); } else return 0;
    if (y > 1911) y -= 1911;
    return m >= 1 && m <= 12 && dd >= 1 && dd <= 31 ? y * 10000 + m * 100 + dd : 0;
  }
  function showPay(ctx, r, refresh) {
    const { $, esc, fmt, ymLabel } = ctx;
    const el = $('#rcPay');
    r.checks = r.checks || [];
    const draw = () => {
      const tot = payTotal(r);
      el.hidden = false;
      el.innerHTML = `<div class="panel-head"><h2>${esc(r.code)} ${esc(r.name || '')}・${ymLabel(r.ym)} 詳細（現金、支票）</h2><button class="icon-btn" data-x title="關閉">✕</button></div>
        <p class="hint">照紅單下半部記下現金和支票。<b>不填沒關係；填了，現金＋支票的合計就要和「實收」一樣</b>（不一樣會標紅）。這裡不會改上面的實收。到期日可以打 115/12/05 或 1151205。</p>
        <div class="row pay-cash"><label>現金 <input data-c="cash" inputmode="decimal" value="${r.cash || ''}"></label></div>
        <div class="table-wrap"><table class="dt pay-t"><thead><tr><th>支票號碼</th><th>帳號</th><th>付款銀行</th><th>客／本</th><th>到期日</th><th class="n">支票金額</th><th></th></tr></thead><tbody>
        ${r.checks.map((c, i) => `<tr data-i="${i}"><td><input data-f="no" value="${esc(c.no || '')}"></td><td><input data-f="acct" value="${esc(c.acct || '')}"></td><td><input data-f="bank" value="${esc(c.bank || '')}"></td>
          <td><select data-f="kind"><option value="客" ${c.kind !== '本' ? 'selected' : ''}>客票</option><option value="本" ${c.kind === '本' ? 'selected' : ''}>本人票</option></select></td>
          <td><input data-f="due" value="${c.due ? EM().dayLabel(c.due) : ''}" placeholder="115/12/05" class="${c.dueBad ? 'bad-in' : ''}"></td><td class="n"><input data-f="amt" inputmode="decimal" value="${c.amt || ''}"></td>
          <td><button class="icon-btn" data-cdel title="刪除這張支票">✕</button></td></tr>`).join('')}</tbody></table></div>
        <div class="row"><button class="btn" data-cadd>＋ 新增一張支票</button>
          <span class="pay-sum">支票 ${r.checks.length} 張 ${fmt.money(r.checks.reduce((t, c) => t + (+c.amt || 0), 0))} ＋ 現金 ${fmt.money(+r.cash || 0)} ＝ <b>${fmt.money(tot)}</b>　${!hasPay(r) ? `<span class="muted">（還沒填）</span>` : payBad(r) ? `<span class="bad">≠ 實收 ${fmt.money(v(r, 'paid'))}，差 ${fmt.money(tot - v(r, 'paid'))}</span>` : `<span class="ok">✓ 和實收一樣</span>`}</span></div>`;
    };
    const sync = () => { refresh(r); draw(); };
    el.onclick = (e) => {
      if (e.target.closest('[data-x]')) { el.hidden = true; return; }
      if (e.target.closest('[data-cadd]')) { r.checks.push({ kind: '客' }); draw(); const ins = el.querySelectorAll('input[data-f="no"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
      const d = e.target.closest('[data-cdel]'); if (d) { r.checks.splice(+d.closest('tr').dataset.i, 1); sync(); }
    };
    el.onchange = (e) => {
      const t = e.target;
      if (t.dataset.c === 'cash') { const n = Number(t.value.replace(/[,\s$]/g, '')); r.cash = Number.isFinite(n) ? n : 0; sync(); return; }
      const f = t.dataset.f, tr = t.closest('tr[data-i]'); if (!f || !tr) return;
      const c = r.checks[+tr.dataset.i];
      if (f === 'amt') { const n = Number(t.value.replace(/[,\s$]/g, '')); c.amt = Number.isFinite(n) ? n : 0; }
      else if (f === 'due') { c.due = parseDue(t.value); c.dueBad = !!t.value.trim() && !c.due; }
      else c[f] = t.value.trim();
      sync();
    };
    draw();
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 增刪調整項目：⊕ 加的、⊖ 減的兩邊分開。刪掉項目不會改到已經登記的那幾行
  function showItems(ctx, done, card) {
    const { $, esc } = ctx;
    const el = $('#rcItems'); if (!el) return;
    const draw = () => {
      const L = itemLists();
      const col = (key, sg, title) => `<div class="it-col ${key}"><h3><span class="sgn ${sg < 0 ? 'minus' : 'plus'}">${sg < 0 ? '−' : '+'}</span> ${title}</h3>
        <div class="it-list">${L[key].map((k, i) => `<span class="it-chip">${esc(k)}<button type="button" class="icon-btn" data-idel="${key}:${i}" title="刪掉這個項目">✕</button></span>`).join('') || '<span class="muted">（沒有項目）</span>'}</div>
        <div class="row it-add"><input data-inew="${key}" placeholder="新項目名稱" autocomplete="off"><button type="button" class="btn small" data-iadd="${key}">加入</button></div></div>`;
      el.hidden = false;
      el.innerHTML = `<div class="panel-head"><h2>增刪調整項目</h2><button class="icon-btn" data-x title="關閉">✕</button></div>
        <p class="hint">按 ⊕ 時下拉只出現「加的項目」，按 ⊖ 時只出現「減的項目」。刪掉項目不會改到已經登記的資料。</p>
        <div class="it-cols">${col('plus', 1, '加的項目（⊕）')}${col('minus', -1, '減的項目（⊖）')}</div>`;
    };
    const add = (key) => { const inp = el.querySelector(`[data-inew="${key}"]`); const k = inp.value.trim(); if (!k) return; const l = itemLists()[key]; if (!l.includes(k)) l.push(k); ctx.saveRecv(); draw(); done(); const n = el.querySelector(`[data-inew="${key}"]`); if (n) n.focus(); };
    el.onclick = (e) => {
      if (e.target.closest('[data-x]')) { el.hidden = true; return; }
      const d = e.target.closest('[data-idel]'); if (d) { const [key, i] = d.dataset.idel.split(':'); itemLists()[key].splice(+i, 1); ctx.saveRecv(); draw(); done(); return; }
      const a = e.target.closest('[data-iadd]'); if (a) add(a.dataset.iadd);
    };
    el.onkeydown = (e) => { const t = e.target.closest('[data-inew]'); if (t && e.key === 'Enter') { e.preventDefault(); add(t.dataset.inew); } };
    draw();
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    const carry = last ? prev.filter((r) => r.ym === last.ym).flatMap((r) => (r.adj || []).map((a) => adjTxt(a, ctx))) : [];
    el.hidden = false;
    el.innerHTML = `<div class="panel-head"><h2>${esc(code)} ${esc(name || '')} 前幾個月的明細</h2><button class="icon-btn" id="rcHistX" title="關閉">✕</button></div>
      <p class="hint">${s ? `銷售資料 ${ymLabel(ym)}：出貨 <b>${fmt.money(s.sales)}</b>、退貨 <b>${fmt.money(s.returns)}</b>。` : ''}${last ? `上一次登記（${ymLabel(last.ym)}）留下：${carry.length ? carry.join('、') : '沒有調整'}${last.note ? `；備註「${esc(last.note)}」` : ''}。` : '這位客戶之前沒有登記過。'}</p>
      ${prev.length ? `<div class="table-wrap"><table class="dt hist-t"><thead><tr><th>月份</th>${MAIN.map(([, l]) => `<th class="n">${l}</th>`).join('')}<th>調整</th><th class="n">應收淨額</th><th>檢查</th><th>備註</th></tr></thead><tbody>
        ${prev.map((r) => { const c = calc(r); return `<tr><td>${ymLabel(r.ym)}</td>${MAIN.map(([k]) => `<td class="n">${r[k] ? fmt.money(r[k]) : ''}</td>`).join('')}<td class="lbl">${(r.adj || []).map((a) => adjTxt(a, ctx)).join('<br>')}</td><td class="n">${fmt.money(c.due)}</td><td>${!isBad(r, hgd) ? '<span class="ok">✓</span>' : `<span class="bad">差 ${fmt.money(hgd.get(gkey(r)))}</span>`}</td><td class="lbl">${esc(r.note || '')}</td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
    $('#rcHistX').onclick = () => { el.hidden = true; };
    window.__recvHist = { code, months: prevYms }; // 測試用
  }

  function exportCsv(ctx, ym) {
    const rows = store().rows.filter((r) => r.ym === ym);
    const used = [...new Set(rows.flatMap((r) => (r.adj || []).map((a) => a.k).filter(Boolean)))];
    const names = allItems().filter((k) => used.includes(k)).concat(used.filter((k) => !allItems().includes(k)));
    const head = ['月份', '地區', '業務員', '代號', '客戶名稱', '折率%'].concat(MAIN.map((x) => x[1]), names, ['調整合計', '調整明細', '應收淨額', '差額', '備註', '現金', '支票張數', '支票明細']);
    ctx.downloadCsv(`應收帳款_${ym}`, head, rows.map((r) => { const c = calc(r); return [ctx.ymLabel(r.ym), r.region, r.rep, r.code, r.name, r.pct || ''].concat(NUMK.map((k) => v(r, k)), names.map((k) => adjOf(r, k)), [c.adj, (r.adj || []).map((a) => `${a.s < 0 ? '-' : '+'}${a.k} ${a.amt}${a.note ? ' ' + a.note : ''}`).join('；'), c.due, c.diff, r.note || '', +r.cash || 0, (r.checks || []).length,
      (r.checks || []).map((x) => [x.no, x.bank, x.kind === '本' ? '本人票' : '客票', x.due ? EM().dayLabel(x.due) : '', x.amt].join(' ')).join('；')]); }));
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
    const open = [...latest.values()].filter((r) => (r.adj || []).some((a) => +a.amt)).sort((a, b) => b.ym - a.ym);
    const seen = new Set(); const bads = rows.filter((r) => isBad(r, gdAll) && !seen.has(gkey(r)) && seen.add(gkey(r))).sort((a, b) => b.ym - a.ym);
    el.innerHTML = `
      <div class="toolbar"><label class="inline">年度 <select id="raYear">${years.map((y) => `<option value="${y}" ${y === Y ? 'selected' : ''}>${y}年</option>`).join('')}</select></label></div>
      <div class="kpis">
        <div class="kpi"><div class="k">應收淨額</div><div class="v">${fmt.big(T.due)}</div><div class="d">${nf0.format(T.n)} 筆、${months.length} 個月</div></div>
        <div class="kpi"><div class="k">實收</div><div class="v">${fmt.big(T.paid || 0)}</div><div class="d">實收 ÷ 應收淨額 ${pct(T.paid || 0, T.due)}</div></div>
        <div class="kpi"><div class="k">折讓</div><div class="v">${fmt.big(T.disc || 0)}</div><div class="d">折讓率 ${pct(T.disc || 0, (T.ar || 0) - (T.ret || 0) - (T.bu || 0))}（÷ 應收−退貨−補價）</div></div>
        <div class="kpi"><div class="k">退貨＋補價</div><div class="v">${fmt.big((T.ret || 0) + (T.bu || 0))}</div><div class="d">退貨 ${fmt.big(T.ret || 0)}、補價 ${fmt.big(T.bu || 0)}</div></div>
        <div class="kpi ${T.bad ? 'alert' : ''}"><div class="k">對不上（客戶・月）</div><div class="v">${T.bad ? `<span class="bad">${T.bad} 位</span>` : '<span class="ok">0 位</span>'}</div><div class="d">差額合計 ${fmt.money(T.diff)}</div></div>
      </div>
      <div class="panel"><div class="panel-head"><h2>每月應收淨額與實收</h2></div><p class="hint">深紅長條是應收淨額，藍線是實收。兩者差的部分是不足、保留、溢入等調整。</p><div class="chart" id="raChart"></div>
        <details class="num-table"><summary>數字表</summary><div class="table-wrap" id="raMonths"></div></details></div>
      <div class="grid2"><div class="panel"><div class="panel-head"><h2>各地區</h2></div><div class="table-wrap" id="raRegion"></div></div>
        <div class="panel"><div class="panel-head"><h2>各業務</h2></div><div class="table-wrap" id="raRep"></div></div></div>
      <div class="panel"><div class="panel-head"><h2>支票到期</h2></div><p class="hint" id="raChkHint"></p><div class="table-wrap" id="raChecks"></div></div>
      <div class="panel"><div class="panel-head"><h2>上次還有調整的客戶（不足、保留、溢入…）</h2></div><p class="hint">每位客戶最近一次登記的狀況。點一列到那個月的收款登記。</p><div class="table-wrap" id="raOpen"></div></div>
      <div class="panel"><div class="panel-head"><h2>${Y}年對不上的客戶</h2></div><p class="hint">同一位客戶同一個月的幾行加起來，應收淨額 ≠ 實收 + 調整。點一列到那個月去改。</p><div class="table-wrap" id="raBad"></div></div>`;
    $('#raYear').onchange = (e) => { S.recvYear = +e.target.value; renderAnalysis(ctx); };
    Charts.render($('#raChart'), { type: 'combo', labels: byM.map((m) => ymLabel(m.ym)), series: [{ name: '應收淨額', kind: 'bar', cls: 'total', values: byM.map((m) => m.due) }, { name: '實收', kind: 'line', cls: 'c1', values: byM.map((m) => m.paid || 0) }], fmt: fmt.money, axisFmt: fmt.axis, title: '每月應收淨額與實收' });
    const cols = [{ key: 'due', label: '應收淨額', n: 1, fmt: 'money' }, { key: 'paid', label: '實收', n: 1, fmt: 'money' }, { key: 'disc', label: '折讓', n: 1, fmt: 'money' },
      { key: 'rate', label: '折讓率', n: 1, render: (r) => pct(r.disc || 0, (r.ar || 0) - (r.ret || 0) - (r.bu || 0)) }, { key: 'adj', label: '調整', n: 1, fmt: 'money' }, { key: 'bad', label: '對不上', n: 1, render: (r) => (r.bad ? `<span class="bad">${r.bad}</span>` : '0') }];
    ctx.table($('#raMonths'), [{ key: 'ym', label: '月份', render: (r) => ymLabel(r.ym) }, { key: 'ar', label: '應收', n: 1, fmt: 'money' }, { key: 'ret', label: '退貨', n: 1, fmt: 'money' }, { key: 'bu', label: '補價', n: 1, fmt: 'money' }, { key: 'tax', label: '稅金', n: 1, fmt: 'money' }, { key: 'other', label: '尾數', n: 1, fmt: 'money' }].concat(cols), byM);
    ctx.table($('#raRegion'), [{ key: 'g', label: '地區', cls: 'lbl' }].concat(cols), group('region'));
    ctx.table($('#raRep'), [{ key: 'g', label: '業務', cls: 'lbl', render: (r) => esc(r.g === '（空白）' ? r.g : '業務 ' + r.g) }].concat(cols), group('rep'));
    const goTo = (r) => { S.recvYm = r.ym; S.recvF = { region: '', q: r.code }; ctx.go('recv'); };
    ctx.table($('#raOpen'), [{ key: 'ym', label: '月份', render: (r) => ymLabel(r.ym) }, { key: 'code', label: '代號' }, { key: 'name', label: '客戶', cls: 'lbl' }, { key: 'adjT', label: '調整', cls: 'lbl', render: (r) => (r.adj || []).filter((a) => +a.amt).map((a) => adjTxt(a, ctx)).join('<br>') }, { key: 'adjS', label: '合計', n: 1, render: (r) => fmt.money(adjSum(r)) }, { key: 'note', label: '備註', cls: 'lbl' }], open, { onRow: goTo, empty: '沒有。' });
    ctx.table($('#raBad'), [{ key: 'ym', label: '月份', render: (r) => ymLabel(r.ym) }, { key: 'code', label: '代號' }, { key: 'name', label: '客戶', cls: 'lbl' }, { key: 'due', label: '應收淨額', n: 1, render: (r) => fmt.money(calc(r).due) }, { key: 'paid', label: '實收', n: 1, fmt: 'money' }, { key: 'diff', label: '差額（這位客戶這個月合計）', n: 1, render: (r) => `<span class="bad">${fmt.money(gdAll.get(gkey(r)))}</span>` }, { key: 'note', label: '備註', cls: 'lbl' }], bads, { onRow: goTo, empty: '全部對得上。' });
    // 支票到期：已過期 30 天內到未來 60 天內，依到期日排
    const now = new Date(), today = (now.getFullYear() - 1911) * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const dn = (d) => EM().dayNum(d), tn = dn(today);
    const chks = [];
    R.rows.forEach((r) => (r.checks || []).forEach((c) => { if (c.due) { const left = dn(c.due) - tn; if (left >= -30 && left <= 60) chks.push({ ...c, left, code: r.code, name: r.name, ym: r.ym }); } }));
    chks.sort((a, b) => a.due - b.due);
    const soon = chks.filter((c) => c.left >= 0 && c.left <= 30);
    $('#raChkHint').innerHTML = `今天 ${EM().dayLabel(today)}。未來 30 天內到期 <b>${soon.length}</b> 張、共 <b>${fmt.money(soon.reduce((t, c) => t + (+c.amt || 0), 0))}</b>。列出過期 30 天內到未來 60 天內的支票，點一列到那個月的收款登記。`;
    ctx.table($('#raChecks'), [{ key: 'due', label: '到期日', render: (c) => EM().dayLabel(c.due) }, { key: 'left', label: '還有幾天', n: 1, render: (c) => (c.left < 0 ? `<span class="bad">已過 ${-c.left} 天</span>` : c.left <= 7 ? `<b class="soon">${c.left} 天</b>` : `${c.left} 天`) },
      { key: 'code', label: '代號' }, { key: 'name', label: '客戶', cls: 'lbl' }, { key: 'bank', label: '付款銀行' }, { key: 'no', label: '支票號碼' }, { key: 'kind', label: '客／本', render: (c) => (c.kind === '本' ? '本人票' : '客票') }, { key: 'amt', label: '金額', n: 1, fmt: 'money' }],
      chks, { onRow: (c) => { S.recvYm = c.ym; S.recvF = { region: '', q: c.code }; ctx.go('recv'); }, empty: '這段期間沒有到期的支票。' });
    window.__recvA = { checks: chks.length, soon: soon.length, year: Y, due: T.due, paid: T.paid || 0, bad: T.bad, open: open.length }; // 測試用
  }

  root.Recv = { renderEntry, renderAnalysis, calc, groupDiffs, holdReminders, normRow, ADJ, MAIN };
})(window);

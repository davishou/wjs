/* 應收帳款：收款登記（照紅單／Excel「客戶應收帳款明細表」的欄位輸入，網站自動算、自動抓錯）與應收分析。
   資料存在 S.meta.recv（跟銷售資料一起用開啟密碼加密、跟著資料包到手機；重新匯入銷售資料不會不見）。
   算法和使用者的 Excel 一樣（2026-11-10）：
     應收淨額（自動結算）= 應收帳款 − 退貨 − 補價 − 折率 + 稅金 − 其他
     對得上 ⇔ 應收淨額 = 實收 + 前先入 + 前溢入 + 溢入 + 保留 + 不足 + 多入 + 運金（調整欄照輸入的正負號直接加，和 Excel 一樣）
   折率（2026-11-10 使用者確認）：「折率%」欄填 6 或 6+1；第一次 =（應收 − 退貨 − 補價）× 6%，第二次 = 第一次折完後的金額 × 1%，各自四捨五入，
   折率金額 = 兩次相加。每位客人的折率記在 S.meta.recvRates[代號]，下次加入這位客人自動帶入。直接改折率金額 = 手動，不再自動算。
   「其他」改叫「尾數」（使用者要求，欄位 key 仍是 other）。
   支票／現金（使用者要求）：row.cash、row.checks = [{ no 支票號碼, acct 帳號, bank 付款銀行, kind 客|本（客票／本人票）, due 到期日 yyymmdd, amt 金額 }]；
   有填任何一筆時，實收 = 現金 + 支票合計（自動）。 */
(function (root) {
  const ADJ = [['preAdv', '前先入', '+'], ['preOver', '前溢入', '+'], ['over', '溢入', '−'], ['hold', '保留', '+'], ['short', '不足', '+'], ['more', '多入', '−'], ['freight', '運金', '+']];
  const MAIN = [['ar', '應收帳款'], ['ret', '退貨'], ['bu', '補價'], ['disc', '折率'], ['tax', '稅金'], ['other', '尾數'], ['paid', '實收']];
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
  // 折率：'6+1' → [6, 1]
  const parsePct = (t) => String(t || '').replace(/%/g, '').split(/[+＋,，、]/).map((x) => parseFloat(x)).filter((x) => Number.isFinite(x) && x > 0).slice(0, 2);
  function applyPct(r) {
    const p = parsePct(r.pct); if (!p.length) return;
    const base = v(r, 'ar') - v(r, 'ret') - v(r, 'bu');
    const d1 = Math.round(base * p[0] / 100), d2 = p[1] ? Math.round((base - d1) * p[1] / 100) : 0;
    r.disc = d1 + d2; r.discParts = p[1] ? [d1, d2] : null;
  }
  const rates = () => { const S = root.__app; S.meta = S.meta || {}; return S.meta.recvRates || (S.meta.recvRates = {}); };
  // 支票＋現金
  const hasPay = (r) => (r.checks && r.checks.length) || r.cash;
  const payTotal = (r) => (+r.cash || 0) + (r.checks || []).reduce((t, c) => t + (+c.amt || 0), 0);
  const store = () => { const S = root.__app; S.meta = S.meta || {}; if (!S.meta.recv) S.meta.recv = { v: 1, rows: [] }; return S.meta.recv; };
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
      const hold = r2(g.rows.reduce((t, r) => t + v(r, 'hold'), 0));
      if (Math.abs(hold) < 0.5) return;
      const f = g.rows[0];
      out.push({ code, name: f.name, region: f.region || '', rep: f.rep || '', ym: g.ym, hold, note: g.rows.map((r) => r.note).filter(Boolean).join('；'),
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
        <p class="hint">點一位客戶打開來填。應收淨額 = 應收 − 退貨 − 補價 − 折率 + 稅金 − 尾數；要等於 實收 + 調整。黃色 = 和銷售資料的出貨、退貨不一樣。</p></div>` :
      `<div class="panel"><div class="table-wrap recv-wrap" id="rcList"><table class="dt recv-t"><thead><tr>
        <th class="stick">代號</th><th class="stick2">客戶</th>${MAIN.map(([k, l]) => (k === 'disc' ? '<th class="n pct">折率%<small>如 6+1</small></th>' : '') + `<th class="n">${l}${k === 'paid' ? '<small>支票＋現金</small>' : ''}</th>`).join('')}
        ${ADJ.map(([k, l, s]) => `<th class="n adj">${l}<small>(${s})</small></th>`).join('')}
        <th class="n">應收淨額<small>自動</small></th><th>檢查</th><th>備註</th><th></th></tr></thead>
        <tbody>${rows.map((r) => rowHtml(r, ctx, gd)).join('') || `<tr><td colspan="24" class="empty">${ymLabel(ym)} 還沒有登記。上面輸入客戶加入，或匯入原本的應收帳款 Excel。</td></tr>`}</tbody></table></div>
        <p class="hint">算法和 Excel 一樣：應收淨額 = 應收 − 退貨 − 補價 − 折率 + 稅金 − 尾數；對得上 = 應收淨額 等於 實收 + 右邊各項調整（照輸入的正負號相加）。「折率%」填 6 或 6+1：第一次 =（應收 − 退貨 − 補價）× 6%，第二次 = 折完後 × 1%；會記住每位客人的折率。實收旁的「支票」可以輸入支票和現金。黃色的格子 = 和銷售資料的出貨、退貨不一樣。代號「↳ 同上」= 同一位客戶的第二行，幾行加起來對得上就算對。</p></div>`}
      <div id="rcPanels">
      <div class="panel" id="rcPay" hidden></div>
      <div class="panel" id="rcHist" hidden></div></div>`;
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
    const park = () => { const home = $('#rcPanels'); ['#rcPay', '#rcHist'].forEach((q) => { const n = $(q); if (n && n.parentNode !== home) { n.hidden = true; home.appendChild(n); } }); };
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
      const row = { id: uid(), ym, code: c.code, name: c.name, region: c.region || '', rep: c.rep || '', note: '', ar: s ? Math.round(s.sales) : 0, ret: s ? Math.round(s.returns) : 0 };
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
    // 改了一列：重算同一位客戶這個月的幾行、上面的合計，再存檔
    const refresh = (r) => {
      r.updatedAt = new Date().toISOString();
      gd = groupDiffs(R.rows.filter((x) => x.ym === ym));
      R.rows.filter((x) => x.ym === ym && x.code === r.code).forEach((x) => {
        const t = el.querySelector(`tr[data-id="${x.id}"]`); if (t) { t.outerHTML = rowHtml(x, ctx, gd); return; }
        const n = el.querySelector(`.rc-card[data-id="${x.id}"]`); if (!n) return;
        if (!n.classList.contains('open')) { n.outerHTML = cardHtml(x, ctx, gd, false); return; }
        // 打開的卡片：只更新上面的摘要、算好的數字，正在輸入的那一格不動
        n.querySelector('.rc-head').innerHTML = cardHead(x, ctx, gd);
        n.querySelector('.rc-live').innerHTML = cardLive(x, ctx, gd);
        n.classList.toggle('bad', isBad(x, gd));
        n.querySelectorAll('[data-k]').forEach((i) => { if (i !== document.activeElement) i.value = valOf(x, i.dataset.k); });
        const pi = n.querySelector('input[data-k="paid"]'); if (pi) pi.readOnly = !!hasPay(x);
        const pb = n.querySelector('[data-pay]'); if (pb) pb.textContent = payLabel(x);
      });
      drawSum(ctx, rows); save();
    };
    // 編輯（表格的一列或一張卡片都有 data-id）
    const list = $('#rcList');
    const rowOf = (t) => { const n = t.closest('[data-id]'); return n ? R.rows.find((x) => x.id === n.dataset.id) : null; };
    list.addEventListener('focusin', (e) => { if (layout(S) !== 'table') return; const r = rowOf(e.target); if (r) showHist(ctx, r.code, r.name, r.id); });
    list.addEventListener('change', (e) => {
      const inp = e.target.closest('[data-k]'); if (!inp) return;
      const r = rowOf(e.target); if (!r) return;
      const k = inp.dataset.k; let val = inp.value.trim();
      if (k === 'note') r.note = val;
      else if (k === 'pct' || (k === 'disc' && /%$/.test(val))) {
        r.pct = parsePct(val).join('+');
        if (r.pct) { applyPct(r); rates()[r.code] = r.pct; } else { delete r.pct; delete r.discParts; }
      } else {
        const n = Number(val.replace(/[,\s$]/g, '')); r[k] = Number.isFinite(n) ? n : 0;
        if (k === 'disc') { delete r.pct; delete r.discParts; }        // 手動改折率金額
        if ((k === 'ar' || k === 'ret' || k === 'bu') && r.pct) applyPct(r); // 金額改了，折率跟著重算
      }
      refresh(r);
    });
    list.addEventListener('click', (e) => {
      if (e.target.closest('[data-open]')) { const n = e.target.closest('.rc-card'); openCard(n.classList.contains('open') ? null : n.dataset.id); return; }
      if (e.target.closest('[data-close]')) { openCard(null); return; }
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

  function rowHtml(r, ctx, gd) {
    const { esc, fmt } = ctx;
    const c = calc(r);
    const gdiff = gd ? gd.get(gkey(r)) || 0 : c.diff;
    const s = salesOf(ctx, r.code, r.ym);
    const offA = s && Math.abs(v(r, 'ar') - s.sales) > 1, offR = s && Math.abs(v(r, 'ret') - s.returns) > 1;
    const inp = (k, warn, tip) => {
      const ro = k === 'paid' && hasPay(r);
      const cell = `<td class="n ${warn ? 'warn-cell' : ''} ${ro ? 'auto' : ''}" ${tip ? `title="${esc(tip)}"` : ''}><input data-k="${k}" inputmode="decimal" value="${r[k] ? r[k] : ''}" ${ro ? 'readonly' : ''}>` +
        (k === 'paid' ? `<button class="pay-btn ${hasPay(r) ? 'on' : ''}" data-pay title="支票、現金明細">${payLabel(r)}</button>` : '') +
        (k === 'hold' && v(r, 'hold') ? '<small class="hold-next">下個月要算</small>' : '') + '</td>';
      return (k === 'disc' ? `<td class="n pct"><input data-k="pct" value="${esc(r.pct || '')}" placeholder="%"></td>` : '') + cell;
    };
    const ok = Math.abs(c.diff) < 0.5, gok = Math.abs(gdiff) < 0.5;
    return `<tr data-id="${r.id}" class="${ok || gok ? '' : 'bad-row'} ${r.cont ? 'cont' : ''}"><td class="stick">${r.cont ? '<span class="muted">↳ 同上</span>' : esc(r.code)}</td><td class="stick2 lbl">${esc(r.name)}<small>${esc([r.region, r.rep && '業務 ' + r.rep].filter(Boolean).join('・'))}</small>${r.cont ? '' : holdTag(r, ctx)}</td>` +
      MAIN.map(([k]) => inp(k, (k === 'ar' && offA) || (k === 'ret' && offR), k === 'ar' && offA ? `銷售資料這個月出貨 ${fmt.money(s.sales)}` : k === 'ret' && offR ? `銷售資料這個月退貨 ${fmt.money(s.returns)}` : (k === 'disc' && r.discParts ? `第一次 ${fmt.money(r.discParts[0])}＋第二次 ${fmt.money(r.discParts[1])}` : k === 'paid' && hasPay(r) ? '由支票＋現金自動加總，按「支票」修改' : ''))).join('') +
      ADJ.map(([k]) => inp(k)).join('') +
      `<td class="n due">${fmt.money(c.due)}</td><td class="chk">${ok ? '<span class="ok">✓ 對得上</span>' : gok ? '<span class="ok" title="這位客戶這個月的幾行加起來對得上">✓ 合計對得上</span>' : `<span class="bad">差 ${fmt.money(gdiff)}</span>`}</td>` +
      `<td class="note"><input data-k="note" value="${esc(r.note || '')}" placeholder="${v(r, 'hold') ? '寫保留的原因，下個月會提醒' : '特殊狀況寫這裡'}"></td><td><button class="icon-btn" data-del title="刪除這一筆">✕</button></td></tr>`;
  }

  const payLabel = (r) => (r.checks && r.checks.length ? `支票 ${r.checks.length}` : hasPay(r) ? '現金' : '支票');
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
  const CARD_MAIN = [['ar', '應收帳款'], ['ret', '退貨'], ['bu', '補價'], ['pct', '折率%'], ['disc', '折率金額'], ['tax', '稅金'], ['other', '尾數']];
  function cardHead(r, ctx, gd) {
    const { esc, fmt } = ctx;
    const c = calc(r), gdiff = gd.get(gkey(r)) || 0, ok = Math.abs(c.diff) < 0.5 || Math.abs(gdiff) < 0.5;
    const blank = !v(r, 'paid') && !c.adj;
    return `<span class="rh-who"><b>${r.cont ? '↳ 同上' : esc(r.code)}</b> ${esc(r.name)}<small>${esc([r.region, r.rep && '業務 ' + r.rep].filter(Boolean).join('・'))}</small></span>
      <span class="rh-amt"><small>應收淨額</small>${fmt.money(c.due)}</span>
      <span class="rh-st">${ok ? '<span class="ok">✓ 對得上</span>' : blank ? '<span class="todo">還沒填實收</span>' : `<span class="bad">差 ${fmt.money(gdiff)}</span>`}
        ${r.cont ? '' : holdTag(r, ctx)}${v(r, 'hold') ? `<span class="hold-tag now">本月保留 ${fmt.money(v(r, 'hold'))}・下個月要算</span>` : ''}</span>
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
    const bad = Math.abs(c.diff) >= 0.5 && Math.abs(gdiff) >= 0.5 && (v(r, 'paid') || c.adj);
    const head = `<button type="button" class="rc-head" data-open aria-expanded="${open ? 'true' : 'false'}">${cardHead(r, ctx, gd)}</button>`;
    if (!open) return `<div class="rc-card ${bad ? 'bad' : ''}" data-id="${r.id}">${head}</div>`;
    const s = salesOf(ctx, r.code, r.ym);
    const offA = s && Math.abs(v(r, 'ar') - s.sales) > 1, offR = s && Math.abs(v(r, 'ret') - s.returns) > 1;
    const field = (k, label, extra = '') => {
      const warn = (k === 'ar' && offA) || (k === 'ret' && offR);
      const ro = k === 'paid' && hasPay(r);
      const tip = k === 'ar' && offA ? `銷售資料出貨 ${fmt.money(s.sales)}` : k === 'ret' && offR ? `銷售資料退貨 ${fmt.money(s.returns)}` : k === 'disc' && r.discParts ? `${fmt.money(r.discParts[0])}＋${fmt.money(r.discParts[1])}` : k === 'pct' ? '填 6 或 6+1' : k === 'hold' ? '下個月要算' : '';
      return `<label class="rc-f ${warn ? 'warn' : ''}"><span>${label}${extra}</span><input data-k="${k}" ${k === 'pct' ? 'inputmode="text" placeholder="6+1"' : 'inputmode="decimal"'} value="${esc(valOf(r, k))}" ${ro ? 'readonly' : ''} autocomplete="off">${tip ? `<small>${esc(tip)}</small>` : ''}</label>`;
    };
    const nAdj = ADJ.filter(([k]) => v(r, k)).length;
    return `<div class="rc-card open ${bad ? 'bad' : ''}" data-id="${r.id}">${head}<div class="rc-body">
      <div class="rc-sec"><h4>應收</h4><div class="rc-grid">${CARD_MAIN.map(([k, l]) => field(k, l)).join('')}</div></div>
      <div class="rc-sec"><h4>實收</h4><div class="rc-grid">${field('paid', '實收金額')}<div class="rc-f"><span>支票／現金</span><button type="button" class="btn pay-btn2 ${hasPay(r) ? 'on' : ''}" data-pay>${payLabel(r)}</button><small>有填就自動算實收</small></div></div></div>
      <details class="rc-sec" ${nAdj ? 'open' : ''}><summary>調整${nAdj ? `（有 ${nAdj} 項）` : '：不足、溢入、保留…（沒有就不用填）'}</summary><div class="rc-grid">${ADJ.map(([k, l, sg]) => field(k, l, ` <em>(${sg})</em>`)).join('')}</div></details>
      <div class="rc-sec"><label class="rc-f wide"><span>備註</span><textarea data-k="note" rows="2" placeholder="${v(r, 'hold') ? '寫保留的原因，下個月會提醒' : '特殊狀況寫這裡'}">${esc(r.note || '')}</textarea></label></div>
      <div class="rc-live">${cardLive(r, ctx, gd)}</div>
      <div class="rc-acts"><button type="button" class="btn" data-hist>前幾個月</button><button type="button" class="btn danger" data-del>刪除</button><span class="grow"></span><button type="button" class="btn primary" data-close>填好了，收起</button></div>
      <div class="rc-slot"></div></div></div>`;
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

  // 紅單下半部：支票（號碼、帳號、付款銀行、客票／本人票、到期日、金額）和現金。有填就自動算實收
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
      el.innerHTML = `<div class="panel-head"><h2>${esc(r.code)} ${esc(r.name || '')}・${ymLabel(r.ym)} 收款明細</h2><button class="icon-btn" data-x title="關閉">✕</button></div>
        <p class="hint">照紅單下半部輸入。有填任何一筆，上面的「實收」就自動等於 現金 + 支票合計。到期日可以打 115/12/05 或 1151205。</p>
        <div class="row pay-cash"><label>現金 <input data-c="cash" inputmode="decimal" value="${r.cash || ''}"></label></div>
        <div class="table-wrap"><table class="dt pay-t"><thead><tr><th>支票號碼</th><th>帳號</th><th>付款銀行</th><th>客／本</th><th>到期日</th><th class="n">支票金額</th><th></th></tr></thead><tbody>
        ${r.checks.map((c, i) => `<tr data-i="${i}"><td><input data-f="no" value="${esc(c.no || '')}"></td><td><input data-f="acct" value="${esc(c.acct || '')}"></td><td><input data-f="bank" value="${esc(c.bank || '')}"></td>
          <td><select data-f="kind"><option value="客" ${c.kind !== '本' ? 'selected' : ''}>客票</option><option value="本" ${c.kind === '本' ? 'selected' : ''}>本人票</option></select></td>
          <td><input data-f="due" value="${c.due ? EM().dayLabel(c.due) : ''}" placeholder="115/12/05" class="${c.dueBad ? 'bad-in' : ''}"></td><td class="n"><input data-f="amt" inputmode="decimal" value="${c.amt || ''}"></td>
          <td><button class="icon-btn" data-cdel title="刪除這張支票">✕</button></td></tr>`).join('')}</tbody></table></div>
        <div class="row"><button class="btn" data-cadd>＋ 新增一張支票</button>
          <span class="pay-sum">支票 ${r.checks.length} 張 ${fmt.money(r.checks.reduce((t, c) => t + (+c.amt || 0), 0))} ＋ 現金 ${fmt.money(+r.cash || 0)} ＝ 實收 <b>${fmt.money(tot)}</b></span></div>`;
    };
    const sync = () => { if (hasPay(r)) r.paid = payTotal(r); refresh(r); draw(); };
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
    const head = ['月份', '地區', '業務員', '代號', '客戶名稱', '折率%'].concat(MAIN.map((x) => x[1]), ADJ.map((x) => x[1]), ['應收淨額', '差額', '備註', '現金', '支票張數', '支票明細']);
    ctx.downloadCsv(`應收帳款_${ym}`, head, rows.map((r) => { const c = calc(r); return [ctx.ymLabel(r.ym), r.region, r.rep, r.code, r.name, r.pct || ''].concat(NUMK.map((k) => v(r, k)), [c.due, c.diff, r.note || '', +r.cash || 0, (r.checks || []).length,
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
    const open = [...latest.values()].filter((r) => v(r, 'short') || v(r, 'hold') || v(r, 'over') || v(r, 'more')).sort((a, b) => b.ym - a.ym);
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
      <div class="panel"><div class="panel-head"><h2>還有不足、保留、溢入的客戶</h2></div><p class="hint">每位客戶最近一次登記的狀況。點一列到那個月的收款登記。</p><div class="table-wrap" id="raOpen"></div></div>
      <div class="panel"><div class="panel-head"><h2>${Y}年對不上的客戶</h2></div><p class="hint">同一位客戶同一個月的幾行加起來，應收淨額 ≠ 實收 + 調整。點一列到那個月去改。</p><div class="table-wrap" id="raBad"></div></div>`;
    $('#raYear').onchange = (e) => { S.recvYear = +e.target.value; renderAnalysis(ctx); };
    Charts.render($('#raChart'), { type: 'combo', labels: byM.map((m) => ymLabel(m.ym)), series: [{ name: '應收淨額', kind: 'bar', cls: 'total', values: byM.map((m) => m.due) }, { name: '實收', kind: 'line', cls: 'c1', values: byM.map((m) => m.paid || 0) }], fmt: fmt.money, axisFmt: fmt.axis, title: '每月應收淨額與實收' });
    const cols = [{ key: 'due', label: '應收淨額', n: 1, fmt: 'money' }, { key: 'paid', label: '實收', n: 1, fmt: 'money' }, { key: 'disc', label: '折讓', n: 1, fmt: 'money' },
      { key: 'rate', label: '折讓率', n: 1, render: (r) => pct(r.disc || 0, (r.ar || 0) - (r.ret || 0) - (r.bu || 0)) }, { key: 'adj', label: '調整', n: 1, fmt: 'money' }, { key: 'bad', label: '對不上', n: 1, render: (r) => (r.bad ? `<span class="bad">${r.bad}</span>` : '0') }];
    ctx.table($('#raMonths'), [{ key: 'ym', label: '月份', render: (r) => ymLabel(r.ym) }, { key: 'ar', label: '應收', n: 1, fmt: 'money' }, { key: 'ret', label: '退貨', n: 1, fmt: 'money' }, { key: 'bu', label: '補價', n: 1, fmt: 'money' }, { key: 'tax', label: '稅金', n: 1, fmt: 'money' }, { key: 'other', label: '尾數', n: 1, fmt: 'money' }].concat(cols), byM);
    ctx.table($('#raRegion'), [{ key: 'g', label: '地區', cls: 'lbl' }].concat(cols), group('region'));
    ctx.table($('#raRep'), [{ key: 'g', label: '業務', cls: 'lbl', render: (r) => esc(r.g === '（空白）' ? r.g : '業務 ' + r.g) }].concat(cols), group('rep'));
    const goTo = (r) => { S.recvYm = r.ym; S.recvF = { region: '', q: r.code }; ctx.go('recv'); };
    ctx.table($('#raOpen'), [{ key: 'ym', label: '月份', render: (r) => ymLabel(r.ym) }, { key: 'code', label: '代號' }, { key: 'name', label: '客戶', cls: 'lbl' }, { key: 'short', label: '不足', n: 1, fmt: 'money' }, { key: 'hold', label: '保留', n: 1, fmt: 'money' }, { key: 'over', label: '溢入', n: 1, fmt: 'money' }, { key: 'more', label: '多入', n: 1, fmt: 'money' }, { key: 'note', label: '備註', cls: 'lbl' }], open, { onRow: goTo, empty: '沒有。' });
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

  root.Recv = { renderEntry, renderAnalysis, calc, groupDiffs, holdReminders, ADJ, MAIN };
})(window);

/* 進貨分析（2026-11-17）：廠商進貨 JMSINC、退回廠商 JMSIBK。
   資料放在 S.meta.buy（跟銷售資料一起加密存、跟著資料包到手機）：
     { v: 1, n, src: [0 進貨 | 1 退回], cols: { ord 單號, ln 序號, cat, sku, color, unit, vend 廠商代號, vname 廠商名, tran, price 單價, cost 成本, qty, unitn, amt 品項總額, tot 整張單總額（只在第一列，不加總）, pay, date 打單日期 }, added: [...] }
   更新規則和客戶出貨一樣：依整張單號（進貨、退回分開）取代或新增；期間內網站有、新檔案沒有的單列出來問要不要刪。
   頁面：概況（buy）、廠商（buyV）、商品（buyP）、進貨單（buyO）。紅色、工廠圖示。 */
(function (root) {
  const COLS_S = ['ord', 'ln', 'cat', 'sku', 'color', 'unit', 'vend', 'vname'];
  const COLS_N = ['tran', 'price', 'cost', 'qty', 'unitn', 'amt', 'tot', 'pay', 'date'];
  const ymOfOrd = (s) => { const v = parseInt(String(s).slice(0, 5), 10); return Number.isNaN(v) ? 0 : v; };

  // ---------- 合併 ----------
  const rowsOf = (B) => { const out = []; for (let i = 0; i < B.n; i++) { const o = { src: B.src[i] }; for (const k of COLS_S) o[k] = B.cols[k][i]; for (const k of COLS_N) o[k] = B.cols[k][i]; out.push(o); } return out; };
  function pack(rows, added) {
    rows.sort((a, b) => a.src - b.src || (a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : 0) || (a.ln < b.ln ? -1 : a.ln > b.ln ? 1 : 0));
    const cols = {}; for (const k of [...COLS_S, ...COLS_N]) cols[k] = rows.map((o) => o[k]);
    return { v: 1, n: rows.length, src: rows.map((o) => o.src), cols, added: added || [] };
  }
  const key = (o) => o.src + '|' + o.ord;
  const sig = (o) => [o.ln, o.sku, o.color, o.qty, o.amt, o.cost, o.vend].join('\u0001');
  function plan(base, add) {
    const b = new Map(), a = new Map();
    for (const o of base ? rowsOf(base) : []) { const k = key(o); if (!b.has(k)) b.set(k, []); b.get(k).push(o); }
    for (const o of rowsOf(add)) { const k = key(o); if (!a.has(k)) a.set(k, []); a.get(k).push(o); }
    const rng = [0, 1].map(() => ({ dMin: Infinity, dMax: 0, mMin: Infinity, mMax: 0 }));
    for (const ar of a.values()) for (const o of ar) { const g = rng[o.src], m = ymOfOrd(o.ord); if (o.date) { g.dMin = Math.min(g.dMin, o.date); g.dMax = Math.max(g.dMax, o.date); } if (m) { g.mMin = Math.min(g.mMin, m); g.mMax = Math.max(g.mMax, m); } }
    const nNew = [0, 0], nUpd = [0, 0]; let nChanged = 0;
    for (const [k, ar] of a) {
      const s = +k.charAt(0), br = b.get(k);
      if (!br) { nNew[s]++; continue; }
      nUpd[s]++;
      const x = br.map(sig).sort(), y = ar.map(sig).sort();
      if (x.length !== y.length || x.some((v, i) => v !== y[i])) nChanged++;
    }
    const missing = [];
    for (const [k, br] of b) {
      if (a.has(k)) continue;
      const s = +k.charAt(0), g = rng[s];
      const inR = br.some((o) => (g.dMax ? o.date && o.date >= g.dMin && o.date <= g.dMax : (() => { const m = ymOfOrd(o.ord); return m && m >= g.mMin && m <= g.mMax; })()));
      if (inR) missing.push({ src: s, ord: k.slice(2), rows: br.length });
    }
    missing.sort((x, y) => x.src - y.src || (x.ord < y.ord ? -1 : 1));
    const range = rng.map((g) => (g.dMax ? { by: 'date', from: g.dMin, to: g.dMax } : g.mMax ? { by: 'ord', from: g.mMin, to: g.mMax } : null));
    return { b, a, nNew, nUpd, nChanged, missing, range, nIn: add.nIn, nBk: add.nBk };
  }
  function merge(base, add, P, { removeMissing = false, name = '' } = {}) {
    const drop = new Set([...P.a.keys()].filter((k) => P.b.has(k)));
    if (removeMissing) for (const m of P.missing) drop.add(m.src + '|' + m.ord);
    const rows = (base ? rowsOf(base) : []).filter((o) => !drop.has(key(o))).concat(rowsOf(add));
    const added = ((base && base.added) || []).concat([{ name, at: new Date().toISOString(), inc: add.nIn, bk: add.nBk }]).slice(-60);
    return pack(rows, added);
  }

  // ---------- 計算 ----------
  // ymMode：'date' 依打單日期（預設，和銷售分析同一個設定），沒有日期改用單號前 5 碼；'ord' 依單號
  class BuyEngine {
    constructor(B, meta, opts = {}) {
      const D = root.Dataset, n = B.n, c = B.cols;
      this.n = n; this.src = B.src; this.c = c;
      const cmap = (meta && meta.cat && meta.cat.map) || null;
      const style = new Array(n), size = new Array(n), cat = new Array(n), big = new Array(n), pcs = new Float64Array(n), ym = new Int32Array(n);
      const memo = new Map();
      let maxDate = 0;
      for (let i = 0; i < n; i++) {
        let sp = memo.get(c.sku[i]); if (!sp) { sp = D.splitSku(c.sku[i]); memo.set(c.sku[i], sp); }
        style[i] = sp[0]; size[i] = sp[1] || '（無尺寸）';
        const k = D.normCat(c.cat[i]), hit = cmap ? cmap[k] : null;
        cat[i] = !k ? '（空白）' : hit && hit[0] ? k + ' ' + hit[0] : k;
        big[i] = hit && hit[1] ? hit[1] : cmap ? '未分類' : '（未匯入分類表）';
        const t = c.tran[i] > 1 ? c.tran[i] : 12;
        pcs[i] = String(c.unitn[i]) === '2' ? c.qty[i] * t : c.qty[i];
        const d = c.date[i], o = ymOfOrd(c.ord[i]);
        ym[i] = d > 0 && opts.ymMode !== 'ord' ? Math.floor(d / 100) : o;
        if (d > maxDate) maxDate = d;
      }
      Object.assign(this, { style, size, cat, big, pcs, ym, maxDate });
      // 廠商：代號 → 最近一次的名稱
      const vn = new Map(), vd = new Map();
      for (let i = 0; i < n; i++) { const v = c.vend[i], d = c.date[i] || ym[i] * 100; if (!vn.has(v) || d >= vd.get(v)) { vn.set(v, c.vname[i]); vd.set(v, d); } }
      this.vname = vn;
      this.ymList = [...new Set(ym)].filter(Boolean).sort((a, b) => a - b);
      this.minYm = this.ymList[0] || 0; this.maxYm = this.ymList[this.ymList.length - 1] || 0;
      this.ymIndex = new Set(this.ymList);
    }
    refDate(ref) { let m = 0; const { c, ym } = this; for (let i = 0; i < this.n; i++) if (ym[i] === ref && c.date[i] > m) m = c.date[i]; return m; }
    vendLabel(v) { const nm = this.vname.get(v) || ''; return nm ? v + ' ' + nm : v; }
    // f：{ ymFrom, ymTo } 或 { dFrom, dTo }；dims：{ vend, style, big, cat: Set }
    match(i, f, dims) {
      if (f) {
        if (f.dFrom) { const d = this.c.date[i]; if (!d || d < f.dFrom || d > f.dTo) return false; } else if (f.ymFrom && (this.ym[i] < f.ymFrom || this.ym[i] > f.ymTo)) return false;
      }
      if (dims) {
        if (dims.vend && !dims.vend.has(this.c.vend[i])) return false;
        if (dims.style && !dims.style.has(this.style[i])) return false;
        if (dims.big && !dims.big.has(this.big[i])) return false;
        if (dims.cat && !dims.cat.has(this.cat[i])) return false;
      }
      return true;
    }
    // 依 keyFn 分組加總
    group(f, dims, keyFn) {
      const m = new Map(), { c } = this;
      for (let i = 0; i < this.n; i++) {
        if (!this.match(i, f, dims)) continue;
        const k = keyFn(i);
        let a = m.get(k);
        if (!a) m.set(k, (a = { key: k, inA: 0, bkA: 0, inP: 0, bkP: 0, ords: new Set(), lines: 0, last: 0, lastYm: 0, first: Infinity }));
        if (this.src[i]) { a.bkA += c.amt[i]; a.bkP += this.pcs[i]; } else { a.inA += c.amt[i]; a.inP += this.pcs[i]; a.ords.add(c.ord[i]); }
        a.lines++;
        const d = c.date[i]; if (!this.src[i]) { if (d > a.last) a.last = d; if (this.ym[i] > a.lastYm) a.lastYm = this.ym[i]; if (this.ym[i] < a.first) a.first = this.ym[i]; }
      }
      for (const a of m.values()) { a.net = a.inA - a.bkA; a.netP = a.inP - a.bkP; a.orders = a.ords.size; a.retRate = a.inA ? a.bkA / a.inA : null; a.avg = a.inP ? a.inA / a.inP : null; }
      return m;
    }
    total(f, dims) { return this.group(f, dims, () => 'all').get('all') || { inA: 0, bkA: 0, net: 0, inP: 0, bkP: 0, netP: 0, orders: 0, lines: 0, retRate: null, avg: null }; }
    byYm(f, dims) { const g = this.group(f, dims, (i) => this.ym[i]); return g; }
    byDay(f, dims) { return this.group(f, dims, (i) => this.c.date[i]); }
    // 每張單一列
    orders(f, dims) {
      const m = new Map(), { c } = this;
      for (let i = 0; i < this.n; i++) {
        if (!this.match(i, f, dims)) continue;
        const k = this.src[i] + '|' + c.ord[i];
        let o = m.get(k);
        if (!o) m.set(k, (o = { src: this.src[i], ord: c.ord[i], date: c.date[i], ym: this.ym[i], vend: c.vend[i], vname: c.vname[i], lines: 0, pcs: 0, amt: 0, tot: 0, rows: [] }));
        o.lines++; o.pcs += this.pcs[i]; o.amt += c.amt[i]; if (c.tot[i]) o.tot = c.tot[i]; if (c.date[i] > o.date) o.date = c.date[i];
        o.rows.push(i);
      }
      return [...m.values()];
    }
    // 款號的成本變化：期間內最後一次進貨的每件成本 vs 期間前最後一次（同一個款號、只看進貨）
    unitCost(i) { const p = this.pcs[i]; return p ? this.c.amt[i] / p : null; }
  }

  // ---------- 畫面 ----------
  const addM = (ym, k) => { let y = Math.floor(ym / 100), m = ym % 100 + k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y * 100 + m; };
  // 進貨多或少不一定是好壞，所以不用紅綠，只用 ▲▼（成本變貴才用紅色）
  const growth = (a, b, fmt) => (b ? `<span class="gr">${a >= b ? '▲' : '▼'} ${fmt.pct(Math.abs(a - b) / Math.abs(b))}</span>` : a ? '<span class="muted">新</span>' : '—');

  function noData(X, el) {
    el.innerHTML = `<div class="panel buy-empty"><div class="buy-empty-ic">${FACTORY}</div><h2>還沒有廠商進貨資料</h2>
      <p>到「資料與設定」→「更新資料」選系統匯出的 <b>JMSINC.DBF</b>（進貨）和 <b>JMSIBK.DBF</b>（退回廠商），可以一起選。另存的 Excel 也可以。</p>
      <p class="hint">以後一樣每次匯出新的期間再丟進來，依單號更新、不會重複。</p><a class="btn primary" href="#data">去匯入</a></div>`;
  }
  function head(X, id, sub) {
    const { S } = X, BE = S.BE;
    const per = X.$(`#${id}Period`);
    const R = root.Period.mount(per, S.bspan, BE, BE.maxYm, () => { X.store.set('bspan', S.bspan); X.rerender(); }, X.esc);
    X.$(`#${id}Sub`).textContent = sub(R);
    return R;
  }
  // 期間內的走勢：每月（期間 2 個月內且有日期 → 每天），去年同期虛線
  function trend(BE, R, dims, measure = 'net') {
    const val = (a) => (a ? a[measure] : 0);
    if (BE.maxDate && (R.byDay || R.F[0] === R.F[1])) {
      const { dayNum, fromDayNum, dayLabel } = root.EngineMeta;
      const start = R.byDay ? R.f.dFrom : R.F[0] * 100 + 1, end = R.byDay ? R.f.dTo : Math.max(start, Math.min(R.F[1] * 100 + 31, BE.maxDate));
      const cm = BE.byDay(R.f.dFrom ? R.f : { dFrom: start, dTo: end }, dims), pm = R.pf ? BE.byDay(R.pf.dFrom ? R.pf : { dFrom: start - 10000, dTo: end - 10000 }, dims) : null;
      const days = []; for (let x = dayNum(start), e = dayNum(end); x <= e; x++) days.push(fromDayNum(x));
      if (days.length <= 62) return { labels: days.map((d) => dayLabel(d).slice(4)), cur: days.map((d) => val(cm.get(d))), prev: pm ? days.map((d) => val(pm.get(d - 10000))) : null, hint: '每天一根（依打單日期）' };
    }
    const months = []; for (let v = R.F[0]; v <= R.F[1]; v = addM(v, 1)) months.push(v);
    const cm = BE.byYm(R.f.dFrom ? { ymFrom: R.F[0], ymTo: R.F[1] } : R.f, dims), pm = R.pf ? BE.byYm(R.pf.dFrom ? { ymFrom: R.P[0], ymTo: R.P[1] } : R.pf, dims) : null;
    if (months.length > 36) {
      const ys = [...new Set(months.map((v) => Math.floor(v / 100)))];
      return { labels: ys.map((y) => y + ' 年'), cur: ys.map((y) => months.filter((v) => Math.floor(v / 100) === y).reduce((t, v) => t + val(cm.get(v)), 0)), prev: null, hint: '期間超過 3 年，每年一根' };
    }
    return { labels: months.map(root.EngineMeta.ymLabel), cur: months.map((v) => val(cm.get(v))), prev: pm ? months.map((v) => val(pm.get(addM(v, -12)))) : null, hint: '每月一根' };
  }
  const bigColor = (X, label) => X.colorOf('big', label);

  // ===== 概況 =====
  function renderHome(X) {
    const { S, $, fmt, nf0, esc, Charts } = X, BE = S.BE;
    const body = $('#buyBody');
    if (!BE) { noData(X, body); X.$('#buySub').textContent = ''; X.$('#buyPeriod').innerHTML = ''; return; }
    const R = head(X, 'buy', (r) => `期間 ${r.label}${r.pf ? `，對照去年同期 ${r.prevLabel}` : ''}。金額是進貨單上的品項總額（未稅、未扣折讓）；淨進貨 = 進貨 − 退回廠商。`);
    const T = BE.total(R.f), P = R.pf ? BE.total(R.pf) : null;
    const vend = BE.group(R.f, null, (i) => BE.c.vend[i]), pv = R.pf ? BE.group(R.pf, null, (i) => BE.c.vend[i]) : new Map();
    const d = (a, b) => (P ? `去年同期 ${fmt.big(b)}　${growth(a, b, fmt)}` : '');
    body.innerHTML = X.kpiHtml([
      { k: '淨進貨', v: fmt.big(T.net), d: d(T.net, P && P.net) },
      { k: '進貨金額', v: fmt.big(T.inA), d: `${nf0.format(T.orders)} 張進貨單` },
      { k: '退回廠商', v: fmt.big(T.bkA), d: `佔進貨 ${fmt.pct(T.retRate)}${P ? `（去年同期 ${fmt.pct(P.retRate)}）` : ''}` },
      { k: '進貨件數', v: fmt.big(T.inP), d: `平均每件 ${T.avg == null ? '—' : fmt.money2(T.avg)} 元` },
      { k: '廠商', v: nf0.format([...vend.values()].filter((v) => v.inA).length) + ' 家', d: P ? `去年同期 ${nf0.format([...pv.values()].filter((v) => v.inA).length)} 家` : '' },
    ]) + `<div class="panel"><div class="panel-head"><h2>淨進貨走勢 <span class="linked">跟著期間</span></h2></div><p class="hint" id="buyTrendHint"></p><div class="chart" id="buyTrend"></div></div>
      <div class="grid2"><div class="panel"><div class="panel-head"><h2>前 10 大廠商</h2><a class="btn" href="#buyV">全部廠商</a></div><p class="hint">長條是這段期間的淨進貨${P ? '，細線是去年同期' : ''}。點一列看那家廠商。</p><div id="buyTopV"></div></div>
        <div class="panel"><div class="panel-head"><h2>跟誰進、進什麼</h2></div><p class="hint">左邊是各廠商佔淨進貨的比例，右邊是商品大類（匯入商品類別代碼表才有男、女、童）。</p>
          <div class="donuts"><div><h3>廠商</h3><div id="buyMixV"></div></div><div><h3>大類</h3><div id="buyMixB"></div></div></div></div></div>
      <div class="grid2"><div class="panel"><div class="panel-head"><h2>進最多的款號</h2><a class="btn" href="#buyP">全部商品</a></div><p class="hint">依淨進貨金額。點一列看那個款號。</p><div id="buyTopP"></div></div>
        <div class="panel"><div class="panel-head"><h2>每月進貨和退回廠商</h2></div><p class="hint">近 12 個月（到 ${esc(root.EngineMeta.ymLabel(R.F[1]))}），長條是進貨、退回分開看。</p><div class="chart" id="buyInBk"></div></div></div>`;
    const tr = trend(BE, R, null);
    $('#buyTrendHint').textContent = tr.hint + (tr.prev ? '，虛線是去年同期。' : '。') + ` 合計 ${fmt.big(tr.cur.reduce((t, v) => t + v, 0))}。`;
    Charts.render($('#buyTrend'), { type: tr.prev ? 'combo' : 'bar', labels: tr.labels, series: [{ name: '淨進貨', kind: 'bar', cls: 'total-red', values: tr.cur }, ...(tr.prev ? [{ name: '去年同期', kind: 'line', dash: true, cls: 's3', values: tr.prev }] : [])], fmt: fmt.money, axisFmt: fmt.axis, title: '淨進貨走勢' });
    const vl = [...vend.values()].filter((v) => v.net > 0).sort((a, b) => b.net - a.net);
    Charts.hbars($('#buyTopV'), { rows: vl.slice(0, 10).map((v) => ({ label: BE.vendLabel(v.key), value: v.net, prev: P ? (pv.get(v.key) || {}).net || 0 : null, v: v.key, cls: X.colorOf('vend', v.key) })), fmt: fmt.big, limit: 10, onClick: (x) => openVendor(X, x.v) });
    Charts.donut($('#buyMixV'), { items: vl.map((v) => ({ label: BE.vendLabel(v.key), value: v.net, cls: X.colorOf('vend', v.key), v: v.key })), fmt: fmt.big, title: '廠商', center: { value: fmt.big(T.net), label: '淨進貨' }, onClick: (x) => openVendor(X, x.v) });
    const bg = [...BE.group(R.f, null, (i) => BE.big[i]).values()].filter((v) => v.net > 0);
    Charts.donut($('#buyMixB'), { items: bg.map((v) => ({ label: v.key, value: v.net, cls: bigColor(X, v.key) })), fmt: fmt.big, title: '大類' });
    const st = [...BE.group(R.f, null, (i) => BE.style[i]).values()].filter((v) => v.net > 0).sort((a, b) => b.net - a.net);
    Charts.hbars($('#buyTopP'), { rows: st.slice(0, 10).map((v) => ({ label: v.key, value: v.net, s: v.key, note: `${nf0.format(v.inP)} 件` })), fmt: fmt.big, limit: 10, onClick: (x) => openStyle(X, x.s) });
    const m12 = []; for (let v = addM(R.F[1], -11); v <= R.F[1]; v = addM(v, 1)) m12.push(v);
    const by = BE.byYm({ ymFrom: m12[0], ymTo: m12[11] });
    Charts.render($('#buyInBk'), { type: 'bar', labels: m12.map(root.EngineMeta.ymLabel), series: [{ name: '進貨', cls: 'c1', values: m12.map((v) => (by.get(v) || {}).inA || 0) }, { name: '退回廠商', cls: 'c2', values: m12.map((v) => (by.get(v) || {}).bkA || 0) }], fmt: fmt.money, axisFmt: fmt.axis });
    window.__buy = { net: T.net, inA: T.inA, bkA: T.bkA, inP: T.inP, orders: T.orders, vend: vl.length, trend: tr.cur, period: R.label }; // 測試用
  }

  // ===== 廠商 =====
  function vendData(X) {
    const { S } = X, BE = S.BE;
    const R = root.Period.range(BE, BE.maxYm, S.bspan);
    const g = BE.group(R.f, null, (i) => BE.c.vend[i]), pg = R.pf ? BE.group(R.pf, null, (i) => BE.c.vend[i]) : new Map();
    const all = BE.group(null, null, (i) => BE.c.vend[i]);
    const top = new Map(); // 廠商 → 期間內進最多的款號
    const ts = BE.group(R.f, null, (i) => BE.c.vend[i] + '\u0001' + BE.style[i]);
    for (const a of ts.values()) { const [v, s] = a.key.split('\u0001'); const t = top.get(v); if (!t || a.inA > t.inA) top.set(v, { s, inA: a.inA }); }
    const q = (S.buyV.q || '').toLowerCase();
    let list = [...all.values()].map((a) => {
      const c = g.get(a.key) || {}, p = pg.get(a.key) || {};
      return { vend: a.key, name: BE.vname.get(a.key) || '', net: c.net || 0, inA: c.inA || 0, bkA: c.bkA || 0, inP: c.inP || 0, orders: c.orders || 0, retRate: c.retRate == null ? null : c.retRate, avg: c.avg,
        prev: p.net || 0, last: a.last, lastYm: a.lastYm, first: a.first, top: (top.get(a.key) || {}).s || '', allNet: a.net };
    });
    if (q) list = list.filter((v) => (v.vend + ' ' + v.name).toLowerCase().includes(q));
    if (!S.buyV.all) list = list.filter((v) => v.inA || v.bkA || v.prev);
    list = X.sortRows(list, S.buyV.sort);
    return { R, list };
  }
  function renderVend(X) {
    const { S, $, fmt, nf0, esc, Charts } = X, BE = S.BE;
    if (!BE) { noData(X, $('#buyVBody')); $('#buyVPeriod').innerHTML = ''; return; }
    const R = head(X, 'buyV', (r) => `期間 ${r.label}${r.pf ? `，對照去年同期 ${r.prevLabel}` : ''}。點一列看那家廠商每個月進多少、進哪些款號、最近的進貨單。`);
    const { list } = vendData(X);
    const has = !!R.pf;
    $('#buyVBody').innerHTML = `<div class="toolbar"><input type="search" id="bvSearch" placeholder="搜尋廠商代號或名稱" value="${esc(S.buyV.q || '')}">
        <label class="inline"><input type="checkbox" id="bvAll" ${S.buyV.all ? 'checked' : ''}> 也列出這段期間沒進貨的廠商</label></div>
      <div class="panel"><div class="panel-head"><h2>各廠商淨進貨 <span class="linked">跟著期間・搜尋</span></h2></div><p class="hint">長條是這段期間${has ? '，細線是去年同期' : ''}。</p><div id="bvBars"></div></div>
      <div class="panel"><div class="panel-head"><h2>廠商列表</h2><button class="btn" id="bvCsv">匯出 CSV</button></div><div class="table-wrap" id="bvTable"></div></div>`;
    Charts.hbars($('#bvBars'), { rows: list.filter((v) => v.net > 0).sort((a, b) => b.net - a.net).slice(0, 15).map((v) => ({ label: v.vend + ' ' + v.name, value: v.net, prev: has ? v.prev : null, v: v.vend, cls: X.colorOf('vend', v.vend), note: has ? growth(v.net, v.prev, fmt) : '' })), fmt: fmt.big, limit: 15, onClick: (x) => openVendor(X, x.v) });
    const cols = [
      { key: 'vend', label: '廠商代號' }, { key: 'name', label: '廠商名' },
      { key: 'net', label: '淨進貨', n: 1, fmt: 'money' }, ...(has ? [{ key: 'prev', label: '去年同期', n: 1, fmt: 'money' }, { key: 'g', label: '成長', n: 1, get: (v) => (v.prev ? (v.net - v.prev) / Math.abs(v.prev) : null), render: (v) => growth(v.net, v.prev, fmt) }] : []),
      { key: 'inP', label: '進貨件數', n: 1, fmt: 'int' }, { key: 'bkA', label: '退回廠商', n: 1, fmt: 'money' }, { key: 'retRate', label: '退回比例', n: 1, fmt: 'pct' },
      { key: 'avg', label: '平均每件', n: 1, fmt: 'money2' }, { key: 'orders', label: '進貨單', n: 1, fmt: 'int' }, { key: 'top', label: '進最多的款號' },
      { key: 'last', label: '最近進貨', render: (v) => esc(v.last ? root.EngineMeta.dayLabel(v.last) : root.EngineMeta.ymLabel(v.lastYm)) },
    ];
    X.table($('#bvTable'), cols, list, { sort: S.buyV.sort, onSort: (k) => { S.buyV.sort = X.toggleSort(S.buyV.sort, k); renderVend(X); }, onRow: (v) => openVendor(X, v.vend), empty: '沒有符合的廠商' });
    let t; $('#bvSearch').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.buyV.q = e.target.value.trim(); renderVend(X); const s = $('#bvSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 200); };
    $('#bvAll').onchange = (e) => { S.buyV.all = e.target.checked; renderVend(X); };
    $('#bvCsv').onclick = () => X.downloadCsv('廠商進貨.csv', cols.map((c) => c.label), list.map((v) => cols.map((c) => (c.key === 'g' ? (v.prev ? ((v.net - v.prev) / Math.abs(v.prev) * 100).toFixed(1) + '%' : '') : c.key === 'last' ? (v.last ? root.EngineMeta.dayLabel(v.last) : root.EngineMeta.ymLabel(v.lastYm)) : v[c.key] == null ? '' : v[c.key]))));
    window.__buyV = list.map((v) => [v.vend, v.name, v.net]);
  }
  function openVendor(X, vend) {
    const { S, $, fmt, nf0, esc, Charts } = X, BE = S.BE;
    const dims = { vend: new Set([vend]) };
    const R = root.Period.range(BE, BE.maxYm, S.bspan);
    const T = BE.total(R.f, dims), A = BE.total(null, dims), P = R.pf ? BE.total(R.pf, dims) : null;
    X.openDrawer(BE.vname.get(vend) || vend, `廠商 ${vend}`, X.kpiHtml([
      { k: '這段期間淨進貨', v: fmt.big(T.net), d: P ? `去年同期 ${fmt.big(P.net)}　${growth(T.net, P.net, fmt)}` : esc(R.label) },
      { k: '進貨件數', v: fmt.big(T.inP), d: `平均每件 ${T.avg == null ? '—' : fmt.money2(T.avg)} 元` },
      { k: '退回廠商', v: fmt.big(T.bkA), d: `佔進貨 ${fmt.pct(T.retRate)}` },
      { k: '全部期間', v: fmt.big(A.net), d: `${nf0.format(A.orders)} 張進貨單` },
    ]) + `<div class="panel"><div class="panel-head"><h2>每月淨進貨（近 24 個月）</h2></div><div class="chart" id="bdTrend"></div></div>
      <div class="panel"><div class="panel-head"><h2>進哪些款號 <span class="linked">${esc(R.label)}</span></h2></div><div class="table-wrap" id="bdStyles"></div></div>
      <div class="panel"><div class="panel-head"><h2>最近的進貨單</h2></div><div class="table-wrap" id="bdOrders"></div></div>`);
    const m24 = []; for (let v = addM(BE.maxYm, -23); v <= BE.maxYm; v = addM(v, 1)) m24.push(v);
    const by = BE.byYm({ ymFrom: m24[0], ymTo: m24[23] }, dims);
    Charts.render($('#bdTrend'), { type: 'bar', labels: m24.map(root.EngineMeta.ymLabel), series: [{ name: '淨進貨', cls: X.colorOf('vend', vend), values: m24.map((v) => (by.get(v) || {}).net || 0) }], fmt: fmt.money, axisFmt: fmt.axis });
    const st = [...BE.group(R.f, dims, (i) => BE.style[i]).values()].sort((a, b) => b.net - a.net);
    X.table($('#bdStyles'), [{ key: 'key', label: '款號' }, { key: 'inP', label: '進貨件數', n: 1, fmt: 'int' }, { key: 'net', label: '淨進貨', n: 1, fmt: 'money' }, { key: 'avg', label: '平均每件', n: 1, fmt: 'money2' }, { key: 'bkP', label: '退回件數', n: 1, fmt: 'int' }],
      st, { limit: 30, onRow: (a) => openStyle(X, a.key) });
    orderTable(X, $('#bdOrders'), BE.orders(null, dims).sort((a, b) => (b.date || b.ym * 100) - (a.date || a.ym * 100)), 15, false);
  }

  // ===== 商品（款號）=====
  function prodData(X) {
    const { S } = X, BE = S.BE;
    const R = root.Period.range(BE, BE.maxYm, S.bspan);
    const g = BE.group(R.f, null, (i) => BE.style[i]), all = BE.group(null, null, (i) => BE.style[i]);
    const pg = R.pf ? BE.group(R.pf, null, (i) => BE.style[i]) : new Map();
    // 每個款號：主要廠商、大類、期間內最後一次和期間前最後一次的每件成本
    const info = new Map();
    const { c } = BE;
    for (let i = 0; i < BE.n; i++) {
      if (BE.src[i]) continue;
      const s = BE.style[i]; let o = info.get(s);
      if (!o) info.set(s, (o = { vends: new Map(), big: BE.big[i], cat: BE.cat[i], lastIn: null, lastInD: 0, before: null, beforeD: 0 }));
      o.vends.set(c.vend[i], (o.vends.get(c.vend[i]) || 0) + c.amt[i]);
      const u = BE.unitCost(i); if (u == null) continue;
      const d = c.date[i] || BE.ym[i] * 100 + 1;
      if (BE.match(i, R.f, null)) { if (d >= o.lastInD) { o.lastIn = u; o.lastInD = d; } } else if (BE.ym[i] < R.F[0] && d >= o.beforeD) { o.before = u; o.beforeD = d; }
    }
    const sold = X.soldByStyle(R);
    const q = (S.buyP.q || '').toLowerCase();
    let list = [...all.values()].map((a) => {
      const cur = g.get(a.key) || {}, p = pg.get(a.key) || {}, o = info.get(a.key) || { vends: new Map() };
      const vs = [...o.vends.entries()].sort((x, y) => y[1] - x[1]);
      const sd = sold ? sold.get(a.key) || 0 : null;
      return { style: a.key, big: o.big || '', cat: o.cat || '', net: cur.net || 0, inP: cur.inP || 0, bkP: cur.bkP || 0, inA: cur.inA || 0, avg: cur.avg == null ? null : cur.avg, prev: p.net || 0,
        vend: vs.length ? BE.vendLabel(vs[0][0]) + (vs.length > 1 ? ` 等 ${vs.length} 家` : '') : '', nVend: vs.length,
        lastIn: o.lastIn, before: o.before, chg: o.lastIn != null && o.before ? (o.lastIn - o.before) / o.before : null,
        sold: sd, gap: sd == null ? null : (cur.inP || 0) - (cur.bkP || 0) - sd, last: a.last, lastYm: a.lastYm };
    });
    if (q) list = list.filter((v) => (v.style + ' ' + v.vend + ' ' + v.cat).toLowerCase().includes(q));
    if (!S.buyP.all) list = list.filter((v) => v.inP || v.bkP);
    return { R, list: X.sortRows(list, S.buyP.sort) };
  }
  function renderProd(X) {
    const { S, $, fmt, nf0, esc, Charts } = X, BE = S.BE;
    if (!BE) { noData(X, $('#buyPBody')); $('#buyPPeriod').innerHTML = ''; return; }
    const R = head(X, 'buyP', (r) => `期間 ${r.label}。以款號（商品代號去掉尺寸）來看。「成本變化」= 這段期間最後一次進貨的每件成本，和這段期間以前最後一次比；「進 − 賣」= 這段期間淨進貨件數減掉同期淨賣出件數（銷售分析的資料），只是粗估，不是庫存。`);
    const { list } = prodData(X);
    const up = list.filter((v) => v.chg != null && v.chg >= 0.03).sort((a, b) => b.chg - a.chg);
    $('#buyPBody').innerHTML = `<div class="toolbar"><input type="search" id="bpSearch" placeholder="搜尋款號、廠商或類別" value="${esc(S.buyP.q || '')}">
        <label class="inline"><input type="checkbox" id="bpAll" ${S.buyP.all ? 'checked' : ''}> 也列出這段期間沒進貨的款號</label></div>
      <div class="grid2"><div class="panel"><div class="panel-head"><h2>進最多的款號 <span class="linked">跟著期間・搜尋</span></h2></div><p class="hint">依淨進貨金額，旁邊是件數。</p><div id="bpTop"></div></div>
        <div class="panel"><div class="panel-head"><h2>進貨成本變貴的款號</h2></div><p class="hint">這段期間最後一次進貨的每件成本，比之前貴 3% 以上（${nf0.format(up.length)} 個）。點一列看詳細。</p><div class="table-wrap" id="bpUp"></div></div></div>
      <div class="panel"><div class="panel-head"><h2>款號列表</h2><button class="btn" id="bpCsv">匯出 CSV</button></div><div class="table-wrap" id="bpTable"></div></div>`;
    Charts.hbars($('#bpTop'), { rows: list.filter((v) => v.net > 0).sort((a, b) => b.net - a.net).slice(0, 15).map((v) => ({ label: v.style, value: v.net, cls: bigColor(X, v.big), s: v.style, note: `${nf0.format(v.inP)} 件` })), fmt: fmt.big, limit: 15, onClick: (x) => openStyle(X, x.s) });
    // 成本變貴標紅、變便宜標綠；差不到 0.5% 算持平
    const chgCell = (v) => (v.chg == null ? '—' : Math.abs(v.chg) < 0.005 ? '<span class="muted">持平</span>' : `<span class="${v.chg > 0 ? 'down' : 'up'}">${v.chg > 0 ? '▲' : '▼'} ${fmt.pct(Math.abs(v.chg))}</span>`);
    X.table($('#bpUp'), [{ key: 'style', label: '款號' }, { key: 'vend', label: '廠商' }, { key: 'before', label: '之前每件', n: 1, fmt: 'money2' }, { key: 'lastIn', label: '最近每件', n: 1, fmt: 'money2' }, { key: 'chg', label: '變化', n: 1, render: chgCell }],
      up, { limit: 10, onRow: (v) => openStyle(X, v.style), empty: '沒有變貴的款號' });
    const hasSold = list.some((v) => v.sold != null);
    const cols = [
      { key: 'style', label: '款號' }, { key: 'cat', label: '類別' }, { key: 'vend', label: '廠商' },
      { key: 'net', label: '淨進貨', n: 1, fmt: 'money' }, { key: 'inP', label: '進貨件數', n: 1, fmt: 'int' }, { key: 'bkP', label: '退回件數', n: 1, fmt: 'int' },
      { key: 'avg', label: '平均每件', n: 1, fmt: 'money2' }, { key: 'chg', label: '成本變化', n: 1, render: chgCell },
      ...(hasSold ? [{ key: 'sold', label: '同期淨賣出', n: 1, fmt: 'int' }, { key: 'gap', label: '進 − 賣', n: 1, render: (v) => (v.gap == null ? '—' : `<span class="${v.gap < 0 ? 'down' : ''}">${fmt.int(v.gap)}</span>`) }] : []),
      { key: 'last', label: '最近進貨', render: (v) => esc(v.last ? root.EngineMeta.dayLabel(v.last) : root.EngineMeta.ymLabel(v.lastYm)) },
    ];
    X.table($('#bpTable'), cols, list, { sort: S.buyP.sort, onSort: (k) => { S.buyP.sort = X.toggleSort(S.buyP.sort, k); renderProd(X); }, onRow: (v) => openStyle(X, v.style), empty: '沒有符合的款號' });
    let t; $('#bpSearch').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.buyP.q = e.target.value.trim(); renderProd(X); const s = $('#bpSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 200); };
    $('#bpAll').onchange = (e) => { S.buyP.all = e.target.checked; renderProd(X); };
    $('#bpCsv').onclick = () => X.downloadCsv('款號進貨.csv', cols.map((c) => c.label), list.map((v) => cols.map((c) => (c.key === 'last' ? (v.last ? root.EngineMeta.dayLabel(v.last) : root.EngineMeta.ymLabel(v.lastYm)) : c.key === 'chg' ? (v.chg == null ? '' : (v.chg * 100).toFixed(1) + '%') : v[c.key] == null ? '' : v[c.key]))));
    window.__buyP = { list: list.map((v) => [v.style, v.inP, v.net, v.sold, v.chg]), up: up.map((v) => v.style) };
  }
  function openStyle(X, style) {
    const { S, $, fmt, esc, Charts } = X, BE = S.BE;
    const dims = { style: new Set([style]) };
    const R = root.Period.range(BE, BE.maxYm, S.bspan);
    const T = BE.total(R.f, dims), A = BE.total(null, dims);
    X.openDrawer(style, '款號', X.kpiHtml([
      { k: '這段期間淨進貨', v: fmt.big(T.net), d: esc(R.label) },
      { k: '進貨件數', v: fmt.big(T.inP), d: `退回 ${fmt.int(T.bkP)} 件` },
      { k: '平均每件', v: T.avg == null ? '—' : fmt.money2(T.avg), d: `全部期間 ${A.avg == null ? '—' : fmt.money2(A.avg)}` },
    ]) + `<div class="panel"><div class="panel-head"><h2>每月進貨件數${X.soldByStyle(R) ? '和賣出件數' : ''}（近 24 個月）</h2></div><p class="hint">${X.soldByStyle(R) ? '長條是進貨件數，線是同月淨賣出件數（銷售分析的資料），單位都是件。' : ''}</p><div class="chart" id="bdTrend"></div></div>
      <div class="grid2"><div class="panel"><div class="panel-head"><h2>尺寸 <span class="linked">${esc(R.label)}</span></h2></div><div id="bdSize"></div></div>
        <div class="panel"><div class="panel-head"><h2>廠商 <span class="linked">${esc(R.label)}</span></h2></div><div id="bdVend"></div></div></div>
      <div class="panel"><div class="panel-head"><h2>每次進貨的成本</h2></div><p class="hint">每一張進貨單、這個款號的每件成本（品項總額 ÷ 件數）。</p><div class="table-wrap" id="bdCost"></div></div>`);
    const m24 = []; for (let v = addM(BE.maxYm, -23); v <= BE.maxYm; v = addM(v, 1)) m24.push(v);
    const by = BE.byYm({ ymFrom: m24[0], ymTo: m24[23] }, dims);
    const sold = X.soldMonthly(style, m24);
    Charts.render($('#bdTrend'), { type: sold ? 'combo' : 'bar', labels: m24.map(root.EngineMeta.ymLabel), series: [{ name: '進貨件數', kind: 'bar', cls: 'c1', values: m24.map((v) => (by.get(v) || {}).inP || 0) }, ...(sold ? [{ name: '淨賣出件數', kind: 'line', cls: 'c3', values: sold }] : [])], fmt: fmt.int, axisFmt: fmt.axis });
    const D = root.Dataset;
    const sz = [...BE.group(R.f, dims, (i) => BE.size[i]).values()].sort((a, b) => D.sizeRank(a.key === '（無尺寸）' ? '' : a.key) - D.sizeRank(b.key === '（無尺寸）' ? '' : b.key));
    Charts.donut($('#bdSize'), { items: sz.map((a) => ({ label: a.key, value: a.inP })), fmt: (v) => fmt.int(v) + ' 件', title: '尺寸', sort: false });
    const vs = [...BE.group(R.f, dims, (i) => BE.c.vend[i]).values()].sort((a, b) => b.inA - a.inA);
    Charts.hbars($('#bdVend'), { rows: vs.map((a) => ({ label: BE.vendLabel(a.key), value: a.net, cls: X.colorOf('vend', a.key), v: a.key, note: `${fmt.int(a.inP)} 件` })), fmt: fmt.big, onClick: (x) => openVendor(X, x.v) });
    const os = BE.orders(null, dims).filter((o) => !o.src).sort((a, b) => (b.date || b.ym * 100) - (a.date || a.ym * 100));
    X.table($('#bdCost'), [
      { key: 'date', label: '日期', render: (o) => esc(o.date ? root.EngineMeta.dayLabel(o.date) : root.EngineMeta.ymLabel(o.ym)) }, { key: 'ord', label: '單號' },
      { key: 'vname', label: '廠商', render: (o) => esc(BE.vendLabel(o.vend)) }, { key: 'pcs', label: '件數', n: 1, fmt: 'int' }, { key: 'amt', label: '金額', n: 1, fmt: 'money' },
      { key: 'u', label: '每件', n: 1, get: (o) => (o.pcs ? o.amt / o.pcs : null), render: (o) => (o.pcs ? fmt.money2(o.amt / o.pcs) : '—') },
    ], os, { limit: 20 });
  }

  // ===== 進貨單 =====
  function orderTable(X, el, list, limit, withKind = true) {
    const { esc, fmt } = X, BE = X.S.BE;
    X.table(el, [
      { key: 'date', label: '日期', render: (o) => esc(o.date ? root.EngineMeta.dayLabel(o.date) : root.EngineMeta.ymLabel(o.ym)) }, { key: 'ord', label: '單號' },
      ...(withKind ? [{ key: 'src', label: '種類', render: (o) => (o.src ? '<span class="tag-bk">退回廠商</span>' : '<span class="tag-in">進貨</span>') }] : [{ key: 'src', label: '種類', render: (o) => (o.src ? '<span class="tag-bk">退回</span>' : '進貨') }]),
      { key: 'vend', label: '廠商', render: (o) => esc(BE.vendLabel(o.vend)) }, { key: 'lines', label: '品項', n: 1, fmt: 'int' }, { key: 'pcs', label: '件數', n: 1, fmt: 'int' }, { key: 'amt', label: '金額', n: 1, fmt: 'money' },
    ], list, { limit, onRow: (o) => openOrder(X, o) });
  }
  function renderOrders(X) {
    const { S, $, nf0, fmt, esc } = X, BE = S.BE;
    if (!BE) { noData(X, $('#buyOBody')); $('#buyOPeriod').innerHTML = ''; return; }
    const R = head(X, 'buyO', (r) => `期間 ${r.label}。一張單一列，點一列看單上的每個品項。`);
    const q = (S.buyO.q || '').toLowerCase();
    let list = BE.orders(R.f, null);
    if (S.buyO.kind !== 'all') list = list.filter((o) => o.src === (S.buyO.kind === 'bk' ? 1 : 0));
    if (q) list = list.filter((o) => (o.ord + ' ' + BE.vendLabel(o.vend)).toLowerCase().includes(q) || o.rows.some((i) => BE.c.sku[i].toLowerCase().includes(q)));
    list.sort((a, b) => (b.date || b.ym * 100) - (a.date || a.ym * 100) || (a.ord < b.ord ? 1 : -1));
    const inA = list.filter((o) => !o.src).reduce((t, o) => t + o.amt, 0), bkA = list.filter((o) => o.src).reduce((t, o) => t + o.amt, 0);
    $('#buyOBody').innerHTML = `<div class="toolbar"><input type="search" id="boSearch" placeholder="搜尋單號、廠商或商品代號" value="${esc(S.buyO.q || '')}">
        <div class="seg" id="boKind"><button data-v="all">全部</button><button data-v="in">進貨</button><button data-v="bk">退回廠商</button></div></div>
      <p class="hint">${nf0.format(list.length)} 張單：進貨 ${fmt.money(inA)} 元、退回廠商 ${fmt.money(bkA)} 元。</p>
      <div class="panel"><div class="table-wrap" id="boTable"></div></div>`;
    X.$$('#boKind button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.buyO.kind));
    orderTable(X, $('#boTable'), list, 200);
    let t; $('#boSearch').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.buyO.q = e.target.value.trim(); renderOrders(X); const s = $('#boSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 200); };
    $('#boKind').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.buyO.kind = b.dataset.v; renderOrders(X); };
    window.__buyO = list.length;
  }
  function openOrder(X, o) {
    const { $, fmt, esc } = X, BE = X.S.BE, c = BE.c;
    X.openDrawer((o.src ? '退回廠商 ' : '進貨單 ') + o.ord, `${BE.vendLabel(o.vend)}・${o.date ? root.EngineMeta.dayLabel(o.date) : root.EngineMeta.ymLabel(o.ym)}`,
      X.kpiHtml([{ k: '金額', v: fmt.money(o.amt), d: o.tot && Math.abs(o.tot - o.amt) >= 1 ? `單上的總額 ${fmt.money(o.tot)}` : '' }, { k: '件數', v: fmt.int(o.pcs), d: `${o.lines} 個品項` }]) +
      '<div class="panel"><div class="table-wrap" id="bdLines"></div></div>');
    const rows = o.rows.map((i) => ({ ln: c.ln[i], sku: c.sku[i], cat: BE.cat[i], color: c.color[i], qty: c.qty[i], unit: c.unit[i], pcs: BE.pcs[i], cost: c.cost[i], amt: c.amt[i] }));
    X.table($('#bdLines'), [{ key: 'ln', label: '序' }, { key: 'sku', label: '商品代號' }, { key: 'cat', label: '類別' }, { key: 'color', label: '顏色' },
      { key: 'qty', label: '數量', n: 1, render: (r) => esc(fmt.int(r.qty) + ' ' + (r.unit || '')) }, { key: 'pcs', label: '件數', n: 1, fmt: 'int' }, { key: 'cost', label: '成本', n: 1, fmt: 'money2' }, { key: 'amt', label: '品項總額', n: 1, fmt: 'money' }], rows, { limit: 100 });
  }

  const FACTORY = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 28V14l7 4v-4l7 4v-4l7 4V5h4v23z"/><rect x="7" y="21" width="3" height="3" rx=".5" fill="var(--bu-win, #fff)"/><rect x="13" y="21" width="3" height="3" rx=".5" fill="var(--bu-win, #fff)"/><rect x="19" y="21" width="3" height="3" rx=".5" fill="var(--bu-win, #fff)"/></svg>';

  root.Buy = { plan, merge, BuyEngine, renderHome, renderVend, renderProd, renderOrders, FACTORY, VIEWS: ['buy', 'buyV', 'buyP', 'buyO'] };
})(window);

/* 靈活的期間選擇：業務、客戶、商品三頁共用（同一個設定 S.span，切頁也一樣）。
   預設按鈕：基準月、上個月、近 3／6／12 個月、今年累計、去年、全部；有實際日期時另有近 30／90 天；也可以自訂起迄月份。
   每一種都會配一段「去年同期」（同樣長度、往前 12 個月）用來比較。 */
(function (root) {
  const { ymLabel, dayLabel, dayNum, fromDayNum } = root.EngineMeta;
  const addM = (ym, k) => { let y = Math.floor(ym / 100), m = ym % 100 + k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y * 100 + m; };
  const PRESETS = [
    { v: 'd30', label: '近 30 天', day: 30 }, { v: 'd90', label: '近 90 天', day: 90 },
    { v: 'm', label: '基準月' }, { v: 'pm', label: '上個月' }, { v: 'r3', label: '近 3 個月' }, { v: 'r6', label: '近 6 個月' },
    { v: 'ytd', label: '今年累計' }, { v: 'r12', label: '近 12 個月' }, { v: 'ly', label: '去年' }, { v: 'all', label: '全部' },
    { v: 'custom', label: '自訂月份' },
  ];
  const txt = (a, b) => (a === b ? ymLabel(a) : `${ymLabel(a)}～${ymLabel(b)}`);

  // 回傳 { f: 期間篩選, pf: 去年同期篩選或 null, F: [起迄年月], P, label, prevLabel, months: 期間內的年月, byDay }
  function range(E, ref, st) {
    const p = st.p || 'r12';
    const y = Math.floor(ref / 100), mo = ref % 100;
    const pre = PRESETS.find((x) => x.v === p);
    if (pre && pre.day && E.maxDate) {
      const D = E.refDate(ref) || E.maxDate, d0 = fromDayNum(dayNum(D) - pre.day + 1);
      const pd0 = d0 - 10000, pd1 = D - 10000;
      const F = [Math.floor(d0 / 100), Math.floor(D / 100)];
      const hasPrev = E.minYm <= Math.floor(pd1 / 100);
      return { f: { dFrom: d0, dTo: D }, pf: hasPrev ? { dFrom: pd0, dTo: pd1 } : null, F, P: hasPrev ? [Math.floor(pd0 / 100), Math.floor(pd1 / 100)] : null,
        label: `${dayLabel(d0)}～${dayLabel(D)}`, prevLabel: hasPrev ? `${dayLabel(pd0)}～${dayLabel(pd1)}` : '', months: E.ymList.filter((v) => v >= F[0] && v <= F[1]), byDay: true };
    }
    let F;
    if (p === 'm') F = [ref, ref];
    else if (p === 'pm') F = [addM(ref, -1), addM(ref, -1)];
    else if (p === 'r3') F = [addM(ref, -2), ref];
    else if (p === 'r6') F = [addM(ref, -5), ref];
    else if (p === 'ytd') F = [y * 100 + 1, ref];
    else if (p === 'ly') F = [(y - 1) * 100 + 1, (y - 1) * 100 + 12];
    else if (p === 'all') F = [E.minYm, E.maxYm];
    else if (p === 'custom' && st.from && st.to) F = [Math.min(st.from, st.to), Math.max(st.from, st.to)];
    else F = [addM(ref, -11), ref];
    void mo;
    const P = p === 'all' ? null : [addM(F[0], -12), addM(F[1], -12)];
    const hasPrev = !!P && E.ymList.some((v) => v >= P[0] && v <= P[1]);
    return { f: { ymFrom: F[0], ymTo: F[1] }, pf: hasPrev ? { ymFrom: P[0], ymTo: P[1] } : null, F, P: hasPrev ? P : null,
      label: txt(F[0], F[1]), prevLabel: hasPrev ? txt(P[0], P[1]) : '', months: E.ymList.filter((v) => v >= F[0] && v <= F[1]), byDay: false };
  }

  // 畫出選擇器（放在 box 裡），改變時呼叫 onChange()
  function mount(box, st, E, ref, onChange, esc) {
    const items = PRESETS.filter((x) => !x.day || E.maxDate);
    const r = range(E, ref, st);
    const yms = E.ymList.slice().reverse();
    const opt = (v) => yms.map((m) => `<option value="${m}" ${m === v ? 'selected' : ''}>${ymLabel(m)}</option>`).join('');
    box.innerHTML = `<div class="seg wrap">${items.map((x) => `<button data-v="${x.v}" class="${x.v === (st.p || 'r12') ? 'on' : ''}">${x.label}</button>`).join('')}</div>` +
      (st.p === 'custom' ? `<span class="per-custom"><label>從 <select data-k="from">${opt(r.F[0])}</select></label><label>到 <select data-k="to">${opt(r.F[1])}</select></label></span>` : '') +
      `<span class="per-note">${esc(r.label)}${r.prevLabel ? `<small>對照去年同期 ${esc(r.prevLabel)}</small>` : '<small>沒有去年同期可比</small>'}</span>`;
    box.onclick = (e) => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      if (b.dataset.v === 'custom' && st.p !== 'custom') { st.from = r.F[0]; st.to = r.F[1]; }
      st.p = b.dataset.v; onChange();
    };
    box.onchange = (e) => { const s = e.target.closest('select[data-k]'); if (!s) return; st[s.dataset.k] = +s.value; onChange(); };
    return r;
  }

  // 期間內的走勢：短期間（2 個月內、或近 30 天）每天一根，近 90 天每週一根，一般每月一根，超過 3 年每年一根。
  // 回傳 { labels, cur, prev（去年同期，沒有就是 null）, hint, unit }
  function trend(E, R, dims, measure) {
    const m = measure || 'net';
    const get = (rows, f) => { const out = new Map(); E.pivot({ rows: [rows], cols: null, measures: [m], filter: { ...f, dims } }).rows.forEach((r) => out.set(r.labels[0], r.vals[0][0])); return out; };
    const has = !!R.pf;
    const short = R.F[0] === R.F[1] || addM(R.F[0], 1) === R.F[1];
    if (E.maxDate && (R.byDay || short)) {
      const start = R.byDay ? R.f.dFrom : R.F[0] * 100 + 1;
      const end = R.byDay ? R.f.dTo : Math.min(lastDay(R.F[1]), Math.max(E.maxDate, start));
      const days = []; for (let n = dayNum(start), e = dayNum(end); n <= e; n++) days.push(fromDayNum(n));
      const cm = get('day', R.f), pm = has ? get('day', R.pf) : null;
      const val = (map, d) => map.get(dayLabel(d)) || 0;
      if (days.length > 45) { // 每週
        const labels = [], cur = [], prev = [];
        for (let i = 0; i < days.length; i += 7) {
          const wk = days.slice(i, i + 7);
          labels.push(dayLabel(wk[0]).slice(4) + ' 起');
          cur.push(wk.reduce((t, d) => t + val(cm, d), 0));
          prev.push(has ? wk.reduce((t, d) => t + val(pm, d - 10000), 0) : null);
        }
        return { labels, cur, prev: has ? prev : null, unit: 'week', hint: '每週一根長條（7 天加總）' + (has ? '，虛線是去年同一週。' : '。') };
      }
      return { labels: days.map((d) => dayLabel(d).slice(4)), cur: days.map((d) => val(cm, d)), prev: has ? days.map((d) => val(pm, d - 10000)) : null, unit: 'day',
        hint: '每天一根長條（依實際出貨日期）' + (has ? '，虛線是去年同一天。' : '。') };
    }
    const months = []; for (let v = R.F[0]; v <= R.F[1]; v = addM(v, 1)) months.push(v);
    if (months.length > 36) {
      const ys = [...new Set(months.map((v) => Math.floor(v / 100)))];
      const ym = get('ym', R.f);
      const sum = (yy) => months.filter((v) => Math.floor(v / 100) === yy).reduce((t, v) => t + (ym.get(ymLabel(v)) || 0), 0);
      return { labels: ys.map((y) => y + ' 年'), cur: ys.map(sum), prev: null, unit: 'year', hint: '期間超過 3 年，每年一根長條。' };
    }
    const cm = get('ym', R.f), pm = has ? get('ym', R.pf) : null;
    return { labels: months.map(ymLabel), cur: months.map((v) => cm.get(ymLabel(v)) || 0), prev: has ? months.map((v) => pm.get(ymLabel(addM(v, -12))) || 0) : null, unit: 'month',
      hint: '每月一根長條' + (has ? '，虛線是去年同一個月。' : '。') };
  }
  function lastDay(ym) { const y = Math.floor(ym / 100) + 1911, m = ym % 100; return ym * 100 + new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  root.Period = { PRESETS, range, mount, addM, trend };
})(window);

// 輕量 SVG 圖表（不用外部套件）：
//   render：折線、長條、堆疊長條、複合（長條＋折線，同一個刻度）
//   donut：圓餅（甜甜圈）圖，最多 8 塊，其餘併成「其他」
//   hbars：由大到小的橫條（可標去年同期）
// 顏色用 css/app.css 的變數：--c1～--c8 分類色（已用色盲檢查驗證，依固定順序給，不跟著名次），--s1～--s3 主色。
// 規則：只有一個刻度（不同單位不放同一張圖的兩個刻度）；每張圖都有滑鼠提示；兩條以上有圖例。
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const col = (cls) => `var(--${cls || 's1'})`;
  // 前面幾個顏色差最多（藍、橘、綠、紫、黃、洋紅、青、棕…）；c16 深灰留給「合計／淨銷售總數」，不放進來
  const PAL = ['c1', 'c2', 'c3', 'c7', 'c4', 'c13', 'c9', 'c10', 'c5', 'c12', 'c8', 'c11', 'c6', 'c15', 'c14'];

  // 讓格線落在整齊的數字上（1、2、5 的倍數）
  function niceStep(span) {
    if (span <= 0) return 1;
    const raw = span / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  // opts: { labels:[], series:[{name, values:[], cls, kind:'bar'|'line', dash}], fmt, axisFmt, type:'line'|'bar'|'stacked'|'combo' }
  function render(el, opts) {
    el.innerHTML = '';
    if (el._legend) { el._legend.remove(); el._legend = null; }
    const W = el.clientWidth || 600, H = el.clientHeight || 260;
    const m = { l: 56, r: 64, t: 12, b: 26 };
    if (W < 500) { m.l = 44; m.r = 12; }
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.title || '圖表' }, el);
    const type = opts.type || 'line';
    const kind = (s) => (type === 'combo' ? s.kind || 'bar' : type === 'line' ? 'line' : 'bar');
    const n = opts.labels.length;
    const bars = opts.series.filter((s) => kind(s) === 'bar'), lines = opts.series.filter((s) => kind(s) === 'line');
    const hasBar = bars.length > 0;
    // 刻度範圍（堆疊時用加總）
    let vals = [];
    if (type === 'stacked') for (let i = 0; i < n; i++) { let p = 0, q = 0; bars.forEach((s) => { const v = s.values[i] || 0; if (v > 0) p += v; else q += v; }); vals.push(p, q); }
    else vals = opts.series.flatMap((s) => s.values).filter((v) => v != null);
    const vmax = Math.max(0, ...vals), vmin = Math.min(0, ...vals);
    const st = niceStep(vmax - vmin);
    const top = Math.ceil(vmax / st) * st || st, bot = Math.floor(vmin / st) * st;
    const y = (v) => m.t + ih - ((v - bot) / (top - bot)) * ih;
    const step = iw / Math.max(1, hasBar ? n : n - 1);
    const x = (i) => m.l + (hasBar ? step * i + step / 2 : step * i);
    // 格線
    const g = mk('g', { class: 'grid' }, svg);
    const ax = mk('g', { class: 'axis' }, svg);
    for (let v = bot; v <= top + st / 2; v += st) {
      const yy = y(v);
      mk('line', { x1: m.l, x2: m.l + iw, y1: yy, y2: yy, class: Math.abs(v) < st / 2 ? 'zero' : '' }, g);
      const t = mk('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end' }, ax); t.textContent = (opts.axisFmt || opts.fmt)(v);
    }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
    for (let i = 0; i < n; i += every) {
      const t = mk('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }, ax); t.textContent = opts.labels[i];
    }
    // 長條：頂端 4px 圓角、底部貼齊 0；並排時中間留 2px
    const barPath = (x0, w, v0, v1) => {
      const a = y(v0), b = y(v1), up = b < a, t2 = Math.min(a, b), h = Math.max(1, Math.abs(a - b)), r = Math.min(4, w / 2, h);
      return up ? `M${x0},${t2 + h} V${t2 + r} Q${x0},${t2} ${x0 + r},${t2} H${x0 + w - r} Q${x0 + w},${t2} ${x0 + w},${t2 + r} V${t2 + h} Z`
        : `M${x0},${t2} V${t2 + h - r} Q${x0},${t2 + h} ${x0 + r},${t2 + h} H${x0 + w - r} Q${x0 + w},${t2 + h} ${x0 + w},${t2 + h - r} V${t2} Z`;
    };
    if (hasBar) {
      const gap = 2;
      if (type === 'stacked') {
        const bw = Math.max(2, Math.min(36, step - 4));
        for (let i = 0; i < n; i++) {
          let p = 0, q = 0;
          bars.forEach((s) => {
            const v = s.values[i]; if (!v) return;
            const from = v > 0 ? p : q, to = from + v;
            const a = y(from), b = y(to), t2 = Math.min(a, b), h = Math.abs(a - b);
            if (h > 0.5) mk('rect', { x: x(i) - bw / 2, y: t2 + (h > 3 ? 1 : 0), width: bw, height: Math.max(0.5, h - (h > 3 ? 1 : 0)), rx: 2, style: `fill:${col(s.cls)}` }, svg);
            if (v > 0) p = to; else q = to;
          });
        }
      } else {
        const k = bars.length, bw = Math.max(2, (Math.min(36 * k, step - 4) - gap * (k - 1)) / k);
        bars.forEach((s, si) => s.values.forEach((v, i) => {
          if (!v) return;
          const x0 = x(i) - (bw * k + gap * (k - 1)) / 2 + si * (bw + gap);
          mk('path', { d: barPath(x0, bw, 0, v), style: `fill:${col(s.cls)}`, class: 'bar' }, svg);
        }));
      }
    }
    lines.forEach((s) => {
      let d = '', pen = false; // 沒有數字的地方斷開
      s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); pen = true; });
      mk('path', { class: 'line', d, style: `stroke:${col(s.cls)}${s.dash ? ';stroke-dasharray:5 4' : ''}` }, svg);
      if (W >= 500 && opts.series.length <= 6) { // 直接標示在線尾
        let li = s.values.length - 1; while (li > 0 && s.values[li] == null) li--;
        if (s.values[li] != null) { const t = mk('text', { class: 'lbl', x: x(li) + 8, y: y(s.values[li]) + 4 }, svg); t.textContent = s.name; }
      }
    });
    // 提示
    const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; el.appendChild(tip);
    const xh = mk('line', { class: 'xh', y1: m.t, y2: m.t + ih }, svg); xh.style.display = 'none';
    const dots = lines.map((s) => { const c = mk('circle', { class: 'dot', r: 4.5, style: `fill:${col(s.cls)}` }, svg); c.style.display = 'none'; return c; });
    const hit = mk('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
      let i = Math.round((px - m.l - (hasBar ? step / 2 : 0)) / step);
      i = Math.max(0, Math.min(n - 1, i));
      xh.style.display = ''; xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i));
      let html = `<div>${esc(opts.labels[i])}</div>`;
      opts.series.forEach((s) => { const v = s.values[i]; html += `<div><i style="background:${col(s.cls)}"></i>${esc(s.name)}：<b>${v == null ? '—' : opts.fmt(v)}</b></div>`; });
      if (type === 'stacked' && bars.length > 1) html += `<div>合計：<b>${opts.fmt(bars.reduce((a, s) => a + (s.values[i] || 0), 0))}</b></div>`;
      lines.forEach((s, li) => { const v = s.values[i]; dots[li].style.display = v == null ? 'none' : ''; dots[li].setAttribute('cx', x(i)); dots[li].setAttribute('cy', y(v || 0)); });
      tip.innerHTML = html; tip.hidden = false;
      tip.style.left = Math.min(W - 80, Math.max(80, x(i))) * (r.width / W) + 'px';
      tip.style.top = Math.max(40, m.t + 30) + 'px';
    };
    const leave = () => { tip.hidden = true; xh.style.display = 'none'; dots.forEach((d) => { d.style.display = 'none'; }); };
    hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', move, { passive: true }); hit.addEventListener('touchstart', move, { passive: true });
    hit.addEventListener('mouseleave', leave); hit.addEventListener('touchend', () => setTimeout(leave, 1500));
    if (opts.series.length > 1) {
      const lg = document.createElement('div'); lg.className = 'legend';
      lg.innerHTML = opts.series.map((s) => `<span><i class="${kind(s) === 'line' ? 'ln' : 'sq'}${s.dash ? ' dash' : ''}" style="background:${col(s.cls)}"></i>${esc(s.name)}</span>`).join('');
      el.after(lg);
      el._legend = lg;
    }
  }

  // 圓餅（甜甜圈）：items = [{label, value, cls?}]；依大小排，最多 max 塊，其餘併成「其他」（灰色）
  // 顏色：給了 cls 就用（同一個名稱在每張圖都同色），沒給就依順序 --c1～--c8
  function donut(el, { items, fmt, title = '', center = null, max = 8, onClick = null, sort = true }) {
    let list = items.filter((d) => d.value > 0);
    if (sort) list.sort((a, b) => b.value - a.value);
    list = list.map((d, i) => ({ ...d, cls: d.cls || PAL[i % PAL.length] })); // 沒指定顏色：依圓餅裡的順序配，相鄰兩塊一定差很多
    if (list.length > max) {
      const rest = list.slice(max - 1);
      list = list.slice(0, max - 1).concat([{ label: `其他 ${rest.length} 項`, value: rest.reduce((s, d) => s + d.value, 0), cls: 'other', other: true }]);
    }
    const tot = list.reduce((s, d) => s + d.value, 0);
    if (!tot) { el.innerHTML = '<p class="empty">沒有資料</p>'; return; }
    const R = 60, r0 = 38, C = 70;
    let a = -Math.PI / 2;
    const arcs = list.map((d, i) => {
      const ang = (d.value / tot) * Math.PI * 2, a1 = a + ang;
      const gapA = list.length > 1 ? Math.min(0.03, ang / 4) : 0; // 每塊之間留一點空隙
      const s0 = a + gapA / 2, s1 = a1 - gapA / 2;
      const p = (rr, t) => `${(C + rr * Math.cos(t)).toFixed(2)},${(C + rr * Math.sin(t)).toFixed(2)}`;
      const big = s1 - s0 > Math.PI ? 1 : 0;
      const path = list.length === 1
        ? `M${C},${C - R} A${R},${R} 0 1 1 ${C - 0.01},${C - R} L${C - 0.01},${C - r0} A${r0},${r0} 0 1 0 ${C},${C - r0} Z`
        : `M${p(R, s0)} A${R},${R} 0 ${big} 1 ${p(R, s1)} L${p(r0, s1)} A${r0},${r0} 0 ${big} 0 ${p(r0, s0)} Z`;
      a = a1;
      return `<path d="${path}" style="fill:${d.other ? 'var(--s3)' : col(d.cls)}" data-i="${i}"><title>${esc(d.label)}：${esc(fmt(d.value))}（${(d.value / tot * 100).toFixed(1)}%）</title></path>`;
    }).join('');
    const pct = (v) => { const p = v / tot * 100; return p < 0.1 ? '<0.1%' : p.toFixed(p < 10 ? 1 : 0) + '%'; };
    el.innerHTML = `<div class="donut"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(title)}">${arcs}
        ${center ? `<text x="70" y="66" class="dn-v">${esc(center.value)}</text><text x="70" y="84" class="dn-k">${esc(center.label)}</text>` : ''}</svg>
      <ul class="dn-legend">${list.map((d, i) => `<li data-i="${i}" class="${onClick && !d.other ? 'click' : ''}"><i style="background:${d.other ? 'var(--s3)' : col(d.cls)}"></i><span>${esc(d.label)}</span><b>${pct(d.value)}</b><small>${esc(fmt(d.value))}</small></li>`).join('')}</ul></div>`;
    const svgEl = el.querySelector('svg');
    const hl = (i) => { el.querySelectorAll('path').forEach((pth) => pth.classList.toggle('dim', i != null && +pth.dataset.i !== i)); el.querySelectorAll('li').forEach((li) => li.classList.toggle('on', +li.dataset.i === i)); };
    el.querySelectorAll('[data-i]').forEach((n2) => { n2.addEventListener('mouseenter', () => hl(+n2.dataset.i)); n2.addEventListener('mouseleave', () => hl(null)); });
    if (onClick) el.querySelectorAll('[data-i]').forEach((n2) => n2.addEventListener('click', () => { const d = list[+n2.dataset.i]; if (!d.other) onClick(d); }));
    void svgEl;
  }

  // 橫條排名：rows = [{label, value, prev?, cls?, note?}]；同一個刻度，去年同期用細線標示
  // 整張圖只有一種顏色時（例如前 10 大客戶），改成每一列不同顏色，比較好分辨（使用者要求顏色豐富）
  function hbars(el, { rows, fmt, onClick = null, prevLabel = '去年同期', limit = 12 }) {
    let list = rows.slice(0, limit);
    if (list.length > 1 && list.every((r) => !r.cls)) list = list.map((r, i) => ({ ...r, cls: PAL[i % PAL.length] })); // 沒指定顏色時才每列不同色（指定了就照指定，例如客戶依區域）
    const mx = Math.max(1, ...list.map((r) => Math.max(r.value || 0, r.prev || 0)));
    const w = (v) => Math.max(0, Math.min(100, ((v || 0) / mx) * 100));
    el.innerHTML = list.length ? `<div class="hb">${list.map((r, i) => `<div class="hb-row${onClick ? ' click' : ''}" data-i="${i}" title="${esc(r.label)}：${esc(fmt(r.value))}${r.prev != null ? `\n${prevLabel}：${esc(fmt(r.prev))}` : ''}">
        <span class="hb-name">${esc(r.label)}</span>
        <span class="hb-track"><i class="hb-bar" style="width:${w(r.value)}%;background:${col(r.cls || 's1')}"></i>${r.prev ? `<i class="hb-prev" style="left:${w(r.prev)}%"></i>` : ''}</span>
        <span class="hb-val">${esc(fmt(r.value))}</span><span class="hb-note">${r.note || ''}</span></div>`).join('')}</div>` : '<p class="empty">沒有資料</p>';
    if (onClick) el.querySelector('.hb') && (el.querySelector('.hb').onclick = (e) => { const row = e.target.closest('.hb-row'); if (row) onClick(list[+row.dataset.i]); });
  }

  root.Charts = { render, donut, hbars, PAL };
})(window);

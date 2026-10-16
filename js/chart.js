// 輕量 SVG 圖表：折線（含十字線提示）與長條。
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

  // 讓 5 條格線落在整齊的數字上（1、2、5 的倍數）
  function niceMax(v) {
    if (v <= 0) return 4;
    const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
    return step * 4;
  }

  // opts: { labels:[], series:[{name, values:[], cls:'s1'}], fmt:(v)=>str, axisFmt, type:'line'|'bar' }
  function render(el, opts) {
    el.innerHTML = '';
    if (el._legend) { el._legend.remove(); el._legend = null; }
    const W = el.clientWidth || 600, H = el.clientHeight || 260;
    const m = { l: 56, r: 64, t: 12, b: 26 };
    if (W < 500) { m.l = 44; m.r = 12; }
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.title || '圖表' }, el);
    const all = opts.series.flatMap((s) => s.values).filter((v) => v != null);
    const max = niceMax(Math.max(0, ...all));
    const n = opts.labels.length;
    const y = (v) => m.t + ih - (v / max) * ih;
    const isBar = opts.type === 'bar';
    const step = iw / Math.max(1, isBar ? n : n - 1);
    const x = (i) => m.l + (isBar ? step * i + step / 2 : step * i);
    // 格線
    const g = mk('g', { class: 'grid' }, svg);
    const ax = mk('g', { class: 'axis' }, svg);
    for (let k = 0; k <= 4; k++) {
      const v = (max / 4) * k, yy = y(v);
      mk('line', { x1: m.l, x2: m.l + iw, y1: yy, y2: yy }, g);
      const t = mk('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end' }, ax); t.textContent = (opts.axisFmt || opts.fmt)(v);
    }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
    for (let i = 0; i < n; i += every) {
      const t = mk('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }, ax); t.textContent = opts.labels[i];
    }
    if (isBar) {
      const bw = Math.max(2, Math.min(28, step - 2) / opts.series.length);
      opts.series.forEach((s, si) => {
        s.values.forEach((v, i) => {
          if (!v) return;
          const h = Math.max(1, ih - (y(v) - m.t));
          const x0 = x(i) - (bw * opts.series.length) / 2 + si * bw;
          const r = Math.min(4, bw / 2);
          const top = y(v);
          // 頂端圓角、底部貼齊基線
          mk('path', { class: 'bar' + (si + 1), d: `M${x0},${top + h} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - 1 - r} Q${x0 + bw - 1},${top} ${x0 + bw - 1},${top + r} V${top + h} Z` }, svg);
        });
      });
    } else {
      opts.series.forEach((s) => {
        let d = '';
        s.values.forEach((v, i) => { if (v == null) return; d += (d ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); });
        mk('path', { class: 'line ' + s.cls, d }, svg);
        // 直接標示在線尾
        if (W >= 500) {
          const li = s.values.length - 1;
          const t = mk('text', { class: 'lbl', x: x(li) + 8, y: y(s.values[li] || 0) + 4 }, svg); t.textContent = s.name;
        }
      });
    }
    // 提示
    const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; el.appendChild(tip);
    const xh = mk('line', { class: 'xh', y1: m.t, y2: m.t + ih }, svg); xh.style.display = 'none';
    const dots = opts.series.map((s) => { const c = mk('circle', { class: 'dot ' + s.cls, r: 4.5 }, svg); c.style.display = 'none'; return c; });
    const hit = mk('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      let i = Math.round((px - m.l - (isBar ? step / 2 : 0)) / step);
      i = Math.max(0, Math.min(n - 1, i));
      xh.style.display = ''; xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i));
      let html = `<div>${opts.labels[i]}</div>`;
      opts.series.forEach((s, si) => {
        const v = s.values[i];
        if (!isBar) { dots[si].style.display = v == null ? 'none' : ''; dots[si].setAttribute('cx', x(i)); dots[si].setAttribute('cy', y(v || 0)); }
        html += `<div>${s.name}：<b>${v == null ? '—' : opts.fmt(v)}</b></div>`;
      });
      tip.innerHTML = html; tip.hidden = false;
      const maxV = Math.max(...opts.series.map((s) => s.values[i] || 0));
      tip.style.left = Math.min(W - 80, Math.max(80, x(i))) + 'px';
      tip.style.top = Math.max(40, y(maxV)) + 'px';
    };
    const leave = () => { tip.hidden = true; xh.style.display = 'none'; dots.forEach((d) => { d.style.display = 'none'; }); };
    hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', move, { passive: true }); hit.addEventListener('touchstart', move, { passive: true });
    hit.addEventListener('mouseleave', leave); hit.addEventListener('touchend', () => setTimeout(leave, 1500));
    if (opts.series.length > 1) {
      const lg = document.createElement('div'); lg.className = 'legend';
      lg.innerHTML = opts.series.map((s) => `<span><i style="background:var(--${s.cls})"></i>${s.name}</span>`).join('');
      el.after(lg);
      el._legend = lg;
    }
  }

  root.Charts = { render };
})(window);

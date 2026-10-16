// 分析引擎：篩選、樞紐分析、客戶與商品指標。全部在記憶體中以型別陣列運算，百萬筆等級也能在瞬間完成。
(function (root) {
  const SRC_NAMES = ['進貨', '退貨'];

  // 可用來分組/篩選的維度
  const DIMS = [
    { key: 'src', label: '資料來源' },
    { key: 'year', label: '年份' },
    { key: 'ym', label: '年月' },
    { key: 'month', label: '月份' },
    { key: 'region', label: '區域' },
    { key: 'rep', label: '業務員' },
    { key: 'ck', label: '客戶' },
    { key: 'cust', label: '客戶代號' },
    { key: 'cname', label: '客戶名' },
    { key: 'cat', label: '商品類別' },
    { key: 'sku2', label: '商品代碼(簡化)' },
    { key: 'sku', label: '商品代號' },
    { key: 'color', label: '顏色代號' },
    { key: 'unit', label: '單位' },
    { key: 'ord', label: '單號' },
  ];
  // 值欄位
  const MEASURES = [
    { key: 'sales', label: '銷貨金額', fmt: 'money' },
    { key: 'returns', label: '退貨金額', fmt: 'money' },
    { key: 'net', label: '淨銷售額', fmt: 'money' },
    { key: 'profit', label: '毛利', fmt: 'money' },
    { key: 'netProfit', label: '淨毛利(扣退貨)', fmt: 'money' },
    { key: 'margin', label: '毛利率', fmt: 'pct' },
    { key: 'retRate', label: '退貨率', fmt: 'pct' },
    { key: 'soldQty', label: '賣出數(件)', fmt: 'int' },
    { key: 'retQty', label: '退貨數(件)', fmt: 'int' },
    { key: 'netQty', label: '淨賣出數', fmt: 'int' },
    { key: 'qty', label: '數量(原單位)', fmt: 'int' },
    { key: 'orders', label: '訂單數', fmt: 'int' },
    { key: 'custs', label: '客戶數', fmt: 'int' },
    { key: 'skus', label: '品項數', fmt: 'int' },
    { key: 'rows', label: '筆數', fmt: 'int' },
    { key: 'avgPrice', label: '平均售價', fmt: 'money2' },
  ];
  const DISTINCT = { orders: 'ord', custs: 'ck', skus: 'sku' };


  const ymDiff = (a, b) => (Math.floor(a / 100) - Math.floor(b / 100)) * 12 + (a % 100 - b % 100);
  const ymLabel = (ym) => ym ? `${Math.floor(ym / 100)}/${String(ym % 100).padStart(2, '0')}` : '';

  class Engine {
    constructor(ds) {
      this.ds = ds;
      this.n = ds.n;
      const ym = ds.num.ym;
      let mx = 0, mn = Infinity;
      for (let i = 0; i < this.n; i++) { const v = ym[i]; if (v > mx) mx = v; if (v && v < mn) mn = v; }
      this.maxYm = mx; this.minYm = mn === Infinity ? 0 : mn;
      // 年月清單
      const yms = new Set();
      for (let i = 0; i < this.n; i++) if (ym[i]) yms.add(ym[i]);
      this.ymList = [...yms].sort((a, b) => a - b);
      this.ymIndex = new Map(this.ymList.map((v, i) => [v, i]));
      this.yearList = [...new Set(this.ymList.map((v) => Math.floor(v / 100)))];
      this._codeCache = {};
    }

    // 取得某維度每一列的代碼陣列與標籤
    dim(key) {
      if (this._codeCache[key]) return this._codeCache[key];
      const ds = this.ds; let res;
      if (ds.str[key]) {
        res = { codes: ds.str[key].codes, labels: ds.str[key].dict, sortNum: false };
      } else if (key === 'src') {
        res = { codes: ds.src, labels: SRC_NAMES };
      } else if (key === 'ym') {
        const codes = new Int32Array(this.n); const ym = ds.num.ym;
        for (let i = 0; i < this.n; i++) codes[i] = this.ymIndex.get(ym[i]) ?? 0;
        res = { codes, labels: this.ymList.map(ymLabel), raw: this.ymList, ordered: true };
      } else if (key === 'year') {
        const ix = new Map(this.yearList.map((v, i) => [v, i]));
        const codes = new Int32Array(this.n); const ym = ds.num.ym;
        for (let i = 0; i < this.n; i++) codes[i] = ix.get(Math.floor(ym[i] / 100)) ?? 0;
        res = { codes, labels: this.yearList.map((y) => y + '年'), ordered: true };
      } else if (key === 'month') {
        const codes = new Int32Array(this.n); const ym = ds.num.ym;
        for (let i = 0; i < this.n; i++) codes[i] = Math.max(0, (ym[i] % 100) - 1);
        res = { codes, labels: Array.from({ length: 12 }, (_, i) => (i + 1) + '月'), ordered: true };
      }
      this._codeCache[key] = res;
      return res;
    }

    // 回傳符合篩選條件的列索引
    // filter = { src: 'all'|'sales'|'returns', ymFrom, ymTo, dims: {key: Set(codes)}, search: {key, text} }
    select(filter = {}) {
      const n = this.n, ds = this.ds;
      const out = new Uint32Array(n); let k = 0;
      const src = ds.src, ym = ds.num.ym;
      const sMode = filter.src === 'sales' ? 0 : filter.src === 'returns' ? 1 : -1;
      const from = filter.ymFrom || 0, to = filter.ymTo || 999999;
      const checks = [];
      for (const key in (filter.dims || {})) {
        const set = filter.dims[key];
        if (!set || !set.size) continue;
        const d = this.dim(key);
        const mask = new Uint8Array(d.labels.length);
        for (const c of set) mask[c] = 1;
        checks.push([d.codes, mask]);
      }
      for (let i = 0; i < n; i++) {
        if (sMode >= 0 && src[i] !== sMode) continue;
        const y = ym[i];
        if (y < from || y > to) continue;
        let ok = true;
        for (let c = 0; c < checks.length; c++) { if (!checks[c][1][checks[c][0][i]]) { ok = false; break; } }
        if (ok) out[k++] = i;
      }
      return out.subarray(0, k);
    }

    // 樞紐分析
    // spec = { rows: [dimKey], cols: dimKey|null, measures: [measureKey], filter }
    pivot(spec) {
      const t0 = performance.now();
      const idx = spec.rowsIdx || this.select(spec.filter);
      const m = idx.length;
      const rowDims = spec.rows.map((k) => this.dim(k));
      const colDim = spec.cols ? this.dim(spec.cols) : null;
      const ds = this.ds;
      const amt = ds.num.amt, sold = ds.num.sold, profit = ds.num.profit, qty = ds.num.qty, src = ds.src;
      const ms = spec.measures;
      const W = 8; // 0銷貨 1退貨 2毛利S 3毛利R 4賣出S 5賣出R 6數量 7筆數
      const keyArr = rowDims.map((d) => d.codes);
      const colCodes = colDim ? colDim.codes : null;
      // 1) 指派群組編號
      const gid = new Int32Array(m);
      const groupFirst = []; // 每個群組的第一列（用來取維度代碼）
      let span = 1; const mult = [];
      for (const d of rowDims) { mult.push(span); span *= Math.max(1, d.labels.length); }
      if (span <= 16e6) {
        const slot = new Int32Array(span).fill(-1);
        for (let j = 0; j < m; j++) {
          const i = idx[j]; let key = 0;
          for (let d = 0; d < keyArr.length; d++) key += keyArr[d][i] * mult[d];
          let g = slot[key];
          if (g < 0) { g = slot[key] = groupFirst.length; groupFirst.push(i); }
          gid[j] = g;
        }
      } else {
        const map = new Map();
        for (let j = 0; j < m; j++) {
          const i = idx[j]; let key = '';
          for (let d = 0; d < keyArr.length; d++) key += keyArr[d][i] + '|';
          let g = map.get(key);
          if (g === undefined) { g = groupFirst.length; map.set(key, g); groupFirst.push(i); }
          gid[j] = g;
        }
      }
      const G = groupFirst.length;
      // 只保留有資料的欄，並重新編號（避免欄位很多時占用大量記憶體）
      let nCols = 1, cmap = null, ucols = null;
      if (colDim) {
        const seen = new Uint8Array(colDim.labels.length);
        for (let j = 0; j < m; j++) seen[colCodes[idx[j]]] = 1;
        cmap = new Int32Array(colDim.labels.length).fill(-1); ucols = [];
        for (let c = 0; c < seen.length; c++) if (seen[c]) { cmap[c] = ucols.length; ucols.push(c); }
        nCols = Math.max(1, ucols.length);
      }
      if (G * nCols * W > 24e6) {
        const e = new Error('TOO_BIG'); e.groups = G; e.cols = nCols; throw e;
      }
      // 2) 累加
      const cells = new Float64Array(G * nCols * W);
      const tot = new Float64Array(nCols * W);
      for (let j = 0; j < m; j++) {
        const i = idx[j]; const c = colCodes ? cmap[colCodes[i]] : 0;
        const o = (gid[j] * nCols + c) * W, t = c * W;
        const a = amt[i], pf = profit[i], sd = sold[i];
        if (src[i] === 0) { cells[o] += a; cells[o + 2] += pf; cells[o + 4] += sd; tot[t] += a; tot[t + 2] += pf; tot[t + 4] += sd; } else { cells[o + 1] += a; cells[o + 3] += pf; cells[o + 5] += sd; tot[t + 1] += a; tot[t + 3] += pf; tot[t + 5] += sd; }
        cells[o + 6] += qty[i]; cells[o + 7] += 1; tot[t + 6] += qty[i]; tot[t + 7] += 1;
      }
      // 3) 相異計數（排序法，快速且不需大量 Set）
      const distinct = {};
      for (const mk of ms) {
        if (!DISTINCT[mk]) continue;
        const vc = this.dim(DISTINCT[mk]).codes; const V = this.dim(DISTINCT[mk]).labels.length + 1;
        const onlySales = mk === 'orders';
        const cnt = (keyOf, size) => {
          if (size * V <= 4e7) {
            const mark = new Uint8Array(size * V); const res = new Float64Array(size);
            for (let j = 0; j < m; j++) {
              const i = idx[j]; if (onlySales && src[i] !== 0) continue;
              const kk = keyOf(j, i); const x = kk * V + vc[i];
              if (!mark[x]) { mark[x] = 1; res[kk]++; }
            }
            return res;
          }
          const arr = new Float64Array(m); let k = 0;
          for (let j = 0; j < m; j++) { const i = idx[j]; if (onlySales && src[i] !== 0) continue; arr[k++] = keyOf(j, i) * V + vc[i]; }
          const a2 = arr.subarray(0, k).sort();
          const res = new Float64Array(size);
          let prev = -1;
          for (let q = 0; q < k; q++) { const x = a2[q]; if (x !== prev) { res[Math.floor(x / V)]++; prev = x; } }
          return res;
        };
        distinct[mk] = {
          cell: cnt((j, i) => gid[j] * nCols + (colCodes ? cmap[colCodes[i]] : 0), G * nCols),
          row: colDim ? cnt((j) => gid[j], G) : null,
          col: cnt((j, i) => (colCodes ? cmap[colCodes[i]] : 0), nCols),
          all: colDim ? cnt(() => 0, 1)[0] : null,
        };
      }
      const calc = (C, o, dist) => ms.map((mk) => {
        const S = C[o], R = C[o + 1], PS = C[o + 2], PR = C[o + 3], QS = C[o + 4], QR = C[o + 5];
        switch (mk) {
          case 'sales': return S; case 'returns': return R; case 'net': return S - R;
          case 'profit': return PS; case 'netProfit': return PS - PR;
          case 'margin': return S ? PS / S : null; case 'retRate': return S ? R / S : null;
          case 'soldQty': return QS; case 'retQty': return QR; case 'netQty': return QS - QR;
          case 'qty': return C[o + 6]; case 'rows': return C[o + 7];
          case 'avgPrice': return QS ? S / QS : null;
          default: return dist(mk);
        }
      });
      const out = new Array(G);
      const sum = new Float64Array(W);
      for (let g = 0; g < G; g++) {
        const i0 = groupFirst[g];
        const codes = keyArr.map((a) => a[i0]);
        const vals = [];
        for (let c = 0; c < nCols; c++) vals.push(calc(cells, (g * nCols + c) * W, (mk) => distinct[mk].cell[g * nCols + c]));
        let rowTotal = null;
        if (colDim) {
          sum.fill(0);
          for (let c = 0; c < nCols; c++) { const o = (g * nCols + c) * W; for (let w = 0; w < W; w++) sum[w] += cells[o + w]; }
          rowTotal = calc(sum, 0, (mk) => distinct[mk].row[g]);
        }
        out[g] = { codes, labels: codes.map((c, d) => rowDims[d].labels[c]), vals, rowTotal };
      }
      let usedCols = null;
      if (colDim) { usedCols = []; for (let c = 0; c < nCols; c++) usedCols.push(c); }
      const colTotals = [];
      for (let c = 0; c < nCols; c++) colTotals.push(calc(tot, c * W, (mk) => distinct[mk].col[c]));
      let grand;
      if (colDim) {
        sum.fill(0);
        for (let c = 0; c < nCols; c++) for (let w = 0; w < W; w++) sum[w] += tot[c * W + w];
        grand = calc(sum, 0, (mk) => distinct[mk].all);
      } else grand = colTotals[0];
      const coll = new Intl.Collator('zh-Hant', { numeric: true });
      out.sort((a, b) => {
        for (let d = 0; d < rowDims.length; d++) {
          if (rowDims[d].ordered) { if (a.codes[d] !== b.codes[d]) return a.codes[d] - b.codes[d]; } else {
            const r = coll.compare(String(a.labels[d]), String(b.labels[d]));
            if (r) return r;
          }
        }
        return 0;
      });
      return {
        rows: out, rowDims: spec.rows, colDim: spec.cols, measures: ms,
        colLabels: colDim ? ucols.map((c) => colDim.labels[c]) : null, usedCols, colTotals, grand,
        matched: m, ms: performance.now() - t0,
      };
    }

    // 客戶指標（等同 Excel AK~AP）：只用進貨資料計算交易期間
    customers(filter = {}, refYm) {
      const ref = refYm || this.maxYm;
      const idx = this.select({ ...filter, src: 'all' });
      const ds = this.ds;
      const ck = ds.str.ck.codes, ord = ds.str.ord.codes, ym = ds.num.ym, src = ds.src;
      const amt = ds.num.amt, profit = ds.num.profit, sold = ds.num.sold;
      const N = ds.str.ck.dict.length;
      const first = new Int32Array(N).fill(999999), last = new Int32Array(N);
      const sales = new Float64Array(N), ret = new Float64Array(N), prof = new Float64Array(N), qty = new Float64Array(N);
      const orders = Array.from({ length: N }, () => null);
      const custCode = new Int32Array(N), nameCode = new Int32Array(N), repCode = new Int32Array(N).fill(-1), regCode = new Int32Array(N);
      const has = new Uint8Array(N);
      const months = Array.from({ length: N }, () => null);
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j]; const c = ck[i];
        if (src[i] === 1) { ret[c] += amt[i]; continue; }
        has[c] = 1;
        const y = ym[i];
        if (y && y < first[c]) first[c] = y;
        if (y > last[c]) { last[c] = y; repCode[c] = ds.str.rep.codes[i]; }
        sales[c] += amt[i]; prof[c] += profit[i]; qty[c] += sold[i];
        let st = orders[c]; if (!st) st = orders[c] = new Set(); st.add(ord[i]);
        let ms = months[c]; if (!ms) ms = months[c] = new Set(); ms.add(y);
        custCode[c] = ds.str.cust.codes[i]; nameCode[c] = ds.str.cname.codes[i]; regCode[c] = ds.str.region.codes[i];
      }
      const list = [];
      for (let c = 0; c < N; c++) {
        if (!has[c]) continue;
        const span = ymDiff(last[c], first[c]) + 1;
        const nOrd = orders[c].size;
        list.push({
          ck: c,
          key: ds.str.ck.dict[c],
          code: ds.str.cust.dict[custCode[c]],
          name: ds.str.cname.dict[nameCode[c]],
          region: ds.str.region.dict[regCode[c]],
          rep: repCode[c] >= 0 ? ds.str.rep.dict[repCode[c]] : '',
          first: first[c], last: last[c],
          tenure: ymDiff(ref, first[c]) + 1, // 110年至今月份
          idle: ymDiff(ref, last[c]), // 靜止月份
          freq: span / nOrd * 30, // 購買頻率(天)
          orders: nOrd, activeMonths: months[c].size,
          sales: sales[c], returns: ret[c], net: sales[c] - ret[c], profit: prof[c],
          margin: sales[c] ? prof[c] / sales[c] : null, qty: qty[c],
        });
      }
      return { list, ref, matched: idx.length };
    }

    // 商品指標（等同 Excel AT~AX / BM~BR）：level = 'sku' 或 'sku2'
    products(filter = {}, refYm, level = 'sku') {
      const ref = refYm || this.maxYm;
      const idx = this.select({ ...filter, src: 'all' });
      const ds = this.ds;
      const key = ds.str[level].codes, ym = ds.num.ym, src = ds.src;
      const amt = ds.num.amt, profit = ds.num.profit, sold = ds.num.sold, ck = ds.str.ck.codes;
      const N = ds.str[level].dict.length;
      const first = new Int32Array(N).fill(999999), last = new Int32Array(N);
      const firstRow = new Int32Array(N).fill(-1);
      const sales = new Float64Array(N), ret = new Float64Array(N), prof = new Float64Array(N), qty = new Float64Array(N), rq = new Float64Array(N);
      const custs = Array.from({ length: N }, () => null);
      const recent = new Float64Array(N); // 近 12 個月賣出數
      const has = new Uint8Array(N);
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j]; const c = key[i];
        if (src[i] === 1) { ret[c] += amt[i]; rq[c] += sold[i]; continue; }
        has[c] = 1;
        const y = ym[i];
        if (firstRow[c] < 0) firstRow[c] = i;
        if (y && y < first[c]) first[c] = y;
        if (y > last[c]) last[c] = y;
        sales[c] += amt[i]; prof[c] += profit[i]; qty[c] += sold[i];
        if (ymDiff(ref, y) < 12) recent[c] += sold[i];
        let st = custs[c]; if (!st) st = custs[c] = new Set(); st.add(ck[i]);
      }
      const list = [];
      const catD = ds.str.cat.dict, catC = ds.str.cat.codes;
      for (let c = 0; c < N; c++) {
        if (!has[c]) continue;
        list.push({
          code: ds.str[level].dict[c],
          cat: catD[catC[firstRow[c]]],
          sku2: level === 'sku' ? ds.str.sku2.dict[ds.str.sku2.codes[firstRow[c]]] : '',
          first: first[c], last: last[c],
          tenure: ymDiff(ref, first[c]) + 1, // 110年至今月份
          idle: ymDiff(ref, last[c]), // 滯銷/停售月份
          qty: qty[c], retQty: rq[c], recentQty: recent[c],
          sales: sales[c], returns: ret[c], net: sales[c] - ret[c], profit: prof[c],
          margin: sales[c] ? prof[c] / sales[c] : null,
          custs: custs[c].size,
        });
      }
      return { list, ref, matched: idx.length };
    }

    // 月趨勢（總覽用）
    trend(filter = {}) {
      const p = this.pivot({ rows: ['ym'], cols: null, measures: ['sales', 'returns', 'net', 'profit'], filter });
      return p.rows.map((r) => ({ ym: this.ymList[r.codes[0]], label: r.labels[0], sales: r.vals[0][0], returns: r.vals[0][1], net: r.vals[0][2], profit: r.vals[0][3] }));
    }
  }

  root.Engine = Engine;
  root.EngineMeta = { DIMS, MEASURES, ymDiff, ymLabel, SRC_NAMES };
})(typeof self !== 'undefined' ? self : globalThis);

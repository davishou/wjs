// 將 xlsx 的「原始進貨表」「原始退貨表」轉成欄式資料集（合併為一張事實表）。
(function (root) {
  const X = root.XlsxStream;

  // 依表頭名稱對應欄位（不依賴欄位字母，未來欄位順序變動也能讀）
  const SALES_COLS = {
    ord: ['出貨日期', '出貨單號', '單號'],
    cat: ['商品類別'], sku: ['商品代號'], color: ['顏色代號'], unit: ['單位'],
    cost: ['單價'], price: ['售價'], qty: ['數量'], unitn: ['單位(數字)'],
    amt: ['品項總額'], cust: ['客戶代號'], cname: ['客戶名'], rep: ['業務員'],
  };
  const RET_COLS = {
    ord: ['退貨單號'],
    cat: ['商品類別'], sku: ['商品代號'], color: ['顏色代號'], unit: ['單位'],
    cost: ['單價'], price: ['售價'], qty: ['數量'], unitn: ['單位(數字)'],
    amt: ['退貨金額'], cust: ['客戶代號'], cname: ['客戶名'], rep: ['業務員'],
  };
  const STR = ['ord', 'cat', 'sku', 'color', 'unit', 'cust', 'cname', 'rep'];
  const NUM = ['cost', 'price', 'qty', 'unitn', 'amt'];

  class Dict {
    constructor() { this.map = new Map(); this.list = []; }
    code(s) {
      let c = this.map.get(s);
      if (c === undefined) { c = this.list.length; this.list.push(s); this.map.set(s, c); }
      return c;
    }
  }

  class Builder {
    constructor(cap) {
      this.n = 0; this.cap = cap;
      this.dicts = {}; this.s = {}; this.f = {};
      for (const k of STR) { this.dicts[k] = new Dict(); this.s[k] = new Int32Array(cap); }
      for (const k of NUM) this.f[k] = new Float64Array(cap);
      this.src = new Uint8Array(cap);
    }
    grow() {
      const cap = this.cap * 2;
      for (const k of STR) { const a = new Int32Array(cap); a.set(this.s[k]); this.s[k] = a; }
      for (const k of NUM) { const a = new Float64Array(cap); a.set(this.f[k]); this.f[k] = a; }
      const s = new Uint8Array(cap); s.set(this.src); this.src = s;
      this.cap = cap;
    }
  }

  function matchHeader(header, spec) {
    const idx = {};
    for (const key in spec) {
      idx[key] = -1;
      for (const name of spec[key]) {
        const i = header.findIndex((h) => (h || '').trim() === name);
        if (i >= 0) { idx[key] = i; break; }
      }
    }
    return idx;
  }

  async function readTable(zip, sst, path, spec, srcCode, B, progress) {
    let header = null;
    let idxOf = null; // key -> col
    let colKey = null; // col -> key
    let rowVals = [];
    const blankStrCode = {};
    const sstCode = {}; // key -> Int32Array cache per sst index
    for (const k of STR) blankStrCode[k] = -1;
    let rowsRead = 0, emptyStreak = 0;
    const handlers = {
      maxCol: 200,
      stop: false,
      onCell(col, kind, val) {
        if (!header) { rowVals[col] = kind === 1 ? sst[val] : String(val); return; }
        const key = colKey[col];
        if (key === undefined) return;
        rowVals[col] = kind === 1 ? -1 - val : val; // 負數代表共用字串索引
        void key;
      },
      onRowEnd() {
        if (!header) {
          header = [];
          for (let i = 0; i < rowVals.length; i++) header[i] = rowVals[i] == null ? '' : String(rowVals[i]);
          idxOf = matchHeader(header, spec);
          const missing = Object.keys(idxOf).filter((k) => idxOf[k] < 0 && k !== 'rep');
          if (missing.length) throw new Error('「' + path + '」找不到欄位：' + missing.map((k) => spec[k][0]).join('、'));
          colKey = [];
          let mx = 0;
          for (const k in idxOf) if (idxOf[k] >= 0) { colKey[idxOf[k]] = k; mx = Math.max(mx, idxOf[k]); }
          handlers.maxCol = mx + 1;
          rowVals = [];
          return;
        }
        const sv = rowVals[idxOf.sku], ov = rowVals[idxOf.ord];
        if (sv === undefined && ov === undefined) {
          rowVals = [];
          if (++emptyStreak > 5000 && rowsRead > 0) handlers.stop = true; // 後面都是空白列
          return;
        }
        emptyStreak = 0;
        if (B.n >= B.cap) B.grow();
        const r = B.n++;
        for (const k of STR) {
          const c = idxOf[k];
          const v = c >= 0 ? rowVals[c] : undefined;
          let code;
          if (v === undefined || v === null) {
            if (blankStrCode[k] < 0) blankStrCode[k] = B.dicts[k].code('');
            code = blankStrCode[k];
          } else if (typeof v === 'number' && v < 0 && Number.isInteger(v) && (v <= -1) && rowValsIsSst(c)) {
            const si = -1 - v;
            let cache = sstCode[k];
            if (!cache) { cache = sstCode[k] = new Int32Array(sst.length).fill(-1); }
            code = cache[si];
            if (code < 0) { code = cache[si] = B.dicts[k].code(String(sst[si]).trim()); }
          } else {
            code = B.dicts[k].code(String(v).trim());
          }
          B.s[k][r] = code;
        }
        for (const k of NUM) {
          const c = idxOf[k];
          let v = c >= 0 ? rowVals[c] : undefined;
          if (typeof v === 'number' && rowValsIsSst(c)) v = parseFloat(sst[-1 - v]);
          else if (typeof v === 'string') v = parseFloat(v);
          B.f[k][r] = (v === undefined || v === null || Number.isNaN(v)) ? 0 : v;
        }
        B.src[r] = srcCode;
        rowsRead++;
        rowVals = [];
        sstFlags.fill(0);
      },
    };
    // 記錄哪些欄位值是共用字串（負數編碼與真正負數區分）
    const sstFlags = new Uint8Array(256);
    const origOnCell = handlers.onCell;
    handlers.onCell = function (col, kind, val) {
      if (header && kind === 1 && col < 256) sstFlags[col] = 1;
      else if (header && col < 256) sstFlags[col] = 0;
      origOnCell(col, kind, val);
    };
    function rowValsIsSst(c) { return sstFlags[c] === 1; }
    await X.scanSheet(zip, path, handlers, progress);
    return rowsRead;
  }

  function trim(a, n) { return a.length === n ? a : a.slice(0, n); }

  // blob：File/Blob 或 Uint8Array（解密後的內容）；name：檔名
  async function ingestXlsx(blob, onStatus, name) {
    const t0 = Date.now();
    onStatus({ stage: '開啟檔案', pct: 0 });
    const zip = await X.openZip(blob);
    const sheets = await X.listSheets(zip);
    const sstText = zip.entries['xl/sharedStrings.xml'] ? await zip.text('xl/sharedStrings.xml') : '';
    const sst = X.parseSharedStrings(sstText);
    const find = (names) => sheets.find((s) => names.includes(s.name.trim()));
    const sSheet = find(['原始進貨表', '進貨表', '原始出貨表']);
    const rSheet = find(['原始退貨表', '退貨表']);
    if (!sSheet) throw new Error('找不到「原始進貨表」工作表。檔案內的工作表：' + sheets.map((s) => s.name).join('、'));
    const B = new Builder(1 << 20);
    const sizeS = (zip.entries[sSheet.path] || {}).uncomp || 1;
    const sizeR = rSheet ? ((zip.entries[rSheet.path] || {}).uncomp || 1) : 0;
    const tot = sizeS + sizeR;
    const nS = await readTable(zip, sst, sSheet.path, SALES_COLS, 0, B, (p) => onStatus({ stage: '讀取原始進貨表', pct: p / tot, rows: B.n }));
    let nR = 0;
    if (rSheet) nR = await readTable(zip, sst, rSheet.path, RET_COLS, 1, B, (p) => onStatus({ stage: '讀取原始退貨表', pct: (sizeS + p) / tot, rows: B.n }));
    const n = B.n;
    const ds = {
      version: 1,
      createdAt: new Date().toISOString(),
      sourceName: name || blob.name || '',
      n, nSales: nS, nReturns: nR,
      str: {}, num: {},
      src: trim(B.src, n),
    };
    for (const k of STR) ds.str[k] = { dict: B.dicts[k].list, codes: trim(B.s[k], n) };
    for (const k of NUM) ds.num[k] = trim(B.f[k], n);
    ds.parseMs = Date.now() - t0;
    return ds;
  }

  // ---- 商品類別代碼表（使用者另外提供的 Excel：商品類別(代碼)、商品類別、大類）----
  // 找到表頭同時有「代碼」與「大類」的工作表；回傳 { map: {代碼: [名稱, 大類]}, rows, sheet }，沒有就回傳 null
  async function readClassification(blob) {
    const zip = await X.openZip(blob);
    const sheets = await X.listSheets(zip);
    const sst = X.parseSharedStrings(zip.entries['xl/sharedStrings.xml'] ? await zip.text('xl/sharedStrings.xml') : '');
    for (const sh of sheets) {
      if (!zip.entries[sh.path]) continue;
      const rows = []; let cur = [];
      const h = {
        maxCol: 12, stop: false,
        onCell(col, kind, val) { cur[col] = kind === 1 ? sst[val] : val; },
        onRowEnd() { rows.push(cur); cur = []; if (rows.length > 20000) h.stop = true; },
      };
      await X.scanSheet(zip, sh.path, h);
      const hi = rows.findIndex((r) => r && r.some((v) => String(v || '').includes('大類')));
      if (hi < 0) continue;
      const head = rows[hi].map((v) => String(v == null ? '' : v).trim());
      const ci = head.findIndex((v) => v.includes('代碼'));
      const bi = head.findIndex((v) => v.includes('大類'));
      const ni = head.findIndex((v, i) => i !== ci && i !== bi && v.includes('類別'));
      if (ci < 0 || bi < 0) continue;
      const map = {}; let n = 0;
      for (const r of rows.slice(hi + 1)) {
        if (!r || r[ci] == null || String(r[ci]).trim() === '') continue;
        const t = String(r[ci]).trim();
        const code = t === '(空白)' || t === '（空白）' ? '' : (/^\d$/.test(t) ? '0' + t : t);
        const name = ni >= 0 && r[ni] != null ? String(r[ni]).trim() : '';
        const big = r[bi] != null ? String(r[bi]).trim() : '';
        if (!name && !big) continue; // 沒有名稱也沒有大類的代碼，當作未分類
        map[code] = [name, big]; n++;
      }
      if (n) return { map, rows: n, sheet: sh.name };
    }
    return null;
  }
  // 這個 Excel 是總表（有原始進貨表）還是分類表？
  async function detectKind(blob) {
    const sheets = await X.listSheets(await X.openZip(blob));
    const names = sheets.map((s) => s.name.trim());
    if (names.some((n) => ['原始進貨表', '進貨表', '原始出貨表'].includes(n))) return 'master';
    return 'other';
  }

  root.Ingest = { ingestXlsx, readClassification, detectKind };
})(typeof self !== 'undefined' ? self : globalThis);

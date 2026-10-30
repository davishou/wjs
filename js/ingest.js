// 將 xlsx 的「原始進貨表」「原始退貨表」轉成欄式資料集（合併為一張事實表）。
(function (root) {
  const X = root.XlsxStream;

  // 依表頭名稱對應欄位（不依賴欄位字母，未來欄位順序變動也能讀）。
  // 支援兩種表頭：總表的中文表頭，以及系統原始資料（JMSSAL／JMSSBK）的英文欄位名稱。
  // 原始資料對照：DELIVNO 單號、CODE 商品類別、STYLE 商品代號、COLO 顏色、UNIT_NM 單位、PRICE 單價（成本）、OUTPRICE 售價、
  //   OUTQTY 數量、UNIT 單位(數字)、SALEGET 品項金額、ID 客戶代號、SNAME 客戶名、EMPNO 業務員、DELIVDATE 實際出貨／退貨日期。
  // 注意：總表 A 欄的表頭叫「出貨日期」，但內容其實是發貨單號，所以只當單號用。
  const COMMON = {
    cat: ['商品類別', 'CODE'], sku: ['商品代號', 'STYLE'], color: ['顏色代號', 'COLO'], unit: ['單位', 'UNIT_NM'],
    cost: ['單價', 'PRICE'], price: ['售價', 'OUTPRICE'], qty: ['數量', 'OUTQTY'], unitn: ['單位(數字)', 'UNIT'],
    cust: ['客戶代號', 'ID'], cname: ['客戶名', 'SNAME'], rep: ['業務員', 'EMPNO'],
    date: ['DELIVDATE', '實際出貨日期', '實際退貨日期', '實際日期'],
  };
  const SALES_COLS = { ord: ['出貨日期', '出貨單號', '單號', 'DELIVNO'], amt: ['品項總額', 'SALEGET'], ...COMMON };
  const RET_COLS = { ord: ['退貨單號', 'DELIVNO'], amt: ['退貨金額', 'SALEGET'], ...COMMON };
  const OPTIONAL = new Set(['rep', 'date']);
  const STR = ['ord', 'cat', 'sku', 'color', 'unit', 'cust', 'cname', 'rep'];
  const NUM = ['cost', 'price', 'qty', 'unitn', 'amt', 'date'];

  // 日期 → 民國 yyymmdd 整數（例如 1150801）。讀不出來回傳 0。
  // 接受：1150801（民國）、20260801（西元）、115/08/01、2026-08-01、Excel 日期序號
  const roc = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 0 && y < 300 ? y * 10000 + m * 100 + d : 0);
  function parseDate(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') {
      if (!isFinite(v) || v <= 0) return 0;
      const n = Math.round(v);
      if (n >= 19000101 && n <= 21001231) return roc(Math.floor(n / 10000) - 1911, Math.floor(n / 100) % 100, n % 100);
      if (n >= 100101 && n <= 2991231 && Math.floor(n / 100) % 100 >= 1 && Math.floor(n / 100) % 100 <= 12) return roc(Math.floor(n / 10000), Math.floor(n / 100) % 100, n % 100);
      if (n > 20000 && n < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return roc(d.getUTCFullYear() - 1911, d.getUTCMonth() + 1, d.getUTCDate()); }
      return 0;
    }
    const t = String(v).trim();
    const m = /^(\d{2,4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/.exec(t);
    if (m) { let y = +m[1]; if (y > 1911) y -= 1911; return roc(y, +m[2], +m[3]); }
    if (/^\d{5,8}$/.test(t)) return parseDate(+t);
    return 0;
  }

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
      this.dated = 0;
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

  // scan(handlers, progress)：逐列送出儲存格（Excel 工作表或 DBF）；label 用在錯誤訊息
  async function readTable(scan, sst, label, spec, srcCode, B, progress) {
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
          const missing = Object.keys(idxOf).filter((k) => idxOf[k] < 0 && !OPTIONAL.has(k));
          if (missing.length) throw new Error('「' + label + '」找不到欄位：' + missing.map((k) => spec[k][0]).join('、'));
          colKey = [];
          let mx = 0;
          for (const k in idxOf) if (idxOf[k] >= 0) { colKey[idxOf[k]] = k; mx = Math.max(mx, idxOf[k]); }
          handlers.maxCol = mx + 1;
          handlers.want = new Uint8Array(mx + 1); for (const k in idxOf) if (idxOf[k] >= 0) handlers.want[idxOf[k]] = 1;
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
          if (typeof v === 'number' && rowValsIsSst(c)) v = k === 'date' ? sst[-1 - v] : parseFloat(sst[-1 - v]);
          if (k === 'date') { B.f[k][r] = parseDate(v); if (B.f[k][r]) B.dated++; continue; }
          if (typeof v === 'string') v = parseFloat(v);
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
    await scan(handlers, progress);
    return rowsRead;
  }

  function trim(a, n) { return a.length === n ? a : a.slice(0, n); }

  // 判斷一張表是出貨（0）還是退貨（1）：看表頭，回傳 -1 表示都不是
  function kindOfHeader(header) {
    const h = header.map((x) => String(x == null ? '' : x).trim());
    const has = (n) => h.includes(n);
    const okS = Object.entries(SALES_COLS).every(([k, names]) => OPTIONAL.has(k) || names.some(has));
    const okR = Object.entries(RET_COLS).every(([k, names]) => OPTIONAL.has(k) || names.some(has));
    const retHint = has('退貨單號') || has('退貨金額') || has('SERIES') || has('HOLD');
    if (okR && retHint) return 1;
    if (okS) return 0;
    if (okR) return 1;
    return -1;
  }
  async function headerOfSheet(zip, sst, path) {
    const row = []; let done = false;
    const h = { maxCol: 200, stop: false, onCell(c, kind, v) { if (!done) row[c] = kind === 1 ? sst[v] : v; }, onRowEnd() { done = true; h.stop = true; } };
    await X.scanSheet(zip, path, h);
    return row;
  }

  // 讀一個或多個檔案，合併成一張事實表。
  // sources：[{ src: File/Blob/Uint8Array, name, dbf: true|false }]
  //   Excel：找「原始進貨表／原始出貨表」「原始退貨表」工作表；找不到就依表頭判斷（例如 WPS 把 JMSSAL.DBF 另存的 Excel）
  //   DBF：JMSSAL（出貨）、JMSSBK（退貨），依欄位判斷
  async function ingestFiles(sources, onStatus) {
    const t0 = Date.now();
    onStatus({ stage: '開啟檔案', pct: 0 });
    const tables = []; // { scan, sst, label, spec, src, size }
    const notes = [];
    for (const f of sources) {
      if (f.dbf) {
        const H = await self.Dbf.readHeader(f.src);
        const k = kindOfHeader(H.fields.map((x) => x.name));
        const kind = k >= 0 ? k : (/BK/i.test(f.name) ? 1 : /SAL/i.test(f.name) ? 0 : -1);
        if (kind < 0) throw new Error('「' + f.name + '」看起來不是出貨（JMSSAL）或退貨（JMSSBK）資料。欄位：' + H.fields.map((x) => x.name).join('、'));
        const stats = { bad: 0, text: 0 };
        tables.push({ src: kind, label: f.name, size: H.n * H.recLen, sst: [], spec: kind ? RET_COLS : SALES_COLS,
          scan: async (h, p) => { const st = await self.Dbf.scanDbf(f.src, h, p); stats.bad = st.bad; stats.text = st.text; }, stats });
        continue;
      }
      const zip = await X.openZip(f.src);
      const sheets = await X.listSheets(zip);
      const sst = X.parseSharedStrings(zip.entries['xl/sharedStrings.xml'] ? await zip.text('xl/sharedStrings.xml') : '');
      const find = (names) => sheets.find((s) => names.includes(s.name.trim()));
      let sSheet = find(['原始進貨表', '進貨表', '原始出貨表', '出貨表']);
      let rSheet = find(['原始退貨表', '退貨表']);
      if (!sSheet && !rSheet) {
        for (const sh of sheets) {
          if (!zip.entries[sh.path]) continue;
          const k = kindOfHeader(await headerOfSheet(zip, sst, sh.path));
          if (k === 0 && !sSheet) sSheet = sh; else if (k === 1 && !rSheet) rSheet = sh;
        }
      }
      const add = (sh, kind) => tables.push({ src: kind, label: (sources.length > 1 ? f.name + '：' : '') + sh.name, size: (zip.entries[sh.path] || {}).uncomp || 1, sst,
        spec: kind ? RET_COLS : SALES_COLS, scan: (h, p) => X.scanSheet(zip, sh.path, h, p) });
      if (sSheet) add(sSheet, 0);
      if (rSheet) add(rSheet, 1);
      if (!sSheet && !rSheet) notes.push(f.name + '（工作表：' + sheets.map((s) => s.name).join('、') + '）');
    }
    if (!tables.some((t) => t.src === 0)) {
      throw new Error('找不到出貨（進貨）資料。請選總表（有「原始進貨表」或「原始出貨表」），或系統匯出的 JMSSAL' + (sources.length > 1 ? '，可以和 JMSSBK 一起選' : '') + '。' + (notes.length ? '看不懂的檔案：' + notes.join('；') : ''));
    }
    tables.sort((a, b) => a.src - b.src); // 先出貨後退貨
    const B = new Builder(1 << 20);
    const tot = tables.reduce((s, t) => s + t.size, 0) || 1;
    let done = 0; const cnt = [0, 0];
    for (const t of tables) {
      const name = t.src ? '退貨' : '出貨';
      cnt[t.src] += await readTable(t.scan, t.sst, t.label, t.spec, t.src, B, (p, total) => onStatus({ stage: `讀取${name}資料（${t.label}）`, pct: (done + p * (t.size / (total || t.size))) / tot, rows: B.n }));
      done += t.size;
    }
    const n = B.n;
    const ds = {
      version: 1,
      createdAt: new Date().toISOString(),
      sourceName: sources.map((f) => f.name).join('、'),
      n, nSales: cnt[0], nReturns: cnt[1], dated: B.dated,
      str: {}, num: {},
      src: trim(B.src, n),
    };
    const bad = tables.reduce((s, t) => s + (t.stats ? t.stats.bad : 0), 0), text = tables.reduce((s, t) => s + (t.stats ? t.stats.text : 0), 0);
    if (text && bad / text > 0.02) ds.warning = 'DBF 裡的中文有一部分無法辨識，客戶名可能會有亂碼。';
    for (const k of STR) ds.str[k] = { dict: B.dicts[k].list, codes: trim(B.s[k], n) };
    for (const k of NUM) ds.num[k] = trim(B.f[k], n);
    ds.parseMs = Date.now() - t0;
    return ds;
  }
  // 舊的介面：一個 Excel
  function ingestXlsx(blob, onStatus, name) { return ingestFiles([{ src: blob, name: name || blob.name || '', dbf: false }], onStatus); }

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
    const zip = await X.openZip(blob);
    const sheets = await X.listSheets(zip);
    const names = sheets.map((s) => s.name.trim());
    if (names.some((n) => ['原始進貨表', '進貨表', '原始出貨表', '出貨表', '原始退貨表', '退貨表'].includes(n))) return 'master';
    const sst = X.parseSharedStrings(zip.entries['xl/sharedStrings.xml'] ? await zip.text('xl/sharedStrings.xml') : '');
    for (const sh of sheets) if (zip.entries[sh.path] && kindOfHeader(await headerOfSheet(zip, sst, sh.path)) >= 0) return 'master';
    return 'other';
  }

  root.Ingest = { ingestXlsx, ingestFiles, readClassification, detectKind, parseDate };
})(typeof self !== 'undefined' ? self : globalThis);

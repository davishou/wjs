// 資料集：序列化（存本機 / 匯出資料包）、壓縮、加密、以及衍生欄位計算。
(function (root) {
  const MAGIC = 'DVDS1';
  const STR = ['ord', 'cat', 'sku', 'color', 'unit', 'cust', 'cname', 'rep'];
  const NUM = ['cost', 'price', 'qty', 'unitn', 'amt', 'date']; // date：實際出貨／退貨日期（民國 yyymmdd，沒有就是 0）
  const enc = new TextEncoder(), dec = new TextDecoder();

  // ---- 序列化：JSON 標頭 + 二進位欄位 ----
  function serialize(raw) {
    const parts = []; const cols = [];
    let off = 0;
    const push = (name, arr) => {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      // 4-byte 對齊
      const pad = (8 - (off % 8)) % 8;
      if (pad) { parts.push(new Uint8Array(pad)); off += pad; }
      cols.push({ name, type: arr.constructor.name, off, len: arr.length });
      parts.push(bytes); off += bytes.byteLength;
    };
    const dicts = {};
    for (const k of STR) {
      const d = raw.str[k];
      dicts[k] = d.dict;
      const c = d.dict.length < 65536 ? Uint16Array.from(d.codes) : d.codes;
      push('s.' + k, c);
    }
    for (const k of NUM) push('n.' + k, raw.num[k]);
    push('src', raw.src);
    const head = enc.encode(JSON.stringify({
      magic: MAGIC, n: raw.n, nSales: raw.nSales, nReturns: raw.nReturns,
      createdAt: raw.createdAt, sourceName: raw.sourceName, added: raw.added || [], meta: raw.meta || null, dicts, cols,
    }));
    const total = 8 + head.length + ((8 - ((8 + head.length) % 8)) % 8) + off;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    out.set(enc.encode('DVDS'), 0); dv.setUint32(4, head.length, true);
    out.set(head, 8);
    let base = 8 + head.length; base += (8 - (base % 8)) % 8;
    let p = base;
    for (const part of parts) { out.set(part, p); p += part.byteLength; }
    return out.buffer;
  }

  function deserialize(buf) {
    const u8 = new Uint8Array(buf);
    if (dec.decode(u8.subarray(0, 4)) !== 'DVDS') throw new Error('不是有效的資料包');
    const hl = new DataView(buf).getUint32(4, true);
    const head = JSON.parse(dec.decode(u8.subarray(8, 8 + hl)));
    let base = 8 + hl; base += (8 - (base % 8)) % 8;
    const T = { Uint16Array, Int32Array, Float64Array, Uint8Array, Float32Array, Uint32Array };
    const get = (name) => {
      const c = head.cols.find((x) => x.name === name);
      if (!c) return new Float64Array(head.n); // 舊資料沒有這個欄位（例如實際日期）
      const Ctor = T[c.type];
      return new Ctor(buf, base + c.off, c.len);
    };
    const raw = { n: head.n, nSales: head.nSales, nReturns: head.nReturns, createdAt: head.createdAt, sourceName: head.sourceName, added: head.added || [], meta: head.meta || null, str: {}, num: {} };
    for (const k of STR) raw.str[k] = { dict: head.dicts[k], codes: get('s.' + k) };
    for (const k of NUM) raw.num[k] = get('n.' + k);
    raw.src = get('src');
    return raw;
  }

  // ---- 壓縮 / 加密 ----
  // 不經過 Blob（瀏覽器可能把大型 Blob 暫存到硬碟），直接用記憶體串流
  async function pipeBytes(buf, transform) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let p = 0; const STEP = 1 << 20;
    const src = new ReadableStream({ pull(c) { if (p >= u8.length) c.close(); else { c.enqueue(u8.slice(p, p + STEP)); p += STEP; } } });
    return await new Response(src.pipeThrough(transform)).arrayBuffer();
  }
  const gzip = (b) => pipeBytes(b, new CompressionStream('gzip'));
  const gunzip = (b) => pipeBytes(b, new DecompressionStream('gzip'));

  async function keyFrom(password, salt) {
    const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  // 資料包格式：'DVPK' + flags(1) + [salt16 + iv12] + 內容
  async function makePack(raw, password) {
    const z = await gzip(serialize(raw));
    if (!password) {
      const out = new Uint8Array(5 + z.byteLength);
      out.set(enc.encode('DVPK'), 0); out[4] = 0; out.set(new Uint8Array(z), 5);
      return out.buffer;
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFrom(password, salt);
    const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, z);
    const out = new Uint8Array(5 + 28 + c.byteLength);
    out.set(enc.encode('DVPK'), 0); out[4] = 1; out.set(salt, 5); out.set(iv, 21); out.set(new Uint8Array(c), 33);
    return out.buffer;
  }
  function packNeedsPassword(buf) { return new Uint8Array(buf)[4] === 1; }
  async function openPack(buf, password) {
    const u8 = new Uint8Array(buf);
    if (dec.decode(u8.subarray(0, 4)) !== 'DVPK') throw new Error('這不是本軟體匯出的資料包');
    let z;
    if (u8[4] === 1) {
      if (!password) throw new Error('需要密碼');
      const key = await keyFrom(password, u8.slice(5, 21));
      try { z = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(21, 33) }, key, u8.slice(33)); } catch (e) { throw new Error('密碼不正確'); }
    } else z = u8.slice(5).buffer;
    return deserialize(await gunzip(z));
  }

  // 單號前 5 碼是民國年月（例如 11501 = 115 年 1 月）；讀不出來時為 0
  // 在資料裡換上新的 meta（分類表、固定費用、應收帳款），回傳新的資料
  function withMeta(buf, meta) { const raw = deserialize(buf); raw.meta = meta || null; return serialize(raw); }

  function ymOfOrd(s) { const v = parseInt(String(s).slice(0, 5), 10); return Number.isNaN(v) ? 0 : v; }

  // ---- 每月加入新資料 ----
  // 把 add（新月份的 Excel）併入 base（目前的資料）。新檔案裡出現的月份，會取代 base 中「同一種來源（進貨／退貨）、同月份」的資料，
  // 所以同一個檔案加兩次也不會重複。讀不出月份的列直接加入。
  function merge(base, add, name) {
    if (!add.n) throw new Error('「' + (name || '新檔案') + '」裡沒有任何進貨或退貨資料');
    const monthsOf = (raw) => {
      const d = raw.str.ord.dict.map(ymOfOrd), c = raw.str.ord.codes, out = new Int32Array(raw.n);
      for (let r = 0; r < raw.n; r++) out[r] = d[c[r]];
      return out;
    };
    const bYm = monthsOf(base), aYm = monthsOf(add);
    const replace = [new Set(), new Set()]; // [進貨月份, 退貨月份]
    for (let r = 0; r < add.n; r++) if (aYm[r]) replace[add.src[r]].add(aYm[r]);
    const keep = new Uint8Array(base.n);
    const removed = [0, 0], added = [0, 0];
    for (let r = 0; r < base.n; r++) { if (replace[base.src[r]].has(bYm[r])) removed[base.src[r]]++; else keep[r] = 1; }
    for (let r = 0; r < add.n; r++) added[add.src[r]]++;
    // 新的列順序：進貨（舊→新）、退貨（舊→新）。from[j]：0 = 舊資料、1 = 新檔案；row[j]：在該資料中的列號
    const n = base.n - removed[0] - removed[1] + add.n;
    const from = new Uint8Array(n), row = new Int32Array(n);
    let j = 0;
    for (const s of [0, 1]) {
      for (let r = 0; r < base.n; r++) if (keep[r] && base.src[r] === s) { row[j++] = r; }
      for (let r = 0; r < add.n; r++) if (add.src[r] === s) { from[j] = 1; row[j++] = r; }
    }
    const parts = [base, add];
    const now = new Date().toISOString();
    const out = {
      n, nSales: base.nSales - removed[0] + added[0], nReturns: base.nReturns - removed[1] + added[1],
      createdAt: now, sourceName: base.sourceName, meta: base.meta || null,
      added: (base.added || []).concat([{ name: name || '', at: now, sales: added[0], returns: added[1] }]).slice(-24),
      str: {}, num: {}, src: new Uint8Array(n),
    };
    for (const k of STR) {
      const d = makeDict();
      const maps = parts.map((p) => p.str[k].dict.map((v) => d.code(v)));
      const codes = new Int32Array(n), pc = [base.str[k].codes, add.str[k].codes];
      for (let i = 0; i < n; i++) codes[i] = maps[from[i]][pc[from[i]][row[i]]];
      out.str[k] = { dict: d.list, codes };
    }
    for (const k of NUM) {
      const a = new Float64Array(n), pn = [base.num[k], add.num[k]];
      for (let i = 0; i < n; i++) a[i] = pn[from[i]][row[i]];
      out.num[k] = a;
    }
    for (let i = 0; i < n; i++) out.src[i] = parts[from[i]].src[row[i]];
    const months = [...new Set([...replace[0], ...replace[1]])].sort((x, y) => x - y);
    const baseMonths = new Set(bYm);
    let noMonth = 0; for (let r = 0; r < add.n; r++) if (!aYm[r]) noMonth++;
    return {
      raw: out,
      stats: { months, newMonths: months.filter((m) => !baseMonths.has(m)), addSales: added[0], addReturns: added[1], delSales: removed[0], delReturns: removed[1], noMonth, nSales: out.nSales, nReturns: out.nReturns },
    };
  }

  // ---- 加入系統原始資料（JMSSAL／JMSSBK，任何期間：一個月、幾天都可以）----
  // 規則和「總表更新工具」一樣：
  //  1. 依整張單號比對（進貨、退貨分開）。新檔案有的單 → 整張換成新資料；沒有的單 → 新增。
  //  2. 業務員保留原本的：系統事後改了業務員，也保留當初實際負責的人。同一張單依列的順序對齊（第 k 列對第 k 列），
  //     對不到或原本是空白時，用這張單原本的第一個業務員；這張單原本完全沒有業務員才用系統的。
  //  3. 期間內網站有、新檔案沒有的單（多半是作廢或刪除）先列出來，由使用者決定要不要刪。
  //     期間：新檔案的實際日期最早～最晚（進貨、退貨分開）；新檔案沒有實際日期時改用單號月份。
  const ordKey = (raw, r) => raw.src[r] + '|' + raw.str.ord.dict[raw.str.ord.codes[r]];
  const ordOf = (raw, r) => raw.str.ord.dict[raw.str.ord.codes[r]];
  const repOf = (raw, r) => raw.str.rep.dict[raw.str.rep.codes[r]] || '';
  function lineSig(raw, r) { // 比較內容用：不含業務員與日期（舊資料可能沒有日期）
    const s = (k) => raw.str[k].dict[raw.str[k].codes[r]];
    return [s('sku'), s('color'), s('unit'), s('cust'), raw.num.qty[r], raw.num.amt[r], raw.num.price[r], raw.num.cost[r]].join('\u0001');
  }
  function planOrders(base, add) {
    if (!add.n) throw new Error('新檔案裡沒有任何出貨或退貨資料');
    const bRows = new Map(); // key → [列號…]
    for (let r = 0; r < base.n; r++) { const k = ordKey(base, r); let a = bRows.get(k); if (!a) bRows.set(k, (a = [])); a.push(r); }
    const aRows = new Map();
    for (let r = 0; r < add.n; r++) { const k = ordKey(add, r); let a = aRows.get(k); if (!a) aRows.set(k, (a = [])); a.push(r); }
    // 新檔案的期間
    const rng = [0, 1].map(() => ({ dMin: Infinity, dMax: 0, mMin: Infinity, mMax: 0 }));
    for (let r = 0; r < add.n; r++) {
      const g = rng[add.src[r]], d = add.num.date[r], m = ymOfOrd(ordOf(add, r));
      if (d) { if (d < g.dMin) g.dMin = d; if (d > g.dMax) g.dMax = d; }
      if (m) { if (m < g.mMin) g.mMin = m; if (m > g.mMax) g.mMax = m; }
    }
    // 業務員：決定新資料每一列要用的業務員
    const repFix = new Map(); // add 列號 → 要改成的業務員
    const repChanges = []; // { src, ord, from, to }
    let nNew = [0, 0], nUpd = [0, 0], nChanged = 0, nDateFill = 0;
    for (const [k, ar] of aRows) {
      const s = +k.charAt(0), br = bRows.get(k);
      if (!br) { nNew[s]++; continue; }
      nUpd[s]++;
      const first = br.map((r) => repOf(base, r)).find((x) => x) || '';
      let changed = br.length !== ar.length;
      if (!changed) { const a = br.map((r) => lineSig(base, r)).sort(), b = ar.map((r) => lineSig(add, r)).sort(); changed = a.some((x, i) => x !== b[i]); }
      if (changed) nChanged++;
      if (br.some((r) => !base.num.date[r]) && ar.some((r) => add.num.date[r])) nDateFill++;
      if (!first) continue;
      const diff = new Set();
      ar.forEach((r, i) => {
        const keep = (i < br.length && repOf(base, br[i])) || first, sys = repOf(add, r);
        if (sys !== keep) { repFix.set(r, keep); diff.add(keep + '\u0001' + sys); }
      });
      for (const d of diff) { const [from, to] = d.split('\u0001'); repChanges.push({ src: s, ord: k.slice(2), from, to }); }
    }
    // 期間內網站有、新檔案沒有的單
    const missing = []; // { src, ord, rows }
    for (const [k, br] of bRows) {
      if (aRows.has(k)) continue;
      const s = +k.charAt(0), g = rng[s];
      const hasDates = g.dMax > 0;
      const inRange = br.some((r) => {
        if (hasDates) { const d = base.num.date[r]; return d && d >= g.dMin && d <= g.dMax; }
        const m = ymOfOrd(ordOf(base, r)); return m && m >= g.mMin && m <= g.mMax;
      });
      if (inRange) missing.push({ src: s, ord: k.slice(2), rows: br.length });
    }
    missing.sort((a, b) => a.src - b.src || (a.ord < b.ord ? -1 : 1));
    const range = rng.map((g) => (g.dMax ? { by: 'date', from: g.dMin, to: g.dMax } : g.mMax ? { by: 'ord', from: g.mMin, to: g.mMax } : null));
    return { bRows, aRows, repFix, repChanges, missing, range, nNew, nUpd, nChanged, nDateFill, addSales: add.nSales, addReturns: add.nReturns };
  }
  function mergeOrders(base, add, plan, { removeMissing = false, name = '' } = {}) {
    const drop = new Set();
    for (const k of plan.aRows.keys()) if (plan.bRows.has(k)) drop.add(k);
    if (removeMissing) for (const m of plan.missing) drop.add(m.src + '|' + m.ord);
    const keep = new Uint8Array(base.n);
    const removed = [0, 0];
    for (let r = 0; r < base.n; r++) { if (drop.has(ordKey(base, r))) removed[base.src[r]]++; else keep[r] = 1; }
    const n = base.n - removed[0] - removed[1] + add.n;
    const from = new Uint8Array(n), row = new Int32Array(n);
    let j = 0;
    for (const s of [0, 1]) {
      for (let r = 0; r < base.n; r++) if (keep[r] && base.src[r] === s) row[j++] = r;
      for (let r = 0; r < add.n; r++) if (add.src[r] === s) { from[j] = 1; row[j++] = r; }
    }
    const parts = [base, add], now = new Date().toISOString();
    const added = [add.nSales, add.nReturns];
    const out = {
      n, nSales: base.nSales - removed[0] + added[0], nReturns: base.nReturns - removed[1] + added[1],
      createdAt: now, sourceName: base.sourceName, meta: base.meta || null,
      added: (base.added || []).concat([{ name, at: now, sales: added[0], returns: added[1] }]).slice(-60),
      str: {}, num: {}, src: new Uint8Array(n),
    };
    for (const k of STR) {
      const d = makeDict();
      const maps = parts.map((p) => p.str[k].dict.map((v) => d.code(v)));
      const codes = new Int32Array(n), pc = [base.str[k].codes, add.str[k].codes];
      for (let i = 0; i < n; i++) codes[i] = maps[from[i]][pc[from[i]][row[i]]];
      if (k === 'rep') for (let i = 0; i < n; i++) if (from[i] && plan.repFix.has(row[i])) codes[i] = d.code(plan.repFix.get(row[i]));
      out.str[k] = { dict: d.list, codes };
    }
    for (const k of NUM) {
      const a = new Float64Array(n), pn = [base.num[k], add.num[k]];
      for (let i = 0; i < n; i++) a[i] = pn[from[i]][row[i]];
      out.num[k] = a;
    }
    for (let i = 0; i < n; i++) out.src[i] = parts[from[i]].src[row[i]];
    return { raw: out, removedMissing: removeMissing ? plan.missing.length : 0 };
  }

  // ---- 原始檔加密備份（.dvr）----
  // 把使用者選的 JMSSAL.DBF、JMSSBK.DBF「原封不動」包成一個檔，用開啟密碼的金鑰加密（AES-256-GCM）。
  // 格式：'DVRB' + 版本(1) + 次數(4) + salt(16) + iv(12) + AES-GCM(gzip(標頭長度(4) + JSON 標頭 + 每個檔案的位元組))
  // 還原時輸入當時的開啟密碼，用檔案裡的 salt 和次數重新產生金鑰；密碼不存在檔案裡。
  const BAK_AAD = enc.encode('DVRAWBK1');
  async function makeRawBackup(vault, files, info) {
    const list = [], bufs = [];
    for (const f of files) {
      const u8 = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(await f.arrayBuffer());
      list.push({ name: f.name, size: u8.length, lastModified: f.lastModified || 0 }); bufs.push(u8);
    }
    const head = enc.encode(JSON.stringify({ v: 1, createdAt: new Date().toISOString(), files: list, ...(info || {}) }));
    const total = 4 + head.length + bufs.reduce((s, b) => s + b.length, 0);
    const plain = new Uint8Array(total);
    new DataView(plain.buffer).setUint32(0, head.length, true); plain.set(head, 4);
    let p = 4 + head.length; for (const b of bufs) { plain.set(b, p); p += b.length; }
    const z = await gzip(plain); plain.fill(0);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: BAK_AAD }, vault.key, z));
    const out = new Uint8Array(37 + ct.length);
    out.set(enc.encode('DVRB'), 0); out[4] = 1; new DataView(out.buffer).setUint32(5, vault.iter, true);
    out.set(vault.salt, 9); out.set(iv, 25); out.set(ct, 37);
    return out;
  }
  const isRawBackup = (u8) => u8.length > 37 && dec.decode(u8.subarray(0, 4)) === 'DVRB';
  // 回傳 { info, files: [{ name, size, lastModified, bytes: Uint8Array }] }；密碼錯誤時 code = BAD_PASSWORD
  async function openRawBackup(u8, password) {
    if (!isRawBackup(u8)) throw new Error('這不是本軟體的原始檔備份（.dvr）');
    if (u8[4] !== 1) throw new Error('這個備份是新版軟體做的，請重新整理網頁後再試');
    const iter = new DataView(u8.buffer, u8.byteOffset).getUint32(5, true);
    const key = await vaultKey(password, u8.slice(9, 25), iter);
    let z;
    try { z = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(25, 37), additionalData: BAK_AAD }, key, u8.subarray(37)); } catch (e) { const er = new Error('密碼不正確'); er.code = 'BAD_PASSWORD'; throw er; }
    const plain = new Uint8Array(await gunzip(z));
    const hl = new DataView(plain.buffer).getUint32(0, true);
    const info = JSON.parse(dec.decode(plain.subarray(4, 4 + hl)));
    let p = 4 + hl;
    const files = info.files.map((f) => { const bytes = plain.subarray(p, p + f.size); p += f.size; return { ...f, bytes }; });
    return { info, files };
  }

  // ---- 衍生欄位（等同 Excel W~AE 欄的公式）----
  function regionOf(code) {
    const c = code.charAt(0);
    if (c === '1' || c === '2') return '大台北地區';
    if (c === '3') return '桃竹苗';
    if (c === '4' || c === '5') return '中部';
    if (c === '6' || c === '7' || c === '8') return '南部';
    return '其他地區';
  }
  function simplify(sku) {
    const a = sku.indexOf('-'), b = sku.indexOf('/');
    let p = sku.length;
    if (a >= 0) p = Math.min(p, a);
    if (b >= 0) p = Math.min(p, b);
    return sku.slice(0, p);
  }
  // 商品類別代碼：Excel 可能把 03 存成數字 3，統一補成兩碼；「(空白)」視為空白
  function normCat(v) {
    const t = String(v == null ? '' : v).trim();
    if (t === '(空白)' || t === '（空白）') return '';
    return /^\d$/.test(t) ? '0' + t : t;
  }
  // 商品代號 → [款號, 尺寸]。尺寸在「/」或「-」之後，也可能直接接在數字後面：
  //   A100-1 → A100 / 1；B200/3 → B200 / 3；5401/M-L → 5401 / M-L；AR9006XXL → AR9006 / XXL；6872XL-XXL → 6872 / XL-XXL
  function splitSku(sku) {
    const t = String(sku || '').trim();
    const sl = t.indexOf('/');
    if (sl > 0) return [t.slice(0, sl).trim(), t.slice(sl + 1).trim().toUpperCase()];
    const m = /^([A-Za-z]*\d+)(.*)$/.exec(t);
    if (m) return [m[1], m[2].replace(/^[\s\-_.]+/, '').trim().toUpperCase()];
    const d = t.indexOf('-');
    if (d > 0) return [t.slice(0, d), t.slice(d + 1).toUpperCase()];
    return [t, ''];
  }
  // 尺寸排序：數字由小到大，再來 XS < S < M < L < XL < XXL…，M-L 這種範圍以第一個尺寸排
  const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL', 'F', 'FREE'];
  function sizeRank(s) {
    if (!s) return 1e6;
    if (/^\d+(\.\d+)?$/.test(s)) return +s;
    const first = s.split('-')[0];
    const i = SIZE_ORDER.indexOf(first);
    return i >= 0 ? 1000 + i * 10 + (s.includes('-') ? 5 : 0) : 5000;
  }
  function makeDict() { const map = new Map(), list = []; return { list, code(s) { let c = map.get(s); if (c === undefined) { c = list.length; list.push(s); map.set(s, c); } return c; } }; }

  // meta.cat.map = { 代碼: [類別名稱, 大類] }（使用者匯入的商品類別代碼表）
  // opts.ymMode：'date'（預設，依實際出貨／退貨日期；沒有日期的列改用單號）或 'ord'（依單號前 5 碼）
  function hydrate(raw, meta, opts = {}) {
    const n = raw.n;
    const ds = { n, nSales: raw.nSales, nReturns: raw.nReturns, createdAt: raw.createdAt, sourceName: raw.sourceName, added: raw.added || [], str: {}, num: {}, src: raw.src };
    for (const k of STR) ds.str[k] = raw.str[k];
    for (const k of NUM) ds.num[k] = raw.num[k];
    const ordD = raw.str.ord.dict, ordC = raw.str.ord.codes;
    const ymOf = Int32Array.from(ordD, ymOfOrd);
    const ym = new Int32Array(n);
    const dt = raw.num.date, byDate = opts.ymMode !== 'ord';
    let dated = 0, moved = 0;
    for (let r = 0; r < n; r++) {
      const o = ymOf[ordC[r]], d = dt ? dt[r] : 0;
      if (d > 0) { dated++; const dm = Math.floor(d / 100); if (dm !== o) moved++; ym[r] = byDate ? dm : o; } else ym[r] = o;
    }
    ds.dates = { dated, moved, mode: byDate ? 'date' : 'ord' };
    // 客戶 = 代號 + 客戶名
    const ckD = makeDict(); const ck = new Int32Array(n); const pair = new Map();
    const cC = raw.str.cust.codes, nC = raw.str.cname.codes, cD = raw.str.cust.dict, nD = raw.str.cname.dict;
    for (let r = 0; r < n; r++) {
      const pk = cC[r] * 1048576 + nC[r];
      let c = pair.get(pk);
      if (c === undefined) { c = ckD.code(cD[cC[r]] + nD[nC[r]]); pair.set(pk, c); }
      ck[r] = c;
    }
    const regD = makeDict(); const regOf = cD.map((s) => regD.code(regionOf(s)));
    const region = new Int32Array(n); for (let r = 0; r < n; r++) region[r] = regOf[cC[r]];
    const s2D = makeDict(); const s2Of = raw.str.sku.dict.map((s) => s2D.code(simplify(s)));
    const sC = raw.str.sku.codes; const sku2 = new Int32Array(n); for (let r = 0; r < n; r++) sku2[r] = s2Of[sC[r]];
    const sold = new Float64Array(n), profit = new Float64Array(n);
    const { unitn, qty, price, cost, amt } = raw.num;
    for (let r = 0; r < n; r++) {
      const u = unitn[r];
      sold[r] = u === 1 ? qty[r] : (u === 2 ? qty[r] * 12 : 0);
      const pr = price[r];
      profit[r] = pr ? amt[r] * (1 - cost[r] / pr) : 0;
    }
    ds.str.ck = { dict: ckD.list, codes: ck };
    ds.str.region = { dict: regD.list, codes: region };
    ds.str.sku2 = { dict: s2D.list, codes: sku2 };
    // 款號、尺寸（由商品代號拆出來，不改動原始資料）
    const stD = makeDict(), szD = makeDict();
    const stOf = new Int32Array(raw.str.sku.dict.length), szOf = new Int32Array(raw.str.sku.dict.length);
    raw.str.sku.dict.forEach((s, i) => { const [a, b] = splitSku(s); stOf[i] = stD.code(a); szOf[i] = szD.code(b); });
    const style = new Int32Array(n), size = new Int32Array(n);
    for (let r = 0; r < n; r++) { style[r] = stOf[sC[r]]; size[r] = szOf[sC[r]]; }
    ds.str.style = { dict: stD.list, codes: style };
    ds.str.size = { dict: szD.list.map((x) => x || '（無尺寸）'), codes: size, rank: szD.list.map(sizeRank) };
    // 商品類別：有分類表時顯示「代碼 名稱」，並加上大類（男／女／童／配件）
    const cmap = (meta && meta.cat && meta.cat.map) || null;
    const catRaw = raw.str.cat.dict;
    const bigD = makeDict(); const bigOf = new Int32Array(catRaw.length);
    const catLabel = catRaw.map((c, i) => {
      const k = normCat(c), hit = cmap ? cmap[k] : null;
      bigOf[i] = bigD.code(hit && hit[1] ? hit[1] : (cmap ? '未分類' : '（未匯入分類表）'));
      if (!k) return '（空白）';
      return hit && hit[0] ? k + ' ' + hit[0] : k;
    });
    ds.str.cat = { dict: catLabel, codes: raw.str.cat.codes, mapped: catRaw.map((c) => !!(cmap && cmap[normCat(c)] && cmap[normCat(c)][0])) };
    const big = new Int32Array(n); const catC = raw.str.cat.codes;
    for (let r = 0; r < n; r++) big[r] = bigOf[catC[r]];
    ds.str.big = { dict: bigD.list, codes: big };
    ds.meta = meta || null;
    ds.num.ym = ym; ds.num.sold = sold; ds.num.profit = profit;
    return ds;
  }

  // ---- IndexedDB 本機快取 ----
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('dv-analytics', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction('kv', 'readonly'); const q = t.objectStore('kv').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  }
  async function idbDel(key) {
    const db = await idb();
    return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(key); t.oncomplete = () => res(); });
  }

  // ---- 加密的本機儲存（開啟密碼）----
  // IndexedDB 只存密文：{ v, iter, salt, iv, ct }。密碼與金鑰只放在記憶體，重新整理就要重新輸入。
  const VAULT_ITER = 600000;
  const VAULT_AAD = enc.encode('DVVAULT1');
  async function vaultKey(password, salt, iter) {
    const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const Vault = {
    // 用新密碼建立金鑰（每次都換新的 salt）
    async create(password) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      return { key: await vaultKey(password, salt, VAULT_ITER), salt, iter: VAULT_ITER };
    },
    // 加密後存入，並刪除舊版未加密的資料
    async save(v, buf) {
      const z = await gzip(buf);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: VAULT_AAD }, v.key, z);
      await idbSet('vault', { v: 1, iter: v.iter, salt: v.salt, iv, ct, savedAt: new Date().toISOString() });
      await idbDel('data');
    },
    // 用密碼解開；密碼錯誤時丟出 code = BAD_PASSWORD
    async open(password) {
      const rec = await idbGet('vault');
      if (!rec) { const e = new Error('這台裝置上沒有資料'); e.code = 'NO_DATA'; throw e; }
      const key = await vaultKey(password, rec.salt, rec.iter);
      let z;
      try { z = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv, additionalData: VAULT_AAD }, key, rec.ct); } catch (e) { const er = new Error('密碼不正確'); er.code = 'BAD_PASSWORD'; throw er; }
      return { vault: { key, salt: rec.salt, iter: rec.iter }, buf: await gunzip(z) };
    },
    async exists() { return !!(await idbGet('vault')); },
    async legacy() { return (await idbGet('data')) || null; }, // 舊版（未加密）資料
    async clear() { await idbDel('vault'); await idbDel('data'); },
  };

  root.Dataset = { Vault, serialize, deserialize, hydrate, merge, planOrders, mergeOrders, makeRawBackup, openRawBackup, isRawBackup, withMeta, normCat, splitSku, sizeRank, makePack, openPack, packNeedsPassword, gzip, gunzip, idbSet, idbGet, idbDel, regionOf, simplify };
})(typeof self !== 'undefined' ? self : globalThis);

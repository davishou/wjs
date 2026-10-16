// 資料集：序列化（存本機 / 匯出資料包）、壓縮、加密、以及衍生欄位計算。
(function (root) {
  const MAGIC = 'DVDS1';
  const STR = ['ord', 'cat', 'sku', 'color', 'unit', 'cust', 'cname', 'rep'];
  const NUM = ['cost', 'price', 'qty', 'unitn', 'amt'];
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
      createdAt: raw.createdAt, sourceName: raw.sourceName, dicts, cols,
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
      const Ctor = T[c.type];
      return new Ctor(buf, base + c.off, c.len);
    };
    const raw = { n: head.n, nSales: head.nSales, nReturns: head.nReturns, createdAt: head.createdAt, sourceName: head.sourceName, str: {}, num: {} };
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
  function makeDict() { const map = new Map(), list = []; return { list, code(s) { let c = map.get(s); if (c === undefined) { c = list.length; list.push(s); map.set(s, c); } return c; } }; }

  function hydrate(raw) {
    const n = raw.n;
    const ds = { n, nSales: raw.nSales, nReturns: raw.nReturns, createdAt: raw.createdAt, sourceName: raw.sourceName, str: {}, num: {}, src: raw.src };
    for (const k of STR) ds.str[k] = raw.str[k];
    for (const k of NUM) ds.num[k] = raw.num[k];
    const ordD = raw.str.ord.dict, ordC = raw.str.ord.codes;
    const ymOf = new Int32Array(ordD.length);
    for (let i = 0; i < ordD.length; i++) { const v = parseInt(ordD[i].slice(0, 5), 10); ymOf[i] = Number.isNaN(v) ? 0 : v; }
    const ym = new Int32Array(n);
    for (let r = 0; r < n; r++) ym[r] = ymOf[ordC[r]];
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

  root.Dataset = { Vault, serialize, deserialize, hydrate, makePack, openPack, packNeedsPassword, gzip, gunzip, idbSet, idbGet, idbDel, regionOf, simplify };
})(typeof self !== 'undefined' ? self : globalThis);

// 應收帳款自動備份：把收款資料做成一個「要密碼才能打開」的 Excel（.xlsx，Excel 的 Agile 加密：AES-256 + SHA-512）。
// - 每個月一張工作表，格式和使用者原本的「客戶應收帳款明細表」一樣（網站的匯入也讀得懂）
// - 「支票」一張；「網站還原用」（隱藏）放完整資料，匯入時可以整份還原
// - 密碼不儲存：設定時用密碼算出金鑰組（makeKeys），金鑰組跟著銷售資料加密存在這台裝置（S.meta.recvBk）
// 參考：[MS-OFFCRYPTO] 2.3.4.10–2.3.4.15、[MS-CFB]；容器的目錄結構和 msoffcrypto-tool 一樣
(function (root) {
  'use strict';
  const subtle = crypto.subtle;
  const sha512 = (m) => root.OfficeCrypto.sha512(m);
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const cat = (...arrs) => { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
  const le32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
  const utf16 = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b[2 * i] = c & 255; b[2 * i + 1] = c >> 8; } return b; };
  const fix = (b, n) => { if (b.length >= n) return b.slice(0, n); const o = new Uint8Array(n).fill(0x36); o.set(b); return o; };
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; };
  const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
  const enc8 = new TextEncoder();

  // AES-CBC、不加填充（資料長度一定是 16 的倍數；WebCrypto 會多補一整塊，丟掉即可）
  async function cbc(rawKey, iv, data) {
    const key = await subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['encrypt']);
    const out = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, key, data));
    return out.subarray(0, data.length);
  }

  const BK_VIN = hex('fea7d2763b4b9e79'), BK_VH = hex('d7aa0f6d3061344e'), BK_KEY = hex('146e0be7abacd0d6');
  const BK_HK = hex('5fb2ad010cb9e1f6'), BK_HV = hex('a0677f02b22c8433');
  const SPIN = 100000;

  // 用密碼產生金鑰組。回傳的內容要加密保存（裡面有解開備份檔的金鑰），密碼本身不留下
  async function makeKeys(password) {
    const secret = rand(32), kdSalt = rand(16), ekSalt = rand(16), hk = rand(64), vin = rand(16);
    let h = sha512(cat(ekSalt, utf16(password)));
    const it = new Uint8Array(68);
    for (let i = 0; i < SPIN; i++) { it.set(le32(i), 0); it.set(h, 4); h = sha512(it); }
    const bk = (block) => fix(sha512(cat(h, block)), 32);
    const iv = fix(ekSalt, 16);
    const eVin = await cbc(bk(BK_VIN), iv, vin);
    const eVh = await cbc(bk(BK_VH), iv, sha512(vin));
    const eKey = await cbc(bk(BK_KEY), iv, secret);
    const eHk = await cbc(secret, fix(sha512(cat(kdSalt, BK_HK)), 16), hk);
    h.fill(0); it.fill(0);
    const pe = `<p:encryptedKey spinCount="${SPIN}" saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${b64(ekSalt)}" ` +
      `encryptedVerifierHashInput="${b64(eVin)}" encryptedVerifierHashValue="${b64(eVh)}" encryptedKeyValue="${b64(eKey)}"/>`;
    return { v: 1, k: b64(secret), h: b64(hk), s: b64(kdSalt), eHk: b64(eHk), pe };
  }

  // 把 .xlsx 內容加密成 Excel 認得的加密檔
  async function encrypt(plain, K) {
    const secret = unb64(K.k), kdSalt = unb64(K.s), hk = unb64(K.h);
    const parts = [new Uint8Array(8)];
    new DataView(parts[0].buffer).setBigUint64(0, BigInt(plain.length), true);
    for (let i = 0, n = 0; i < plain.length; i += 4096, n++) {
      let seg = plain.subarray(i, i + 4096);
      if (seg.length % 16) { const p = new Uint8Array(seg.length + 16 - seg.length % 16); p.set(seg); seg = p; }
      parts.push(await cbc(secret, fix(sha512(cat(kdSalt, le32(n))), 16), seg));
    }
    let pkg = cat(...parts);
    if (pkg.length < 4096) { const p = new Uint8Array(4096); p.set(pkg); pkg = p; } // 比 4096 小的資料流要放進小區段，這裡直接補到 4096
    const hkey = await subtle.importKey('raw', hk, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    const hv = new Uint8Array(await subtle.sign('HMAC', hkey, pkg));
    const eHv = await cbc(secret, fix(sha512(cat(kdSalt, BK_HV)), 16), hv);
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">' +
      `<keyData saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${K.s}"/>` +
      `<dataIntegrity encryptedHmacKey="${K.eHk}" encryptedHmacValue="${b64(eHv)}"/>` +
      `<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">${K.pe}</keyEncryptor></keyEncryptors></encryption>`;
    const info = cat(Uint8Array.of(4, 0, 4, 0, 0x40, 0, 0, 0), enc8.encode(xml));
    secret.fill(0); hk.fill(0);
    return writeCfb(info, pkg);
  }

  // ---------- 複合文件（CFB）：目錄結構照 msoffcrypto-tool（Excel 打得開）----------
  const u16le = (s) => Uint8Array.from(s.match(/../g).map((x) => parseInt(x, 16)));
  const DS_VERSION = u16le('3c0000004d006900630072006f0073006f00660074002e0043006f006e007400610069006e00650072002e004400610074006100530070006100630065007300010000000100000001000000');
  function dsString(s) { const u = utf16(s); const pad = (4 - u.length % 4) % 4; return cat(le32(u.length), u, new Uint8Array(pad)); }
  const DATA_SPACE_MAP = cat(le32(8), le32(1), (() => { const body = cat(le32(1), le32(0), dsString('EncryptedPackage'), dsString('StrongEncryptionDataSpace')); return cat(le32(body.length + 4), body); })());
  const STRONG_DS = cat(le32(8), le32(1), dsString('StrongEncryptionTransform'));
  const PRIMARY = (() => {
    const body = cat(le32(1), dsString('{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}'));
    const hdr = cat(le32(body.length + 4), body);
    return cat(hdr, dsString('Microsoft.Container.EncryptionTransform'), le32(1), le32(1), le32(1), le32(0), le32(0), le32(0), le32(4));
  })();

  function writeCfb(info, pkg) {
    const SS = 512, END = 0xFFFFFFFE, FREE = 0xFFFFFFFF, FATSECT = 0xFFFFFFFD, NONE = 0xFFFFFFFF;
    // 目錄（順序固定）：0 Root、1 EncryptedPackage、2 \x06DataSpaces、3 Version、4 DataSpaceMap、5 DataSpaceInfo、
    // 6 StrongEncryptionDataSpace、7 TransformInfo、8 StrongEncryptionTransform、9 \x06Primary、10 EncryptionInfo
    const D = [
      { n: 'Root Entry', t: 5, c: 0, child: 10 },
      { n: 'EncryptedPackage', t: 2, c: 0, data: pkg },
      { n: '\x06DataSpaces', t: 1, c: 0, child: 4 },
      { n: 'Version', t: 2, c: 1, data: DS_VERSION },
      { n: 'DataSpaceMap', t: 2, c: 1, left: 3, right: 5, data: DATA_SPACE_MAP },
      { n: 'DataSpaceInfo', t: 1, c: 1, right: 7, child: 6 },
      { n: 'StrongEncryptionDataSpace', t: 2, c: 1, data: STRONG_DS },
      { n: 'TransformInfo', t: 1, c: 0, child: 8 },
      { n: 'StrongEncryptionTransform', t: 1, c: 1, child: 9 },
      { n: '\x06Primary', t: 2, c: 1, data: PRIMARY },
      { n: 'EncryptionInfo', t: 2, c: 1, left: 2, right: 1, data: info },
    ];
    if (info.length >= 4096) throw new Error('加密資訊太長');
    // 小資料流放進「小區段」（64 位元組一格）
    let mini = []; let nMini = 0;
    for (const d of D) {
      if (d.t !== 2 || d === D[1]) continue;
      d.start = nMini; const k = Math.ceil(d.data.length / 64); nMini += k;
      const p = new Uint8Array(k * 64); p.set(d.data); mini.push(p);
    }
    mini = cat(...mini);
    const dirSecs = Math.ceil(D.length / 4), mfatSecs = Math.ceil(nMini * 4 / SS), miniSecs = Math.ceil(mini.length / SS), pkgSecs = Math.ceil(pkg.length / SS);
    let nfat = 1;
    while (nfat * 128 < nfat + dirSecs + mfatSecs + miniSecs + pkgSecs) nfat++;
    if (nfat > 109) throw new Error('備份資料太大（超過 7MB），請聯絡維護的人');
    const dirAt = nfat, mfatAt = dirAt + dirSecs, miniAt = mfatAt + mfatSecs, pkgAt = miniAt + miniSecs, total = pkgAt + pkgSecs;
    const out = new Uint8Array(SS * (1 + total)); const dv = new DataView(out.buffer);
    const sec = (i) => SS * (1 + i);
    // 標頭
    out.set(hex('d0cf11e0a1b11ae1'), 0);
    dv.setUint16(24, 0x3E, true); dv.setUint16(26, 3, true); dv.setUint16(28, 0xFFFE, true); dv.setUint16(30, 9, true); dv.setUint16(32, 6, true);
    dv.setUint32(40, 0, true); dv.setUint32(44, nfat, true); dv.setUint32(48, dirAt, true); dv.setUint32(52, 0, true); dv.setUint32(56, 4096, true);
    dv.setUint32(60, mfatSecs ? mfatAt : END, true); dv.setUint32(64, mfatSecs, true); dv.setUint32(68, END, true); dv.setUint32(72, 0, true);
    for (let i = 0; i < 109; i++) dv.setUint32(76 + 4 * i, i < nfat ? i : FREE, true);
    // FAT
    const fat = new Array(nfat * 128).fill(FREE);
    for (let i = 0; i < nfat; i++) fat[i] = FATSECT;
    const chain = (s, n) => { for (let i = 0; i < n; i++) fat[s + i] = i < n - 1 ? s + i + 1 : END; };
    chain(dirAt, dirSecs); chain(mfatAt, mfatSecs); chain(miniAt, miniSecs); chain(pkgAt, pkgSecs);
    fat.forEach((v, i) => dv.setUint32(sec(0) + 4 * i, v, true));
    // 小區段配置表
    const mfat = new Array(mfatSecs * 128).fill(FREE);
    for (const d of D) if (d.t === 2 && d !== D[1]) { const k = Math.ceil(d.data.length / 64); for (let i = 0; i < k; i++) mfat[d.start + i] = i < k - 1 ? d.start + i + 1 : END; }
    mfat.forEach((v, i) => dv.setUint32(sec(mfatAt) + 4 * i, v, true));
    out.set(mini, sec(miniAt));
    out.set(pkg, sec(pkgAt));
    // 目錄
    for (let i = 0; i < dirSecs * 4; i++) {
      const o = sec(dirAt) + 128 * i, d = D[i];
      dv.setUint32(o + 68, NONE, true); dv.setUint32(o + 72, NONE, true); dv.setUint32(o + 76, NONE, true);
      if (!d) continue;
      const nm = utf16(d.n); out.set(nm, o); dv.setUint16(o + 64, nm.length + 2, true);
      out[o + 66] = d.t; out[o + 67] = d.c;
      if (d.left != null) dv.setUint32(o + 68, d.left, true);
      if (d.right != null) dv.setUint32(o + 72, d.right, true);
      if (d.child != null) dv.setUint32(o + 76, d.child, true);
      let start = 0, size = 0;
      if (i === 0) { start = miniAt; size = mini.length; } else if (d === D[1]) { start = pkgAt; size = pkg.length; } else if (d.t === 2) { start = d.start; size = d.data.length; }
      if (d.t === 1) start = 0;
      dv.setUint32(o + 116, start, true); dv.setUint32(o + 120, size, true);
    }
    return out;
  }

  // ---------- .xlsx（不壓縮的 ZIP）----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const locals = [], cents = []; let off = 0;
    for (const [name, text] of files) {
      const data = typeof text === 'string' ? enc8.encode(text) : text, nm = enc8.encode(name), crc = crc32(data);
      const lh = new Uint8Array(30 + nm.length), l = new DataView(lh.buffer);
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, 0, true);
      l.setUint16(12, 0x21, true); l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, nm.length, true); lh.set(nm, 30);
      const ch = new Uint8Array(46 + nm.length), c = new DataView(ch.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true); ch.set(nm, 46);
      locals.push(lh, data); cents.push(ch); off += lh.length + data.length;
    }
    const cd = cat(...cents), e = new Uint8Array(22), ev = new DataView(e.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cd.length, true); ev.setUint32(16, off, true);
    return cat(...locals, cd, e);
  }
  const xe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // rows：每列是陣列，格子是 null、數字、字串，或 { v, s }（s：1 千分位、2 粗體、3 粗體千分位、4 標題、5 紅字千分位）
  function sheetXml(rows, widths) {
    const cols = widths ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((c, ci) => {
      if (c == null || c === '') return '';
      const o = typeof c === 'object' ? c : { v: c };
      const ref = colName(ci) + (ri + 1), st = o.s ? ` s="${o.s}"` : (typeof o.v === 'number' ? ' s="1"' : '');
      return typeof o.v === 'number' ? `<c r="${ref}"${st}><v>${o.v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xe(o.v)}</t></is></c>`;
    }).join('') + '</row>').join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
  }
  function book(sheets) {
    const S = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const ct = S + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>';
    const rels = S + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    const wb = S + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      sheets.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>';
    const wrels = S + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const styles = S + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="4"><font><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="13"/><name val="Microsoft JhengHei"/></font><font><sz val="11"/><color rgb="FFC00000"/><name val="Microsoft JhengHei"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFBEAB0"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="3" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    return zip([['[Content_Types].xml', ct], ['_rels/.rels', rels], ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', wrels], ['xl/styles.xml', styles],
      ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.widths)])]);
  }

  const BACKUP_SHEET = '網站還原用';
  const ADJ = [['preAdv', '前先入'], ['preOver', '前溢入'], ['over', '溢入'], ['hold', '保留'], ['short', '不足'], ['more', '多入'], ['freight', '運金']]; // 原本 Excel 的調整欄順序
  const ymName = (ym) => `${Math.floor(ym / 100)}年${String(ym % 100).padStart(2, '0')}月`;
  const ymTitle = (ym) => `${Math.floor(ym / 100)} 年 ${String(ym % 100).padStart(2, '0')} 月`;
  const dueTxt = (d) => (d ? `${Math.floor(d / 10000)}/${String(Math.floor(d / 100) % 100).padStart(2, '0')}/${String(d % 100).padStart(2, '0')}` : '');

  // 收款資料 → .xlsx 內容（Uint8Array）
  // 調整（row.adj 一行一行：s 加減、k 項目、amt、note）→ 每個項目一欄，金額照加減帶正負號（和原本 Excel 一樣，匯入時會轉回來）
  const adjOf = (r, k) => (r.adj || []).filter((a) => a.k === k).reduce((t, a) => t + (a.s < 0 ? -1 : 1) * (+a.amt || 0), 0);
  function buildBook({ rows, rates, extra, calc, groupDiffs, at }) {
    const sheets = [];
    const gd = groupDiffs(rows);
    const months = [...new Set(rows.map((r) => r.ym))].sort((a, b) => b - a); // 最新的月份放最前面
    const n = (v) => +v || 0;
    for (const ym of months) {
      const mr = rows.filter((r) => r.ym === ym);
      // 這個月用到的調整項目：原本 Excel 的 7 項在前，自己加的項目接在後面
      const used = new Set(); mr.forEach((r) => (r.adj || []).forEach((a) => a.k && used.add(a.k)));
      const items = ADJ.map((a) => a[1]).concat([...used].filter((k) => !ADJ.some((a) => a[1] === k)));
      const HEAD = ['代號', '客戶名稱', '應收帳款', '退貨金額', '補價金額', '折率%', '折讓金額', '稅金', '尾數', '應收淨額', '實收金額', '現金', '支票', ...items, '對不上', '備註', '調整說明'];
      const widths = [9, 16, 12, 11, 11, 8, 11, 9, 8, 12, 12, 11, 11, ...items.map(() => 9), 9, 30, 30];
      const groups = new Map();
      for (const r of mr) { const k = (r.region || '') + '|' + (r.rep || ''); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
      const out = [];
      for (const [k, list] of groups) {
        const [region, rep] = k.split('|');
        out.push([{ v: `${ymTitle(ym)} 客戶應收帳款明細表 ${region} 地區 / 業務員: ${rep}`, s: 4 }]);
        out.push(HEAD.map((h) => ({ v: h, s: 2 })));
        const T = {};
        for (const r of list) {
          const c = calc(r), cash = n(r.cash), chk = (r.checks || []).reduce((s, x) => s + n(x.amt), 0);
          const diff = r.cont ? null : gd.get(r.ym + '|' + r.code);
          const vals = { ar: n(r.ar), ret: n(r.ret), bu: n(r.bu), disc: n(r.disc), tax: n(r.tax), other: n(r.other), due: c.due, paid: n(r.paid), cash, chk };
          items.forEach((k) => { vals['a:' + k] = adjOf(r, k); });
          for (const key in vals) T[key] = (T[key] || 0) + vals[key];
          const why = (r.adj || []).filter((a) => a.note).map((a) => `${a.k || ''}${a.s < 0 ? '−' : '+'}${n(a.amt)}：${a.note}`).join('；');
          const num = (v) => (v ? v : null);
          out.push([r.cont ? '-------' : r.code, r.name || '', num(vals.ar), num(vals.ret), num(vals.bu), r.pct || r.discPct || null, num(vals.disc), num(vals.tax), num(vals.other),
            vals.due, num(vals.paid), num(cash), num(chk), ...items.map((k) => num(vals['a:' + k])),
            diff && Math.abs(diff) >= 0.5 ? { v: Math.round(diff * 100) / 100, s: 5 } : null, r.note || '', why]);
        }
        const tn = (v) => ({ v: v || 0, s: 3 });
        out.push([{ v: '總計', s: 2 }, { v: '', s: 2 }, tn(T.ar), tn(T.ret), tn(T.bu), { v: '', s: 2 }, tn(T.disc), tn(T.tax), tn(T.other), tn(T.due), tn(T.paid), tn(T.cash), tn(T.chk),
          ...items.map((k) => tn(T['a:' + k])), { v: '', s: 2 }, { v: '', s: 2 }, { v: '', s: 2 }]);
        out.push([]);
      }
      sheets.push({ name: ymName(ym), rows: out, widths });
    }
    // 支票
    const chk = [[{ v: '支票明細（網站自動備份）', s: 4 }], ['年月', '代號', '客戶名稱', '支票號碼', '帳號', '銀行', '客票／本人票', '到期日', '金額'].map((h) => ({ v: h, s: 2 }))];
    for (const r of rows.slice().sort((a, b) => b.ym - a.ym)) for (const c of r.checks || []) {
      chk.push([ymTitle(r.ym), r.code, r.name || '', c.no || '', c.acct || '', c.bank || '', c.kind === '本' ? '本人票' : c.kind === '客' ? '客票' : '', dueTxt(c.due), n(c.amt)]);
    }
    sheets.push({ name: '支票', rows: chk, widths: [12, 9, 16, 14, 16, 14, 12, 12, 12] });
    if (!months.length) sheets.unshift({ name: '應收帳款', rows: [['目前還沒有收款資料']] });
    // 網站還原用（隱藏）：完整資料，一格最多 3 萬字
    const json = JSON.stringify({ app: 'wjs-recv', v: 1, at: (at || new Date()).toISOString(), rows, rates: rates || {}, ...(extra || {}) });
    const bk = [['這張是網站還原用的資料，請不要修改。把整個檔案拖進網站「收款登記」→「匯入應收帳款 Excel」就能還原。']];
    for (let i = 0; i < json.length; i += 30000) bk.push([json.slice(i, i + 30000)]);
    sheets.push({ name: BACKUP_SHEET, rows: bk, hidden: true });
    return book(sheets);
  }

  root.RecvBackup = { makeKeys, encrypt, buildBook, BACKUP_SHEET, _writeCfb: writeCfb };
})(typeof self !== 'undefined' ? self : globalThis);

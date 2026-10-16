// 有開啟密碼的 Excel（.xlsx）解密：完全在瀏覽器記憶體內進行，不寫入任何檔案、不傳送密碼。
// 支援 Excel 2010 以後的「Agile」加密（AES + SHA-512），以及 Excel 2007 的「Standard」加密（AES + SHA-1）。
// 規格：Microsoft [MS-OFFCRYPTO]、[MS-CFB]。
/* eslint-disable no-bitwise */
(function (root) {
  const subtle = (root.crypto || globalThis.crypto).subtle;
  const TD8 = new TextDecoder('utf-8');
  const TD16 = new TextDecoder('utf-16le');

  function fail(code, message) { const e = new Error(message); e.code = code; return e; }

  // ======================= 雜湊（純 JS，同步，給大量迭代用）=======================
  const K512 = (() => {
    const h = '428a2f98d728ae22 7137449123ef65cd b5c0fbcfec4d3b2f e9b5dba58189dbbc 3956c25bf348b538 59f111f1b605d019 923f82a4af194f9b ab1c5ed5da6d8118 d807aa98a3030242 12835b0145706fbe 243185be4ee4b28c 550c7dc3d5ffb4e2 72be5d74f27b896f 80deb1fe3b1696b1 9bdc06a725c71235 c19bf174cf692694 e49b69c19ef14ad2 efbe4786384f25e3 0fc19dc68b8cd5b5 240ca1cc77ac9c65 2de92c6f592b0275 4a7484aa6ea6e483 5cb0a9dcbd41fbd4 76f988da831153b5 983e5152ee66dfab a831c66d2db43210 b00327c898fb213f bf597fc7beef0ee4 c6e00bf33da88fc2 d5a79147930aa725 06ca6351e003826f 142929670a0e6e70 27b70a8546d22ffc 2e1b21385c26c926 4d2c6dfc5ac42aed 53380d139d95b3df 650a73548baf63de 766a0abb3c77b2a8 81c2c92e47edaee6 92722c851482353b a2bfe8a14cf10364 a81a664bbc423001 c24b8b70d0f89791 c76c51a30654be30 d192e819d6ef5218 d69906245565a910 f40e35855771202a 106aa07032bbd1b8 19a4c116b8d2d0c8 1e376c085141ab53 2748774cdf8eeb99 34b0bcb5e19b48a8 391c0cb3c5c95a63 4ed8aa4ae3418acb 5b9cca4f7763e373 682e6ff3d6b2b8a3 748f82ee5defb2fc 78a5636f43172f60 84c87814a1f0ab72 8cc702081a6439ec 90befffa23631e28 a4506cebde82bde9 bef9a3f7b2c67915 c67178f2e372532b ca273eceea26619c d186b8c721c0c207 eada7dd6cde0eb1e f57d4f7fee6ed178 06f067aa72176fba 0a637dc5a2c898a6 113f9804bef90dae 1b710b35131c471b 28db77f523047d84 32caab7b40c72493 3c9ebe0a15c9bebc 431d67c49c100d4c 4cc5d4becb3e42b6 597f299cfc657e2a 5fcb6fab3ad6faec 6c44198c4a475817'.split(' ');
    const a = new Int32Array(160);
    h.forEach((x, i) => { a[2 * i] = parseInt(x.slice(0, 8), 16) | 0; a[2 * i + 1] = parseInt(x.slice(8), 16) | 0; });
    return a;
  })();
  const H512 = [0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1, 0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179];
  const W = new Int32Array(160);

  function padMsg(msg, blockBytes, lenBytes) {
    const L = msg.length;
    const total = Math.ceil((L + 1 + lenBytes) / blockBytes) * blockBytes;
    const p = new Uint8Array(total);
    p.set(msg); p[L] = 0x80;
    const bits = L * 8, dv = new DataView(p.buffer);
    dv.setUint32(total - 4, bits >>> 0); dv.setUint32(total - 8, Math.floor(bits / 4294967296));
    return p;
  }

  function sha512(msg) {
    const p = padMsg(msg, 128, 16);
    const dv = new DataView(p.buffer);
    const H = Int32Array.from(H512);
    for (let off = 0; off < p.length; off += 128) {
      for (let i = 0; i < 32; i++) W[i] = dv.getInt32(off + i * 4);
      for (let i = 16; i < 80; i++) {
        // σ0(W[i-15]) = rotr1 ^ rotr8 ^ shr7
        let xh = W[2 * (i - 15)], xl = W[2 * (i - 15) + 1];
        const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
        const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
        // σ1(W[i-2]) = rotr19 ^ rotr61 ^ shr6
        xh = W[2 * (i - 2)]; xl = W[2 * (i - 2) + 1];
        const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
        const s1l = ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
        const lo = (s1l >>> 0) + (W[2 * (i - 7) + 1] >>> 0) + (s0l >>> 0) + (W[2 * (i - 16) + 1] >>> 0);
        W[2 * i] = (s1h + W[2 * (i - 7)] + s0h + W[2 * (i - 16)] + Math.floor(lo / 4294967296)) | 0;
        W[2 * i + 1] = lo | 0;
      }
      let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7];
      let eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
      for (let i = 0; i < 80; i++) {
        // Σ1(e) = rotr14 ^ rotr18 ^ rotr41
        const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
        const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
        const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
        const t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[2 * i + 1] >>> 0) + (W[2 * i + 1] >>> 0);
        const t1h = (hh + S1h + chh + K512[2 * i] + W[2 * i] + Math.floor(t1l / 4294967296)) | 0;
        // Σ0(a) = rotr28 ^ rotr34 ^ rotr39
        const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
        const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
        const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch), mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
        const t2l = (S0l >>> 0) + (mjl >>> 0);
        const t2h = (S0h + mjh + Math.floor(t2l / 4294967296)) | 0;
        hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
        let lo = (dl >>> 0) + (t1l >>> 0);
        eh = (dh + t1h + Math.floor(lo / 4294967296)) | 0; el = lo | 0;
        dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
        lo = (t1l >>> 0) + (t2l >>> 0);
        ah = (t1h + t2h + Math.floor(lo / 4294967296)) | 0; al = lo | 0;
      }
      const v = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
      for (let i = 0; i < 16; i += 2) {
        const lo = (H[i + 1] >>> 0) + (v[i + 1] >>> 0);
        H[i] = (H[i] + v[i] + Math.floor(lo / 4294967296)) | 0; H[i + 1] = lo | 0;
      }
    }
    const out = new Uint8Array(64), odv = new DataView(out.buffer);
    for (let i = 0; i < 16; i++) odv.setInt32(i * 4, H[i]);
    return out;
  }

  function sha1(msg) {
    const p = padMsg(msg, 64, 8);
    const dv = new DataView(p.buffer);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Int32Array(80);
    for (let off = 0; off < p.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
      for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; } else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; } else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; } else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    const out = new Uint8Array(20), odv = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((x, i) => odv.setInt32(i * 4, x));
    return out;
  }

  // 依演算法名稱取得雜湊函式；SHA-256/384 交給 WebCrypto（較慢但正確）
  function hasher(name) {
    const n = String(name || '').toUpperCase().replace('-', '');
    if (n === 'SHA512') return { sync: sha512 };
    if (n === 'SHA1') return { sync: sha1 };
    if (n === 'SHA256' || n === 'SHA384') { const algo = 'SHA-' + n.slice(3); return { async: async (m) => new Uint8Array(await subtle.digest(algo, m)) }; }
    throw fail('UNSUPPORTED', '這份 Excel 使用不支援的雜湊演算法（' + name + '）。請在 Excel 重新設定密碼後再試。');
  }
  async function H(h, m) { return h.sync ? h.sync(m) : h.async(m); }

  const cat = (...arrs) => { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
  const le32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
  const utf16 = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b[2 * i] = c & 255; b[2 * i + 1] = c >> 8; } return b; };
  const fixLen = (b, n, padByte) => { if (b.length >= n) return b.slice(0, n); const o = new Uint8Array(n).fill(padByte); o.set(b); return o; };
  const b64 = (s) => { const bin = atob(s); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; };
  const eq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };

  // ======================= AES（WebCrypto，無填充）=======================
  // WebCrypto 的 AES-CBC 一定會檢查 PKCS#7 填充；Office 的密文沒有填充。
  // 作法：在密文後面接上一個「解出來剛好是一整塊填充」的區塊，解密後的結果就是原本的明文。
  async function aesKey(raw) { return subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']); }
  async function cbcNoPad(key, iv, data) {
    if (data.length % 16) throw fail('CORRUPT', '加密資料長度不正確，檔案可能已損毀');
    if (!data.length) return new Uint8Array(0);
    const last = data.subarray(data.length - 16);
    const extra = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: last }, key, new Uint8Array(16).fill(16))).subarray(0, 16);
    const buf = new Uint8Array(data.length + 16); buf.set(data); buf.set(extra, data.length);
    const out = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv }, key, buf));
    buf.fill(0);
    return out;
  }
  // ECB = 以零 IV 做 CBC，再把每塊與前一塊密文 XOR 回來
  async function ecbNoPad(key, data) {
    const out = await cbcNoPad(key, new Uint8Array(16), data);
    for (let i = 16; i < out.length; i++) out[i] ^= data[i - 16];
    return out;
  }

  // ======================= 複合文件（CFB / OLE2）=======================
  function readCfb(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const u32 = (o) => dv.getUint32(o, true);
    if (u32(0) !== 0xe011cfd0 || u32(4) !== 0xe11ab1a1) throw fail('NOT_CFB', '不是加密的 Office 檔案');
    const ss = 1 << dv.getUint16(0x1e, true), mss = 1 << dv.getUint16(0x20, true);
    const dirStart = u32(0x30), miniCut = u32(0x38), miniFatStart = u32(0x3c);
    let difat = u32(0x44); const nDifat = u32(0x48);
    const secOff = (sid) => (sid + 1) * ss;
    const MAXREG = 0xfffffffa;
    const fatSecs = [];
    for (let i = 0; i < 109; i++) { const v = u32(0x4c + 4 * i); if (v < MAXREG) fatSecs.push(v); }
    for (let k = 0; k < nDifat && difat < MAXREG; k++) {
      const o = secOff(difat);
      for (let i = 0; i < ss / 4 - 1; i++) { const v = u32(o + 4 * i); if (v < MAXREG) fatSecs.push(v); }
      difat = u32(o + ss - 4);
    }
    const per = ss / 4;
    const fat = new Uint32Array(fatSecs.length * per);
    fatSecs.forEach((sid, k) => { const o = secOff(sid); if (o + ss <= u8.length) for (let i = 0; i < per; i++) fat[k * per + i] = u32(o + 4 * i); });
    function chain(start, table) {
      const out = []; let s = start; const lim = table.length + 1;
      while (s < MAXREG) { if (s >= table.length || out.length > lim) throw fail('CORRUPT', '檔案結構損毀'); out.push(s); s = table[s]; }
      return out;
    }
    function readRegular(start, size) {
      const sids = chain(start, fat);
      const n = size == null ? sids.length * ss : size;
      const out = new Uint8Array(n);
      for (let i = 0, p = 0; i < sids.length && p < n; i++, p += ss) {
        const o = secOff(sids[i]);
        out.set(u8.subarray(o, Math.min(o + Math.min(ss, n - p), u8.length)), p);
      }
      return out;
    }
    const dir = readRegular(dirStart);
    const ddv = new DataView(dir.buffer);
    const entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nl = ddv.getUint16(o + 64, true), type = dir[o + 66];
      if (!type || nl < 2) continue;
      let size = ddv.getUint32(o + 120, true);
      if (ss !== 512) size += ddv.getUint32(o + 124, true) * 4294967296;
      entries.push({ name: TD16.decode(dir.subarray(o, o + nl - 2)), type, start: ddv.getUint32(o + 116, true), size });
    }
    const rootE = entries.find((e) => e.type === 5);
    let mini = null, miniFat = null;
    function readMini(start, size) {
      if (!mini) {
        mini = rootE ? readRegular(rootE.start, rootE.size) : new Uint8Array(0);
        const mf = miniFatStart < MAXREG ? readRegular(miniFatStart) : new Uint8Array(0);
        miniFat = new Uint32Array(mf.buffer, 0, mf.length >> 2);
      }
      const sids = chain(start, miniFat);
      const out = new Uint8Array(size);
      for (let i = 0, p = 0; i < sids.length && p < size; i++, p += mss) out.set(mini.subarray(sids[i] * mss, sids[i] * mss + Math.min(mss, size - p)), p);
      return out;
    }
    return {
      has: (name) => entries.some((e) => e.type === 2 && e.name === name),
      get(name) {
        const e = entries.find((x) => x.type === 2 && x.name === name);
        if (!e) return null;
        return e.size < miniCut ? readMini(e.start, e.size) : readRegular(e.start, e.size);
      },
    };
  }

  // ======================= EncryptionInfo =======================
  function attrs(tag) { const o = {}; tag.replace(/([\w:]+)="([^"]*)"/g, (m, k, v) => { o[k.replace(/^.*:/, '')] = v; return ''; }); return o; }
  function parseInfo(info) {
    const dv = new DataView(info.buffer, info.byteOffset, info.byteLength);
    const maj = dv.getUint16(0, true), min = dv.getUint16(2, true);
    if (maj === 4 && min === 4) {
      const xml = TD8.decode(info.subarray(8));
      const kd = /<(?:\w+:)?keyData\b[^>]*>/.exec(xml);
      const ek = /<(?:\w+:)?encryptedKey\b[^>]*>/.exec(xml.replace(/<(?:\w+:)?keyData\b[^>]*>/, ''));
      if (!kd || !ek) throw fail('UNSUPPORTED', '這份 Excel 不是用密碼加密（可能是憑證加密），無法讀取');
      return { type: 'agile', keyData: attrs(kd[0]), key: attrs(ek[0]) };
    }
    if ((maj === 2 || maj === 3 || maj === 4) && min === 2) {
      const hs = dv.getUint32(8, true);
      const algId = dv.getUint32(12 + 8, true), keyBits = dv.getUint32(12 + 16, true);
      if (algId !== 0x660e && algId !== 0x660f && algId !== 0x6610) throw fail('UNSUPPORTED', '這份 Excel 使用舊式 RC4 加密，軟體無法讀取。請在 Excel 重新設定一次密碼（新版 Excel 會改用 AES）後再試。');
      const v = 12 + hs;
      const saltSize = dv.getUint32(v, true);
      const salt = info.slice(v + 4, v + 4 + saltSize);
      const encVerifier = info.slice(v + 4 + saltSize, v + 20 + saltSize);
      const hashSize = dv.getUint32(v + 20 + saltSize, true);
      const encVerifierHash = info.slice(v + 24 + saltSize, v + 24 + saltSize + 32);
      return { type: 'standard', keyBits, salt, encVerifier, hashSize, encVerifierHash };
    }
    throw fail('UNSUPPORTED', '不支援的 Excel 加密版本（' + maj + '.' + min + '）');
  }

  // ======================= 解密 =======================
  const BK_VERIFIER_INPUT = Uint8Array.of(0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79);
  const BK_VERIFIER_HASH = Uint8Array.of(0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e);
  const BK_KEY = Uint8Array.of(0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6);
  const SEG = 4096;
  const yieldNow = () => new Promise((r) => setTimeout(r, 0));

  async function spin(h, salt, password, count) {
    let x = await H(h, cat(salt, utf16(password)));
    const it = new Uint8Array(4 + x.length); const idv = new DataView(it.buffer);
    for (let i = 0; i < count; i++) {
      if (it.length !== 4 + x.length) throw fail('CORRUPT', '雜湊長度錯誤');
      idv.setUint32(0, i, true); it.set(x, 4);
      x = await H(h, it);
    }
    return x;
  }

  async function decryptAgile(info, pkg, password, onProgress) {
    const { keyData: kd, key: ek } = info;
    if ((kd.cipherAlgorithm || 'AES') !== 'AES' || (ek.cipherAlgorithm || 'AES') !== 'AES') throw fail('UNSUPPORTED', '不支援的加密演算法：' + (kd.cipherAlgorithm || ek.cipherAlgorithm));
    if ((kd.cipherChaining || 'ChainingModeCBC') !== 'ChainingModeCBC' || (ek.cipherChaining || 'ChainingModeCBC') !== 'ChainingModeCBC') throw fail('UNSUPPORTED', '不支援的加密模式');
    const hK = hasher(ek.hashAlgorithm), hD = hasher(kd.hashAlgorithm);
    const ekSalt = b64(ek.saltValue), kdSalt = b64(kd.saltValue);
    const ekBits = +ek.keyBits, ekBlock = +ek.blockSize || 16, kdBits = +kd.keyBits, kdBlock = +kd.blockSize || 16, ekHashSize = +ek.hashSize;
    onProgress && onProgress({ stage: '確認 Excel 密碼', pct: 0 });
    const hn = await spin(hK, ekSalt, password, +ek.spinCount || 100000);
    const blockKey = async (bk) => aesKey(fixLen(await H(hK, cat(hn, bk)), ekBits / 8, 0x36));
    const iv = fixLen(ekSalt, ekBlock, 0x36);
    const vIn = await cbcNoPad(await blockKey(BK_VERIFIER_INPUT), iv, b64(ek.encryptedVerifierHashInput));
    const vHash = await cbcNoPad(await blockKey(BK_VERIFIER_HASH), iv, b64(ek.encryptedVerifierHashValue));
    const calc = await H(hK, vIn.subarray(0, +ek.saltSize || 16));
    if (!eq(calc.subarray(0, ekHashSize), vHash.subarray(0, ekHashSize))) throw fail('BAD_PASSWORD', 'Excel 密碼不正確');
    const secret = (await cbcNoPad(await blockKey(BK_KEY), iv, b64(ek.encryptedKeyValue))).slice(0, kdBits / 8);
    const key = await aesKey(secret); secret.fill(0);

    const size = Number(new DataView(pkg.buffer, pkg.byteOffset).getBigUint64(0, true));
    const cipher = pkg.subarray(8, 8 + Math.floor((pkg.length - 8) / 16) * 16);
    if (size > cipher.length) throw fail('CORRUPT', '加密內容長度不符，檔案可能已損毀');
    const plain = new Uint8Array(size);
    const segIv = async (i) => fixLen(await H(hD, cat(kdSalt, le32(i))), kdBlock, 0x36);
    const CHUNK = SEG * 256; // 1MB
    for (let s = 0; s < cipher.length && s < size; s += CHUNK) {
      const e = Math.min(s + CHUNK, cipher.length);
      const out = await cbcNoPad(key, await segIv(s / SEG), cipher.subarray(s, e));
      // 每個 4096 位元組區段有自己的 IV：修正區段第一塊
      for (let b = s + SEG; b < e; b += SEG) {
        const iv2 = await segIv(b / SEG);
        for (let k = 0; k < 16; k++) out[b - s + k] ^= cipher[b - 16 + k] ^ iv2[k];
      }
      plain.set(out.subarray(0, Math.min(out.length, size - s)), s);
      out.fill(0);
      onProgress && onProgress({ stage: '解密 Excel', pct: e / cipher.length * 0.2 });
      if ((s / CHUNK) % 8 === 7) await yieldNow();
    }
    return plain;
  }

  async function decryptStandard(info, pkg, password, onProgress) {
    onProgress && onProgress({ stage: '確認 Excel 密碼', pct: 0 });
    const hn = await spin({ sync: sha1 }, info.salt, password, 50000);
    const hf = sha1(cat(hn, le32(0)));
    const b1 = new Uint8Array(64).fill(0x36), b2 = new Uint8Array(64).fill(0x5c);
    for (let i = 0; i < hf.length; i++) { b1[i] ^= hf[i]; b2[i] ^= hf[i]; }
    const raw = cat(sha1(b1), sha1(b2)).slice(0, info.keyBits / 8);
    const key = await aesKey(raw); raw.fill(0);
    const v = await ecbNoPad(key, info.encVerifier);
    const vh = await ecbNoPad(key, info.encVerifierHash);
    if (!eq(sha1(v), vh.subarray(0, 20))) throw fail('BAD_PASSWORD', 'Excel 密碼不正確');
    const size = Number(new DataView(pkg.buffer, pkg.byteOffset).getBigUint64(0, true));
    const cipher = pkg.subarray(8, 8 + Math.floor((pkg.length - 8) / 16) * 16);
    if (size > cipher.length) throw fail('CORRUPT', '加密內容長度不符，檔案可能已損毀');
    const plain = new Uint8Array(size);
    const CHUNK = 1 << 20;
    for (let s = 0; s < cipher.length && s < size; s += CHUNK) {
      const e = Math.min(s + CHUNK, cipher.length);
      const out = await ecbNoPad(key, cipher.subarray(s, e));
      plain.set(out.subarray(0, Math.min(out.length, size - s)), s);
      out.fill(0);
      onProgress && onProgress({ stage: '解密 Excel', pct: e / cipher.length * 0.2 });
    }
    return plain;
  }

  function isCfb(head) { return head.length >= 8 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0 && head[4] === 0xa1 && head[5] === 0xb1 && head[6] === 0x1a && head[7] === 0xe1; }

  // bytes：整個加密檔（Uint8Array）。回傳解密後的 .xlsx 內容（Uint8Array，只在記憶體中）。
  async function decryptXlsx(bytes, password, onProgress) {
    const cfb = readCfb(bytes);
    if (!cfb.has('EncryptionInfo') || !cfb.has('EncryptedPackage')) {
      throw fail('OLD_XLS', '這是舊版 .xls 格式，軟體無法讀取。請在 Excel 開啟後「另存新檔」為 .xlsx 再匯入。');
    }
    if (!password) throw fail('NEED_PASSWORD', '這份 Excel 有開啟密碼，請輸入密碼');
    const info = parseInfo(cfb.get('EncryptionInfo'));
    const pkg = cfb.get('EncryptedPackage');
    const plain = info.type === 'agile' ? await decryptAgile(info, pkg, password, onProgress) : await decryptStandard(info, pkg, password, onProgress);
    if (plain[0] !== 0x50 || plain[1] !== 0x4b) { plain.fill(0); throw fail('BAD_PASSWORD', 'Excel 密碼不正確'); }
    return plain;
  }

  root.OfficeCrypto = { isCfb, decryptXlsx, readCfb, sha512, sha1 };
})(typeof self !== 'undefined' ? self : globalThis);

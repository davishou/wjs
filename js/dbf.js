// 讀取 dBase（.DBF）檔，例如系統匯出的 JMSSAL.DBF、JMSSBK.DBF。
// 中文用 Big5 解碼（Windows 繁體中文 Excel 開 DBF 也是用 Big5；Mac 的 WPS 用錯編碼才會變亂碼）。
// 介面和 XlsxStream.scanSheet 一樣：先送出表頭列（欄位名稱），再一列一列送出資料，只解碼需要的欄位。
/* eslint-disable no-bitwise */
(function (root) {
  const ASCII = new TextDecoder('ascii');

  // 檔頭第一個位元組是版本：0x03 dBase III、0x83 有備註欄、0x30/0x31 Visual FoxPro、0xF5 FoxPro 有備註 …
  function isDbf(head, name) {
    if (!head || head.length < 4) return false;
    if (/\.dbf$/i.test(name || '')) return true;
    const v = head[0];
    if (![0x03, 0x83, 0x30, 0x31, 0x32, 0xF5, 0x8B, 0xCB, 0x04, 0x05, 0x43, 0x63].includes(v)) return false;
    const mm = head[2], dd = head[3];
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  }

  async function readBytes(src, s, e) {
    if (src instanceof Uint8Array) return src.subarray(s, e);
    return new Uint8Array(await src.slice(s, e).arrayBuffer());
  }

  // 讀檔頭：回傳 { n 筆數, headLen, recLen, fields: [{name, type, off, len}] }
  async function readHeader(src) {
    const h = await readBytes(src, 0, 32);
    const dv = new DataView(h.buffer, h.byteOffset, 32);
    const n = dv.getUint32(4, true), headLen = dv.getUint16(8, true), recLen = dv.getUint16(10, true);
    if (!headLen || !recLen || headLen < 33) throw new Error('不是有效的 DBF 檔');
    const fd = await readBytes(src, 32, headLen);
    const fields = []; let off = 1; // 每筆資料的第一個位元組是刪除記號
    for (let p = 0; p + 32 <= fd.length && fd[p] !== 0x0D; p += 32) {
      let e = 0; while (e < 11 && fd[p + e]) e++;
      const name = ASCII.decode(fd.subarray(p, p + e)).trim();
      const type = String.fromCharCode(fd[p + 11]);
      const len = fd[p + 16];
      fields.push({ name, type, off, len });
      off += len;
    }
    return { n, headLen, recLen, fields };
  }

  // handlers：{ maxCol, want(Uint8Array, 表頭後才有), stop, onCell(col, kind, val), onRowEnd(row) }
  // kind：0 數字、2 文字、3 是非（1/0），和 XlsxStream 相同
  async function scanDbf(src, handlers, onProgress, opts = {}) {
    const H = await readHeader(src);
    const big5 = new TextDecoder(opts.encoding || 'big5');
    const stats = { rows: 0, bad: 0, text: 0 };
    // 表頭列
    H.fields.forEach((f, i) => handlers.onCell(i, 2, f.name));
    handlers.onRowEnd(1);
    const size = src instanceof Uint8Array ? src.length : src.size;
    const per = Math.max(1, Math.floor((4 << 20) / H.recLen)); // 一次讀約 4MB
    for (let r0 = 0; r0 < H.n && !handlers.stop; r0 += per) {
      const cnt = Math.min(per, H.n - r0);
      const s = H.headLen + r0 * H.recLen;
      const buf = await readBytes(src, s, Math.min(size, s + cnt * H.recLen));
      const got = Math.floor(buf.length / H.recLen);
      for (let k = 0; k < got; k++) {
        const b = k * H.recLen;
        const flag = buf[b];
        if (flag === 0x1A) { handlers.stop = true; break; } // 檔尾
        if (flag === 0x2A) continue; // 已刪除的資料
        const maxCol = Math.min(handlers.maxCol || H.fields.length, H.fields.length), want = handlers.want;
        for (let i = 0; i < maxCol; i++) {
          if (want && !want[i]) continue;
          const f = H.fields[i];
          let a = b + f.off, e = a + f.len;
          // 去掉前後空白與 NUL
          while (a < e && (buf[a] === 0x20 || buf[a] === 0)) a++;
          while (e > a && (buf[e - 1] === 0x20 || buf[e - 1] === 0)) e--;
          if (a >= e) continue;
          const t = f.type;
          if (t === 'N' || t === 'F') {
            const v = parseFloat(ASCII.decode(buf.subarray(a, e)));
            if (!Number.isNaN(v)) handlers.onCell(i, 0, v);
          } else if (t === 'L') {
            const c = buf[a]; handlers.onCell(i, 3, c === 0x54 || c === 0x74 || c === 0x59 || c === 0x79 ? 1 : 0);
          } else if (t === 'C' || t === 'D' || t === 'V') {
            let ascii = true;
            for (let q = a; q < e; q++) if (buf[q] > 0x7E) { ascii = false; break; }
            let str;
            if (ascii) str = String.fromCharCode.apply(null, buf.subarray(a, e));
            else { str = big5.decode(buf.subarray(a, e)); stats.text++; if (str.includes('�')) stats.bad++; }
            handlers.onCell(i, 2, str);
          }
          // 其他型態（備註 M、二進位等）不需要
        }
        handlers.onRowEnd(r0 + k + 2);
        stats.rows++;
        if (handlers.stop) break;
      }
      if (onProgress) onProgress(s + buf.length - H.headLen, size - H.headLen);
      if (got < cnt) break;
    }
    return stats;
  }

  root.Dbf = { isDbf, readHeader, scanDbf };
})(typeof self !== 'undefined' ? self : globalThis);

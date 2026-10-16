// 零相依的 XLSX 串流讀取器：用瀏覽器內建 DecompressionStream 解壓，逐位元組掃描工作表 XML。
// 只讀取需要的欄位，可處理上 GB 的工作表而不會一次載入記憶體。
/* eslint-disable no-bitwise */
(function (root) {
  const TD = new TextDecoder('utf-8');

  // 來源可以是 File/Blob，也可以是記憶體中的 Uint8Array（解密後的 Excel 只放記憶體，不建立 Blob，避免瀏覽器把它暫存到硬碟）
  function toSource(x) {
    if (x instanceof Uint8Array) {
      return {
        size: x.length,
        read: async (s, e) => x.subarray(s, e),
        stream(s, e) {
          const part = x.subarray(s, e); let p = 0; const STEP = 1 << 20;
          return new ReadableStream({ pull(c) { if (p >= part.length) c.close(); else { c.enqueue(part.slice(p, p + STEP)); p += STEP; } } });
        },
      };
    }
    return { size: x.size, read: async (s, e) => new Uint8Array(await x.slice(s, e).arrayBuffer()), stream: (s, e) => x.slice(s, e).stream() };
  }
  async function readBytes(src, start, end) { return src.read(start, end); }
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216;
  const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 4294967296;

  async function openZip(input) {
    const blob = toSource(input);
    const size = blob.size;
    const head = await readBytes(blob, 0, 8);
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
      throw new Error('這份 Excel 設有開啟密碼（或是舊版 .xls 格式），需要先輸入密碼解密。');
    }
    const tailLen = Math.min(size, 65557 + 20);
    const tail = await readBytes(blob, size - tailLen, size);
    let p = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { p = i; break; }
    }
    if (p < 0) throw new Error('不是有效的 xlsx 檔（找不到 ZIP 目錄）');
    let count = u16(tail, p + 10);
    let cdSize = u32(tail, p + 12);
    let cdOff = u32(tail, p + 16);
    if (cdOff === 0xffffffff || count === 0xffff) {
      // ZIP64
      const lp = p - 20;
      if (u32(tail, lp) === 0x07064b50) {
        const z64off = u64(tail, lp + 8);
        const z = await readBytes(blob, z64off, z64off + 56);
        count = u64(z, 32); cdSize = u64(z, 40); cdOff = u64(z, 48);
      }
    }
    const cd = await readBytes(blob, cdOff, cdOff + cdSize);
    const entries = {};
    let o = 0;
    for (let n = 0; n < count && o < cd.length; n++) {
      if (u32(cd, o) !== 0x02014b50) break;
      const method = u16(cd, o + 10);
      let comp = u32(cd, o + 20), uncomp = u32(cd, o + 24);
      const nl = u16(cd, o + 28), el = u16(cd, o + 30), cl = u16(cd, o + 32);
      let lho = u32(cd, o + 42);
      const name = TD.decode(cd.subarray(o + 46, o + 46 + nl));
      // zip64 extra
      let e = o + 46 + nl; const eEnd = e + el;
      while (e + 4 <= eEnd) {
        const id = u16(cd, e), sz = u16(cd, e + 2);
        if (id === 1) {
          let q = e + 4;
          if (uncomp === 0xffffffff) { uncomp = u64(cd, q); q += 8; }
          if (comp === 0xffffffff) { comp = u64(cd, q); q += 8; }
          if (lho === 0xffffffff) { lho = u64(cd, q); q += 8; }
        }
        e += 4 + sz;
      }
      entries[name] = { name, method, comp, uncomp, lho };
      o += 46 + nl + el + cl;
    }
    async function dataStart(en) {
      const h = await readBytes(blob, en.lho, en.lho + 30);
      return en.lho + 30 + u16(h, 26) + u16(h, 28);
    }
    async function stream(name) {
      const en = entries[name];
      if (!en) throw new Error('xlsx 內缺少 ' + name);
      const s = await dataStart(en);
      const raw = blob.stream(s, s + en.comp);
      if (en.method === 0) return raw;
      if (en.method !== 8) throw new Error('不支援的壓縮方式 ' + en.method);
      return raw.pipeThrough(new DecompressionStream('deflate-raw'));
    }
    async function text(name) {
      const r = (await stream(name)).getReader();
      const parts = []; let len = 0;
      for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); len += value.length; }
      const all = new Uint8Array(len); let k = 0;
      for (const p2 of parts) { all.set(p2, k); k += p2.length; }
      return TD.decode(all);
    }
    return { entries, stream, text };
  }

  function unescapeXml(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, g) => {
      switch (g) {
        case 'lt': return '<'; case 'gt': return '>'; case 'amp': return '&';
        case 'quot': return '"'; case 'apos': return "'";
        default: return g[1] === 'x' ? String.fromCodePoint(parseInt(g.slice(2), 16)) : String.fromCodePoint(parseInt(g.slice(1), 10));
      }
    });
  }

  function parseSharedStrings(xml) {
    const out = [];
    const reSi = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    const reT = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = reSi.exec(xml))) {
      const body = m[1] || '';
      // 忽略注音標示 rPh
      const clean = body.indexOf('<rPh') >= 0 ? body.replace(/<rPh[\s\S]*?<\/rPh>/g, '') : body;
      let s = '', t;
      reT.lastIndex = 0;
      while ((t = reT.exec(clean))) s += t[1];
      out.push(unescapeXml(s));
    }
    return out;
  }

  async function listSheets(zip) {
    const wb = await zip.text('xl/workbook.xml');
    const rels = await zip.text('xl/_rels/workbook.xml.rels');
    const relMap = {};
    rels.replace(/<Relationship\b[^>]*>/g, (tag) => {
      const id = /Id="([^"]+)"/.exec(tag), tg = /Target="([^"]+)"/.exec(tag);
      if (id && tg) relMap[id[1]] = tg[1];
      return '';
    });
    const sheets = [];
    wb.replace(/<sheet\b[^>]*>/g, (tag) => {
      const nm = /name="([^"]+)"/.exec(tag), rid = /r:id="([^"]+)"/.exec(tag);
      if (nm && rid) {
        let t = relMap[rid[1]] || '';
        t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
        sheets.push({ name: unescapeXml(nm[1]), path: t });
      }
      return '';
    });
    return sheets;
  }

  // 欄位字母 -> 0 起算索引
  function colIndexFromBytes(b, s, e) {
    let c = 0;
    for (let i = s; i < e; i++) {
      const ch = b[i];
      if (ch >= 65 && ch <= 90) c = c * 26 + (ch - 64); else break;
    }
    return c - 1;
  }

  // 掃描一個工作表。onHeader(headerArray) 回傳要讀的欄索引陣列(maxCol)；onCell(col, kind, value) ; onRowEnd(rowNum)
  // kind: 0=數字(value=number) 1=共用字串索引(value=int) 2=字串(value=string) 3=布林(number)
  async function scanSheet(zip, path, handlers, onProgress) {
    const en = zip.entries[path];
    const total = en ? en.uncomp : 0;
    const reader = (await zip.stream(path)).getReader();
    let carry = new Uint8Array(0);
    let processed = 0;
    let maxCol = handlers.maxCol; // 只處理 < maxCol 的欄
    const ROW_END = [60, 47, 114, 111, 119, 62]; // </row>

    function lastRowEnd(buf) {
      for (let i = buf.length - 6; i >= 0; i--) {
        if (buf[i] === 60 && buf[i + 1] === 47 && buf[i + 2] === 114 && buf[i + 3] === 111 && buf[i + 4] === 119 && buf[i + 5] === 62) return i + 6;
      }
      return -1;
    }

    function numFrom(b, s, e) {
      // 快速整數/小數解析，遇到指數等複雜情況改用 parseFloat
      let i = s, neg = false, v = 0;
      if (b[i] === 45) { neg = true; i++; }
      let ok = true, frac = 0, scale = 1, inFrac = false;
      for (; i < e; i++) {
        const ch = b[i];
        if (ch >= 48 && ch <= 57) {
          if (inFrac) { frac = frac * 10 + (ch - 48); scale *= 10; } else v = v * 10 + (ch - 48);
        } else if (ch === 46 && !inFrac) inFrac = true;
        else { ok = false; break; }
      }
      if (!ok || scale > 1e15) return parseFloat(TD.decode(b.subarray(s, e)));
      v = v + frac / scale;
      return neg ? -v : v;
    }

    function processRows(b, end) {
      let i = 0;
      while (i < end) {
        // 找 <row
        const r = indexOfRow(b, i, end);
        if (r < 0) break;
        i = r + 4;
        // 取 r="n"
        let rowNum = -1;
        let gt = i;
        while (gt < end && b[gt] !== 62) gt++;
        for (let k = i; k < gt - 3; k++) {
          if (b[k] === 32 && b[k + 1] === 114 && b[k + 2] === 61 && b[k + 3] === 34) {
            let n = 0, q = k + 4;
            while (b[q] >= 48 && b[q] <= 57) { n = n * 10 + (b[q] - 48); q++; }
            rowNum = n; break;
          }
        }
        if (b[gt - 1] === 47) { i = gt + 1; continue; } // <row .../>
        i = gt + 1;
        let seq = 0;
        // 迭代 <c
        for (;;) {
          // 找下一個 '<'
          while (i < end && b[i] !== 60) i++;
          if (i >= end) break;
          if (b[i + 1] === 47) { // </row>
            i += 6; break;
          }
          if (b[i + 1] !== 99 || (b[i + 2] !== 32 && b[i + 2] !== 62 && b[i + 2] !== 47)) { i++; continue; }
          // <c ...
          let j = i + 2;
          let col = -1, t = 0; // t: 0 n, 1 s, 2 str, 3 b, 4 inlineStr, 5 e
          while (j < end && b[j] !== 62) {
            if (b[j] === 32) {
              const a = b[j + 1];
              if (a === 114 && b[j + 2] === 61) { // r=
                const s0 = j + 4; let s1 = s0;
                while (b[s1] >= 65 && b[s1] <= 90) s1++;
                col = colIndexFromBytes(b, s0, s1);
              } else if (a === 116 && b[j + 2] === 61) { // t=
                const c0 = b[j + 4];
                if (c0 === 115) t = (b[j + 5] === 116) ? 2 : 1; // str / s
                else if (c0 === 98) t = 3;
                else if (c0 === 105) t = 4;
                else if (c0 === 101) t = 5;
                else t = 0;
              }
            }
            j++;
          }
          if (col < 0) col = seq;
          seq = col + 1;
          const selfClose = b[j - 1] === 47;
          i = j + 1;
          if (selfClose) continue;
          // 找 </c>
          let ce = i;
          while (ce < end && !(b[ce] === 60 && b[ce + 1] === 47 && b[ce + 2] === 99 && b[ce + 3] === 62)) ce++;
          if (col < maxCol) {
            if (t === 4) {
              // <is><t>..</t></is>
              const seg = TD.decode(b.subarray(i, ce));
              const mm = seg.match(/<t[^>]*>([\s\S]*?)<\/t>/g);
              let s = '';
              if (mm) for (const x of mm) s += x.replace(/<[^>]+>/g, '');
              handlers.onCell(col, 2, unescapeXml(s));
            } else {
              // 找 <v>
              let v = i;
              while (v < ce && !(b[v] === 60 && b[v + 1] === 118 && b[v + 2] === 62)) v++;
              if (v < ce) {
                const vs = v + 3; let ve = vs;
                while (ve < ce && b[ve] !== 60) ve++;
                if (t === 0) handlers.onCell(col, 0, numFrom(b, vs, ve));
                else if (t === 1) handlers.onCell(col, 1, numFrom(b, vs, ve));
                else if (t === 2) handlers.onCell(col, 2, unescapeXml(TD.decode(b.subarray(vs, ve))));
                else if (t === 3) handlers.onCell(col, 3, b[vs] === 49 ? 1 : 0);
              }
            }
          }
          i = ce + 4;
        }
        handlers.onRowEnd(rowNum);
      }
    }

    function indexOfRow(b, s, e) {
      for (let k = s; k < e - 4; k++) {
        if (b[k] === 60 && b[k + 1] === 114 && b[k + 2] === 111 && b[k + 3] === 119 && (b[k + 4] === 32 || b[k + 4] === 62)) return k;
      }
      return -1;
    }

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      processed += value.length;
      let buf;
      if (carry.length) { buf = new Uint8Array(carry.length + value.length); buf.set(carry, 0); buf.set(value, carry.length); } else buf = value;
      const end = lastRowEnd(buf);
      if (end < 0) { carry = buf; continue; }
      processRows(buf, end);
      if (handlers.stop) { try { reader.cancel(); } catch (e) { /* */ } break; }
      carry = buf.slice(end);
      maxCol = handlers.maxCol;
      if (onProgress) onProgress(processed, total);
    }
    if (carry.length && !handlers.stop) {
      // 結尾殘留（理論上沒有完整列）
    }
    void ROW_END;
  }

  root.XlsxStream = { openZip, listSheets, parseSharedStrings, scanSheet };
})(typeof self !== 'undefined' ? self : globalThis);

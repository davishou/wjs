// 背景執行緒：讀取 Excel 並轉成資料集，不會卡住畫面。
importScripts('office-crypto.js', 'xlsx-stream.js', 'ingest.js', 'dataset.js');

self.onmessage = async (e) => {
  const { type, file, password } = e.data;
  try {
    if (type === 'ingest') {
      let last = 0;
      const report = (s) => {
        const now = Date.now();
        if (now - last > 150) { last = now; self.postMessage({ type: 'progress', ...s }); }
      };
      // 有開啟密碼的 Excel：在記憶體內解密，不寫入任何檔案；用完立刻清空
      let src = file, plain = null;
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      if (self.OfficeCrypto.isCfb(head)) {
        plain = await self.OfficeCrypto.decryptXlsx(new Uint8Array(await file.arrayBuffer()), password, report);
        src = plain;
      }
      let raw;
      try {
        raw = await self.Ingest.ingestXlsx(src, plain ? (s) => report({ ...s, pct: 0.2 + 0.8 * (s.pct || 0) }) : report, file.name);
      } finally { if (plain) plain.fill(0); }
      self.postMessage({ type: 'progress', stage: '整理資料', pct: 1, rows: raw.n });
      const buf = self.Dataset.serialize(raw);
      self.postMessage({ type: 'done', buf, ms: raw.parseMs }, [buf]);
    } else if (type === 'pack') {
      const raw = self.Dataset.deserialize(e.data.buf);
      const pack = await self.Dataset.makePack(raw, password);
      self.postMessage({ type: 'packed', pack }, [pack]);
    } else if (type === 'unpack') {
      const raw = await self.Dataset.openPack(e.data.buf, password);
      const buf = self.Dataset.serialize(raw);
      self.postMessage({ type: 'done', buf }, [buf]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', code: err && err.code, message: err && err.message ? err.message : String(err) });
  }
};

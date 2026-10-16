// 背景執行緒：讀取 Excel 並轉成資料集，不會卡住畫面。
importScripts('xlsx-stream.js', 'ingest.js', 'dataset.js');

self.onmessage = async (e) => {
  const { type, file, password } = e.data;
  try {
    if (type === 'ingest') {
      let last = 0;
      const raw = await self.Ingest.ingestXlsx(file, (s) => {
        const now = Date.now();
        if (now - last > 150) { last = now; self.postMessage({ type: 'progress', ...s }); }
      });
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
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};

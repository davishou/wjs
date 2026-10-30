// 背景執行緒：讀取 Excel 並轉成資料集，不會卡住畫面。
importScripts('office-crypto.js', 'xlsx-stream.js', 'ingest.js', 'dataset.js');

let last = 0;
function report(s) {
  const now = Date.now();
  if (now - last > 150) { last = now; self.postMessage({ type: 'progress', ...s }); }
}

// 讀取 Excel。有開啟密碼的：在記憶體內解密，不寫入任何檔案；用完立刻清空
async function readExcel(file, password) {
  let src = file, plain = null;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (self.OfficeCrypto.isCfb(head)) {
    plain = await self.OfficeCrypto.decryptXlsx(new Uint8Array(await file.arrayBuffer()), password, report);
    src = plain;
  }
  try {
    return await self.Ingest.ingestXlsx(src, plain ? (s) => report({ ...s, pct: 0.2 + 0.8 * (s.pct || 0) }) : report, file.name);
  } finally { if (plain) plain.fill(0); }
}

// 不是總表時，試著當作商品類別代碼表讀；是總表就回傳 null
async function readOther(file, password) {
  let src = file, plain = null;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (self.OfficeCrypto.isCfb(head)) { plain = await self.OfficeCrypto.decryptXlsx(new Uint8Array(await file.arrayBuffer()), password, report); src = plain; }
  try {
    if ((await self.Ingest.detectKind(src)) === 'master') return null;
    const cls = await self.Ingest.readClassification(src);
    if (!cls) throw new Error('這個 Excel 不是總表（沒有「原始進貨表」），也不是商品類別代碼表（找不到「代碼」和「大類」欄）。');
    cls.file = file.name;
    return cls;
  } finally { if (plain) plain.fill(0); }
}

self.onmessage = async (e) => {
  const { type, file, password } = e.data;
  try {
    if (type === 'ingest') {
      // 先看是總表還是商品類別代碼表（使用者可能把分類表拖進同一個地方）
      const cls = await readOther(file, password);
      if (cls) { self.postMessage({ type: 'done', classification: cls }); return; }
      const raw = await readExcel(file, password);
      self.postMessage({ type: 'progress', stage: '整理資料', pct: 1, rows: raw.n });
      const buf = self.Dataset.serialize(raw);
      self.postMessage({ type: 'done', buf, ms: raw.parseMs }, [buf]);
    } else if (type === 'classify') {
      const cls = await readOther(file, password);
      if (!cls) throw new Error('這是總表，不是商品類別代碼表。總表請拖到上面的「更新資料」。');
      self.postMessage({ type: 'done', classification: cls });
    } else if (type === 'merge') {
      // 每月加入：讀新的 Excel，併進目前的資料（同月份取代）
      const add = await readExcel(file, password);
      self.postMessage({ type: 'progress', stage: '合併到目前的資料', pct: 1, rows: add.n });
      const { raw, stats } = self.Dataset.merge(self.Dataset.deserialize(e.data.base), add, file.name);
      const buf = self.Dataset.serialize(raw);
      self.postMessage({ type: 'done', buf, stats }, [buf]);
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

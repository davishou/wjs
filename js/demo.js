/* 示範資料：全部是假的，用來看每一頁長什麼樣子。
   只放在記憶體，不會存進這台裝置、不會蓋掉真正的資料；重新整理就消失。
   客戶名稱、商品代號、類別名稱都是虛構的。每次產生的內容都一樣（固定亂數種子）。 */
(function (root) {
  // 固定種子的亂數
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  let R = rng(20261031);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const wpick = (arr, w) => { const s = w.reduce((a, b) => a + b, 0); let x = R() * s; for (let i = 0; i < arr.length; i++) { x -= w[i]; if (x <= 0) return arr[i]; } return arr[arr.length - 1]; };
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));

  // 虛構的商品類別（代碼、名稱、大類）。88 故意不放進分類表，示範「未分類」的提醒
  const CATS = [
    ['11', '男三角褲', '男', 120], ['12', '男平口褲', '男', 150], ['13', '男背心', '男', 180], ['14', '男保暖衣', '男', 320],
    ['21', '女內褲', '女', 110], ['22', '女胸衣', '女', 390], ['23', '女束褲', '女', 300], ['24', '女背心', '女', 200], ['25', '女保暖衣', '女', 340],
    ['31', '童內褲', '童', 90], ['32', '童內衣', '童', 150],
    ['41', '毛巾', '百貨', 120], ['42', '襪子', '百貨', 60], ['88', '', '', 200],
  ];
  const CAT_W = [9, 8, 4, 5, 8, 10, 6, 4, 4, 3, 2, 2, 2, 1];
  const SIZES = { 男: [['M', 'L', 'XL', 'XXL', '3L'], [3, 5, 6, 4, 2]], 女: [['M-L', 'XL-XXL'], [6, 4]], 女2: [['S', 'M', 'L', 'XL'], [2, 5, 5, 3]], 童: [['90', '100', '110', '120', '130'], [2, 4, 5, 4, 2]] };
  const COLORS = [['00', '01', '02', '05', '08'], [6, 4, 3, 2, 1]];

  // 虛構的客戶：代號第一碼決定區域（1、2 大台北，3 桃竹苗，4、5 中部，6～8 南部，9 其他）
  const PRE = ['晨光', '大同', '和美', '新興', '福星', '永豐', '金鴻', '美華', '佳佳', '好運', '長春', '安心', '順發', '吉祥', '東昇', '如意', '鑫隆', '寶島', '仁愛', '光明', '文華', '益豐', '振興', '嘉年', '綠野', '向陽', '春田', '青山', '海灣', '明月', '天成', '富貴', '星辰', '雅緻', '百合', '日新', '茂盛', '恆春', '宏圖', '樂活'];
  const SUF = ['商行', '百貨', '服飾', '內衣', '商店', '行', '企業社'];
  const REGION_D = ['1', '2', '2', '3', '4', '5', '5', '6', '7', '8', '9'];
  const skuOf = (s) => {
    if (s.fmt === 'none') return s.base;
    const sz = s.big === '女' ? (s.fmt === 'slash' ? SIZES.女 : SIZES.女2) : SIZES[s.big];
    const v = wpick(sz[0], sz[1]);
    return s.fmt === 'join' ? s.base + v : s.fmt === 'slash' ? s.base + '/' + v : s.base + '-' + v;
  };
  let STYLES = [], CUSTS = [];
  // 每次都從同一個亂數種子開始，產生的資料完全一樣
  function init() {
    R = rng(20261031); STYLES = []; CUSTS = [];
    // 款號：每個類別幾款，寫法混合「-」「/」和直接接在數字後面
    CATS.forEach(([code, , big, price], ci) => {
      const n = big === '百貨' || code === '88' ? 3 : ri(4, 8);
      for (let k = 0; k < n; k++) {
        const num = String(ri(1000, 9899));
        let base, fmt;
        if (big === '男') { base = k % 3 === 0 ? 'MX' + num.slice(0, 2) : num; fmt = k % 3 === 0 ? 'join' : 'dash'; }
        else if (big === '女') { base = num; fmt = k % 2 ? 'slash' : 'dash2'; }
        else if (big === '童') { base = 'K' + num.slice(0, 3); fmt = 'dash'; }
        else { base = code === '88' ? 'Z' + num.slice(0, 3) : num; fmt = 'none'; }
        STYLES.push({ ci, cat: code, big, base, fmt, price: Math.round(price * (0.85 + R() * 0.4)), cost: 0.62 + R() * 0.16, pop: 1 / Math.pow(k + 1, 0.9) });
      }
    });
    for (let i = 0; i < 64; i++) {
      const d = REGION_D[i % REGION_D.length];
      CUSTS.push({ id: d + String.fromCharCode(65 + (i * 7) % 26) + String(ri(10, 99)), name: PRE[i % PRE.length] + SUF[(i * 3) % SUF.length], rep: String(21 + (i % 5)),
        w: 1 / Math.pow(i + 1, 0.75), start: i >= 56 ? 11502 + (i - 56) : (i % 9 === 4 ? 11307 : 11301), stop: i % 13 === 7 ? 11412 : 99999, trend: i % 6 === 2 ? 0.75 : i % 5 === 1 ? 1.2 : 1 });
    }
  }
  const SEASON = [0.85, 0.7, 0.9, 0.9, 0.95, 0.9, 0.85, 0.9, 1.05, 1.15, 1.25, 1.35]; // 保暖衣冬天賣得好
  const YEAR = { 113: 1, 114: 1.07, 115: 0.96 };

  function build() {
    init();
    const STR = ['ord', 'cat', 'sku', 'color', 'unit', 'cust', 'cname', 'rep'];
    const dicts = {}, codes = {}; STR.forEach((k) => { dicts[k] = { map: new Map(), list: [] }; codes[k] = []; });
    const num = { cost: [], price: [], qty: [], unitn: [], amt: [], date: [] }, src = [];
    const put = (row, s) => {
      STR.forEach((k) => { const d = dicts[k]; let c = d.map.get(row[k]); if (c === undefined) { c = d.list.length; d.list.push(row[k]); d.map.set(row[k], c); } codes[k].push(c); });
      Object.keys(num).forEach((k) => num[k].push(row[k])); src.push(s);
    };
    const sales = [], rets = [];
    let retSeq = 0;
    for (let y = 113; y <= 115; y++) {
      for (let m = 1; m <= (y === 115 ? 9 : 12); m++) {
        const ym = y * 100 + m;
        const active = CUSTS.filter((c) => ym >= c.start && ym <= c.stop);
        const nOrd = Math.round(150 * SEASON[m - 1] * YEAR[y] * (0.92 + R() * 0.16));
        let seq = 0;
        for (let o = 0; o < nOrd; o++) {
          const c = wpick(active, active.map((x) => x.w * (y === 115 ? x.trend : 1) * (x.id[0] >= '6' && x.id[0] <= '8' && y === 115 ? 1.25 : 1)));
          const day = ri(1, 28) + (R() < 0.12 ? 2 : 0);
          // 月底出貨的單有一部分用下個月的單號（示範「單號月份和實際月份不同」）
          const last = ym === 11509; // 最後一個月的單不跨到下個月
          const numYm = !last && day >= 29 && R() < 0.6 ? (m === 12 ? (y + 1) * 100 + 1 : ym + 1) : ym;
          const ord = `${numYm}${String(++seq + (numYm !== ym ? 5000 : 0)).padStart(5, '0')}`;
          const date = ym * 100 + Math.min(day, 30);
          const lines = ri(1, 5);
          for (let l = 0; l < lines; l++) {
            const st = wpick(STYLES, STYLES.map((s) => s.pop * CAT_W[s.ci] * ((s.cat === '14' || s.cat === '25') ? (m >= 10 || m <= 2 ? 2.5 : 0.3) : 1)));
            const dozen = (st.big === '男' || st.big === '女') && R() < 0.55;
            const price = dozen ? Math.round(st.price * 12 * 0.94) : st.price;
            const qty = dozen ? pick([0.5, 1, 1, 2, 3]) : ri(1, 24);
            const costRate = st.cost + (y === 115 ? 0.025 : 0); // 115 年成本變高，毛利率下降
            const row = { ord, cat: st.cat, sku: skuOf(st), color: wpick(COLORS[0], COLORS[1]), unit: dozen ? '打' : '件', cust: c.id, cname: c.name, rep: c.rep,
              cost: Math.round(price * costRate * 10) / 10, price, qty, unitn: dozen ? 2 : 1, amt: Math.round(price * qty * 10) / 10, date };
            sales.push(row);
            // 退貨：約 4%，115 年稍微多一點
            if (R() < (y === 115 ? 0.055 : 0.038)) {
              const rd = Math.min(30, day + ri(3, 20));
              const rym = !last && rd > 28 && m < 12 ? ym + 1 : ym;
              const rq = dozen ? 0.5 : Math.max(1, Math.round(qty * (0.2 + R() * 0.5)));
              rets.push({ ...row, ord: `${ym}9${String(++retSeq % 10000).padStart(4, '0')}`, qty: rq, amt: Math.round(price * rq * 10) / 10, date: rym === ym ? ym * 100 + rd : rym * 100 + ri(1, 5) });
            }
          }
        }
      }
    }
    sales.forEach((r) => put(r, 0)); rets.forEach((r) => put(r, 1));
    const n = src.length;
    const raw = {
      n, nSales: sales.length, nReturns: rets.length, createdAt: new Date().toISOString(), sourceName: '示範資料（假的）', added: [],
      meta: {
        cat: { map: Object.fromEntries(CATS.filter((c) => c[1]).map((c) => [c[0], [c[1], c[2]]])), file: '示範用分類表', rows: CATS.length - 1, at: new Date().toISOString() },
        fixedCost: 300000, ar: { amount: 2600000, ym: 11509 },
      },
      str: {}, num: {}, src: Uint8Array.from(src),
    };
    STR.forEach((k) => { raw.str[k] = { dict: dicts[k].list, codes: Int32Array.from(codes[k]) }; });
    Object.keys(num).forEach((k) => { raw.num[k] = Float64Array.from(num[k]); });
    return raw;
  }

  root.Demo = { build };
})(window);

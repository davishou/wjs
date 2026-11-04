/* 儀表板：重點提醒、核心數字、排名與毛利貢獻、佔比、毛利率／退貨率比較、損益兩平、應收帳款天數、客戶動態、商品結構、缺少的資料。
   每一區都附「這代表什麼／該注意什麼」。所有計算都在瀏覽器內用 Engine 完成。 */
(function (root) {
  const { ymLabel, ymDiff } = root.EngineMeta;

  // 年月加減 k 個月（民國年月，例如 11401 + (-1) = 11312）
  const addM = (ym, k) => { let y = Math.floor(ym / 100), m = ym % 100 + k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y * 100 + m; };
  const M = ['sales', 'returns', 'net', 'profit', 'netProfit', 'orders', 'soldQty'];
  const PERIODS = [
    { v: 'month', label: '基準月' }, { v: 'ytd', label: '今年累計' }, { v: 'r12', label: '近 12 個月' }, { v: 'all', label: '全部期間' },
  ];
  // 期間與去年同期：per = month | ytd | r12 | all；F、P = [起, 迄] 年月
  function range(E, ref, per) {
    const y = Math.floor(ref / 100), mo = ref % 100;
    let F, P;
    if (per === 'month') { F = [ref, ref]; P = [addM(ref, -12), addM(ref, -12)]; }
    else if (per === 'ytd') { F = [y * 100 + 1, ref]; P = [(y - 1) * 100 + 1, (y - 1) * 100 + mo]; }
    else if (per === 'r12') { F = [addM(ref, -11), ref]; P = [addM(ref, -23), addM(ref, -12)]; }
    else { F = [E.minYm, E.maxYm]; P = null; }
    const hasPrev = !!P && E.ymList.some((v) => v >= P[0] && v <= P[1]);
    return { F, P, hasPrev };
  }
  const periodText = (r) => (r[0] === r[1] ? ymLabel(r[0]) : `${ymLabel(r[0])}～${ymLabel(r[1])}`);
  // 排名可選的維度
  const RANK_DIMS = [
    { key: 'ck', label: '客戶' }, { key: 'style', label: '商品（款號）' }, { key: 'rep', label: '業務員' },
    { key: 'region', label: '區域' }, { key: 'big', label: '商品大類' }, { key: 'cat', label: '商品類別' },
  ];

  // 說明文字：代表什麼／該注意什麼
  const HELP = {
    net: ['銷貨金額減掉退貨金額，也就是這段期間實際賣出去的金額。', '和去年同期比較最準（避開淡旺季）。連續幾個月下滑，就要從下面的排名找出是哪些客戶、業務或商品掉下來。'],
    netProfit: ['淨銷售扣掉商品成本後賺到的錢（毛利），已扣掉退貨的部分。', '銷售成長但毛利沒跟著成長，代表賣的多是低毛利商品或折扣變多。'],
    margin: ['每賣 100 元，扣掉商品成本後剩多少。算法：毛利 ÷ 銷貨金額（和總覽、Excel 相同，未扣退貨）。', '比去年同期下降 1 個百分點以上就要注意：可能是進貨成本上漲、折扣變多，或低毛利商品賣得比較多。'],
    retRate: ['退貨金額 ÷ 銷貨金額。', '比去年同期高，或某個客戶、商品特別高，要查原因：品質、尺寸不合、出錯貨，或客戶壓庫存後退回。'],
    orders: ['有開出貨單的張數，以及平均每張單的金額。', '單數變少但每單變大，可能是客戶改成一次叫多一點；單數和每單金額都變少，就要注意客戶在流失。'],
    custs: ['這段期間有買東西的客戶數，以及其中第一次跟我們買的新客戶。', '交易客戶數下滑代表客戶在流失；新客戶太少，長期業績會越來越依賴老客戶。'],
    top10: ['銷售額前 10 大客戶加起來佔全部淨銷售的比例。', '超過 50% 代表太依賴少數大客戶，其中一家減少叫貨，業績就會明顯下滑。'],
    rank: ['依淨銷售或毛利貢獻排序。「佔比」是佔全部淨銷售的比例，「累計」是從第一名加到這一名的比例；「毛利貢獻」是這一項賺到的淨毛利，「毛利貢獻率」是佔全部淨毛利的比例。', '銷售排名高、但毛利貢獻率明顯低於銷售佔比的，代表賣很多但不太賺錢（價格太低或退貨多）。反過來，毛利貢獻率高於銷售佔比的，是值得多推的對象。'],
    share: ['各區域、商品大類、商品類別佔淨銷售（深色）和淨毛利（淺色）的比例。', '某一塊的毛利比例明顯低於銷售比例，代表那一塊比較不賺錢。比例和去年差很多時，要看是那一塊成長，還是其他塊衰退。'],
    follow: ['漸漸沒來的客戶：最近一次交易在 3～12 個月前、過去買得多的客戶。滯銷商品：6 個月以上沒有賣出、過去有業績的商品（簡化代碼）。', '客戶請業務主動聯絡；滯銷商品考慮促銷、退回廠商或停止進貨。'],
    bep: ['損益兩平（BEP）：每個月至少要賣到多少淨銷售，賺的毛利才夠付固定費用（房租、薪資、保險、水電等不論賣多少都要付的錢）。算法：每月固定費用 ÷ 淨毛利率。', '這裡假設除了商品成本以外沒有其他「賣越多花越多」的費用；如果有運費、佣金等，實際的損益兩平會更高。安全邊際越低，業績稍微下滑就會虧損。'],
    dso: ['應收帳款天數：客戶平均要多少天才付款。算法：應收帳款餘額 ÷ 近 3 個月淨銷售 × 91 天。', '比給客戶的收款條件（例如月結 60 天）長很多，代表有客戶拖款，資金會被卡住。超過 90 天要特別注意呆帳風險。'],
    custMove: ['新客戶：這段期間第一次跟我們買。可能流失：去年同期有買、這段期間都沒買的客戶。衰退的大客戶：去年同期前 20 大、今年少了 30% 以上。', '可能流失和衰退的大客戶，請業務主動聯絡了解原因。'],
    abc: ['把款號依淨銷售由高到低排，看要幾個款號就能做到 80% 的業績（ABC 分析）；新品是這段期間才第一次賣出的款號。', '少數款號撐起大部分業績時，這些款號要確保不缺貨；很多款號只賣一點點，可以考慮精簡。退貨率高的款號要檢查品質或尺寸。'],
  };

  // 每一種提醒的建議做法（2～3 點，有些比較天馬行空，給大家討論用）與對應的數據表
  const IDEAS = {
    partial: { go: null, ideas: ['把上面的基準月改成上一個完整的月份再比較，數字才公平。', '想看這個月到今天的進度，到「今日」頁看本月累計和本月預估。'] },
    netDown: { go: 'dbNetDrill', ideas: ['從下面的表找出掉最多的前 3 名客戶，請負責的業務這週內親自拜訪或打電話，問清楚是淡季、改跟別家買，還是商品不對。', '掉最多的款號檢查是不是斷貨、被別家便宜貨取代，或已經退流行；需要時換成新款補上。', '辦一檔「老客戶回購」活動，例如這個月叫貨滿一定金額送贈品或下次折扣，把掉下來的客戶拉回來。'] },
    netUp: { go: 'dbNetDrill', ideas: ['找出成長最多的客戶和款號，問業務做對了什麼，把同樣的做法複製到同類型的客戶。', '確認熱賣款的庫存跟得上，避免成長到一半斷貨。', '趁客戶叫貨順的時候，搭配推高毛利的商品，讓毛利也一起成長。'] },
    marginDown: { go: 'dbMarginDrill', ideas: ['下面表中「影響毛利」最多的款號，先和廠商重新議價，或調整售價。', '訂出業務可以給的折扣底線，超過要主管同意。', '把毛利高的款號列成「本月主推」，業務獎金依毛利而不是只看營業額。'] },
    retUp: { go: 'dbHighRet', ideas: ['退貨率最高的幾個款號抽檢品質和尺寸表，看是不是同一批貨出問題。', '打給退貨最多的客戶問原因，記下來（尺寸不合、瑕疵、賣不掉），一個月後看哪個原因最多。', '出貨時附尺寸對照卡或試穿建議；客戶常因賣不掉而退的，改成小量多次出貨。'] },
    top10: { go: 'dbTop10Drill', ideas: ['每位業務每個月訂一個開發新客戶的目標（例如 2 家），開發成功給獎金。', '第 11～30 名的中型客戶推「升級方案」：叫貨量到一個門檻給更好的價格或優先出貨。', '和前幾大客戶談年度合作（保證量換優惠），讓大客戶比較不會突然減少叫貨。'] },
    bepBelow: { go: 'dbBep', ideas: ['把固定費用一項一項列出來，先砍不影響業績的（例如閒置的倉庫、用不到的訂閱）。', '把業績集中推到毛利率高的商品和客戶，淨毛利率提高，損益兩平就會降低。', '訂每月銷售目標 = 損益兩平 × 1.1，每週在「今日」頁看本月預估有沒有達標。'] },
    bepThin: { go: 'dbBep', ideas: ['訂每月銷售目標 = 損益兩平 × 1.1，每週在「今日」頁看本月預估有沒有達標。', '先準備好淡季的促銷或清庫存活動，避免淡季直接掉到損益兩平以下。'] },
    bepMonths: { go: 'dbBep', ideas: ['看低於損益兩平的月份是不是每年都一樣（淡季），提早在前一個月辦預購或促銷。', '淡季可以安排新品發表或拜訪遠一點的客戶，把空檔變成開發期。'] },
    dso: { go: 'dbDso', ideas: ['請會計每週列出逾期 30 天以上的客戶和金額，業務拜訪時順便收款。', '新客戶或常拖款的客戶改成貨到收現、預付，或縮短票期。', '提早付款給 1～2% 折扣，鼓勵客戶早點付。'] },
    lost: { go: 'dbCust', ideas: ['業務這週照名單一家一家打電話，問「最近怎麼沒叫貨」，把原因記下來。', '寄一份新品目錄或回購優惠給這些客戶。', '如果是被別家搶走，記下對方的價格或款式，回來一起討論要不要跟進。'] },
    down: { go: 'dbCust', ideas: ['業務主管親自拜訪這幾家大客戶的老闆，了解是生意變差還是改跟別家買。', '針對大客戶推專屬款、獨家顏色，或保留熱賣款給他們。', '一起訂下半年的叫貨計畫，讓我們可以先備貨、給更好的價格。'] },
    due: { go: 'dbDue', ideas: ['請業務照名單打電話，先問候再問要不要補貨。', '平常每幾天會來的客戶，可以約好固定時間主動送新品目錄給他們（例如每週一傳 LINE）。', '天馬行空：之後可以把這份名單每天自動整理好，傳給負責的業務。'] },
    unmapped: { go: 'dbMissing', ideas: ['在商品類別代碼表補上這些代碼的名稱和大類，再到「資料與設定」重新匯入代碼表。', '如果是新開的類別，順便決定要算在哪個大類（男、女、童、配件）。'] },
  };

  function render(ctx) {
    const { S, E, fmt, nf0, nf1, esc, $, $$, table, Charts, refYm, repName } = ctx;
    const ref = refYm();
    const per = S.dash.period;
    const { F, P, hasPrev } = range(E, ref, per);
    const fil = (r) => ({ ymFrom: r[0], ymTo: r[1] });

    // ---------- 計算 ----------
    const tot = (r) => { const g = E.pivot({ rows: [], cols: null, measures: M, filter: fil(r) }).grand; const o = {}; M.forEach((k, i) => { o[k] = g[i] || 0; }); return o; };
    const cur = tot(F), prev = hasPrev ? tot(P) : null;
    const rate = (a, b) => (b ? a / b : null);
    const mg = (t) => (t ? rate(t.profit, t.sales) : null), rr = (t) => (t ? rate(t.returns, t.sales) : null);
    const allCust = E.customers({}, ref).list;
    const custIn = (r) => E.customers(fil(r), ref).list; // 期間內的客戶（只算進貨）
    const cCur = custIn(F), cPrev = hasPrev ? custIn(P) : [];
    const firstOf = new Map(allCust.map((c) => [c.ck, c.first]));
    const newCust = cCur.filter((c) => firstOf.get(c.ck) >= F[0] && firstOf.get(c.ck) <= F[1]);
    const prevNewCust = hasPrev ? cPrev.filter((c) => firstOf.get(c.ck) >= P[0] && firstOf.get(c.ck) <= P[1]) : [];
    const byNet = cCur.slice().sort((a, b) => b.net - a.net);
    const top10 = byNet.slice(0, 10).reduce((s, c) => s + c.net, 0);
    const top10Share = rate(top10, cur.net);
    const prevByNet = cPrev.slice().sort((a, b) => b.net - a.net);
    const fullCustMap = new Map(allCust.map((c) => [c.ck, c]));
    const fullCustOf = (ck) => fullCustMap.get(ck);
    const prevTop10Share = hasPrev ? rate(prevByNet.slice(0, 10).reduce((s, c) => s + c.net, 0), prev.net) : null;
    // 期間內每月的資料月數（算每月平均用）
    const monthsIn = E.ymList.filter((v) => v >= F[0] && v <= F[1]);
    // 本月是否未滿月
    const cntOf = (ym) => E.pivot({ rows: [], cols: null, measures: ['rows'], filter: { src: 'sales', ymFrom: ym, ymTo: ym } }).grand[0];
    const partial = ref === E.maxYm && cntOf(ref) < cntOf(addM(ref, -1)) * 0.6;

    // ---------- 小工具 ----------
    const chgPct = (a, b) => (b ? (a - b) / Math.abs(b) : null);
    const arrow = (d, goodUp = true, kind = 'pct') => {
      if (d == null || !isFinite(d)) return '<span class="muted">—</span>';
      const up = d >= 0, good = up === goodUp;
      const txt = kind === 'pp' ? nf1.format(Math.abs(d * 100)) + ' 個百分點' : fmt.pct(Math.abs(d));
      return `<span class="${Math.abs(d) < 1e-9 ? '' : good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${txt}</span>`;
    };
    const help = (k) => `<details class="explain"><summary>這代表什麼？該注意什麼？</summary><div class="pop"><p><b>代表：</b>${HELP[k][0]}</p><p><b>注意：</b>${HELP[k][1]}</p></div></details>`;
    const card = (k, label, val, sub, delta) => `<div class="kpi db-kpi"><div class="k">${label}</div><div class="v">${val}</div><span class="d">${delta || ''}</span>${sub ? `<span class="d">${sub}</span>` : ''}${help(k)}</div>`;
    const vsTxt = hasPrev ? `比去年同期（${periodText(P)}）` : '';

    // ---------- 重點提醒 ----------
    const alerts = []; // {lv:'bad'|'warn'|'good', t, s}
    if (partial && (per === 'month' || per === 'ytd' || per === 'r12')) alerts.push({ k: 'partial', lv: 'warn', t: `${ymLabel(ref)} 的資料筆數比上個月少很多，可能還沒滿月`, s: '比較時請把基準月改成上一個完整的月份。' });
    if (hasPrev) {
      const g = chgPct(cur.net, prev.net);
      if (g != null && g <= -0.1) alerts.push({ k: 'netDown', lv: 'bad', t: `淨銷售比去年同期少 ${fmt.pct(-g)}`, s: '到「比較」頁的「自選兩段期間」，依客戶、業務或款號拆開，找出掉最多的。' });
      else if (g != null && g >= 0.1) alerts.push({ k: 'netUp', lv: 'good', t: `淨銷售比去年同期成長 ${fmt.pct(g)}`, s: '確認成長是來自少數大客戶，還是普遍成長。' });
      const dm = mg(cur) - mg(prev);
      if (isFinite(dm) && dm <= -0.01) alerts.push({ k: 'marginDown', lv: 'bad', t: `毛利率下降 ${nf1.format(-dm * 100)} 個百分點（${fmt.pct(mg(prev))} → ${fmt.pct(mg(cur))}）`, s: '檢查進貨成本、折扣，以及低毛利商品是否賣得比較多（到「比較」頁看毛利率，依款號拆開）。' });
      const dr = rr(cur) - rr(prev);
      if (isFinite(dr) && dr >= 0.01) alerts.push({ k: 'retUp', lv: 'bad', t: `退貨率上升 ${nf1.format(dr * 100)} 個百分點（${fmt.pct(rr(prev))} → ${fmt.pct(rr(cur))}）`, s: '看下面「退貨率最高的款號」，或到「比較」頁看退貨率。' });
    }
    if (top10Share != null && top10Share > 0.5) alerts.push({ k: 'top10', lv: 'warn', t: `前 10 大客戶佔淨銷售 ${fmt.pct(top10Share)}`, s: '太依賴少數客戶，建議分散：開發新客戶、加強中型客戶。' });

    // ---------- 排名 ----------
    function rankRows(dim) {
      const ms = ['sales', 'returns', 'net', 'profit', 'netProfit'];
      const p = E.pivot({ rows: [dim], cols: null, measures: ms, filter: fil(F) });
      const prevMap = new Map();
      if (hasPrev) E.pivot({ rows: [dim], cols: null, measures: ['net', 'netProfit'], filter: fil(P) }).rows.forEach((r) => prevMap.set(r.codes[0], r.vals[0]));
      const totNet = cur.net, totNP = cur.netProfit;
      const rows = p.rows.map((r) => {
        const [s, rt, n, pf, np] = r.vals[0]; const pv = prevMap.get(r.codes[0]);
        let label = r.labels[0];
        if (dim === 'rep') label = repName(label);
        return { code: r.codes[0], label: label || '（空白）', sales: s, returns: rt, net: n, profit: pf, netProfit: np,
          share: rate(n, totNet), npShare: rate(np, totNP), margin: rate(pf, s), retRate: rate(rt, s),
          prevNet: pv ? pv[0] : 0, yoy: pv && pv[0] ? (n - pv[0]) / Math.abs(pv[0]) : null, diff: n - (pv ? pv[0] : 0) };
      });
      return rows;
    }

    // ---------- 版面 ----------
    const html = [];
    html.push(`<p class="db-note">月份依：<b>${(E.ds.dates && E.ds.dates.dated && E.ds.dates.mode === 'date') ? '實際出貨／退貨日期' : '單號'}</b>　期間：<b>${periodText(F)}</b>${hasPrev ? `　對照：去年同期 ${periodText(P)}` : '　（全部期間沒有去年同期可比）'}</p>`);
    // 提醒（後面 BEP、應收、分類表會再補）
    html.push('<div class="panel" id="dbAlerts"></div>');
    html.push('<div id="dbDrills"></div>');
    // 這一頁只放「要處理的事」；總數、排名、佔比在「比較」「圖表報告」
    // 客戶動態、商品結構
    html.push(`<div class="panel"><div class="panel-head"><h2>客戶動態</h2></div>${help('custMove')}<div class="grid3" id="dbCust"></div></div>`);
    html.push(`<div class="panel"><div class="panel-head"><h2>該來買、還沒來的客戶</h2></div><p class="hint">已經超過平常購買間隔 1.5 倍沒來買（用實際出貨日期算，至少買過 3 天、180 天內買過），依歷史銷貨排序，適合業務打電話。</p><div id="dbDue" class="db-scroll"></div></div>`);
    html.push(`<div class="panel"><div class="panel-head"><h2>需要跟進</h2></div>${help('follow')}<div class="grid2 tight">
      <div><div class="panel-head"><h3>漸漸沒來的客戶</h3><a href="#customers" class="link" data-goto="cust-idle">看全部</a></div><div id="dbIdleCust" class="db-scroll"></div></div>
      <div><div class="panel-head"><h3>滯銷商品</h3><a href="#products" class="link" data-goto="prod-idle">看全部</a></div><div id="dbIdleProd" class="db-scroll"></div></div></div></div>`);
    html.push(`<div class="panel"><div class="panel-head"><h2>退貨率最高的款號</h2></div><p class="hint">銷售額至少佔 0.5% 的款號裡，退貨率最高的。要檢查品質或尺寸。</p><div id="dbHighRet" class="db-scroll"></div></div>`);
    html.push('<div class="grid2"><div class="panel" id="dbBep"></div><div class="panel" id="dbDso"></div></div>');
    html.push('<div class="panel" id="dbMissing"></div>');
    $('#dbBody').innerHTML = html.join('');
    $('#dbBody').ontoggle = null;
    $$('.db-kpi .explain').forEach((d) => d.addEventListener('toggle', () => { if (d.open) $$('.db-kpi .explain[open]').forEach((o) => { if (o !== d) o.open = false; }); }));

    // ---------- 損益兩平 ----------
    const meta = S.meta || {};
    const fixed = meta.fixedCost > 0 ? meta.fixedCost : null;
    const npRate = rate(cur.netProfit, cur.net);
    const months12 = Array.from({ length: 12 }, (_, i) => addM(ref, i - 11));
    const mp = new Map(E.pivot({ rows: ['ym'], cols: null, measures: ['net', 'netProfit'], filter: { ymFrom: months12[0], ymTo: ref } }).rows.map((r) => [E.ymList[r.codes[0]], r.vals[0]]));
    let bepHtml = `<div class="panel-head"><h2>損益兩平（BEP）</h2></div>${help('bep')}
      <form class="row db-input" id="dbFixedForm"><label class="field-label" for="dbFixed">每月固定費用（元）</label><input type="text" inputmode="numeric" id="dbFixed" value="${fixed ? nf0.format(fixed) : ''}" placeholder="例如 800,000"><button class="btn primary">套用</button></form>`;
    if (!fixed) bepHtml += '<p class="missing">缺少：每月固定費用（房租、薪資、勞健保、水電、租車等）。輸入後就會算出每月至少要賣多少。只存在這台裝置，會加密。</p>';
    else if (!(npRate > 0)) bepHtml += '<p class="missing">這段期間的淨毛利率不是正數，無法計算損益兩平。</p>';
    else {
      const bep = fixed / npRate;
      const avg = cur.net / Math.max(1, monthsIn.length);
      const safety = (avg - bep) / avg;
      const below = months12.filter((m) => mp.has(m) && mp.get(m)[0] < bep);
      bepHtml += `<div class="kpis two">
        <div class="kpi"><div class="k">每月損益兩平銷售額</div><div class="v">${fmt.big(bep)}</div><span class="d">= ${fmt.money(fixed)} ÷ 淨毛利率 ${fmt.pct(npRate)}</span></div>
        <div class="kpi"><div class="k">安全邊際</div><div class="v ${safety < 0 ? 'neg' : ''}">${fmt.pct(safety)}</div><span class="d">期間平均每月淨銷售 ${fmt.big(avg)}</span></div></div>
        <p class="hint">近 12 個月有 <b>${below.length}</b> 個月的淨銷售低於損益兩平${below.length ? '：' + below.map(ymLabel).join('、') : ''}。</p>
        <div class="chart short" id="dbBepChart"></div>`;
      if (safety < 0) alerts.push({ k: 'bepBelow', lv: 'bad', t: `平均每月淨銷售 ${fmt.big(avg)}，低於損益兩平 ${fmt.big(bep)}`, s: '毛利不夠付固定費用：要提高銷售或毛利率，或降低固定費用。' });
      else if (safety < 0.1) alerts.push({ k: 'bepThin', lv: 'warn', t: `安全邊際只有 ${fmt.pct(safety)}`, s: '業績再掉一點就會虧損。' });
      if (below.length >= 3) alerts.push({ k: 'bepMonths', lv: 'warn', t: `近 12 個月有 ${below.length} 個月低於損益兩平`, s: '看這些月份是淡季還是特殊原因。' });
      ctx.after.push(() => Charts.render($('#dbBepChart'), { type: 'combo', labels: months12.map(ymLabel), series: [{ name: '淨銷售', kind: 'bar', cls: 'c1', values: months12.map((m) => (mp.get(m) || [0])[0]) }, { name: '損益兩平', kind: 'line', dash: true, cls: 'c8', values: months12.map(() => bep) }], fmt: fmt.money, axisFmt: fmt.axis }));
    }
    $('#dbBep').innerHTML = bepHtml;

    // ---------- 應收帳款天數 ----------
    const ar = meta.ar && meta.ar.amount > 0 ? meta.ar : null;
    const arYm = ar && E.ymIndex.has(ar.ym) ? ar.ym : ref;
    let dsoHtml = `<div class="panel-head"><h2>應收帳款天數</h2></div>${help('dso')}
      <form class="row db-input" id="dbArForm"><label class="field-label" for="dbAr">應收帳款餘額（元），截至</label><select id="dbArYm">${E.ymList.slice().reverse().slice(0, 24).map((v) => `<option value="${v}" ${v === arYm ? 'selected' : ''}>${ymLabel(v)} 月底</option>`).join('')}</select><input type="text" inputmode="numeric" id="dbAr" value="${ar ? nf0.format(ar.amount) : ''}" placeholder="例如 3,500,000"><button class="btn primary">套用</button></form>`;
    if (!ar) dsoHtml += '<p class="missing">缺少：應收帳款餘額（還沒收到的貨款總額，會計或對帳單上有）。總表裡的 RECEIVE、PAY 欄看起來像收款紀錄，如果確認它們的意思，之後可以改成自動計算，還能列出每位客戶的未收金額。</p>';
    else {
      const s3 = [addM(arYm, -2), addM(arYm, -1), arYm].reduce((s, m) => s + ((E.pivot({ rows: [], cols: null, measures: ['net'], filter: { ymFrom: m, ymTo: m } }).grand[0]) || 0), 0);
      const dso = s3 > 0 ? ar.amount / s3 * 91 : null;
      dsoHtml += `<div class="kpis two"><div class="kpi"><div class="k">應收帳款天數</div><div class="v ${dso > 90 ? 'neg' : ''}">${dso == null ? '—' : nf0.format(dso) + ' 天'}</div><span class="d">${fmt.money(ar.amount)} ÷ ${fmt.money(s3)} × 91</span></div>
        <div class="kpi"><div class="k">近 3 個月淨銷售</div><div class="v">${fmt.big(s3)}</div><span class="d">${ymLabel(addM(arYm, -2))}～${ymLabel(arYm)}</span></div></div>`;
      if (dso > 90) alerts.push({ k: 'dso', lv: 'bad', t: `應收帳款天數 ${nf0.format(dso)} 天`, s: '收款太慢，請會計列出逾期的客戶，業務協助催收。' });
      else if (dso > 60) alerts.push({ k: 'dso', lv: 'warn', t: `應收帳款天數 ${nf0.format(dso)} 天`, s: '比一般月結 30～60 天長，檢查是否有客戶拖款。' });
    }
    $('#dbDso').innerHTML = dsoHtml;
    const num = (s) => { const v = parseFloat(String(s).replace(/[,\s，元]/g, '')); return isFinite(v) && v >= 0 ? v : null; };
    $('#dbFixedForm').onsubmit = async (e) => { e.preventDefault(); const v = num($('#dbFixed').value); await ctx.saveMeta({ fixedCost: v || null }); ctx.toast(v ? '已套用每月固定費用' : '已清除每月固定費用'); };
    $('#dbArForm').onsubmit = async (e) => { e.preventDefault(); const v = num($('#dbAr').value); await ctx.saveMeta({ ar: v ? { amount: v, ym: +$('#dbArYm').value } : null }); ctx.toast(v ? '已套用應收帳款餘額' : '已清除應收帳款餘額'); };

    // ---------- 客戶動態 ----------
    const custTable = (title, rows, cols, empty) => `<div><h3>${title}</h3><div class="db-mini" data-t="${title}"></div></div>`;
    $('#dbCust').innerHTML = custTable('新客戶') + custTable('可能流失（去年同期有買，這段期間沒買）') + custTable('衰退的大客戶（少 30% 以上）');
    const minis = $$('#dbCust .db-mini');
    const fullCust = new Map(allCust.map((c) => [c.ck, c]));
    const open = (c) => ctx.openCustomer(fullCust.get(c.ck) || c);
    table(minis[0], [{ key: 'name', label: '客戶', cls: 'lbl', get: (r) => r.code + ' ' + r.name }, { key: 'net', label: '淨銷售', n: 1, fmt: 'money' }], newCust.slice().sort((a, b) => b.net - a.net), { limit: 8, onRow: open, empty: '這段期間沒有新客戶' });
    let lost = [], down = [];
    if (hasPrev) {
      const curSet = new Map(cCur.map((c) => [c.ck, c]));
      lost = cPrev.filter((c) => !curSet.has(c.ck) && c.net > 0).sort((a, b) => b.net - a.net);
      down = prevByNet.slice(0, 20).map((c) => ({ ...c, now: (curSet.get(c.ck) || { net: 0 }).net })).filter((c) => c.now > 0 && c.now < c.net * 0.7).map((c) => ({ ...c, chg: (c.now - c.net) / c.net }));
      const lostAmt = lost.reduce((s, c) => s + c.net, 0);
      if (lost.length && rate(lostAmt, prev.net) > 0.05) alerts.push({ k: 'lost', lv: 'warn', t: `${lost.length} 位去年同期有買的客戶，這段期間都沒買（去年合計 ${fmt.big(lostAmt)}）`, s: '見「客戶動態」的可能流失名單，請業務聯絡。' });
      if (down.length) alerts.push({ k: 'down', lv: 'warn', t: `${down.length} 位去年同期前 20 大的客戶，今年少了 30% 以上`, s: '見「客戶動態」的衰退名單。' });
    }
    table(minis[1], [{ key: 'name', label: '客戶', cls: 'lbl', get: (r) => r.code + ' ' + r.name }, { key: 'net', label: '去年同期淨銷售', n: 1, fmt: 'money' }, { key: 'last', label: '最近交易', get: (r) => (fullCust.get(r.ck) || r).last, fmt: 'ym' }], lost, { limit: 8, onRow: open, empty: hasPrev ? '沒有' : '全部期間無法比較' });
    table(minis[2], [{ key: 'name', label: '客戶', cls: 'lbl', get: (r) => r.code + ' ' + r.name }, { key: 'net', label: '去年同期', n: 1, fmt: 'money' }, { key: 'now', label: '這段期間', n: 1, fmt: 'money' }, { key: 'chg', label: '變化', n: 1, render: (r) => arrow(r.chg) }], down, { limit: 8, onRow: open, empty: hasPrev ? '沒有' : '全部期間無法比較' });

    // ---------- 需要跟進 ----------
    const idleC = allCust.filter((c) => c.idle >= 3 && c.idle <= 12).sort((a, b) => b.sales - a.sales).slice(0, 8);
    table($('#dbIdleCust'), [
      { key: 'name', label: '客戶', get: (r) => r.code + ' ' + r.name, cls: 'lbl' },
      { key: 'rep', label: '業務', render: (r) => esc(repName(r.rep)) },
      { key: 'last', label: '最近交易', fmt: 'ym' },
      { key: 'idle', label: '靜止(月)', n: 1, fmt: 'int' },
      { key: 'sales', label: '歷史銷貨', n: 1, fmt: 'money' },
    ], idleC, { onRow: open, empty: '目前沒有靜止 3～12 個月的客戶' });
    const idleP = E.products({}, ref, 'sku2').list.filter((p) => p.idle >= 6).sort((a, b) => b.sales - a.sales).slice(0, 8);
    table($('#dbIdleProd'), [
      { key: 'code', label: '商品(簡化代碼)', cls: 'lbl' },
      { key: 'cat', label: '類別' },
      { key: 'idle', label: '滯銷(月)', n: 1, fmt: 'int' },
      { key: 'sales', label: '歷史銷貨', n: 1, fmt: 'money' },
    ], idleP, { onRow: (r) => ctx.openProduct(r, 'sku2'), empty: '沒有' });
    $$('#dbBody [data-goto]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); ctx.gotoIdle(a.dataset.goto); }; });

    // ---------- 退貨率最高的款號 ----------
    const st = rankRows('style');
    const totPos = st.reduce((s2, r) => s2 + Math.max(0, r.net), 0);
    const highRet = st.filter((r) => r.sales >= totPos * 0.005 && r.retRate > 0).sort((a, b) => b.retRate - a.retRate).slice(0, 8);
    table($('#dbHighRet'), [{ key: 'label', label: '款號', cls: 'lbl' }, { key: 'sales', label: '銷貨', n: 1, fmt: 'money' }, { key: 'returns', label: '退貨', n: 1, fmt: 'money' }, { key: 'retRate', label: '退貨率', n: 1, fmt: 'pct' }],
      highRet, { onRow: (r) => ctx.drill('style', r.code, r.label), empty: '沒有' });

    // ---------- 該來買、還沒來的客戶（需要實際日期）----------
    const D = E.maxSalesDate;
    if (!D) $('#dbDue').innerHTML = '<p class="hint">需要實際出貨日期（系統原始資料 JMSSAL／JMSSBK，或補上日期的總表）才算得出來。</p>';
    else {
      const today = root.EngineMeta.dayNum(D);
      const due = allCust.filter((c) => c.freq != null && c.buyDays >= 3 && c.lastDate && c.lastDate <= D)
        .map((c) => ({ ...c, since: today - root.EngineMeta.dayNum(c.lastDate) })).filter((c) => c.since > c.freq * 1.5 && c.since <= 180).sort((a, b) => b.sales - a.sales);
      table($('#dbDue'), [
        { key: 'name', label: '客戶', cls: 'lbl', get: (r) => r.code + ' ' + r.name },
        { key: 'rep', label: '業務', render: (r) => esc(repName(r.rep)) },
        { key: 'freq', label: '平常每幾天', n: 1, render: (r) => nf0.format(r.freq) + ' 天' },
        { key: 'since', label: '已經幾天沒買', n: 1, render: (r) => `<b>${nf0.format(r.since)}</b> 天` },
        { key: 'sales', label: '歷史銷貨', n: 1, fmt: 'money' },
      ], due, { limit: 10, onRow: open, empty: '沒有：客戶都在平常的時間內有來買' });
      if (due.length) alerts.push({ k: 'due', lv: 'warn', t: `${due.length} 位客戶超過平常的購買間隔還沒來買`, s: '見「該來買、還沒來的客戶」，請業務聯絡。' });
    }

    // ---------- 缺少的資料與說明 ----------
    const miss = [];
    const ds = E.ds;
    if (!(meta.cat && meta.cat.map)) miss.push(['商品類別代碼表', '還沒匯入。匯入後才會顯示類別名稱，以及商品大類（男、女、童、配件）的佔比。到「資料與設定」→「商品類別代碼表」匯入。']);
    else {
      const unm = E.pivot({ rows: ['cat'], cols: null, measures: ['net'], filter: {} }).rows.filter((r) => !ds.str.cat.mapped[r.codes[0]] && r.labels[0] !== '（空白）');
      if (unm.length) {
        miss.push(['分類表裡沒有名稱或大類的類別代碼', unm.sort((a, b) => b.vals[0][0] - a.vals[0][0]).map((r) => `${esc(r.labels[0])}（${fmt.big(r.vals[0][0])}）`).join('、') + '。這些會算在「未分類」，請在分類表補上後重新匯入。']);
        alerts.push({ k: 'unmapped', lv: 'warn', t: `有 ${unm.length} 個商品類別代碼沒有分類`, s: '見最下面「缺少的資料」。' });
      }
    }
    if (!fixed) miss.push(['每月固定費用', '損益兩平需要。在上面「損益兩平」輸入。']);
    if (!ar) miss.push(['應收帳款餘額', '應收帳款天數需要。在上面「應收帳款天數」輸入；或確認總表 RECEIVE、PAY 欄的意思後改成自動計算。']);
    miss.push(['庫存與進貨（採購）資料', '總表只有銷貨和退貨，所以無法算存貨週轉天數、缺貨或庫存過多。若有庫存表，可以再加進來。']);
    const dts = ds.dates || { dated: 0, mode: 'ord' };
    if (!dts.dated) miss.push(['實際出貨日期', '這份資料是總表，沒有實際出貨日期（DELIVDATE），月份是用單號前 5 碼判斷，月底、月初的單可能算到別的月份。改匯入系統的 JMSSAL、JMSSBK 原始資料就會依實際日期。']);
    else if (dts.dated < ds.n) miss.push(['部分資料沒有實際日期', `${nf0.format(ds.n - dts.dated)} 筆沒有實際日期，這些用單號判斷月份。`]);
    if (dts.mode === 'ord' && dts.dated) miss.push(['月份依據', '目前設定為「依單號」判斷月份；到「資料與設定」可以改回依實際出貨／退貨日期。']);
    const noSize = (() => { let c = 0; ds.str.sku.dict.forEach((s) => { if (!Dataset.splitSku(s)[1]) c++; }); return c; })();
    if (noSize) miss.push(['看不出尺寸的商品代號', `${nf0.format(noSize)} 個商品代號後面沒有尺寸（例如配件、運費），尺寸分析會顯示「（無尺寸）」。`]);
    const otherRegion = (E.pivot({ rows: ['region'], cols: null, measures: ['net'], filter: fil(F) }).rows.find((r) => r.labels[0] === '其他地區') || { vals: [[0]] }).vals[0][0];
    if (otherRegion) miss.push(['區域', `區域是用客戶代號的第一碼判斷，有 ${fmt.big(otherRegion)} 的淨銷售歸在「其他地區」（客戶代號不是 1～8 開頭）。`]);
    $('#dbMissing').innerHTML = `<div class="panel-head"><h2>缺少的資料與說明</h2></div><ul class="missing-list">${miss.map(([a, b]) => `<li><b>${a}</b>${b}</li>`).join('')}</ul>`;

    // 提醒背後的數據：淨銷售掉或升最多、毛利率掉最多、前 10 大客戶（只在有這個提醒時才出現）
    const has = (k) => alerts.some((a) => a.k === k);
    const drills = [];
    const netDir = has('netDown') ? 'down' : has('netUp') ? 'up' : null;
    if (netDir) drills.push(`<div class="panel drill" id="dbNetDrill"><div class="panel-head"><h2>淨銷售${netDir === 'down' ? '掉' : '多'}最多的是誰</h2><div class="seg" id="dbNetDim">${[['ck', '客戶'], ['rep', '業務員'], ['style', '款號'], ['region', '區域'], ['big', '大類']].map(([k, l]) => `<button data-v="${k}" class="${k === (S.dash.drillDim || 'ck') ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <p class="hint">${periodText(F)} 和去年同期 ${hasPrev ? periodText(P) : ''} 比，依差額排序。長條是這段期間，細線是去年同期。點一列看明細。</p><div class="grid2 tight"><div id="dbNetBars"></div><div id="dbNetTable" class="db-scroll"></div></div></div>`);
    let marginRows = [];
    if (has('marginDown')) {
      const sp = (r) => new Map(E.pivot({ rows: ['style'], cols: null, measures: ['sales', 'profit'], filter: fil(r) }).rows.map((x) => [x.codes[0], [x.labels[0], x.vals[0][0], x.vals[0][1]]]));
      const a = sp(F), b = sp(P);
      marginRows = [...a.entries()].filter(([k, v]) => v[1] > 0 && b.get(k) && b.get(k)[1] > 0).map(([k, v]) => {
        const pv = b.get(k), m1 = v[2] / v[1], m0 = pv[2] / pv[1];
        return { code: k, label: v[0], sales: v[1], m0, m1, dm: m1 - m0, impact: v[1] * (m1 - m0) };
      }).sort((x, y) => x.impact - y.impact).slice(0, 12);
      drills.push(`<div class="panel drill" id="dbMarginDrill"><div class="panel-head"><h2>毛利率掉最多的款號</h2></div><p class="hint">「影響毛利」= 這段期間的銷貨 ×（今年毛利率 − 去年毛利率），也就是毛利率變差讓毛利少賺了多少。點一列看款號。</p><div id="dbMarginTable" class="db-scroll"></div></div>`);
    }
    if (has('top10')) drills.push(`<div class="panel drill" id="dbTop10Drill"><div class="panel-head"><h2>前 10 大客戶佔多少</h2></div><p class="hint">累計 = 從第一名加到這一名，佔全部淨銷售的比例。點一列看客戶。</p><div class="grid2 tight"><div id="dbTop10Bars"></div><div id="dbTop10Table" class="db-scroll"></div></div></div>`);
    $('#dbDrills').innerHTML = drills.length ? `<h2 class="section-title">提醒背後的數據 <small>從上面的「看數據」跳過來</small></h2>${drills.join('')}` : '';
    if (netDir) {
      const drawNet = () => {
        const dim = S.dash.drillDim || 'ck';
        const rows = rankRows(dim).filter((r) => r.net || r.prevNet).sort((a, b) => (netDir === 'down' ? a.diff - b.diff : b.diff - a.diff)).slice(0, 15);
        const lbl = (r) => (dim === 'ck' ? (fullCustOf(r.code) ? fullCustOf(r.code).code + ' ' + fullCustOf(r.code).name : r.label) : r.label);
        const openRow = (r) => (dim === 'ck' ? (fullCustOf(r.code) && ctx.openCustomer(fullCustOf(r.code))) : dim === 'rep' ? ctx.goRep && ctx.goRep(E.dim('rep').labels[r.code]) : ctx.drill(dim, r.code, r.label));
        Charts.hbars($('#dbNetBars'), { rows: rows.slice(0, 10).map((r) => ({ label: lbl(r), value: Math.max(0, r.net), prev: r.prevNet, cls: dim === 'region' || dim === 'big' || dim === 'rep' ? ctx.colorOf(dim, dim === 'rep' ? E.dim('rep').labels[r.code] : r.label) : (netDir === 'down' ? 'c8' : 'c3'), r, note: arrow(r.yoy) })), fmt: fmt.big, limit: 10, onClick: (x) => openRow(x.r) });
        table($('#dbNetTable'), [{ key: 'label', label: '名稱', cls: 'lbl', get: lbl }, { key: 'prevNet', label: '去年同期', n: 1, fmt: 'money' }, { key: 'net', label: '這段期間', n: 1, fmt: 'money' },
          { key: 'diff', label: '差額', n: 1, render: (r) => `<b class="${r.diff >= 0 ? 'up' : 'down'}">${r.diff >= 0 ? '+' : '−'}${fmt.big(Math.abs(r.diff))}</b>` }, { key: 'yoy', label: '變化', n: 1, render: (r) => (r.prevNet ? arrow(r.yoy) : '<span class="muted">新</span>') }], rows, { onRow: openRow });
        window.__dashDrill = { dim, rows: rows.map((r) => [lbl(r), r.diff]) }; // 測試用
      };
      $('#dbNetDim').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.dash.drillDim = b.dataset.v; ctx.saveDash(); $$('#dbNetDim button').forEach((x) => x.classList.toggle('on', x === b)); drawNet(); };
      ctx.after.push(drawNet);
    }
    if (marginRows.length) table($('#dbMarginTable'), [{ key: 'label', label: '款號', cls: 'lbl' }, { key: 'sales', label: '銷貨', n: 1, fmt: 'money' }, { key: 'm0', label: '去年毛利率', n: 1, fmt: 'pct' }, { key: 'm1', label: '今年毛利率', n: 1, fmt: 'pct' },
      { key: 'dm', label: '變化', n: 1, render: (r) => arrow(r.dm, true, 'pp') }, { key: 'impact', label: '影響毛利', n: 1, render: (r) => `<b class="${r.impact >= 0 ? 'up' : 'down'}">${r.impact >= 0 ? '+' : '−'}${fmt.big(Math.abs(r.impact))}</b>` }], marginRows, { onRow: (r) => ctx.drill('style', r.code, r.label) });
    else if (has('marginDown')) $('#dbMarginTable').innerHTML = '<p class="hint">沒有兩期都有賣的款號可以比較。</p>';
    if (has('top10')) {
      let acc = 0;
      const t10 = byNet.slice(0, 10).map((c) => { acc += c.net; return { ...c, share: rate(c.net, cur.net), cum: rate(acc, cur.net) }; });
      Charts.hbars($('#dbTop10Bars'), { rows: t10.map((c) => ({ label: c.code + ' ' + c.name, value: c.net, cls: 'c1', c, note: fmt.pct(c.share) })), fmt: fmt.big, limit: 10, onClick: (x) => open(x.c) });
      table($('#dbTop10Table'), [{ key: 'name', label: '客戶', cls: 'lbl', get: (r) => r.code + ' ' + r.name }, { key: 'net', label: '淨銷售', n: 1, fmt: 'money' }, { key: 'share', label: '佔比', n: 1, fmt: 'pct' }, { key: 'cum', label: '累計', n: 1, fmt: 'pct' }], t10, { onRow: open });
    }

    // ---------- 提醒（最後才畫，因為上面會補）----------
    const lvName = { bad: '要注意', warn: '留意', good: '不錯' };
    const order = { bad: 0, warn: 1, good: 2 };
    alerts.sort((a, b) => order[a.lv] - order[b.lv]);
    $('#dbAlerts').innerHTML = `<div class="panel-head"><h2>重點提醒</h2></div>` + (alerts.length
      ? `<ul class="alerts">${alerts.map((a) => { const I = IDEAS[a.k] || { ideas: [] }; return `<li class="${a.lv}"><span class="tag">${lvName[a.lv]}</span><div class="al-body"><b>${a.t}</b><p>${a.s}</p>` +
          (I.ideas.length ? `<details class="ideas"${a.lv === 'bad' ? ' open' : ''}><summary>建議可以怎麼做（${I.ideas.length} 點）</summary><ol>${I.ideas.map((x) => `<li>${x}</li>`).join('')}</ol></details>` : '') +
          (I.go ? `<button type="button" class="btn small" data-jump="${I.go}">看數據 ↓</button>` : '') + '</div></li>'; }).join('')}</ul>`
      : '<p class="hint">這段期間沒有特別需要注意的地方。</p>');
    $$('#dbAlerts [data-jump]').forEach((b) => { b.onclick = () => { const t = $('#' + b.dataset.jump); if (!t) return; t.scrollIntoView({ behavior: 'smooth', block: 'start' }); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); }; });
    return { cur, prev, alerts, top10Share, newCust: newCust.length };
  }

  root.Dashboard = { render, PERIODS, addM, range, periodText };
})(window);

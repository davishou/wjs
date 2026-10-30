# 銷售分析（wjs）— 給 Claude Code 的專案說明

使用者用這個軟體分析公司「總表」Excel 的進貨與退貨資料。網址：https://davishou.github.io/wjs/
使用者不是工程師：回覆用繁體中文、白話，少用術語；介面上的文字也一樣。

## 最重要的規則：公司資料不能外流

1. **repo 是公開的**，任何進 repo 的東西（包括舊版本的歷史紀錄）都會永久公開。
   不要 commit 任何 Excel、CSV、資料包（.dvp）、zip、截圖中有真實數字的圖片。`.gitignore` 已擋下這些，不要拿掉。
2. **不要打開使用者真正的總表 Excel 或資料包**來「看看內容」。你讀到的內容會送到雲端。
   需要測試資料時，用 `tests/make_fixtures.py` 產生假資料。需要知道欄位名稱時，問使用者，或看 `js/ingest.js`。
3. 資料只在使用者的瀏覽器裡處理，網站沒有後端。**不要加入任何會把資料送出去的功能**（上傳、分析服務、外部 API、錯誤回報服務等）。
4. 密碼不儲存、不傳送、不寫進 localStorage 或 console。
5. 不要重新加回「把資料包放在網站上載入」的功能（已在 2026-10-21 依使用者要求移除）。

## 架構

純靜態網頁，零相依套件、不需要建置。改完檔案直接推上 `main`，GitHub Pages 約 1 分鐘後更新。

```
index.html            所有畫面（含開鎖畫面 #lock、密碼對話框 #dlg）
css/app.css           三種介面風格：indigo 藍染、night 夜航、market 市集（用 [data-theme] 切換）
js/app.js             介面邏輯（匯入、開鎖、資料包、樞紐、客戶、商品）
js/engine.js          樞紐分析、客戶與商品指標（維度含 季度、商品大類、款號、尺寸）
js/dashboard.js       儀表板：提醒、排名與毛利貢獻、佔比、毛利率／退貨率比較、損益兩平、應收帳款天數、客戶動態、商品結構、缺少的資料
js/dataset.js         資料序列化、衍生欄位、資料包加解密、加密的本機儲存（Vault）
js/xlsx-stream.js     Excel 串流讀取（自己解 ZIP，接受 File/Blob 或 Uint8Array）
js/dbf.js             系統原始資料 .DBF 讀取（JMSSAL、JMSSBK），中文用 Big5
js/office-crypto.js   有開啟密碼的 Excel 解密（[MS-OFFCRYPTO] Agile 與 Standard）
js/ingest.js          依表頭名稱讀總表的「原始進貨表」「原始退貨表」，或系統原始資料 JMSSAL／JMSSBK（.DBF 或另存的 Excel，可一次選多個檔案）
js/worker.js          背景執行緒：解密＋讀 Excel、打包／解開資料包
js/chart.js           圖表
sw.js                 離線快取
```

### 總表更新工具（excel-tool/）
另一套給使用者電腦用的工具：雙擊 `更新總表.cmd`，用 Excel 自動化（PowerShell COM）把 JMSSAL（.DBF/.xlsx）接到「原始進貨表」A～V、JMSSBK 接到「原始退貨表」A～U，
以整張單號比對重複；單號已有但內容不同 → 改用新資料、業務員保留原本的（使用者的規則）。依單號排序、清掉資料下面的空白列（表格1 縮到資料範圍）、補 W～AE／V～AB 公式、補 AK/AT/BM 的 UNIQUE 清單旁的公式；
BB/BC/BI 對照表整張改成和 AK/AT/BM 一樣，其他對照表只加進貨的新值；AR2 填下個月，最後另存新檔。
啟動時記住上次的資料夾（`%LOCALAPPDATA%\總表更新工具\settings.json`，只存路徑），自動挑最新的總表／JMSSAL／JMSSBK，跳確認視窗。
說明在 `excel-tool/README.md`。`.ps1` 必須存成 UTF-8 含 BOM。測試：`powershell -NoProfile -ExecutionPolicy Bypass -File tests\excel_tool_test.ps1`（需要 Excel）。

### 兩種資料來源
1. **總表**（中文表頭）。A 欄表頭叫「出貨日期」但其實是發貨單號；沒有實際出貨日期。
2. **系統原始資料**（建議）：JMSSAL（出貨，A～W）、JMSSBK（退貨，A～V），英文欄位。對照：DELIVNO 單號、CODE 商品類別、STYLE 商品代號、COLO 顏色、
   UNIT_NM 單位、PRICE 單價（成本）、OUTPRICE 售價、OUTQTY 數量、UNIT 單位(數字)、SALEGET 品項金額、ID 客戶代號、SNAME 客戶名、EMPNO 業務員、
   **DELIVDATE 實際出貨／退貨日期（民國 yyymmdd 文字，例如 1150801）**。AMOUNT 是整張單的總額（只在第一列），不要拿來加總。
   使用者在 Mac 用 WPS 開 DBF 時中文會變亂碼（編碼錯），所以網站直接讀 .DBF 並用 Big5 解碼；請使用者直接選 .DBF，不要先轉 Excel。
- **月份依據**（`S.ymMode`，存在這台裝置的 localStorage）：預設 `date` 依 DELIVDATE；`ord` 依單號前 5 碼。沒有實際日期的列一律用單號。
  兩種都保留，在「資料與設定」切換。每列的日期存在 `num.date`（民國 yyymmdd，沒有就 0）；舊資料沒有這欄時讀出來是 0。

### 資料流程
- **電腦匯入 Excel**：worker 讀檔頭；若是加密檔（D0 CF 11 E0）就用 `OfficeCrypto.decryptXlsx` 在記憶體內解密成 Uint8Array（不建立 Blob，避免被暫存到硬碟），讀完 `fill(0)` 清空。→ `Dataset.serialize` → `Vault.save` 加密存進 IndexedDB。
- **開啟密碼（Vault）**：IndexedDB 資料庫 `dv-analytics`、store `kv`、key `vault` = `{v, iter, salt, iv, ct}`。AES-256-GCM，PBKDF2-SHA256 60 萬次，內容先 gzip。金鑰只放記憶體（`S.vault`），重新整理就上鎖。舊版的未加密 key `data` 會在第一次開啟時轉成加密並刪除。
- **資料包（.dvp）**：`'DVPK'` + flag + salt + iv + AES-GCM(gzip(serialize))。手機開啟資料包後，開啟密碼沿用資料包密碼。LINE 會把資料包包成 zip，`openPackFile` 會自動解開；選到 Excel 會直接匯入。
- **meta（分類表與設定）**：存在資料標頭的 `meta`（`serialize`／`deserialize`）：`cat.map = {類別代碼: [名稱, 大類]}`、`fixedCost`（每月固定費用）、`ar = {amount, ym}`（應收帳款餘額）。
  跟著資料一起加密進 Vault、跟著資料包到手機；重新匯入總表或每月加入時沿用目前的 meta（`loadBuffer`）。
  **商品類別代碼表是使用者的公司資料，不可以寫進程式或 repo**，只能由使用者在「資料與設定」匯入（也可以直接拖進更新資料的框框，會自動辨識）。
- **衍生欄位**：款號、尺寸由商品代號拆出（`splitSku`：「/」或「-」後面，或數字後面的字母，例如 AR9006XXL → AR9006 / XXL、6872XL-XXL → 6872 / XL-XXL），不改動原始資料，也不改「簡化代碼」（它要和 Excel 公式一致）。
  商品類別代碼會補成兩碼（Excel 可能把 03 存成 3）。大類＝男／女／童／配件，用來分男女商品。
- **忘記密碼**：沒有後門。開鎖畫面「忘記密碼？」→ 清除資料 → 電腦重新匯入 Excel／手機重新開啟資料包。

## 儀表板的定義（改之前先問使用者）
- 毛利率 = 銷貨毛利 ÷ 銷貨金額（和總覽、Excel 一樣，未扣退貨）；毛利貢獻 = 淨毛利（扣退貨）；毛利貢獻率 = 佔全部淨毛利的比例。
- 損益兩平 = 每月固定費用 ÷ 淨毛利率；應收帳款天數 = 應收帳款餘額 ÷ 近 3 個月淨銷售 × 91。
- 總表的 RECEIVE、PAY 欄可能是收款紀錄，意思尚未和使用者確認。使用者說應收帳款資料之後會另外提供，先不要自己推算。

## 修改時要注意
- **新增或改名 js/css 檔**：要加進 `sw.js` 的 `SHELL` 清單；任何程式檔有變動就把 `sw.js` 的 `VERSION` 加 1（例如 v7 → v8），手機才會拿到新版。
- 三種介面風格和手機寬度（390px）都要看過；顏色用 `css/app.css` 開頭的變數，不要寫死。
- Excel 欄位是**依表頭名稱**對應（`js/ingest.js` 的 `SALES_COLS`、`RET_COLS`），不依欄位字母。
- 衍生欄位（區域、簡化代碼、賣出數、毛利）的算法在 `js/dataset.js` 的 `hydrate`，要和使用者 Excel 的公式一致；改之前先問使用者。

## 測試（改完一定要跑）
```
pip install openpyxl cryptography playwright
python -m playwright install chromium
python tests/make_fixtures.py          # 產生假資料到 tests/fixtures/（加 --big 多測 18 萬筆大檔）
python tests/e2e.py                    # 瀏覽器實測，最後印出「全部通過」
```
`tests/fixtures/` 不會進 repo。截圖在 `tests/fixtures/shots/`，看介面有沒有跑掉。
新功能請在 `tests/e2e.py` 加對應的檢查。

## Git
- 直接在 `main` 上工作並推送（使用者一個人用，沒有審查流程）。commit 訊息用繁體中文，第一行寫改了什麼。
- 推送前跑 `git status`，確認沒有任何資料檔被加進去。

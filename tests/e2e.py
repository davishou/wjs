"""瀏覽器端到端測試：Excel 密碼解密、開鎖畫面、資料包、忘記密碼、手機選檔。

先執行 python tests/make_fixtures.py（加 --big 會多測大檔），再執行：
  python tests/e2e.py
需要：pip install playwright && python -m playwright install chromium
截圖存在 tests/fixtures/shots/。測試只用假資料，不要放真的總表。
"""
import asyncio, os, sys, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FX = os.path.join(HERE, 'fixtures'); SH = os.path.join(FX, 'shots'); os.makedirs(SH, exist_ok=True)
if not os.path.exists(FX + '/agile.xlsx'): sys.exit('請先執行 python tests/make_fixtures.py')

# 在背景起一個本機網頁伺服器（只聽 127.0.0.1）
class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
_srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(_Quiet, directory=ROOT))
threading.Thread(target=_srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{_srv.server_address[1]}/index.html'

def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: sys.exit(1)

IDB_DUMP = """async () => { const db = await new Promise((r,j)=>{const q=indexedDB.open('dv-analytics',1);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});
 const keys = await new Promise(r=>{const q=db.transaction('kv').objectStore('kv').getAllKeys();q.onsuccess=()=>r(q.result)});
 const v = await new Promise(r=>{const q=db.transaction('kv').objectStore('kv').get('vault');q.onsuccess=()=>r(q.result)});
 return {keys, vault: v ? {iter:v.iter, ctLen:v.ct.byteLength, hasIv: v.iv.length, ctHead: Array.from(new Uint8Array(v.ct).slice(0,4))} : null}; }"""
async def dlg_fill(page, vals, check=None):
    await page.wait_for_selector('#dlg[open]')
    if check is not None:
        if (await page.is_checked('#dlg_check')) != check: await page.click('#dlg_check')
    for k,v in vals.items(): await page.fill(f'#dlg_{k}', v)
    await page.click('#dlgOk')
async def wait_done(page):
    await page.wait_for_function("document.querySelector('#importProgress p') && /完成|失敗|取消/.test(document.querySelector('#importProgress p').textContent)", timeout=120000)
    return await page.text_content('#importProgress p')
async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch()
    # ===== 電腦 =====
    ctx = await b.new_context(viewport={'width':1280,'height':800}, accept_downloads=True)
    page = await ctx.new_page(); errs=[]
    page.on('pageerror', lambda e: errs.append(str(e))); page.on('console', lambda m: m.type=='error' and 'Failed to load resource' not in m.text and errs.append(m.text))
    await page.goto(URL); await page.wait_for_timeout(500)
    ok(await page.is_hidden('#lock'), '首次開啟（無資料）不顯示開鎖畫面')
    # 1. 加密 Excel，先輸入錯的
    await page.set_input_files('#fileXlsx', FX+'/agile.xlsx')
    await page.wait_for_selector('#dlg[open]')
    await page.screenshot(path=SH+'/1_import_dialog.png')
    ok(await page.is_checked('#dlg_check') and await page.is_hidden('[data-f=app]'), '對話框：Excel 密碼＋「開啟密碼也用這組」預設勾選')
    await dlg_fill(page, {'xls':'wrongpw'})
    await page.wait_for_selector('#dlg[open]'); await page.wait_for_function("document.querySelector('#dlgErr') && document.querySelector('#dlgErr').textContent.includes('不正確')", timeout=60000)
    await page.screenshot(path=SH+'/2_wrong_pw.png')
    ok(True, '錯誤 Excel 密碼 → 再問一次並顯示「不正確」')
    await dlg_fill(page, {'xls':'測試pw123'})
    t = await wait_done(page); ok('完成' in t and '1,080' in t, '解密匯入成功：'+t)
    st = await page.evaluate(IDB_DUMP); print('  IDB', st)
    ok(st['keys']==['vault'] and st['vault']['iter']==600000, 'IndexedDB 只有加密的 vault，沒有未加密的 data')
    ok(st['vault']['ctHead'][:2] != [0x1f,0x8b], '儲存內容不是明文 gzip')
    ls = await page.evaluate("JSON.stringify(localStorage)")
    ok('測試' not in ls and 'pw123' not in ls, 'localStorage 沒有密碼')
    # 2. 重新開啟 → 開鎖畫面
    await page.reload(); await page.wait_for_selector('#lock:not([hidden])')
    ok(await page.is_hidden('.shell'), '重新開啟：顯示開鎖畫面、主畫面隱藏')
    await page.screenshot(path=SH+'/3_lock.png')
    await page.fill('#lockPw','bad'); await page.click('#lockGo')
    await page.wait_for_function("document.querySelector('#lockErr').textContent.includes('不正確')")
    ok(True, '開鎖：錯誤密碼顯示錯誤')
    await page.fill('#lockPw','測試pw123'); await page.click('#lockGo')
    await page.wait_for_selector('#lock[hidden]', state='attached')
    await page.click('a[data-view=overview]'); await page.wait_for_selector('#view-overview:not([hidden])')
    ok('資料到' in await page.text_content('#brandSub'), '開鎖成功，總覽顯示：'+await page.text_content('#brandSub'))
    await page.screenshot(path=SH+'/4_unlocked.png')
    # 3. 更改開啟密碼
    await page.goto(URL+'#data'); await page.wait_for_timeout(300)
    if await page.is_visible('#lock'):
        await page.fill('#lockPw','測試pw123'); await page.click('#lockGo'); await page.wait_for_selector('#lock[hidden]', state='attached')
    await page.click('#changePw'); await dlg_fill(page, {'cur':'nope','pw':'newpass1','pw2':'newpass1'})
    await page.wait_for_function("document.querySelector('#dlgErr').textContent.includes('不正確')")
    await dlg_fill(page, {'cur':'測試pw123','pw':'newpass1','pw2':'newpass1'})
    await page.wait_for_selector('#dlg:not([open])', state='attached'); await page.wait_for_timeout(1500)
    await page.reload(); await page.wait_for_selector('#lock:not([hidden])')
    await page.fill('#lockPw','測試pw123'); await page.click('#lockGo'); await page.wait_for_function("document.querySelector('#lockErr').textContent.includes('不正確')")
    await page.fill('#lockPw','newpass1'); await page.click('#lockGo'); await page.wait_for_selector('#lock[hidden]', state='attached')
    ok(True, '更改開啟密碼：舊密碼失效、新密碼可開')
    # 4. 已有密碼時匯入 Excel 2007 格式加密檔：只問 Excel 密碼
    await page.click('a[data-view=data]')
    await page.set_input_files('#fileXlsx', FX+'/mid_standard.xlsx')
    await page.wait_for_selector('#dlg[open]')
    ok(await page.query_selector('#dlg_app') is None, '已設定開啟密碼 → 匯入時只問 Excel 密碼')
    await dlg_fill(page, {'xls':'Abc!2007'}); t = await wait_done(page); ok('54,000' in t, 'Excel 2007（Standard）加密檔匯入：'+t)
    # 5. 匯出資料包
    await page.fill('#packPw','packpw88')
    async with page.expect_download() as dl: await page.click('#packExport')
    d = await dl.value; await d.save_as(FX+'/pack.dvp'); ok(os.path.getsize(FX+'/pack.dvp')>1000, '匯出資料包')
    # 6. 忘記密碼
    await page.reload(); await page.wait_for_selector('#lock:not([hidden])')
    await page.click('#lockForgot'); await page.screenshot(path=SH+'/5_forgot.png')
    await page.click('#lockReset'); await page.click('#lockReset')
    await page.wait_for_selector('#lock[hidden]', state='attached'); await page.wait_for_selector('#view-data:not([hidden])')
    st = await page.evaluate(IDB_DUMP); ok(st['keys']==[], '忘記密碼 → 清除資料，回到資料與設定：'+str(st['keys']))
    await page.reload(); await page.wait_for_timeout(500); ok(await page.is_hidden('#lock'), '清除後重開不再要求密碼')
    # 7. 未加密 Excel、尚無開啟密碼 → 要設定開啟密碼
    await page.set_input_files('#fileXlsx', FX+'/plain.xlsx')
    await page.wait_for_selector('#dlg[open]'); await page.screenshot(path=SH+'/6_set_pw.png')
    ok(await page.query_selector('#dlg_xls') is None, '未加密 Excel：只要設定開啟密碼')
    await dlg_fill(page, {'app':'abcd1','app2':'abcd2'}); await page.wait_for_function("document.querySelector('#dlgErr').textContent.includes('不一樣')")
    await dlg_fill(page, {'app':'ab','app2':'ab'}); await page.wait_for_function("document.querySelector('#dlgErr').textContent.includes('至少')")
    await dlg_fill(page, {'app':'abcd1','app2':'abcd1'}); t = await wait_done(page); ok('完成' in t, '設定開啟密碼並匯入：'+t)
    # 8. 加密 Excel、不勾「也用這組」→ 分開設定
    await page.click('#clearData'); await page.click('#clearData'); await page.wait_for_timeout(300)
    await page.set_input_files('#fileXlsx', FX+'/agile.xlsx'); await page.wait_for_selector('#dlg[open]')
    await page.click('#dlg_check'); ok(await page.is_visible('#dlg_app'), '取消勾選 → 出現開啟密碼欄位')
    await dlg_fill(page, {'xls':'測試pw123','app':'sep-pass','app2':'sep-pass'}); t = await wait_done(page)
    await page.reload(); await page.wait_for_selector('#lock:not([hidden])')
    await page.fill('#lockPw','sep-pass'); await page.click('#lockGo'); await page.wait_for_selector('#lock[hidden]', state='attached')
    ok(True, 'Excel 密碼與開啟密碼分開設定也正常')
    ok(not errs, '電腦端沒有 JS 錯誤 '+str(errs))
    await ctx.close()
    # ===== 手機 =====
    m = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    page = await m.new_page(); errs=[]
    page.on('pageerror', lambda e: errs.append(str(e)))
    await page.goto(URL); await page.wait_for_timeout(500)
    await page.fill('#openPw','packpw88'); await page.set_input_files('#filePack', FX+'/pack.dvp')
    await page.wait_for_selector('#view-overview:not([hidden])', timeout=60000)
    st = await page.evaluate(IDB_DUMP); ok(st['keys']==['vault'], '手機開啟資料包 → 加密保存')
    await page.reload(); await page.wait_for_selector('#lock:not([hidden])'); await page.screenshot(path=SH+'/7_phone_lock.png')
    await page.fill('#lockPw','packpw88'); await page.click('#lockGo'); await page.wait_for_selector('#lock[hidden]', state='attached')
    ok(True, '手機：開啟密碼沿用資料包密碼')
    ok(not errs, '手機端沒有 JS 錯誤 '+str(errs))
    await m.close()
    # ===== 舊版未加密資料 → 設定密碼 =====
    c3 = await b.new_context(); page = await c3.new_page(); await page.goto(URL); await page.wait_for_timeout(300)
    await page.evaluate("""async (pk) => { const r = await Dataset.openPack(new Uint8Array(pk).buffer, 'packpw88'); await Dataset.idbSet('data', Dataset.serialize(r)); }""", list(open(FX+'/pack.dvp','rb').read()))
    await page.reload(); await page.wait_for_selector('#lock:not([hidden])'); await page.screenshot(path=SH+'/8_migrate.png')
    ok(await page.is_visible('#lockPw2'), '舊版未加密資料：要求設定開啟密碼')
    await page.fill('#lockPw','mig-123'); await page.fill('#lockPw2','mig-123'); await page.click('#lockGo'); await page.wait_for_selector('#lock[hidden]', state='attached')
    st = await page.evaluate(IDB_DUMP); ok(st['keys']==['vault'], '舊資料已加密，未加密副本已刪除')
    # 大檔效能
    if os.path.exists(FX+'/big_agile.xlsx'):
        await page.click('a[data-view=data]'); await page.set_input_files('#fileXlsx', FX+'/big_agile.xlsx')
        await dlg_fill(page, {'xls':'測試pw123'}); t = await wait_done(page); ok('180,000' in t, '大檔（約 9MB、18 萬筆）加密 Excel：'+t)
    for th in ['night','market']:
        await page.evaluate(f"localStorage.setItem('dv.theme','{th}')"); await page.reload(); await page.wait_for_selector('#lock:not([hidden])'); await page.screenshot(path=SH+f'/9_lock_{th}.png')
    await c3.close()
    await picker(b)
    await b.close()
    print('全部通過')

async def picker(b):
    """手機選資料包時，各種被改過的檔案都要有正確反應。"""
    import zipfile
    zipfile.ZipFile(FX+'/pack_line.zip','w',zipfile.ZIP_DEFLATED).write(FX+'/pack.dvp','pack.dvp')
    open(FX+'/page.html','w').write('<!DOCTYPE html><html><body>Google Drive</body></html>')
    open(FX+'/empty.dvp','w').close(); open(FX+'/junk.dvp','wb').write(b'hello world'*100)
    cases = [('pack.dvp','資料包已載入', False), ('pack_line.zip','資料包已載入', False), ('page.html','網頁', False), ('empty.dvp','空的', False),
             ('junk.dvp','不是本軟體匯出的資料包', False), ('plain.xlsx','Excel', True), ('agile.xlsx','Excel', True)]
    for f, expect, dialog in cases:
        c = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
        pg = await c.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL+'#data'); await pg.wait_for_timeout(400)
        await pg.fill('#openPw', 'packpw88'); await pg.set_input_files('#filePack', FX+'/'+f)
        await pg.wait_for_function("document.querySelector('#toast').classList.contains('show')", timeout=60000)
        await pg.wait_for_timeout(300)
        t = await pg.text_content('#toast'); d = await pg.evaluate("document.querySelector('#dlg').open")
        ok(expect in t and d == dialog and not errs, f'選擇資料包：{f} → {t}')
        await c.close()

asyncio.run(main())

# 產生主畫面圖示 W 標誌（icons/icon.svg、PNG；2026-11-17 使用者設計）：8 個斜的色塊組成 W 的 4 筆，每筆上下兩塊。
# 沿著 W 的筆畫依序：藍（銷售分析圖）、黃（錢）、紅（工廠）、綠（內褲）、橘（人）、黑（地圖）、粉（行銷）、紫（實驗室）
import math, sys
W_, H_, DEG, GAP = 58, 160, 8, 16   # 色塊寬、高、傾斜角度、間隔（含圓角外擴）
RND = 14                             # 圓角（用同色外框做出來，會外擴 RND/2）
COLS = ['#2C5596', '#F2C230', '#D63A3A', '#2F9E5B', '#F08C2E', '#23272F', '#EC6FA8', '#7E57C2']
GL = ['chart', 'money', 'factory', 'briefs', 'person', 'map', 'promo', 'lab']
GLY = {
 'chart': '<rect x="3" y="12" width="4.6" height="9" rx="1.2"/><rect x="9.7" y="7" width="4.6" height="14" rx="1.2"/><rect x="16.4" y="3" width="4.6" height="18" rx="1.2"/>',
 'money': '<path d="M16.6 7.6c-.8-1.6-2.5-2.4-4.6-2.4-2.6 0-4.5 1.3-4.5 3.3 0 4.6 9.3 2.4 9.3 7.2 0 2.1-2 3.6-4.9 3.6-2.2 0-4-.9-4.8-2.7M12 2.4v19.2" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>',
 'factory': '<path d="M2 21V10.5l5 3v-3l5 3v-3l5 3V3h3.4v18z"/><rect x="5" y="16" width="2.6" height="2.6" fill="BG"/><rect x="10" y="16" width="2.6" height="2.6" fill="BG"/><rect x="15" y="16" width="2.6" height="2.6" fill="BG"/>',
 'person': '<circle cx="12" cy="7.3" r="4.6"/><path d="M3.3 21.2c0-4.8 3.9-8.3 8.7-8.3s8.7 3.5 8.7 8.3z"/>',
 'briefs': '<rect x="2.6" y="4.4" width="18.8" height="3" rx="1"/><path d="M2.6 8.6h18.8c-3.6 1.2-6.1 4.6-6.6 10.6H9.2C8.7 13.2 6.2 9.8 2.6 8.6z"/>',
 'promo': '<path d="M2.8 9.4h3.6L14 4.6v14.8l-7.6-4.8H5.2l1.3 5.2H3.9l-1.1-5.2z"/><path d="M16.8 8.6a4.6 4.6 0 0 1 0 6.8M19.3 6a8.3 8.3 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
 'lab': '<path d="M8.6 2.6h6.8v2h-1.2v4.6l5.6 9.3a1.8 1.8 0 0 1-1.5 2.8H5.7a1.8 1.8 0 0 1-1.5-2.8l5.6-9.3V4.6H8.6z"/><path d="M7 15.2h10" stroke="BG" stroke-width="1.6" stroke-linecap="round"/>',
 'map': '<path d="M2.6 5.8 8.8 3.6l6.4 2.2 6.2-2.2v14.6l-6.2 2.2-6.4-2.2-6.2 2.2z"/><path d="M8.8 3.6v14.6M15.2 5.8v14.6" stroke="BG" stroke-width="1.5"/>',
}
def blocks():
    t = math.tan(math.radians(DEG)); a, b = W_ / 2, H_ / 2
    s = (H_ + GAP) * t; step = 2 * a + 2 * b * t + GAP
    x1t = 0; x1b = s; x2b = x1b + step; x2t = x2b + s; x3t = x2t + step; x3b = x3t + s; x4b = x3b + step; x4t = x4b + s
    width = x4t + 2 * a + 2 * b * t
    off = (512 - width) / 2 + a + b * t
    yt = (512 - (2 * H_ + GAP)) / 2 + b; yb = yt + H_ + GAP
    pos = [(x1t, yt, 1), (x1b, yb, 1), (x2b, yb, -1), (x2t, yt, -1), (x3t, yt, 1), (x3b, yb, 1), (x4b, yb, -1), (x4t, yt, -1)]
    out = []
    for (cx, cy, sg), col, g in zip(pos, COLS, GL):
        cx += off
        pts = [(cx - a - sg * b * t, cy - b), (cx + a - sg * b * t, cy - b), (cx + a + sg * b * t, cy + b), (cx - a + sg * b * t, cy + b)]
        d = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + 'Z'
        ink = '#3d2e00' if col == '#F2C230' else '#fff'
        gs = W_ * 0.95; sc = gs / 24
        out.append(f'<path d="{d}" fill="{col}" stroke="{col}" stroke-width="{RND}" stroke-linejoin="round"/>'
                   f'<g transform="translate({cx - gs / 2:.1f} {cy - gs / 2:.1f}) scale({sc:.4f})" fill="{ink}" color="{ink}">{GLY[g].replace("BG", col)}</g>')
    return ''.join(out)
def svg(scale=1.0, round_bg=False):
    body = blocks()
    if scale != 1: body = f'<g transform="translate(256 256) scale({scale}) translate(-256 -256)">{body}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="{112 if round_bg else 0}" fill="#FBF8F3"/>{body}</svg>'
# 用法：python tests/make_icon.py（需要 playwright）→ 寫入 icons/icon.svg、icon-180/192/512.png、icon-maskable-512.png
if __name__ == '__main__':
    import asyncio, os
    from playwright.async_api import async_playwright
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')
    open(out + '/icon.svg', 'w').write(svg(round_bg=True))
    async def render():
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for src, name, size in [(svg(), 'icon-512.png', 512), (svg(), 'icon-192.png', 192), (svg(), 'icon-180.png', 180), (svg(scale=0.66), 'icon-maskable-512.png', 512)]:
                pg = await b.new_page(viewport={'width': size, 'height': size})
                await pg.set_content('<html><body style="margin:0">' + src.replace('<svg ', f'<svg width="{size}" height="{size}" ', 1) + '</body></html>')
                await pg.screenshot(path=os.path.join(out, name))
            await b.close()
    asyncio.run(render())

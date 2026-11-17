# 產生主畫面圖示 W 標誌（icons/icon.svg、PNG；2026-11-17 使用者設計）：8 個斜的色塊組成 W 的 4 筆，每筆上下兩塊。
# 沿著 W 的筆畫依序：藍（銷售分析圖）、黃（錢）、紅（工廠）、綠（男生三角褲）、橘（人）、黑（地球，上面有地圖）、粉（電視，代表行銷）、紫（實驗室）
import math, sys
# 2026-11-17 第二版（使用者要求）：轉折處（下面兩個尖角、中間的尖角）兩筆稍微疊上去；切口俐落（小圓角、細的底色分隔線）
W_, H_, DEG = 72, 160, 9      # 色塊寬、高、傾斜角度
CUT = 7                        # 同一筆上下兩塊之間的切口
OV = 22                        # 轉折處兩筆疊在一起的寬度
RAD = 5                        # 圓角（小一點比較俐落）
LINE = 7                       # 疊在上面的色塊外圍的底色分隔線（一半在色塊外）
BG = '#FBF8F3'
COLS = ['#2C5596', '#F2C230', '#D63A3A', '#2F9E5B', '#F08C2E', '#23272F', '#EC6FA8', '#7E57C2']
GL = ['chart', 'money', 'factory', 'briefs', 'person', 'globe', 'tv', 'lab']
GLY = {
 'chart': '<rect x="3" y="12" width="4.6" height="9" rx="1.2"/><rect x="9.7" y="7" width="4.6" height="14" rx="1.2"/><rect x="16.4" y="3" width="4.6" height="18" rx="1.2"/>',
 'money': '<path d="M16.6 7.6c-.8-1.6-2.5-2.4-4.6-2.4-2.6 0-4.5 1.3-4.5 3.3 0 4.6 9.3 2.4 9.3 7.2 0 2.1-2 3.6-4.9 3.6-2.2 0-4-.9-4.8-2.7M12 2.4v19.2" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>',
 # 工廠：煙囪短、廠房大
 'factory': '<path d="M1 21.5V10.6l5.6 3.4v-3.4l5.6 3.4v-3.4l5.6 3.4V6.8h4.2v14.7z"/><rect x="3.6" y="16.4" width="3.2" height="3" fill="BG"/><rect x="9.2" y="16.4" width="3.2" height="3" fill="BG"/><rect x="14.8" y="16.4" width="3.2" height="3" fill="BG"/>',
 'person': '<circle cx="12" cy="7.3" r="4.6"/><path d="M3.3 21.2c0-4.8 3.9-8.3 8.7-8.3s8.7 3.5 8.7 8.3z"/>',
 # 男生三角褲：腰頭、兩側有寬度、前面 Y 字車線
 'briefs': '<rect x="1.6" y="4.6" width="20.8" height="3.2" rx=".8"/><path d="M1.6 8.6h20.8v3.6c-3.9 1-6.6 4.2-7.2 8.6H8C7.4 16.4 4.7 13.2 1.6 12.2z"/><path d="M8.6 8.6l3.4 4.2 3.4-4.2M12 12.8v4.6" fill="none" stroke="BG" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
 # 地球（上面有地圖）
 'globe': '<circle cx="12" cy="12" r="10.2"/><g fill="BG"><path d="M5.7 6.2c1.6-.9 3.6-.8 4.4.3.6.8-.3 1.7-1.1 2.2-.8.6-.4 1.6.5 2.2 1 .7.6 2-.4 2.5-.9.5-1 1.6-.6 2.7.3 1-.2 1.9-1.1 1.5C5.6 17 4.4 14.4 3.9 12.4c-.5-2 .2-5 1.8-6.2z"/><path d="M13.2 4.6c2-.4 4.3.3 5.8 1.8.8.9.4 1.9-.5 2-1.2.1-1.7 1-1.2 1.9.5 1.1 1.7 1.3 2.6 2.1.6.6.2 1.7-.5 2.4l-1.9 2c-.6.6-1.6.3-1.7-.6-.2-1.4-1.2-2.1-2.3-2.8-1-.6-1-1.9-.3-2.8.6-.8.1-1.7-.6-2.2-.9-.7-.7-1.8.6-1.8z"/></g><circle cx="12" cy="12" r="10.2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
 # 電視：天線、螢幕、旋鈕
 'tv': '<path d="M7.6 2.6 12 6.6l4.4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="1.4" y="6.8" width="21.2" height="13.4" rx="2"/><rect x="3.4" y="8.8" width="13.4" height="9.4" rx="1.4" fill="BG"/><circle cx="19.7" cy="11.2" r="1.1" fill="BG"/><circle cx="19.7" cy="15" r="1.1" fill="BG"/><path d="M5.5 20.2 4.6 22.2M18.5 20.2l.9 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
 'lab': '<path d="M8.6 2.6h6.8v2h-1.2v4.6l5.6 9.3a1.8 1.8 0 0 1-1.5 2.8H5.7a1.8 1.8 0 0 1-1.5-2.8l5.6-9.3V4.6H8.6z"/><path d="M7 15.2h10" stroke="BG" stroke-width="1.6" stroke-linecap="round"/>',
}
def para(cx, cy, a, b, t, sg, r):
    """斜的平行四邊形（上下邊水平），角稍微圓一點"""
    P = [(cx - a - sg * b * t, cy - b), (cx + a - sg * b * t, cy - b), (cx + a + sg * b * t, cy + b), (cx - a + sg * b * t, cy + b)]
    out = []
    for i in range(4):
        p0, p1, p2 = P[i - 1], P[i], P[(i + 1) % 4]
        def toward(p, q, d):
            L = math.hypot(q[0] - p[0], q[1] - p[1]); return (p[0] + (q[0] - p[0]) * d / L, p[1] + (q[1] - p[1]) * d / L)
        s1 = toward(p1, p0, r); s2 = toward(p1, p2, r)
        out.append(f"{'M' if i == 0 else 'L'}{s1[0]:.1f},{s1[1]:.1f} Q{p1[0]:.1f},{p1[1]:.1f} {s2[0]:.1f},{s2[1]:.1f}")
    return ' '.join(out) + 'Z'
def blocks():
    t = math.tan(math.radians(DEG)); a, b = W_ / 2, H_ / 2
    s = (H_ + CUT) * t; step = 2 * a + 2 * b * t - OV
    x1t = 0; x1b = s; x2b = x1b + step; x2t = x2b + s; x3t = x2t + step; x3b = x3t + s; x4b = x3b + step; x4t = x4b + s
    width = x4t + 2 * a + 2 * b * t
    off = (512 - width) / 2 + a + b * t
    yt = (512 - (2 * H_ + CUT)) / 2 + b; yb = yt + H_ + CUT
    pos = [(x1t, yt, 1), (x1b, yb, 1), (x2b, yb, -1), (x2t, yt, -1), (x3t, yt, 1), (x3b, yb, 1), (x4b, yb, -1), (x4t, yt, -1)]
    out = []
    for (cx, cy, sg), col, g in zip(pos, COLS, GL):
        cx += off
        ink = '#3d2e00' if col == '#F2C230' else '#fff'
        gs = W_ * 0.8; sc = gs / 24
        out.append(f'<path d="{para(cx, cy, a, b, t, sg, RAD)}" fill="{col}" stroke="{BG}" stroke-width="{LINE}" paint-order="stroke" stroke-linejoin="round"/>'
                   f'<g transform="translate({cx - gs / 2:.1f} {cy - gs / 2:.1f}) scale({sc:.4f})" fill="{ink}" color="{ink}">{GLY[g].replace("BG", col)}</g>')
    return ''.join(out)
def svg(scale=1.0, round_bg=False):
    body = blocks()
    if scale != 1: body = f'<g transform="translate(256 256) scale({scale}) translate(-256 -256)">{body}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="{112 if round_bg else 0}" fill="{BG}"/>{body}</svg>'
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

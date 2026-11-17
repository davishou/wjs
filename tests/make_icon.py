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
 # 工廠：煙囪短、廠房高（2026-11-17 第三版：整體加高、不加寬）
 'factory': '<path d="M1.2 22.6V7.4l5.6 3.4V7.4l5.6 3.4V7.4l5.6 3.4V3.6h4.2v19z"/><g fill="BG"><rect x="3.4" y="13.2" width="3" height="2.8"/><rect x="9" y="13.2" width="3" height="2.8"/><rect x="14.6" y="13.2" width="3" height="2.8"/><rect x="3.4" y="18" width="3" height="2.8"/><rect x="9" y="18" width="3" height="2.8"/><rect x="14.6" y="18" width="3" height="2.8"/></g>',
 'person': '<circle cx="12" cy="7.3" r="4.6"/><path d="M3.3 21.2c0-4.8 3.9-8.3 8.7-8.3s8.7 3.5 8.7 8.3z"/>',
 # 男生三角褲：腰頭、兩側有寬度（使用者說不要 Y 字車線）
 'briefs': '<rect x="1.6" y="4.6" width="20.8" height="3.2" rx=".8"/><path d="M1.6 8.6h20.8v3.6c-3.9 1-6.6 4.2-7.2 8.6H8C7.4 16.4 4.7 13.2 1.6 12.2z"/>',
 # 地球（上面有地圖）
 # 地球：上面有大陸（北美、格陵蘭、南美、歐洲、英國、非洲、阿拉伯、馬達加斯加）和淡淡的經緯線（2026-11-17 使用者要求畫精細一點）
 'globe': '<circle cx="12" cy="12" r="10.2"/><g fill="none" stroke="#dfe4ea" stroke-width=".35"><ellipse cx="12" cy="12" rx="4.6" ry="10.2"/><path d="M12 1.8v20.4M2.6 8h18.8M2.6 16h18.8M1.8 12h20.4"/></g><g fill="BG">'
   '<path d="M2.9 7.1C3.4 5.8 4.6 4.6 6.1 4c1.2-.4 2.5-.6 3.6-.4l.5.7-.8.3c-.4.3-1 .1-1.4.4-.4.3-.1.9.5.9.5.1.8-.3 1.3-.2l.8.5c-.2.6-.7 1-1.2 1.4-.4.4-.7.8-.6 1.4l-.2.7c-.3-.3-.4-.8-.8-.9-.6-.1-1 .2-1.2.7-.1.6.3 1.1.8 1.5l.4.7-.4.1c-.6-.4-1.2-.9-1.5-1.6-.3-.7-.9-1.2-1.6-1.5-.5-.3-1-.9-1.4-1.6z"/>'
   '<path d="M10.6 3.2c.8-.4 2-.4 2.6.1-.2.8-.9 1.3-1.6 1.5-.5-.5-.8-1-1-1.6z"/><ellipse cx="13.7" cy="5.1" rx=".45" ry=".28"/>'
   '<path d="M7.6 12.6c.7-.2 1.5.1 2.2.6.8.4 1.5.8 1.4 1.6-.2.8-.8 1.3-1.2 2-.4.8-.7 1.7-1.2 2.6-.4.7-.8 1.4-1.2 1.7-.1-.9-.1-1.9-.3-2.8-.2-1-.7-1.9-.9-2.9-.2-.9.4-2.5 1.2-2.8z"/>'
   '<path d="M14.2 8.3c-.2-.7.2-1.3.7-1.6 0-.7.5-1.5 1.1-2.1.5-.4 1.1-.3 1.2.2-.4.5-.6 1-.3 1.4.5-.2.9-.6 1.5-.5.8.2 1.6.7 2 1.3l-.8.6c-.6-.1-1 .3-1.4.5-.6-.3-1.2-.2-1.6.1-.3.4-.2.7-.6.8-.4-.4-.7-.7-1.2-.6z"/><path d="M14 5.9c.4-.3.7.1.6.6-.2.4-.6.3-.7-.1z"/>'
   '<path d="M14.1 10c.7-.6 1.7-.7 2.6-.5.7.1 1.3.1 1.8.5.5.6.8 1.3 1.5 1.6h.6c-.2.8-.8 1.4-1.3 2-.4.6-.3 1.4-.7 2.1-.4.9-1 1.7-1.6 2.4-.4.4-1 .3-1.2-.2-.3-.9-.2-1.9-.6-2.8-.3-.7-.5-1.5-1.2-2-.6-.4-1.1-1-1-1.7.1-.6.6-1 1.1-1.4z"/>'
   '<path d="M18.8 9.7c.7-.1 1.4.3 1.9.8.3.4.3.7-.1.9-.6-.3-1.2-.8-1.8-1.7z"/><ellipse cx="19.6" cy="16.6" rx=".33" ry=".95" transform="rotate(18 19.6 16.6)"/></g>'
   '<circle cx="12" cy="12" r="10.2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
 # 電視：天線、螢幕、旋鈕
 'tv': '<path d="M7.6 2.6 12 6.6l4.4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="1.4" y="6.8" width="21.2" height="13.4" rx="2"/><rect x="3.4" y="8.8" width="13.4" height="9.4" rx="1.4" fill="BG"/><circle cx="19.7" cy="11.2" r="1.1" fill="BG"/><circle cx="19.7" cy="15" r="1.1" fill="BG"/><path d="M5.5 20.2 4.6 22.2M18.5 20.2l.9 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
 # 燒瓶：裡面的水填深紫色，和瓶子之間留一圈白色空隙
 'lab': '<path d="M8.6 2.6h6.8v2h-1.2v4.6l5.6 9.3a1.8 1.8 0 0 1-1.5 2.8H5.7a1.8 1.8 0 0 1-1.5-2.8l5.6-9.3V4.6H8.6z"/><path d="M8.9 13.4h6.2l3.5 5.8a.8.8 0 0 1-.7 1.2H6.1a.8.8 0 0 1-.7-1.2z" fill="#4A2C8F"/>',
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

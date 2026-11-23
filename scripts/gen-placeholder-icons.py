"""Generates placeholder app + tray icons (a peach blob pet) with no dependencies.
Run once; then `pnpm --filter @deskpals/desktop tauri icon apps/desktop/src-tauri/icons/app-icon.png`."""
import struct, zlib, sys

def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def render(size, shade, ss=4):
    """shade(u, v) -> (r,g,b,a) or None, u,v in [0,1]. Supersampled."""
    px = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = shade((x + (sx + .5) / ss) / size, (y + (sy + .5) / ss) / size)
                    if c:
                        a = c[3] / 255
                        acc[0] += c[0] * a; acc[1] += c[1] * a; acc[2] += c[2] * a; acc[3] += a
            n = ss * ss
            i = (y * size + x) * 4
            if acc[3]:
                px[i:i + 4] = bytes([int(acc[0] / acc[3]), int(acc[1] / acc[3]), int(acc[2] / acc[3]), int(255 * acc[3] / n)])
    return px

def in_ellipse(u, v, cx, cy, rx, ry):
    return ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1

def blob(u, v):  # body: squashed ellipse
    return in_ellipse(u, v, .5, .56, .38, .33)

def eye(u, v):
    return in_ellipse(u, v, .38, .52, .045, .07) or in_ellipse(u, v, .62, .52, .045, .07)

def app_shade(u, v):
    if not blob(u, v):
        return None
    if eye(u, v):
        return (58, 40, 36, 255)
    if in_ellipse(u, v, .3, .64, .06, .035) or in_ellipse(u, v, .7, .64, .06, .035):
        return (240, 128, 120, 255)
    # simple top-light gradient
    t = (v - .23) / .66
    return (int(255 - 20 * t), int(178 - 30 * t), int(130 - 25 * t), 255)

def tray_shade(u, v):  # template icon: black silhouette, eyes cut out
    if blob(u, v) and not eye(u, v):
        return (0, 0, 0, 255)
    return None

out = sys.argv[1]
png(f'{out}/app-icon.png', 1024, 1024, render(1024, app_shade, ss=2))
png(f'{out}/tray.png', 44, 44, render(44, tray_shade))

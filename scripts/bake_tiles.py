#!/usr/bin/env python3
"""Bake Blockbound tile textures as 64x64 PNGs — rich Blockheads-style faces."""
import os, struct, zlib, math, random

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'tiles')
os.makedirs(OUT, exist_ok=True)
SIZE = 64

def clamp(v):
    return max(0, min(255, int(v)))

def mix(a, b, t):
    return tuple(clamp(a[i] + (b[i] - a[i]) * t) for i in range(3))

def noise2(x, y, seed=0):
    n = (x * 374761393 + y * 668265263 + seed * 1274126177) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return (n & 0xFFFF) / 65535.0

def fbm(x, y, seed, octaves=3):
    v, amp, freq = 0.0, 1.0, 1.0
    s = 0.0
    for _ in range(octaves):
        v += noise2(int(x * freq), int(y * freq), seed) * amp
        s += amp
        amp *= 0.5
        freq *= 2.0
    return v / s

def write_png(path, rgba, w, h):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b''.join(b'\x00' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)

def blank(a=255):
    return [0, 0, 0, a] * (SIZE * SIZE)

def setp(buf, x, y, rgb, a=255):
    if 0 <= x < SIZE and 0 <= y < SIZE:
        i = (y * SIZE + x) * 4
        buf[i:i+4] = [clamp(rgb[0]), clamp(rgb[1]), clamp(rgb[2]), a]

def getp(buf, x, y):
    i = (y * SIZE + x) * 4
    return buf[i:i+4]

def fill_noise(buf, base, var, seed, a=255):
    for y in range(SIZE):
        for x in range(SIZE):
            n = fbm(x * 0.35, y * 0.35, seed)
            t = (n - 0.5) * 2 * var
            c = (base[0] + t * 40, base[1] + t * 40, base[2] + t * 40)
            # slight vignette for 2.5D face depth
            edge = min(x, y, SIZE - 1 - x, SIZE - 1 - y) / 8.0
            shade = 0.88 + 0.12 * min(1.0, edge)
            # top-left light
            lit = 1.0 + 0.08 * (1 - x / SIZE) + 0.06 * (1 - y / SIZE)
            c = (c[0] * shade * lit, c[1] * shade * lit, c[2] * shade * lit)
            setp(buf, x, y, c, a)

def grass():
    buf = blank()
    # dirt body
    fill_noise(buf, (120, 78, 42), 0.35, 11)
    # grass top band
    for y in range(0, 18):
        for x in range(SIZE):
            n = fbm(x * 0.5, y * 0.8, 22)
            g = mix((70, 140, 48), (110, 190, 70), n)
            if y < 4:
                g = mix((90, 170, 55), (140, 210, 90), n)
            # blades
            if y < 14 and noise2(x, y, 30) > 0.55:
                g = mix(g, (60, 160, 50), 0.5)
            setp(buf, x, y, g)
    # blades sticking up into top edge
    for x in range(0, SIZE, 2):
        h = 3 + int(noise2(x, 0, 40) * 6)
        for dy in range(h):
            setp(buf, x, dy, (85 + (x % 5) * 5, 170 + dy * 3, 55))
            if x + 1 < SIZE:
                setp(buf, x + 1, dy, (75, 155, 48))
    # dirt flecks
    for _ in range(40):
        x, y = random.Random(50).randint(0, 63), random.Random(51).randint(20, 60)
        setp(buf, x, y, (90, 60, 30))
    return buf

def dirt():
    buf = blank()
    fill_noise(buf, (130, 85, 48), 0.4, 7)
    rng = random.Random(9)
    for _ in range(80):
        x, y = rng.randint(0, 63), rng.randint(0, 63)
        setp(buf, x, y, mix((100, 65, 35), (150, 100, 60), rng.random()))
    # pebbles
    for _ in range(12):
        cx, cy = rng.randint(4, 58), rng.randint(4, 58)
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                if dx*dx + dy*dy <= 4:
                    setp(buf, cx+dx, cy+dy, (90, 80, 70))
    return buf

def stone():
    buf = blank()
    fill_noise(buf, (120, 124, 132), 0.3, 3)
    rng = random.Random(3)
    # cracks
    for _ in range(8):
        x, y = rng.randint(0, 63), rng.randint(0, 63)
        for s in range(12):
            setp(buf, x, y, (70, 74, 82))
            x += rng.choice([-1, 0, 1])
            y += rng.choice([-1, 0, 1, 1])
    # lighter flecks
    for _ in range(50):
        setp(buf, rng.randint(0, 63), rng.randint(0, 63), (160, 164, 170))
    return buf

def sand():
    buf = blank()
    fill_noise(buf, (220, 200, 130), 0.25, 15)
    rng = random.Random(15)
    for y in range(SIZE):
        for x in range(SIZE):
            if (x + y * 2) % 7 == 0:
                c = getp(buf, x, y)
                setp(buf, x, y, (c[0] - 15, c[1] - 10, c[2] - 5))
    return buf

def wood():
    buf = blank()
    fill_noise(buf, (120, 78, 40), 0.2, 20)
    for y in range(SIZE):
        for x in range(SIZE):
            ring = abs(math.sin((x - 32) * 0.25 + noise2(x, y, 21) * 0.5))
            base = mix((90, 55, 28), (160, 110, 60), 0.4 + ring * 0.4)
            # vertical bark lines
            if x % 11 < 2:
                base = mix(base, (70, 45, 22), 0.45)
            setp(buf, x, y, base)
    # growth rings center-ish
    for y in range(SIZE):
        for x in range(SIZE):
            d = math.hypot(x - 20, y - 32)
            if int(d) % 6 == 0:
                c = getp(buf, x, y)
                setp(buf, x, y, (c[0] - 20, c[1] - 15, c[2] - 10))
    return buf

def leaves():
    buf = blank(0)
    rng = random.Random(33)
    for y in range(SIZE):
        for x in range(SIZE):
            n = fbm(x * 0.4, y * 0.4, 33)
            if n > 0.28:
                g = mix((40, 110, 45), (90, 180, 70), n)
                # holes for leafy look
                if noise2(x, y, 34) > 0.88:
                    continue
                a = 220 if n > 0.4 else 180
                setp(buf, x, y, g, a)
    # bright leaf accents
    for _ in range(30):
        x, y = rng.randint(0, 63), rng.randint(0, 63)
        if getp(buf, x, y)[3] > 0:
            setp(buf, x, y, (120, 200, 80), 230)
    return buf

def ore(base, spark):
    buf = stone()
    rng = random.Random(hash(spark) & 0xFFFF)
    for _ in range(28):
        cx, cy = rng.randint(4, 58), rng.randint(4, 58)
        for dy in range(-3, 4):
            for dx in range(-3, 4):
                if dx*dx + dy*dy <= 6 + rng.randint(0, 3):
                    t = rng.random()
                    c = mix(base, spark, 0.4 + t * 0.6)
                    setp(buf, cx+dx, cy+dy, c)
    # bright glints
    for _ in range(10):
        setp(buf, rng.randint(0, 63), rng.randint(0, 63), spark)
    return buf

def lava():
    buf = blank()
    for y in range(SIZE):
        for x in range(SIZE):
            n = fbm(x * 0.3, y * 0.3, 90)
            n2 = fbm(x * 0.6 + 10, y * 0.5, 91)
            t = 0.4 + 0.6 * n
            c = mix((180, 30, 0), (255, 200, 40), t * n2)
            if n2 > 0.7:
                c = mix(c, (255, 255, 180), 0.5)
            setp(buf, x, y, c)
    return buf

def bedrock():
    buf = blank()
    fill_noise(buf, (35, 35, 42), 0.2, 2)
    rng = random.Random(2)
    for _ in range(40):
        setp(buf, rng.randint(0, 63), rng.randint(0, 63), (15, 15, 20))
    return buf

def water():
    buf = blank(160)
    for y in range(SIZE):
        for x in range(SIZE):
            n = fbm(x * 0.25, y * 0.4, 60)
            c = mix((30, 100, 180), (80, 180, 230), n)
            # caustic lines
            if int(x + n * 8) % 9 == 0:
                c = mix(c, (200, 240, 255), 0.35)
            setp(buf, x, y, c, 150 + int(n * 50))
    return buf

def snow():
    buf = blank()
    fill_noise(buf, (235, 242, 250), 0.15, 70)
    rng = random.Random(70)
    for _ in range(40):
        setp(buf, rng.randint(0, 63), rng.randint(0, 63), (255, 255, 255))
    # soft blue shadow bottom
    for y in range(40, 64):
        for x in range(SIZE):
            c = getp(buf, x, y)
            setp(buf, x, y, mix(tuple(c[:3]), (180, 200, 230), (y - 40) / 40 * 0.3))
    return buf

def clay():
    buf = blank()
    fill_noise(buf, (170, 120, 100), 0.25, 44)
    return buf

def ladder():
    buf = blank(0)
    # rails
    for y in range(SIZE):
        setp(buf, 10, y, (160, 110, 55), 255)
        setp(buf, 11, y, (180, 130, 70), 255)
        setp(buf, 12, y, (140, 95, 45), 255)
        setp(buf, 51, y, (160, 110, 55), 255)
        setp(buf, 52, y, (180, 130, 70), 255)
        setp(buf, 53, y, (140, 95, 45), 255)
    # rungs
    for ry in (12, 28, 44, 56):
        for x in range(10, 54):
            setp(buf, x, ry, (190, 140, 75), 255)
            setp(buf, x, ry + 1, (150, 100, 50), 255)
    return buf

def torch():
    buf = blank(0)
    # stick
    for y in range(28, 60):
        for x in range(28, 36):
            setp(buf, x, y, (110, 70, 35), 255)
    # flame
    for y in range(8, 32):
        for x in range(20, 44):
            d = math.hypot(x - 32, y - 20)
            if d < 12 - (32 - y) * 0.15:
                t = 1 - d / 12
                c = mix((255, 80, 0), (255, 240, 120), t)
                setp(buf, x, y, c, 230)
    # glow core
    for y in range(14, 26):
        for x in range(26, 38):
            if math.hypot(x - 32, y - 18) < 5:
                setp(buf, x, y, (255, 255, 200), 255)
    return buf

def workbench():
    buf = blank()
    fill_noise(buf, (150, 100, 55), 0.2, 55)
    # top surface darker tools
    for y in range(0, 14):
        for x in range(SIZE):
            setp(buf, x, y, (100, 70, 40))
    # front drawer lines
    for y in (24, 40):
        for x in range(6, 58):
            setp(buf, x, y, (80, 55, 30))
    # legs shadow
    for y in range(50, 64):
        for x in range(SIZE):
            c = getp(buf, x, y)
            setp(buf, x, y, (c[0] * 0.7, c[1] * 0.7, c[2] * 0.7))
    return buf

def planks():
    buf = blank()
    for y in range(SIZE):
        for x in range(SIZE):
            board = (y // 16) % 2
            n = noise2(x, y, 80 + board)
            base = mix((180, 140, 80), (210, 170, 100), n)
            if x % 16 == 0:
                base = (120, 90, 50)
            if y % 16 == 0:
                base = mix(base, (100, 70, 40), 0.6)
            setp(buf, x, y, base)
    return buf

def glass():
    buf = blank(90)
    for y in range(SIZE):
        for x in range(SIZE):
            c = mix((160, 210, 240), (220, 240, 255), noise2(x, y, 99))
            # frame
            if x < 3 or x > 60 or y < 3 or y > 60:
                c = (200, 220, 235)
                a = 200
            else:
                a = 100
            # shine
            if 8 < x < 20 and 8 < y < 22:
                a = 160
                c = (255, 255, 255)
            setp(buf, x, y, c, a)
    return buf

def brick():
    buf = blank()
    colors = [(170, 70, 55), (150, 60, 48), (185, 85, 65)]
    for y in range(SIZE):
        row = y // 10
        off = (row % 2) * 16
        for x in range(SIZE):
            col = (x + off) // 16
            c = colors[(row + col) % 3]
            n = noise2(x, y, 12)
            c = mix(c, (100, 40, 30), n * 0.25)
            # mortar
            if y % 10 == 0 or (x + off) % 16 == 0:
                c = (200, 190, 175)
            setp(buf, x, y, c)
    return buf

def cube_iso(face_buf):
    """Compose a 2.5D cube preview icon from a face texture."""
    out = blank(0)
    # simple: just use face as icon with top band lighter
    for y in range(SIZE):
        for x in range(SIZE):
            c = getp(face_buf, x, y)
            if c[3] == 0:
                continue
            if y < 12:
                c = [clamp(c[0] * 1.15), clamp(c[1] * 1.15), clamp(c[2] * 1.15), c[3]]
            # right edge darker
            if x > 52:
                c = [clamp(c[0] * 0.75), clamp(c[1] * 0.75), clamp(c[2] * 0.75), c[3]]
            setp(out, x, y, c[:3], c[3])
    return out

TILES = {
    'grass': grass,
    'dirt': dirt,
    'stone': stone,
    'sand': sand,
    'wood': wood,
    'leaves': leaves,
    'coal': lambda: ore((40, 40, 40), (20, 20, 20)),
    'iron': lambda: ore((140, 120, 100), (220, 180, 140)),
    'gold': lambda: ore((160, 140, 60), (255, 220, 80)),
    'copper': lambda: ore((140, 100, 70), (230, 120, 60)),
    'lava': lava,
    'bedrock': bedrock,
    'water': water,
    'snow': snow,
    'clay': clay,
    'ladder': ladder,
    'torch': torch,
    'workbench': workbench,
    'planks': planks,
    'glass': glass,
    'brick': brick,
}

def main():
    random.seed(1)
    for name, fn in TILES.items():
        buf = fn()
        path = os.path.join(OUT, f'{name}.png')
        write_png(path, buf, SIZE, SIZE)
        print('wrote', path)
    # atlas strip for optional use
    names = list(TILES.keys())
    aw, ah = SIZE * len(names), SIZE
    atlas = [0] * (aw * ah * 4)
    for i, name in enumerate(names):
        buf = TILES[name]()
        for y in range(SIZE):
            for x in range(SIZE):
                src = (y * SIZE + x) * 4
                dst = (y * aw + i * SIZE + x) * 4
                atlas[dst:dst+4] = buf[src:src+4]
    write_png(os.path.join(OUT, 'atlas.png'), atlas, aw, ah)
    print('atlas', aw, 'x', ah)

if __name__ == '__main__':
    main()

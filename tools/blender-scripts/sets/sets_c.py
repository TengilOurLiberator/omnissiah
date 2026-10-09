# sets_c.py -- start-zone set pieces II: weapon-rack, spell-lectern, ruined-arch, jetty, camp-tent, camp-log-seat, camp-tripod

def _sword(B, x, y, z0, L=1.0):
    B.prism([(-0.05, 0.0), (0.05, 0.0), (0.05, L * 0.85), (0.0, L), (-0.05, L * 0.85)], 0.025, loc=(x, y, z0), rot=(rad(90), 0, 0), color=STEEL)
    B.box((0.3, 0.06, 0.05), loc=(x, y, z0 - 0.02), color=GOLD_D)
    B.cyl(0.03, 0.03, 0.22, seg=5, loc=(x, y, z0 - 0.14), color=LEATHER)
    B.sphere(0.05, loc=(x, y, z0 - 0.27), color=GOLD, seg=5, rings=3)

def model_weapon_rack():
    S = SetModel('weapon-rack')
    B = S.part('frame', supports=[])
    for sx in (-1, 1):
        B.lit(B.box((0.16, 0.16, 1.9), loc=(sx * 1.25, 0, 0.95), color=WOOD_D), 'brown', 4, 1.6)
        B.box((0.2, 0.2, 0.1), loc=(sx * 1.25, 0, 1.95), color=GOLD_D)
        B.lit(B.box((0.16, 0.9, 0.14), loc=(sx * 1.25, 0.0, 0.07), color=WOOD_D), 'brown', 4, 1.6)
        B.lit(B.box((0.12, 0.12, 0.9), loc=(sx * 1.25, 0.55, 0.45), rot=(rad(-25), 0, 0), color=WOOD_D), 'brown', 4, 1.6)
    for z in (0.55, 1.05, 1.6):
        B.lit(B.box((2.6, 0.12, 0.1), loc=(0, 0, z), color=WOOD), 'brown', 6, 1.6)
    B.lit(B.box((2.3, 0.06, 1.0), loc=(0, 0.1, 1.0), color=('brown', 3)), 'brown', 3, 1.2)
    W = S.part('weapons', supports=['frame'])
    for i, x in enumerate((-0.95, -0.6, -0.25)):
        _sword(W, x, -0.1, 1.15 + (0.0 if i != 1 else 0.05), L=0.95)
    W.cyl(0.03, 0.03, 2.3, seg=5, loc=(0.4, -0.1, 1.1), color=WOOD_L)
    W.prism([(-0.07, 0), (0.07, 0), (0, 0.32)], 0.03, loc=(0.4, -0.1, 2.28), rot=(rad(90), 0, 0), color=STEEL)
    W.cyl(0.035, 0.035, 1.0, seg=5, loc=(0.75, -0.1, 0.95), color=WOOD_L)
    W.prism([(0, 0), (0.28, 0.08), (0.34, -0.12), (0.28, -0.3), (0, -0.2)], 0.04, loc=(0.75, -0.1, 1.38), rot=(rad(90), 0, 0), color=STEEL_D)
    W.cyl(0.42, 0.42, 0.08, seg=12, loc=(1.0, -0.13, 0.9), rot=(rad(90), 0, 0), color=CLOTH_R)
    W.torus(0.42, 0.04, major=12, minor=4, loc=(1.0, -0.17, 0.9), rot=(rad(90), 0, 0), color=GOLD_D)
    W.cyl(0.12, 0.06, 0.1, seg=6, loc=(1.0, -0.2, 0.9), rot=(rad(90), 0, 0), color=GLOW, emissive=True)
    W.box((0.9, 0.1, 0.1), loc=(-0.3, -0.12, 0.62), color=STEEL_D)
    B.box((2.0, 0.03, 0.05), loc=(0, -0.07, 1.78), color=GLOW, emissive=True)
    S.ctr = (0, 0, 1.0); S.rad = 2.0
    return S
SETS['weapon-rack'] = model_weapon_rack

def model_spell_lectern():
    S = SetModel('spell-lectern'); rng = random.Random(2)
    B = S.part('stand', supports=[])
    B.lit(B.prism(circ_pts(0.62, 8, phase=rad(22.5)), 0.14, loc=(0, 0, 0.07), color=STONE_D), 'stone', 4, 2.0)
    f = B.poly_loft([(0.14, circ_pts(0.42, 8, phase=rad(22.5))), (1.0, circ_pts(0.28, 8, phase=rad(22.5)))], closed_ends=True, color=STONE); B.lit(f, 'stone', 7, 1.8)
    B.box((0.7, 0.7, 0.1), loc=(0, 0, 1.03), color=GOLD_D)
    circuit_face(B, (0, -0.3, 0.55), (0, 0, 1), (0, -1, 0), 0.3, 0.5, rng, segs=5, t=0.03)
    cog(B, 0.33, 0.06, teeth=8, loc=(0, -0.4, 0.3), rot=(rad(90), 0, 0), color=GOLD)
    T = S.part('book', supports=['stand'])
    T.lit(T.box((0.9, 0.62, 0.07), loc=(0, 0, 1.1), rot=(rad(28), 0, 0), color=STONE_L), 'stone', 9, 1.5)
    bk = Matrix.Translation((0, -0.02, 1.2)) @ Matrix.Rotation(rad(28), 4, 'X')
    for sx in (-1, 1):
        pg = bmesh.ops.create_cube(T.bm, size=1.0, matrix=bk @ Matrix.Translation((sx * 0.21, 0, 0)) @ Matrix.Diagonal((0.4, 0.5, 0.04, 1.0)))
        T.add(T._faces_of(pg['verts']), CLOTH_W)
        for k in range(4):
            gl = bmesh.ops.create_cube(T.bm, size=1.0, matrix=bk @ Matrix.Translation((sx * 0.21, -0.12 + 0.08 * k, 0.03)) @ Matrix.Diagonal((0.3 - 0.04 * k, 0.025, 0.012, 1.0)))
            T.add(T._faces_of(gl['verts']), GLOW, True)
    cv = bmesh.ops.create_cube(T.bm, size=1.0, matrix=bk @ Matrix.Translation((0, 0, -0.005)) @ Matrix.Diagonal((0.9, 0.54, 0.03, 1.0)))
    T.add(T._faces_of(cv['verts']), CLOTH_R)
    O = S.part('orb', supports=[])
    crystal(O, (0, -0.05, 1.62), 0.2, 0.13, color=GLOW_W, emissive=True, belly=0.3, base_k=1.0, tilt=(PI, 0))
    crystal(O, (0, -0.05, 1.62), 0.22, 0.13, color=GLOW, emissive=True, belly=0.3, base_k=1.0)
    O.torus(0.26, 0.015, major=14, minor=4, loc=(0, -0.05, 1.62), rot=(rad(60), 0, rad(20)), color=GOLD)
    O.torus(0.2, 0.012, major=12, minor=4, loc=(0, -0.05, 1.62), rot=(rad(-30), rad(40), 0), color=GOLD_D)
    S.ctr = (0, 0, 0.9); S.rad = 1.5
    return S
SETS['spell-lectern'] = model_spell_lectern

def model_ruined_arch():
    S = SetModel('ruined-arch'); rng = random.Random(6)
    Wd = 3.4; zs = 3.5; Ri = Wd / 2; Ro = Ri + 0.65; D = 1.15
    for side, nm, top in ((-1, 'pillar_L', 3.5), (1, 'pillar_R', 2.6)):
        B = S.part(nm, supports=[])
        x = side * (Ri + 0.65 / 2 + 0.1)
        B.lit(B.box((1.5, 1.5, 0.35), loc=(x, 0, 0.175), color=STONE_D), 'stone', 4, 2.0)
        f = B.poly_loft([(0.35, [(x + px, py) for px, py in circ_pts(0.62, 8, phase=rad(22.5))]), (top, [(x + px, py) for px, py in circ_pts(0.52, 8, phase=rad(22.5))])], closed_ends=True, color=STONE)
        wob(f, 0.05, rng)
        if side > 0: jag_top(f, top, 0.5, rng)
        B.lit(f, 'stone', 7, 1.8)
        B.box((1.05, 1.05, 0.14), loc=(x, 0, 1.5), color=GOLD_D)
        circuit_face(B, (x, -0.5, 2.0 if side < 0 else 1.2), (0, 0, 1), (0, -1, 0), 0.4, 0.9, rng, segs=6, t=0.04)
        if side < 0:
            B.lit(B.box((1.15, 1.15, 0.25), loc=(x, 0, top + 0.12), color=STONE_L), 'stone', 10, 1.6)
        else:
            rock(B, (x, 0, 0.12), 0.75, rng, color=MOSS, sq=(1, 1, 0.3), lit=('moss', 7))
    A = S.part('arch_L', supports=['pillar_L'])
    o, i = arch_poly(Ro, Ri, a0=85, a1=180, n=6, cx=0, cz=zs)
    f = A.annulus(o, i, D, rot=(rad(90), 0, 0), color=STONE_L, wall=STONE, closed=False); A.lit(f, 'stone', 10, 1.5)
    for k in range(1, 5):
        a = rad(85 + 95 * k / 5); r = (Ro + Ri) / 2
        A.box((0.09, 0.05, 0.3), loc=(r * math.cos(a), -D / 2, zs + r * math.sin(a)), rot=(0, -(a - rad(90)), 0), color=GLOW, emissive=True)
    A2 = S.part('arch_R', supports=['pillar_R'])
    o, i = arch_poly(Ro, Ri, a0=0, a1=26, n=2, cx=0, cz=zs - 0.9)
    f = A2.annulus(o, i, D, rot=(rad(90), 0, 0), color=STONE_L, wall=STONE, closed=False); A2.lit(f, 'stone', 10, 1.5)
    R = S.part('rubble', supports=[])
    for k in range(7):
        rock(R, (rng.uniform(-2.5, 2.8), rng.uniform(-2.2, -0.8), 0.18), rng.uniform(0.3, 0.6), rng, color=STONE_L if k % 2 else STONE, lit=('stone', 8))
    crystal(R, (0.2, -1.6, 0.05), 0.9, 0.22, color=GLOW, emissive=True, tilt=(0.5, 0.2), lit=('cyan', 10, 2.0))
    crystal(R, (0.55, -1.5, 0.05), 0.5, 0.15, color=GLOW2, emissive=True, tilt=(0.3, -0.4))
    S.ctr = (0, 0, 2.2); S.rad = 4.2
    return S
SETS['ruined-arch'] = model_ruined_arch

def model_jetty():
    S = SetModel('jetty'); rng = random.Random(3)
    L = 8.0; Wd = 1.7; Zd = 0.55   # deck runs toward -Y (glTF +Z, out over the water); origin at the shore end; Zd = deck height; piles go below y=0
    B = S.part('deck', supports=['piles'])
    n = 16
    for i in range(n):
        y = -0.1 - i * (L / n)
        B.lit(B.box((Wd, L / n - 0.04, 0.09), loc=(rng.uniform(-0.02, 0.02), y - L / n / 2, Zd), color=WOOD_L if i % 3 else WOOD), 'tan' if i % 3 else 'brown', 8 if i % 3 else 6, 1.0)
    for sx in (-1, 1):
        B.lit(B.box((0.14, L, 0.14), loc=(sx * (Wd / 2 - 0.2), -L / 2 - 0.1, Zd - 0.14), color=WOOD_D), 'brown', 4, 1.4)
    P = S.part('piles', supports=[])
    for i in range(0, 5):
        y = -0.4 - i * (L - 0.7) / 4
        for sx in (-1, 1):
            h = 2.0 + rng.uniform(0, 0.2)
            P.lit(P.cyl(0.11, 0.1, h, seg=6, loc=(sx * (Wd / 2 - 0.05), y, Zd + 0.4 - h / 2), color=WOOD_D), 'brown', 4, 1.4)
            P.box((0.18, 0.18, 0.06), loc=(sx * (Wd / 2 - 0.05), y, Zd + 0.4), color=IRON)
    E = S.part('end', supports=['piles'])
    for sx in (-1, 1):
        E.cyl(0.13, 0.12, 0.7, seg=6, loc=(sx * (Wd / 2 - 0.06), -L, Zd + 0.4), color=WOOD_D)
        E.sphere(0.13, loc=(sx * (Wd / 2 - 0.06), -L, Zd + 0.78), color=WOOD_D, seg=5, rings=3)
    E.cyl(0.04, 0.04, Wd - 0.2, seg=4, loc=(0, -L, Zd + 0.55), rot=(0, rad(90), 0), color=('tan', 5))
    E.cyl(0.05, 0.05, 1.9, seg=5, loc=(-Wd / 2 + 0.1, -L + 1.0, Zd + 1.0), color=IRON)
    E.box((0.3, 0.3, 0.3), loc=(-Wd / 2 + 0.1, -L + 1.0, Zd + 2.1), color=FIRE_Y, emissive=True)
    E.cyl(0.24, 0.0, 0.3, seg=4, loc=(-Wd / 2 + 0.1, -L + 1.0, Zd + 2.4), rot=(0, 0, rad(45)), color=GOLD_D)
    E.lit(E.box((Wd + 0.4, 0.8, 0.3), loc=(0, 0.3, 0.15), color=STONE), 'stone', 7, 1.6)
    S.ctr = (0, -4.0, 0.5); S.rad = 5.2; S.views = ((60, 22), (-120, 22))
    return S
SETS['jetty'] = model_jetty

def model_camp_tent():
    S = SetModel('camp-tent')
    B = S.part('tent', supports=[])
    Wd, Ln, H = 2.4, 2.8, 1.6
    f = B.prism([(-Wd / 2, 0), (Wd / 2, 0), (0, H)], Ln, loc=(0, 0, 0.0), rot=(rad(90), 0, 0), color=CLOTH_G, center=True)
    B.lit(f, 'teal', 7, 1.8)
    B.prism([(-Wd / 2 - 0.06, 0), (Wd / 2 + 0.06, 0), (0, H + 0.06)], 0.12, loc=(0, -Ln / 2, 0.0), rot=(rad(90), 0, 0), color=CLOTH_Y)
    B.prism([(-0.4, 0), (0.4, 0), (0, 1.1)], 0.14, loc=(0, -Ln / 2 - 0.02, 0.0), rot=(rad(90), 0, 0), color=DARK)
    B.cyl(0.04, 0.04, H + 0.35, seg=5, loc=(0, -Ln / 2 - 0.1, (H + 0.35) / 2), color=WOOD_L)
    B.cyl(0.04, 0.04, H + 0.35, seg=5, loc=(0, Ln / 2 + 0.1, (H + 0.35) / 2), color=WOOD_L)
    B.box((0.06, Ln + 0.5, 0.06), loc=(0, 0, H + 0.02), color=WOOD_L)
    for sx in (-1, 1):
        for y in (-Ln / 2 - 0.2, Ln / 2 + 0.2):
            B.cyl(0.03, 0.03, 0.5, seg=4, loc=(sx * (Wd / 2 + 0.35), y, 0.2), rot=(0, rad(sx * 40), 0), color=WOOD_L)
    B.lit(B.box((0.9, 1.5, 0.1), loc=(1.9, -0.2, 0.05), rot=(0, 0, rad(10)), color=CLOTH_R), 'crimson', 6, 1.0)
    B.sphere(0.2, loc=(2.0, 0.35, 0.18), color=('bone', 11), seg=6, rings=4)
    S.ctr = (0.3, 0, 1.0); S.rad = 2.8
    return S
SETS['camp-tent'] = model_camp_tent

def model_camp_log_seat():
    S = SetModel('camp-log-seat')
    B = S.part('seats', supports=[])
    for k, (x, y, yaw, L) in enumerate(((0, 0, 0, 1.7), (-1.8, 1.2, 0.9, 1.4), (1.7, 1.1, -0.9, 1.5))):
        f = B.cyl(0.26, 0.24, L, seg=7, loc=(x, y, 0.26), rot=(0, rad(90), yaw), color=BARK)
        B.lit(f, 'brown', 5, 1.4)
        for s in (-1, 1):
            B.cyl(0.2, 0.2, 0.04, seg=7, loc=(x + math.cos(yaw) * s * (L / 2 + 0.01), y + math.sin(yaw) * s * (L / 2 + 0.01), 0.26), rot=(0, rad(90), yaw), color=WOOD_L)
        B.box((0.2, 0.4, 0.12), loc=(x, y, 0.06), rot=(0, 0, yaw), color=WOOD_D)
    B.lit(B.box((0.55, 0.55, 0.1), loc=(-0.3, 2.2, 0.05), color=('tan', 6)), 'tan', 6, 1.0)
    S.ctr = (0, 0.8, 0.3); S.rad = 2.4
    return S
SETS['camp-log-seat'] = model_camp_log_seat

def model_camp_tripod():
    S = SetModel('camp-tripod')
    B = S.part('tripod', supports=[])
    top = 1.55
    for k in range(3):
        a = rad(90 + 120 * k)
        B.loft_path([(math.cos(a) * 0.75, math.sin(a) * 0.75, 0.0), (math.cos(a) * 0.08, math.sin(a) * 0.08, top)], [0.045, 0.045], n=5, color=IRON)
    B.cyl(0.12, 0.12, 0.16, seg=6, loc=(0, 0, top), color=GOLD_D)
    B.cyl(0.015, 0.015, 0.55, seg=4, loc=(0, 0, top - 0.3), color=IRON)
    P = S.part('pot', supports=['tripod'])
    P.lit(P.cyl(0.34, 0.26, 0.42, seg=10, loc=(0, 0, 0.74), color=('grey', 3)), 'grey', 3, 1.4)
    P.annulus(circ_pts(0.35, 10), circ_pts(0.29, 10), 0.05, loc=(0, 0, 0.96), color=('grey', 5))
    P.cyl(0.29, 0.29, 0.03, seg=10, loc=(0, 0, 0.93), color=FIRE, emissive=True)
    P.torus(0.36, 0.015, major=12, minor=3, loc=(0, 0, 1.15), rot=(rad(90), 0, 0), color=IRON)
    S.ctr = (0, 0, 0.8); S.rad = 1.5
    return S
SETS['camp-tripod'] = model_camp_tripod

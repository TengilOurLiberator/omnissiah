# sets_a.py -- gear-cathedral-gate, colossus-head, floating-shrine (+core, rings)
# Blender space: Z up, FRONT = -Y (-> glTF +Z), ground at z=0, centred on the origin. 1 unit = 1 m.

def _spire(B, x, y, z0, w, h, color=STONE_D, tip=GLOW, gold=GOLD):
    """4-sided stone spire with a gold collar and a glowing tip crystal"""
    f = B.poly_loft([(z0, [(w, w), (-w, w), (-w, -w), (w, -w)]), (z0 + h, [(0.05, 0.05), (-0.05, 0.05), (-0.05, -0.05), (0.05, -0.05)])],
                    closed_ends=True, loc=(x, y, 0), color=color)
    B.lit(f, 'stone', 5, 2.4)
    B.box((w * 2.15, w * 2.15, 0.18), loc=(x, y, z0 + 0.09), color=gold)
    crystal(B, (x, y, z0 + h - 0.15), 0.9, 0.16, color=tip, emissive=True)

def model_gear_cathedral_gate():
    S = SetModel('gear-cathedral-gate'); rng = random.Random(11)
    W = 4.0; zs = 3.8; T = 0.6                      # opening width, springing height, arch band thickness
    R_i = W; R_o = W + T                            # equilateral pointed arch: centres at (+-W/2, zs)
    th = math.degrees(math.acos((-W / 2) / R_o))    # outer arcs meet at x=0
    WALLX = 3.6; WALLTOP = 12.8; WD = 1.4; AD = 1.9
    # ---------------- arch bands (two halves, each rests on its jamb/pillar)
    for side, nm in ((-1, 'arch_L'), (1, 'arch_R')):
        B = S.part(nm, supports=['pillar_L' if side < 0 else 'pillar_R'])
        if side < 0:
            o, i = arch_poly(R_o, R_i, a0=th, a1=180, n=6, cx=W / 2, cz=zs)
            o.reverse(); i.reverse()
        else:
            o, i = arch_poly(R_o, R_i, a0=0, a1=180 - th, n=6, cx=-W / 2, cz=zs)
        faces = B.annulus(o, i, AD, rot=(rad(90), 0, 0), color=STONE_L, wall=STONE, closed=False)
        B.lit(faces, 'stone', 10, 1.6)
        # jamb below the springing line
        jx = side * (W / 2 + T / 2)
        B.lit(B.box((T, AD, zs), loc=(jx, 0, zs / 2), color=STONE_L), 'stone', 9, 1.6)
        # glowing rune ticks along the arch face
        for k in range(1, 6):
            a = rad((th + (180 - th) * k / 6) if side < 0 else (0 + (180 - th) * k / 6))
            cx = (W / 2) if side < 0 else (-W / 2)
            r = R_o - T * 0.5
            B.box((0.10, 0.06, 0.34), loc=(cx + r * math.cos(a), -AD / 2 - 0.0, zs + r * math.sin(a)), rot=(0, -(a - rad(90)) if side < 0 else -(a - rad(90)), 0), color=GLOW, emissive=True)
        for k in range(2):  # jamb glow strips
            B.box((0.10, 0.06, 0.9), loc=(jx, -AD / 2, 0.9 + k * 1.5), color=GLOW, emissive=True)
    # keystone medallion on the arch front
    B = S.part('keystone', supports=['arch_L', 'arch_R'])
    cog(B, 0.55, 0.28, teeth=10, loc=(0, -AD / 2 - 0.05, zs + math.sqrt(R_o ** 2 - (W / 2) ** 2) - 0.05), rot=(rad(90), 0, 0), color=GOLD, hole=0.0)
    B.cyl(0.2, 0.2, 0.34, seg=8, loc=(0, -AD / 2 - 0.08, zs + math.sqrt(R_o ** 2 - (W / 2) ** 2) - 0.05), rot=(rad(90), 0, 0), color=GLOW, emissive=True)
    # ---------------- spandrel walls (left / right half), up to the gable
    for side, nm in ((-1, 'wall_L'), (1, 'wall_R')):
        B = S.part(nm, supports=['pillar_L' if side < 0 else 'pillar_R'])
        o, _ = arch_poly(R_o, R_i, a0=th, a1=180, n=6, cx=W / 2, cz=zs)   # left outer arc, apex -> springing
        arcL = [(x, z) for x, z in reversed(o)]                            # springing -> apex (x from -(W/2+T) to 0)
        polyL = [(-WALLX, 0), (-(W / 2 + T), 0)] + arcL + [(0, WALLTOP), (-WALLX, WALLTOP)]
        poly = polyL if side < 0 else [(-x, z) for x, z in polyL]
        clean = []
        for p in poly:   # drop duplicated points
            if not clean or (abs(p[0] - clean[-1][0]) > 1e-4 or abs(p[1] - clean[-1][1]) > 1e-4): clean.append(p)
        f = B.prism(clean, WD, rot=(rad(90), 0, 0), color=STONE)
        B.lit(f, 'stone', 7, 1.8)
        B.box((WALLX, WD + 0.3, 0.35), loc=(side * WALLX / 2, 0, WALLTOP + 0.05), color=STONE_L)
    # gable crown between the pillars
    B = S.part('gable', supports=['wall_L', 'wall_R'])
    f = B.prism([(-WALLX, 0), (WALLX, 0), (0, 2.3)], WD + 0.1, loc=(0, 0, WALLTOP + 0.22), rot=(rad(90), 0, 0), color=STONE_L)
    B.lit(f, 'stone', 9, 1.8)
    B.prism([(-0.9, 0.0), (0.9, 0.0), (0, 1.4)], 0.12, loc=(0, -WD / 2 - 0.0, WALLTOP + 0.45), rot=(rad(90), 0, 0), color=GLOW, emissive=True)
    # ---------------- rose-window gear complex (front of the wall)
    gy = -WD / 2 - 0.2
    B = S.part('rose_gear', supports=['wall_L', 'wall_R'])
    cog(B, 2.15, 0.3, teeth=14, loc=(0, gy, 10.4), rot=(rad(90), 0, 0), color=GOLD, hole=1.5, wall=GOLD_D)
    B.annulus(circ_pts(1.42, 28), circ_pts(1.34, 28), 0.14, loc=(0, gy - 0.02, 10.4), rot=(rad(90), 0, 0), color=GLOW, emissive=True)
    cog(B, 0.95, 0.34, teeth=9, loc=(0, gy - 0.02, 10.4), rot=(rad(90), 0, 0), color=GOLD_D)
    B.cyl(0.4, 0.4, 0.42, seg=8, loc=(0, gy - 0.04, 10.4), rot=(rad(90), 0, 0), color=GLOW_W, emissive=True)
    for k in range(6):  # spokes
        a = rad(60 * k + 30)
        B.box((0.16, 0.18, 1.0), loc=(math.cos(a) * 1.0, gy, 10.4 + math.sin(a) * 1.0), rot=(0, rad(90) - a, 0) if False else (0, -(a - rad(90)), 0), color=GOLD_D)
    for side in (-1, 1):
        nm = 'gears_L' if side < 0 else 'gears_R'
        B = S.part(nm, supports=['wall_L' if side < 0 else 'wall_R'])
        cog(B, 1.05, 0.26, teeth=10, loc=(side * 2.62, gy + 0.05, 9.35), rot=(rad(90), 0, rad(18)), color=GOLD_D, hole=0.4, wall=GOLD_D)
        B.cyl(0.4, 0.4, 0.34, seg=8, loc=(side * 2.62, gy, 9.35), rot=(rad(90), 0, 0), color=GLOW, emissive=True)
        cog(B, 0.78, 0.22, teeth=8, loc=(side * 2.3, gy + 0.1, 11.9), rot=(rad(90), 0, rad(9)), color=GOLD)
        B.cyl(0.22, 0.22, 0.3, seg=6, loc=(side * 2.3, gy + 0.04, 11.9), rot=(rad(90), 0, 0), color=GLOW, emissive=True)
        cog(B, 0.55, 0.2, teeth=7, loc=(side * 2.9, gy + 0.15, 6.0), rot=(rad(90), 0, 0), color=GOLD_D)
        B.cyl(0.14, 0.14, 0.26, seg=6, loc=(side * 2.9, gy + 0.08, 6.0), rot=(rad(90), 0, 0), color=GLOW, emissive=True)
    # ---------------- pillars: tapering towers with spires, buttress fins, gold bands, glowing slits
    PW = 3.0; PD = 2.7; PX = WALLX + PW / 2
    for side, nm in ((-1, 'pillar_L'), (1, 'pillar_R')):
        B = S.part(nm, supports=[])
        x = side * PX
        B.lit(B.box((PW + 0.7, PD + 0.6, 0.9), loc=(x, 0, 0.45), color=STONE_D), 'stone', 4, 2.0)
        f = B.poly_loft([(0.9, [(PW / 2 + 0.15, PD / 2 + 0.1), (-PW / 2 - 0.15, PD / 2 + 0.1), (-PW / 2 - 0.15, -PD / 2 - 0.1), (PW / 2 + 0.15, -PD / 2 - 0.1)]),
                         (8.5, [(PW / 2 - 0.1, PD / 2 - 0.1), (-PW / 2 + 0.1, PD / 2 - 0.1), (-PW / 2 + 0.1, -PD / 2 + 0.1), (PW / 2 - 0.1, -PD / 2 + 0.1)]),
                         (11.4, [(PW / 2 - 0.35, PD / 2 - 0.3), (-PW / 2 + 0.35, PD / 2 - 0.3), (-PW / 2 + 0.35, -PD / 2 + 0.3), (PW / 2 - 0.35, -PD / 2 + 0.3)])],
                        closed_ends=True, loc=(x, 0, 0), color=STONE)
        B.lit(f, 'stone', 7, 1.8)
        # bands
        for z, w in ((3.0, 0.1), (6.4, 0.0), (9.6, -0.2)):
            B.box((PW - 0.05 + w * 0, PD + 0.05, 0.28), loc=(x, 0, z), color=GOLD_D)
        # corbel top + battlement-ish cap
        B.box((PW + 0.3, PD + 0.3, 0.4), loc=(x, 0, 11.6), color=STONE_L)
        _spire(B, x, 0, 11.8, 1.15, 3.9)
        for sx in (-1, 1):
            for sy in (-1, 1):
                B.box((0.4, 0.4, 0.5), loc=(x + sx * (PW / 2 - 0.1), sy * (PD / 2 - 0.1), 12.0), color=STONE_L)
                B.cyl(0.17, 0.0, 0.7, seg=4, loc=(x + sx * (PW / 2 - 0.1), sy * (PD / 2 - 0.1), 12.55), color=GOLD_D)
        # outward buttress fin
        B.lit(B.box((0.7, 1.2, 6.5), loc=(x + side * (PW / 2 + 0.55), 0, 3.5), color=STONE_D, taper=(0.4, 1.0)), 'stone', 5, 1.8)
        B.lit(B.box((0.7, 1.2, 0.4), loc=(x + side * (PW / 2 + 0.5), 0, 6.8), color=STONE_L), 'stone', 9, 1.8)
        # glowing window slits on the front face
        for z in (4.5, 7.6):
            B.box((0.42, 0.08, 1.7), loc=(x, -PD / 2 + 0.05, z), color=GLOW, emissive=True)
            B.box((0.62, 0.1, 0.12), loc=(x, -PD / 2 + 0.04, z + 0.95), color=GOLD)
        # a cog medallion
        cog(B, 0.7, 0.2, teeth=8, loc=(x, -PD / 2 - 0.08, 2.0), rot=(rad(90), 0, 0), color=GOLD)
        B.cyl(0.18, 0.18, 0.28, seg=6, loc=(x, -PD / 2 - 0.1, 2.0), rot=(rad(90), 0, 0), color=GLOW, emissive=True)
        # brass pipe run down the inner face
        for dy in (-0.7, 0.7):
            B.cyl(0.1, 0.1, 9.5, seg=5, loc=(side * (WALLX + 0.12), dy, 5.2), color=BRASS_D)
    # ---------------- floor sill + steps
    B = S.part('sill', supports=[])
    B.lit(B.box((W + 1.4, 3.4, 0.22), loc=(0, 0, 0.11), color=STONE_D), 'stone', 4, 2.0)
    B.lit(B.box((W + 0.4, 3.0, 0.1), loc=(0, 0, 0.27), color=STONE), 'stone', 7, 2.0)
    B.box((0.12, 3.0, 0.03), loc=(0, 0, 0.33), color=GLOW, emissive=True)
    S.notes = {'tile': False, 'opening': [W, zs + 0.866 * W], 'note': 'walk-through opening faces +Z (glTF), ~4 m wide'}
    S.ctr = (0, 0, 6.5); S.rad = 9.0
    return S
SETS['gear-cathedral-gate'] = model_gear_cathedral_gate


# =====================================================================================================================
def model_colossus_head():
    S = SetModel('colossus-head'); rng = random.Random(5)
    def ell(a, b, n=12, ph=0.0): return [(a * math.cos(ph + 2 * PI * i / n), b * math.sin(ph + 2 * PI * i / n)) for i in range(n)]
    # ---- skull (sections z: a = half width, b = half depth)
    B = S.part('head', supports=[])
    sk = [(-1.4, 2.9, 2.95), (-0.4, 3.05, 3.05), (1.5, 3.2, 3.15), (3.0, 2.8, 2.85), (4.1, 1.9, 1.95), (4.7, 0.9, 0.9)]
    f = B.poly_loft([(z, ell(a, b)) for z, a, b in sk], closed_ends=True, color=STONE_L)
    wob(f, 0.08, rng, keep_z0=False)
    B.lit(f, 'stone', 9, 1.7)
    # brow ridge, cheekbones
    B.lit(B.box((6.0, 1.1, 0.75), loc=(0, -2.85, 1.85), rot=(rad(-12), 0, 0), color=STONE), 'stone', 7, 1.5)
    for s in (-1, 1):
        B.lit(B.box((1.7, 1.0, 0.8), loc=(s * 2.0, -2.7, 0.0), rot=(rad(-6), 0, rad(s * 14)), color=STONE), 'stone', 8, 1.5)
        # eye sockets
        B.prism(circ_pts(0.88, 8), 0.4, loc=(s * 1.35, -2.85, 1.0), rot=(rad(90), 0, 0), color=DARK)
    # left eye lit, right eye a dead cog socket
    B.prism(circ_pts(0.58, 6), 0.3, loc=(-1.35, -3.0, 1.0), rot=(rad(90), 0, 0), color=GLOW, emissive=True)
    B.sphere(0.2, loc=(-1.35, -3.2, 1.0), color=GLOW_W, emissive=True, seg=5, rings=3)
    cog(B, 0.6, 0.22, teeth=8, loc=(1.35, -3.0, 1.0), rot=(rad(90), 0, 0), color=BRASS_D)
    # nose
    B.lit(B.box((1.05, 1.2, 2.6), loc=(0, -3.05, -0.1), taper=(0.55, 0.45), color=STONE), 'stone', 8, 1.6)
    # forehead gear-crown: glowing brow-gem + rune lines
    B.prism(circ_pts(0.42, 4), 0.3, loc=(0, -3.0, 3.0), rot=(rad(75), 0, rad(45)), color=GLOW, emissive=True)
    for s in (-1, 1):
        rune_strip(B, (s * 0.9, -2.55, 3.35), (s * 2.1, -2.25, 3.0), None, n=4, w=0.12, h=0.4, d=0.07, out=(0, -1, 0.2), seed=3 + s)
    # cracks\n    for p, r_, L in (((0.9, -3.1, 3.3), 25, 1.6), ((-1.8, -3.0, 2.7), -40, 1.2), ((2.1, -2.2, -0.2), 60, 1.0)):\n        B.box((0.09, 0.12, L), loc=p, rot=(0, rad(r_), rad(r_) * 0.3), color=DARK)\n    # moss on top, snapped chunk at the back
    for c, r in (((0.6, 0.2, 4.55), 0.9), ((-0.9, 0.8, 4.2), 0.7), ((1.4, -0.6, 4.25), 0.55)):
        rock(B, c, r, rng, color=MOSS, sq=(1, 1, 0.35), lit=('moss', 7))
    # ---- jaw (hinged, hangs open) ----
    J = S.part('jaw', supports=['head'])
    jw = [(-3.9, 0.9, 1.2), (-3.0, 1.9, 1.9), (-2.1, 2.6, 2.5), (-1.4, 2.85, 2.9)]
    f = J.poly_loft([(z, ell(a, b)) for z, a, b in jw], closed_ends=True, color=STONE)
    wob(f, 0.07, rng, keep_z0=False); J.lit(f, 'stone', 7, 1.7)
    J.lit(J.box((1.8, 1.0, 1.1), loc=(0, -2.1, -3.2), rot=(rad(-18), 0, 0), color=STONE_L), 'stone', 9, 1.5)  # chin
    for i in range(7):
        x = -1.5 + i * 0.5
        J.box((0.32, 0.4, 0.55 if i % 2 else 0.4), loc=(x, -2.55 + 0.3 * (1 - abs(x) / 2.0), -1.15), color=('bone', 12))
    J.box((3.4, 0.2, 0.18), loc=(0, -2.4, -1.45), color=GLOW, emissive=True)    # glowing mouth line
    jaw_m = Matrix.Translation((0, 2.2, -1.4)) @ Matrix.Rotation(rad(11), 4, 'X') @ Matrix.Translation((0, -2.2, 1.4))
    xf(J, jaw_m)
    # upper teeth belong to the head
    for i in range(7):
        x = -1.5 + i * 0.5
        B.box((0.32, 0.4, 0.5 if i % 2 == 0 else 0.35), loc=(x, -2.6 + 0.3 * (1 - abs(x) / 2.0), -1.15), color=('bone', 12))
    # ---- ear cogs ----
    for s, nm in ((-1, 'ear_L'), (1, 'ear_R')):
        E = S.part(nm, supports=['head'])
        cog(E, 1.7, 0.55, teeth=12, loc=(s * 3.35, 0.4, 0.5), rot=(0, rad(90), 0), color=GOLD_D if s < 0 else COPPER, hole=0.6, wall=GOLD_D)
        E.cyl(0.55, 0.55, 0.62, seg=8, loc=(s * 3.45, 0.4, 0.5), rot=(0, rad(90), 0), color=GLOW if s < 0 else DARK, emissive=(s < 0))
    # ---- broken gear halo behind the head ----
    H = S.part('halo', supports=['head'])
    teeth = 20; R = 7.2
    pts = gear_pts(R * 0.88, R, teeth)
    take = pts[:int(len(pts) * 0.62)]
    inner = [(p[0] * 0.72, p[1] * 0.72) for p in take]
    f = H.annulus(take, inner, 0.9, loc=(0, 3.2, 1.0), rot=(rad(90), 0, rad(20)), color=STONE, wall=STONE_D, closed=False)
    H.lit(f, 'stone', 6, 1.5)
    # ---- place: tilt up, yaw, sink into the ground ----
    M = Matrix.Translation((0, 0, 2.9)) @ Matrix.Rotation(rad(24), 4, 'Z') @ Matrix.Rotation(rad(-18), 4, 'X')
    for n in ('head', 'jaw', 'ear_L', 'ear_R'):
        xf(S.parts[n], M)
    xf(H, Matrix.Translation((0, 0, 1.6)) @ Matrix.Rotation(rad(24), 4, 'Z') @ Matrix.Rotation(rad(-8), 4, 'X'))
    for n in ('head', 'jaw', 'ear_L', 'ear_R', 'halo'): clip_below(S.parts[n], 0.0)
    # ---- rubble and moss at the foot ----
    R_ = S.part('rubble', supports=[])
    for i in range(9):
        a = rng.uniform(-1.2, 1.2) + (PI if i % 2 else 0) * 0 - PI / 2
        r = rng.uniform(5.0, 7.5)
        rock(R_, (math.cos(a) * r + 0.5, math.sin(a) * r * 0.8, 0.2), rng.uniform(0.4, 1.0), rng)
    for i in range(5):
        rock(R_, (rng.uniform(-6, 6), rng.uniform(-6, -2), 0.05), rng.uniform(0.6, 1.4), rng, color=MOSS, sq=(1, 1, 0.22), lit=('moss', 7), jit=0.2)
    S.ctr = (0, 0, 3.0); S.rad = 8.0
    return S
SETS['colossus-head'] = model_colossus_head


# =====================================================================================================================
def model_shrine(variant='full'):
    nm = {'full': 'floating-shrine', 'core': 'floating-shrine-core', 'rings': 'shrine-rings'}[variant]
    S = SetModel(nm); rng = random.Random(21)
    CZ = 6.9      # relic / ring centre height
    if variant != 'rings':
        # ---- floating island: faceted rock cone, grass top
        B = S.part('island', supports=[])
        n = 9
        def rg(r, ph=0.0, j=0.0): return [((r * (1 + rng.uniform(-j, j))) * math.cos(ph + 2 * PI * i / n), (r * (1 + rng.uniform(-j, j))) * math.sin(ph + 2 * PI * i / n)) for i in range(n)]
        secs = [(1.0, rg(0.35, 0.3, 0.2)), (2.2, rg(1.8, 0.0, 0.2)), (3.4, rg(3.3, 0.4, 0.15)), (4.6, rg(4.2, 0.1, 0.1)), (5.0, rg(4.35, 0.3, 0.05))]
        f = B.poly_loft(secs, closed_ends=False, color=STONE_D)
        B.lit(f, 'stone', 5, 2.4)
        B.faces_top = None
        top = B.prism(circ_pts(4.55, 9, phase=0.3), 0.3, loc=(0, 0, 5.12), color=GRASS)
        B.lit(top, 'green', 7, 1.6)
        B.add(bmesh.ops.create_cone(B.bm, cap_ends=True, cap_tris=False, segments=9, radius1=0.4, radius2=0.01, depth=0.1, matrix=Matrix.Translation((0, 0, 0.9)))['verts'] and [], STONE)
        # hanging crystals under the island + stalactite rocks
        crystal(B, (0.0, 0.0, 1.15), 1.0, 0.0001, color=GLOW, emissive=True, tilt=(PI, 0)) if False else None
        for a, r_, h in ((0.5, 1.2, 1.5), (2.6, 1.6, 1.8), (4.4, 1.3, 1.3), (5.6, 1.7, 1.6)):
            crystal(B, (math.cos(a) * r_, math.sin(a) * r_, 2.8 - h * 0.1), h, 0.28, color=GLOW, emissive=True, tilt=(PI + 0.2 * math.sin(a), 0.2 * math.cos(a)), lit=('cyan', 10, 2.0))
        # little stair slab and bushes
        B.lit(B.box((1.6, 1.6, 0.24), loc=(0, -3.4, 5.3), rot=(0, 0, 0), color=STONE_L), 'stone', 9, 1.6)
        B.lit(B.box((1.3, 1.0, 0.24), loc=(0, -4.1, 5.18), color=STONE), 'stone', 7, 1.6)
        for c, r in (((3.0, 1.8, 5.35), 0.55), ((-3.1, 1.6, 5.35), 0.6), ((2.0, -2.6, 5.3), 0.4), ((-2.4, -2.5, 5.3), 0.45)):
            rock(B, c, r, rng, color=LEAF, sq=(1, 1, 0.9), lit=('green', 8), sub=1, jit=0.18)
        # ---- the shrine ----
        T = S.part('shrine', supports=['island'])
        T.lit(T.prism(circ_pts(2.6, 8, phase=rad(22.5)), 0.36, loc=(0, 0, 5.48), color=STONE_L), 'stone', 9, 1.5)
        T.lit(T.prism(circ_pts(2.2, 8, phase=rad(22.5)), 0.3, loc=(0, 0, 5.8), color=STONE), 'stone', 7, 1.5)
        T.annulus(circ_pts(2.05, 32), circ_pts(1.9, 32), 0.04, loc=(0, 0, 5.97), color=GLOW, emissive=True)
        for k in range(6):
            a = rad(30 + 60 * k)
            x, y = math.cos(a) * 1.75, math.sin(a) * 1.75
            T.lit(T.cyl(0.3, 0.26, 2.5, seg=6, loc=(x, y, 7.2), color=STONE_L), 'stone', 10, 1.5)
            T.box((0.66, 0.66, 0.2), loc=(x, y, 5.99 + 0.0), color=GOLD_D)
            T.box((0.7, 0.7, 0.22), loc=(x, y, 8.35), color=GOLD)
            T.box((0.08, 0.08, 1.2), loc=(x * 1.02, y * 1.02, 7.1), color=GLOW, emissive=True)
        T.lit(T.prism(circ_pts(2.25, 6, phase=rad(0)), 0.5, loc=(0, 0, 8.7), color=STONE_L), 'stone', 9, 1.5)
        T.annulus(circ_pts(2.28, 36), circ_pts(2.2, 36), 0.1, loc=(0, 0, 8.95), color=GLOW, emissive=True)
        f = T.poly_loft([(8.95, circ_pts(2.6, 6)), (10.6, circ_pts(0.25, 6))], closed_ends=True, color=GOLD_D)
        T.lit(f, 'gold', 7, 2.2)
        T.cyl(0.14, 0.14, 0.7, seg=4, loc=(0, 0, 10.9), color=GOLD)
        crystal(T, (0, 0, 10.9), 0.9, 0.2, color=GLOW_W, emissive=True)
        # relic: floating glowing diamond with a small ring
        Rl = S.part('relic', supports=[])
        crystal(Rl, (0, 0, CZ - 0.55), 0.55, 0.42, color=GLOW, emissive=True, belly=0.3, base_k=1.0, tip=0.0)
        crystal(Rl, (0, 0, CZ + 0.55), 0.55, 0.42, color=GLOW_W, emissive=True, belly=0.3, base_k=1.0, tilt=(PI, 0))
        Rl.torus(0.62, 0.035, major=14, minor=4, loc=(0, 0, CZ), rot=(rad(25), 0, 0), color=GOLD)
    if variant != 'core':
        Rg = S.part('rings', supports=[])
        specs = ((3.7, rad(0), 0.0, GOLD), (4.4, rad(48), rad(30), GOLD_D), (5.1, rad(-34), rad(100), GOLD))
        for k, (R, tx, tz, col) in enumerate(specs):
            rot = (tx, 0, tz)
            M = Euler(rot, 'XYZ').to_matrix().to_4x4()
            c = Vector((0, 0, CZ if variant == 'full' else 0))
            Rg.torus(R, 0.10, major=28, minor=4, loc=c, rot=rot, color=col)
            for j in range(4):
                a = 2 * PI * j / 4 + k
                p = c + M @ Vector((math.cos(a) * R, math.sin(a) * R, 0))
                Rg.box((0.28, 0.28, 0.28), loc=p, rot=rot, color=GLOW, emissive=True)
            # three studs / mini gear
            a = 2 * PI * 0.37 + k * 1.7
            p = c + M @ Vector((math.cos(a) * R, math.sin(a) * R, 0))
            cog(Rg, 0.36, 0.1, teeth=8, loc=p, rot=(rot[0] + rad(90), rot[1], rot[2]), color=GOLD_L)
    S.ctr = (0, 0, 6.0 if variant != 'rings' else 0); S.rad = 8.0 if variant != 'rings' else 6
    if variant == 'rings': S.ctr = (0, 0, 0)
    return S
SETS['floating-shrine'] = lambda: model_shrine('full')
SETS['floating-shrine-core'] = lambda: model_shrine('core')
SETS['shrine-rings'] = lambda: model_shrine('rings')




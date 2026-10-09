# sets_b.py -- start-zone set pieces: pilgrim-altar, rune-obelisk-a/b/c, waystone
def _face_frame(ang_deg, apothem, slope):
    """outward direction (angle in the XY plane), apothem at z; slope = d(apothem)/dz (negative when tapering up). Returns (N, V)"""
    a = rad(ang_deg)
    d = Vector((math.cos(a), math.sin(a), 0))
    N = (d - Vector((0, 0, slope))).normalized()      # surface leans back as it rises
    V = (Vector((0, 0, 1)) - N * N.z).normalized()
    return d, N, V

def _faces_circuits(B, n, phi0, z0, z1, a0, a1, rng, hfrac=0.8, segs=7, skip=()):
    """circuit drawings on every face of a tapered n-gon shaft (apothem a0 at z0 -> a1 at z1)"""
    slope = (a1 - a0) / (z1 - z0)
    for k in range(n):
        if k in skip: continue
        ang = math.degrees(phi0) + 180.0 / n + 360.0 * k / n
        zc = (z0 + z1) / 2; ac = a0 + slope * (zc - z0)
        d, N, V = _face_frame(ang, ac, slope)
        wface = 2 * ac * math.tan(PI / n)
        circuit_face(B, d * ac + Vector((0, 0, zc)), V, N, wface * 0.62, (z1 - z0) * hfrac, rng, segs=segs, t=0.045)

def model_rune_obelisk(variant):
    S = SetModel('rune-obelisk-' + variant); rng = random.Random({'a': 3, 'b': 8, 'c': 13}[variant])
    if variant == 'a':
        B = S.part('base', supports=[])
        B.lit(B.box((2.8, 2.8, 0.34), loc=(0, 0, 0.17), color=STONE_D), 'stone', 4, 2.0)
        B.lit(B.box((2.1, 2.1, 0.3), loc=(0, 0, 0.49), color=STONE), 'stone', 7, 2.0)
        B.annulus([(1.02, 1.02), (-1.02, 1.02), (-1.02, -1.02), (1.02, -1.02)], [(0.82, 0.82), (-0.82, 0.82), (-0.82, -0.82), (0.82, -0.82)], 0.04, loc=(0, 0, 0.66), color=GLOW, emissive=True)
        for sx in (-1, 1):
            for sy in (-1, 1):
                B.box((0.3, 0.3, 0.5), loc=(sx * 1.25, sy * 1.25, 0.3), color=STONE_L)
        z0, z1, a0, a1 = 0.64, 5.4, 0.64, 0.36
        Sh = S.part('shaft', supports=['base'])
        r = lambda a: a * math.sqrt(2)
        f = Sh.poly_loft([(z0, circ_pts(r(a0), 4, phase=rad(45))), (z1, circ_pts(r(a1), 4, phase=rad(45)))], closed_ends=True, color=STONE)
        Sh.lit(f, 'stone', 7, 1.8)
        _faces_circuits(Sh, 4, rad(45), z0 + 0.5, z1 - 0.7, a0 - (0.5) * (a0 - a1) / (z1 - z0), a1 + 0.7 * (a0 - a1) / (z1 - z0), rng, hfrac=0.95)
        for z in (2.1, 3.5):   # gold collars
            a = a0 + (a1 - a0) * (z - z0) / (z1 - z0)
            Sh.box((2 * a + 0.1, 2 * a + 0.1, 0.12), loc=(0, 0, z), color=GOLD_D)
        f = Sh.poly_loft([(z1, circ_pts(r(a1), 4, phase=rad(45))), (z1 + 0.45, circ_pts(r(0.14), 4, phase=rad(45)))], closed_ends=True, color=STONE_L)
        Sh.lit(f, 'stone', 10, 1.8)
        C = S.part('cap', supports=['shaft'])
        crystal(C, (0, 0, 6.3), 0.7, 0.34, color=GLOW, emissive=True, belly=0.3, base_k=1.0, tilt=(PI, 0))
        crystal(C, (0, 0, 6.3), 0.8, 0.34, color=GLOW_W, emissive=True, belly=0.3, base_k=1.0)
        C.torus(0.62, 0.04, major=14, minor=4, loc=(0, 0, 6.3), rot=(rad(20), 0, 0), color=GOLD)
        S.ctr = (0, 0, 3.2); S.rad = 4.6
    elif variant == 'b':
        B = S.part('base', supports=[])
        f = B.prism(circ_pts(1.9, 6), 0.4, loc=(0, 0, 0.2), color=STONE_D); B.lit(f, 'stone', 4, 2.0)
        f = B.prism(circ_pts(1.5, 6), 0.3, loc=(0, 0, 0.55), color=STONE); B.lit(f, 'stone', 7, 2.0)
        B.annulus(circ_pts(1.37, 6), circ_pts(1.25, 6), 0.04, loc=(0, 0, 0.72), color=GLOW, emissive=True)
        tiers = [(0.7, 2.3, 0.78, 0.66), (2.5, 4.0, 0.68, 0.56), (4.2, 5.5, 0.58, 0.28)]
        for i, (z0, z1, a0, a1) in enumerate(tiers):
            nm = ['tier_1', 'tier_2', 'tier_3'][i]
            T = S.part(nm, supports=['base' if i == 0 else 'tier_%d' % i])
            R0 = a0 / math.cos(PI / 6); R1 = a1 / math.cos(PI / 6)
            f = T.poly_loft([(z0, circ_pts(R0, 6)), (z1, circ_pts(R1, 6))], closed_ends=True, color=STONE if i != 1 else STONE_L)
            T.lit(f, 'stone', 7 if i != 1 else 9, 1.8)
            _faces_circuits(T, 6, 0.0, z0 + 0.15, z1 - 0.15, a0 - 0.15 * (a0 - a1) / (z1 - z0), a1 + 0.15 * (a0 - a1) / (z1 - z0), rng, hfrac=0.9, segs=5, skip=(0, 1, 2) if False else ())
            T.annulus(circ_pts(R1 / 1.0 + 0.08, 6), circ_pts(R1 - 0.1, 6), 0.14, loc=(0, 0, z1 + 0.05), color=GOLD_D, wall=GOLD_D) if i < 2 else None
        Cp = S.part('cap', supports=['tier_3'])
        Cp.lit(Cp.prism(circ_pts(0.4, 6), 0.2, loc=(0, 0, 5.6), color=GOLD), 'gold', 8, 1.5)
        crystal(Cp, (0, 0, 5.7), 1.1, 0.32, color=GLOW, emissive=True, lit=('cyan', 10, 2.0))
        cog(Cp, 1.15, 0.12, teeth=12, loc=(0, 0, 5.2), rot=(0, 0, 0), color=GOLD, hole=0.85, wall=GOLD_D)
        cog(Cp, 0.7, 0.1, teeth=8, loc=(0, 0, 6.35), rot=(rad(14), rad(8), 0), color=GOLD_L, hole=0.5, wall=GOLD_D)
        S.ctr = (0, 0, 3.2); S.rad = 4.6
    else:  # c: snapped and leaning
        B = S.part('base', supports=[])
        B.lit(B.box((2.4, 2.4, 0.3), loc=(0, 0, 0.15), color=STONE_D), 'stone', 4, 2.0)
        B.lit(B.box((1.8, 1.8, 0.26), loc=(0, 0, 0.43), color=STONE), 'stone', 7, 2.0)
        for i in range(4): rock(B, (rng.uniform(-1.8, 1.8), rng.uniform(-2.6, -1.4), 0.1), rng.uniform(0.25, 0.5), rng)
        rock(B, (-1.4, -1.0, 0.1), 0.6, rng, color=MOSS, sq=(1, 1, 0.3), lit=('moss', 7))
        Sh = S.part('shaft_low', supports=['base'])
        z0, z1, a0, a1 = 0.56, 2.7, 0.62, 0.52
        r = lambda a: a * math.sqrt(2)
        f = Sh.poly_loft([(z0, circ_pts(r(a0), 4, phase=rad(45))), (z1, circ_pts(r(a1), 4, phase=rad(45)))], closed_ends=True, color=STONE)
        wob(f, 0.06, rng, keep_z0=True); jag_top(f, z1, 0.35, rng)
        Sh.lit(f, 'stone', 7, 1.8)
        _faces_circuits(Sh, 4, rad(45), z0 + 0.2, z1 - 0.6, a0, a1, rng, hfrac=0.9, segs=6, skip=(2,))
        crystal(Sh, (0.05, 0.0, 2.3), 1.3, 0.28, color=GLOW, emissive=True, tilt=(0.18, 0.12), lit=('cyan', 10, 2.0))
        crystal(Sh, (-0.25, 0.1, 2.25), 0.8, 0.2, color=GLOW2, emissive=True, tilt=(-0.3, -0.25))
        T = S.part('shaft_fallen', supports=['shaft_low'])
        f = T.poly_loft([(0.0, circ_pts(r(0.52), 4, phase=rad(45))), (2.6, circ_pts(r(0.36), 4, phase=rad(45))), (3.0, circ_pts(r(0.14), 4, phase=rad(45)))], closed_ends=True, color=STONE)
        T.lit(f, 'stone', 7, 1.8)
        _faces_circuits(T, 4, rad(45), 0.3, 2.3, 0.5, 0.38, rng, hfrac=0.9, segs=6, skip=())
        T.box((0.9, 0.9, 0.08), loc=(0, 0, 0.03), color=GLOW, emissive=True)     # exposed break face glows
        xf(T, Matrix.Translation((0.0, -2.35, 0.32)) @ Matrix.Rotation(rad(-44), 4, 'X'))
        S.ctr = (0, -0.4, 1.8); S.rad = 3.8
    return S
for _v in 'abc': SETS['rune-obelisk-' + _v] = (lambda v=_v: model_rune_obelisk(v))


# =====================================================================================================================
def model_pilgrim_altar():
    S = SetModel('pilgrim-altar'); rng = random.Random(4)
    D = S.part('dais', supports=[])
    D.lit(D.prism(circ_pts(3.1, 8, phase=rad(22.5)), 0.28, loc=(0, 0, 0.14), color=STONE_D), 'stone', 5, 2.0)
    D.lit(D.prism(circ_pts(2.6, 8, phase=rad(22.5)), 0.26, loc=(0, 0, 0.41), color=STONE), 'stone', 7, 2.0)
    D.annulus(circ_pts(2.45, 32), circ_pts(2.38, 32), 0.03, loc=(0, 0, 0.55), color=GLOW, emissive=True)
    cog(D, 1.55, 0.04, teeth=16, loc=(0, 0.2, 0.56), color=GOLD_D, hole=1.0, wall=GOLD_D)
    for k in range(8):   # rune dots around the step
        a = rad(22.5 + 45 * k + 22.5)
        D.box((0.16, 0.16, 0.04), loc=(math.cos(a) * 2.0, math.sin(a) * 2.0 + 0.0, 0.56), rot=(0, 0, a), color=GLOW, emissive=True)
    for sx in (-1, 1):   # kneeling cushions behind the altar (the pilgrim kneels on the +Y side, looking out over the altar)
        D.lit(D.box((0.8, 0.6, 0.12), loc=(sx * 0.65, 1.55, 0.6), color=CLOTH_R), 'crimson', 7, 1.4)
        D.box((0.84, 0.64, 0.04), loc=(sx * 0.65, 1.55, 0.54), color=GOLD)
    A = S.part('altar', supports=['dais'])
    A.lit(A.box((2.0, 0.9, 0.22), loc=(0, -0.45, 0.67), color=STONE_L), 'stone', 9, 1.6)
    A.lit(A.box((1.6, 0.7, 0.9), loc=(0, -0.45, 1.23), color=STONE), 'stone', 7, 1.8)
    A.lit(A.box((1.9, 0.85, 0.16), loc=(0, -0.45, 1.76), color=STONE_L), 'stone', 10, 1.6)
    A.box((1.5, 0.05, 0.1), loc=(0, -0.83, 1.05), color=GLOW, emissive=True)
    circuit_face(A, (0, -0.81, 1.25), (0, 0, 1), (0, -1, 0), 1.2, 0.45, rng, segs=6, t=0.04)
    A.cyl(0.38, 0.22, 0.2, seg=8, loc=(0, -0.45, 1.94), color=GOLD_D)               # offering bowl
    A.annulus(circ_pts(0.4, 16), circ_pts(0.3, 16), 0.04, loc=(0, -0.45, 2.04), color=GOLD, wall=GOLD)
    A.sphere(0.2, loc=(0, -0.45, 2.1), color=GLOW_W, emissive=True, seg=6, rings=4)
    # the ring frame: a standing gold ring that frames the sky in front of the altar
    Rg = S.part('ring_frame', supports=['dais'])
    for sx in (-1, 1):
        Rg.lit(Rg.box((0.36, 0.5, 1.6), loc=(sx * 1.05, -1.5, 0.98), color=STONE), 'stone', 7, 1.8)
        Rg.box((0.46, 0.6, 0.14), loc=(sx * 1.05, -1.5, 1.85), color=GOLD_D)
    Rg.torus(1.38, 0.09, major=24, minor=5, loc=(0, -1.5, 2.65), rot=(rad(90), 0, 0), color=GOLD)
    Rg.torus(1.2, 0.04, major=24, minor=4, loc=(0, -1.5, 2.65), rot=(rad(90), 0, 0), color=GLOW, emissive=True)
    for k in range(8):
        a = rad(45 * k + 22.5)
        cog(Rg, 0.16, 0.08, teeth=6, loc=(math.cos(a) * 1.38, -1.5, 2.65 + math.sin(a) * 1.38), rot=(rad(90), 0, 0), color=GOLD_L) if k % 2 == 0 else Rg.box((0.12, 0.12, 0.12), loc=(math.cos(a) * 1.38, -1.5, 2.65 + math.sin(a) * 1.38), color=GLOW, emissive=True)
    Rg.box((0.18, 0.18, 1.2), loc=(0, -1.5, 1.35), color=STONE_D)
    for sx in (-1, 1):   # lantern posts
        L = S.part('lantern_L' if sx < 0 else 'lantern_R', supports=['dais'])
        L.cyl(0.09, 0.07, 2.3, seg=5, loc=(sx * 2.15, 0.6, 1.7), color=IRON)
        L.lit(L.box((0.36, 0.36, 0.12), loc=(sx * 2.15, 0.6, 2.9), color=GOLD_D), 'gold', 6, 1.5)
        L.box((0.26, 0.26, 0.34), loc=(sx * 2.15, 0.6, 3.1), color=FIRE_Y, emissive=True)
        L.cyl(0.26, 0.0, 0.3, seg=4, loc=(sx * 2.15, 0.6, 3.42), rot=(0, 0, rad(45)), color=GOLD_D)
    S.ctr = (0, 0, 1.6); S.rad = 3.8
    return S
SETS['pilgrim-altar'] = model_pilgrim_altar


# =====================================================================================================================
def model_waystone():
    S = SetModel('waystone'); rng = random.Random(9)
    B = S.part('base', supports=[])
    B.lit(B.box((2.0, 1.1, 0.25), loc=(0, 0, 0.125), color=STONE_D), 'stone', 5, 2.0)
    B.lit(B.box((1.7, 0.9, 0.2), loc=(0, 0, 0.35), color=STONE), 'stone', 7, 2.0)
    Z = S.part('slab', supports=['base'])
    # standing stone: tapered slab with a chamfered top
    W0, W1, H = 1.4, 1.1, 2.9
    f = Z.poly_loft([(0.45, [(W0 / 2, 0.3), (-W0 / 2, 0.3), (-W0 / 2, -0.3), (W0 / 2, -0.3)]), (H - 0.45, [(W1 / 2, 0.24), (-W1 / 2, 0.24), (-W1 / 2, -0.24), (W1 / 2, -0.24)]),
                      (H, [(W1 / 2 - 0.2, 0.2), (-W1 / 2 + 0.2, 0.2), (-W1 / 2 + 0.2, -0.16), (W1 / 2 - 0.2, -0.16)])], closed_ends=True, color=STONE)
    Z.lit(f, 'stone', 8, 1.8)
    # BLANK TEXT PANEL: flat dark plaque on the front face, exactly 1.0 x 1.3, centre (0, -0.318, 1.55) (glTF: x=0, y=1.55, z=+0.318), faces +Z
    Z.box((1.0, 0.05, 1.3), loc=(0, -0.285, 1.55), color=('slate', 3))
    Z.box((1.12, 0.03, 0.06), loc=(0, -0.3, 2.25), color=GOLD_D); Z.box((1.12, 0.03, 0.06), loc=(0, -0.3, 0.85), color=GOLD_D)
    for sx in (-1, 1):
        Z.box((0.06, 0.03, 1.46), loc=(sx * 0.55, -0.3, 1.55), color=GOLD_D)
    # glowing glyph column on the side faces + top beacon
    Z.box((0.05, 0.62, 0.8), loc=(0.55, 0.0, 1.5), color=GLOW, emissive=True)
    Z.box((0.05, 0.62, 0.8), loc=(-0.55, 0.0, 1.5), color=GLOW, emissive=True)
    crystal(Z, (0, 0, H), 0.55, 0.2, color=GLOW, emissive=True)
    cog(Z, 0.28, 0.1, teeth=8, loc=(0, -0.33, 0.95 + 0.0), rot=(rad(90), 0, 0), color=GOLD_D) if False else None
    # two direction arms (blank) on a post to the side
    P = S.part('arms', supports=['base'])
    P.lit(P.box((0.22, 0.22, 2.0), loc=(1.35, 0.1, 1.0), color=WOOD_D), 'brown', 4, 1.6)
    for i, (z, yaw, L) in enumerate(((1.75, rad(-14), 1.2), (1.3, rad(11), 1.0))):
        arm = P.prism([(-L / 2, -0.14), (L / 2 - 0.2, -0.14), (L / 2 + 0.15, 0.0), (L / 2 - 0.2, 0.14), (-L / 2, 0.14)], 0.08, loc=(1.35 + (0.35 if i == 0 else -0.35) * 0 + (0.55 if i == 0 else -0.55), 0.0, z), rot=(0, 0, yaw + (0 if i == 0 else PI)), color=WOOD_L)
        P.box((0.1, 0.1, 0.3), loc=(1.35, 0.0, z), color=GOLD_D)
    P.cyl(0.14, 0.14, 0.12, seg=6, loc=(1.35, 0.1, 2.05), color=GOLD)
    crystal(P, (1.35, 0.1, 2.08), 0.4, 0.12, color=GLOW, emissive=True)
    S.notes = {'textPlane': {'center': [0, 1.55, 0.318], 'size': [1.0, 1.3], 'facing': '+z'}}
    S.ctr = (0.3, 0, 1.5); S.rad = 2.6
    return S
SETS['waystone'] = model_waystone


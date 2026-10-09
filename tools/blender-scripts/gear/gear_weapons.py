# gear_weapons.py -- hand items. Grip at the origin, business end along +Y (glTF -Z), up = +Z (glTF +Y). Real metres, recommended scale 1.

@register('cog-greatsword')
def cog_greatsword():
    B = Builder('cog-greatsword')
    grip_wrap(B, -0.20, 0.12, 0.032)
    cog(B, 0.075, 0.05, teeth=6, loc=(0, -0.235, 0), rot=(PI / 2, 0, 0), color=GOLD)                  # pommel cog
    B.sphere(0.03, loc=(0, -0.27, 0), color=GLOW, emissive=True, seg=6, rings=4)
    cog(B, 0.16, 0.045, teeth=8, loc=(0, 0.15, 0), rot=(PI / 2, 0, 0), color=GOLD, ratio=0.8)         # cog crossguard
    B.cyl(0.055, 0.055, 0.06, seg=8, loc=(0, 0.15, 0), rot=(PI / 2, 0, 0), color=GLOW, emissive=True)
    blade(B, 0.085, 0.018, 0.17, 1.32, 0.22, ('slate', 7), lit=('slate', 7))
    for sx in (1, -1):                                                                                 # gear-teeth along both edges
        for i in range(7):
            y = 0.32 + i * 0.125
            flat_poly(B, [(-0.02, -0.03), (0.07, -0.02), (0.07, 0.02), (-0.02, 0.03)], 0.034, loc=(sx * 0.075, y, 0), rot=(0, 0, 0 if sx > 0 else PI), color=GOLD if i % 2 == 0 else GOLD_D)
    B.loft_path([(0, 0.24, 0.016), (0, 0.95, 0.016), (0, 1.08, 0.016)], [(0.016, 0.008), (0.016, 0.008), 0.0], n=4, color=GLOW, emissive=True, ref=(0, 0, 1))
    return B.finish()

@register('lightning-spear')
def lightning_spear():
    B = Builder('lightning-spear')
    cylY(B, 0.028, 0.028, -0.45, 1.15, seg=6, color=WOOD)
    for y in (-0.2, 0.05, 0.3):
        cylY(B, 0.04, 0.04, y - 0.018, y + 0.018, seg=6, color=GOLD_D)
    cylY(B, 0.0, 0.04, -0.6, -0.45, seg=6, color=GOLD)                                                  # butt spike
    cylY(B, 0.04, 0.06, 1.06, 1.2, seg=6, color=GOLD)                                                    # socket
    blade(B, 0.085, 0.02, 1.18, 1.72, 0.26, STEEL_L, lit=('slate', 11))
    B.loft_path([(0, 1.24, 0.02), (0, 1.58, 0.02), (0, 1.68, 0.02)], [(0.016, 0.008), (0.016, 0.008), 0.0], n=4, color=GLOW, emissive=True, ref=(0, 0, 1))
    for sx in (1, -1):                                                                                   # twin lightning prongs
        pts = [(sx * 0.06, 1.12), (sx * 0.2, 1.25), (sx * 0.11, 1.32), (sx * 0.25, 1.48), (sx * 0.16, 1.52), (sx * 0.26, 1.7)]
        zig(B, pts, 0.026, 0.04, color=GLOW, emissive=True)
    B.ico(0.045, loc=(0, 1.12, 0), sub=1, color=GLOW, emissive=True)
    return B.finish()

@register('censer-flail')
def censer_flail():
    B = Builder('censer-flail')
    grip_wrap(B, -0.18, 0.22, 0.03)
    cog(B, 0.075, 0.04, teeth=5, loc=(0, 0.245, 0), rot=(PI / 2, 0, 0), color=GOLD)
    B.sphere(0.04, loc=(0, -0.21, 0), seg=6, rings=4, color=GOLD)
    B.torus(0.04, 0.012, major=6, minor=3, loc=(0, 0.30, 0), rot=(0, PI / 2, 0), color=GOLD_D)
    n = 8
    for i in range(n):                                                                                  # chain
        t = (i + 0.5) / n
        B.box((0.04, 0.08, 0.016) if i % 2 == 0 else (0.016, 0.08, 0.04), loc=(0, 0.33 + t * 0.58, -0.16 * t * t), rot=(-0.3 * t, 0, 0), color=STEEL_D)
    cy, cz = 1.1, -0.17                                                                                 # the censer ball
    B.ico(0.14, loc=(0, cy, cz), sub=1, color=GOLD_D)
    B.torus(0.145, 0.018, major=10, minor=3, loc=(0, cy, cz), rot=(PI / 2, 0, 0), color=GOLD)
    B.torus(0.04, 0.012, major=6, minor=3, loc=(0, cy - 0.16, cz + 0.01), rot=(0, PI / 2, 0), color=GOLD_D)
    for k in range(4):                                                                                  # glowing ember vents
        a = rad(90 * k + 45)
        B.box((0.07, 0.05, 0.035), loc=(math.cos(a) * 0.125, cy + 0.03, cz + math.sin(a) * 0.125), rot=(0, 0, a), color=FIRE, emissive=True)
    for loc, rot in (((0, cy + 0.17, cz), (-PI / 2, 0, 0)), ((0, cy, cz + 0.17), (0, 0, 0)), ((0, cy, cz - 0.17), (PI, 0, 0)), ((0.17, cy, cz), (0, PI / 2, 0)), ((-0.17, cy, cz), (0, -PI / 2, 0))):
        B.cyl(0.04, 0.0, 0.12, seg=5, loc=loc, rot=rot, color=GOLD)                                       # spikes
    B.ico(0.05, loc=(0, cy + 0.0, cz - 0.15), sub=0, color=FIRE, emissive=True)                          # smouldering coal at the bottom
    return B.finish()

@register('rune-hammer')
def rune_hammer():
    B = Builder('rune-hammer')
    cylY(B, 0.032, 0.032, -0.32, 0.78, seg=6, color=WOOD)
    for y in (-0.22, -0.05, 0.12):
        cylY(B, 0.045, 0.045, y - 0.02, y + 0.02, seg=6, color=GOLD_D)
    B.sphere(0.055, loc=(0, -0.35, 0), seg=6, rings=4, color=GOLD)
    cy = 0.9
    f = B.box((0.56, 0.30, 0.26), loc=(0, cy, 0), color=STONE_D)                                         # the stone head
    B.lit(f, 'stone', 6, 2.0)
    f = B.box((0.46, 0.34, 0.20), loc=(0, cy, 0), color=STONE)
    B.lit(f, 'stone', 7, 2.0)
    for sx in (1, -1):                                                                                   # brass end-caps with glowing rune rings
        B.box((0.06, 0.34, 0.30), loc=(sx * 0.31, cy, 0), color=GOLD_D)
        B.annulus(circ_pts(0.115, 8), circ_pts(0.075, 8), 0.03, loc=(sx * 0.345, cy, 0), rot=(0, PI / 2, 0), color=GLOW, emissive=True)
        B.cyl(0.03, 0.03, 0.032, seg=4, loc=(sx * 0.345, cy, 0), rot=(0, PI / 2, 0), color=GLOW, emissive=True)
    for z in (1, -1):                                                                                    # runes on the broad faces
        for i, x in enumerate((-0.14, 0.0, 0.14)):
            B.box((0.05, 0.16 - 0.03 * (i % 2), 0.02), loc=(x, cy, z * 0.115), color=GLOW, emissive=True) if False else None
            B.box((0.05, 0.14 - 0.04 * (i % 2), 0.02), loc=(x, cy, z * 0.105), color=GLOW, emissive=True)
    cog(B, 0.1, 0.05, teeth=6, loc=(0, cy, 0.17), color=GOLD, rot=(0, 0, 0))
    B.box((0.12, 0.12, 0.05), loc=(0, cy, -0.16), color=GOLD_D)
    return B.finish()

@register('clockwork-crossbow')
def clockwork_crossbow():
    B = Builder('clockwork-crossbow')
    B.box((0.06, 0.78, 0.07), loc=(0, 0.12, 0.05), color=WOOD)                                           # tiller
    B.box((0.075, 0.30, 0.09), loc=(0, -0.2, 0.05), color=('brown', 4))                                  # butt stock
    B.box((0.065, 0.12, 0.16), loc=(0, 0.0, -0.06), rot=(-0.25, 0, 0), color=LEATHER)                    # pistol grip
    B.box((0.012, 0.6, 0.02), loc=(0, 0.2, 0.1), color=STEEL_D)                                          # bolt rail
    B.box((0.09, 0.14, 0.04), loc=(0, 0.1, 0.095), color=GOLD_D)
    # prod (bow limbs) with a clockwork curve
    for sx in (1, -1):
        pts = [(sx * 0.03, 0.52, 0.06), (sx * 0.2, 0.5, 0.06), (sx * 0.34, 0.44, 0.06), (sx * 0.44, 0.34, 0.06)]
        B.loft_path(pts, [(0.035, 0.02), (0.03, 0.02), (0.026, 0.018), (0.016, 0.012)], n=4, color=STEEL, ref=(0, 0, 1), lit_spec=('slate', 9, 1.5))
        B.box((0.012, 0.012, 0.012), loc=(sx * 0.44, 0.34, 0.06), color=GOLD)
    B.box((0.88, 0.012, 0.012), loc=(0, 0.3, 0.06), color=BONE)                                          # string (drawn back)
    B.box((0.12, 0.08, 0.05), loc=(0, 0.53, 0.06), color=GOLD_D)
    B.sphere(0.04, loc=(0, 0.3, 0.07), seg=6, rings=4, color=GOLD)
    # clockwork: spring drum + two cogs on the right, crank on the left
    cylX(B, 0.09, 0.09, 0.04, 0.12, seg=10, y=0.0, z=0.12, color=BRASS)
    cog(B, 0.085, 0.03, teeth=6, loc=(0.1, 0.0, 0.12), rot=(0, PI / 2, 0), color=GOLD)
    cylX(B, 0.04, 0.04, 0.08, 0.135, seg=6, y=0.0, z=0.12, color=GLOW, emissive=True)
    cog(B, 0.055, 0.025, teeth=5, loc=(0.075, 0.13, 0.12), rot=(0, PI / 2, 0), color=GOLD_D)
    cylX(B, 0.012, 0.012, -0.18, -0.04, seg=5, y=0.0, z=0.12, color=STEEL_D)
    B.box((0.02, 0.1, 0.02), loc=(-0.18, 0.04, 0.12), color=GOLD)
    B.sphere(0.025, loc=(-0.18, 0.09, 0.12), seg=5, rings=3, color=GLOW, emissive=True)
    # bolt magazine on top
    B.box((0.06, 0.2, 0.05), loc=(0, 0.3, 0.17), color=BRASS_D)
    B.box((0.045, 0.16, 0.012), loc=(0, 0.3, 0.2), color=GLOW, emissive=True)
    return B.finish()

@register('plasma-blunderbuss')
def plasma_blunderbuss():
    B = Builder('plasma-blunderbuss')
    B.box((0.07, 0.2, 0.17), loc=(0, -0.02, -0.07), rot=(-0.3, 0, 0), color=LEATHER)                       # grip
    B.box((0.1, 0.07, 0.05), loc=(0, 0.1, -0.08), color=GOLD_D)
    B.box((0.09, 0.32, 0.13), loc=(0, 0.12, 0.06), color=BRASS)                                          # receiver
    B.box((0.08, 0.34, 0.1), loc=(0, -0.28, 0.0), rot=(0.08, 0, 0), color=WOOD)                          # short stock
    B.box((0.1, 0.05, 0.14), loc=(0, -0.46, -0.01), color=GOLD_D)
    B.torus(0.075, 0.014, major=8, minor=3, loc=(0, 0.1, -0.07), rot=(0, PI / 2, 0), color=GOLD_D)         # trigger guard
    cylY(B, 0.045, 0.05, 0.28, 0.55, seg=8, z=0.07, color=BRASS)                                         # barrel
    cylY(B, 0.05, 0.15, 0.55, 0.78, seg=8, z=0.07, color=GOLD)                                           # flared muzzle
    cylY(B, 0.12, 0.12, 0.77, 0.79, seg=8, z=0.07, color=GLOW, emissive=True)                           # plasma in the bell
    for i, y in enumerate((0.32, 0.4, 0.48)):
        B.torus(0.07, 0.015, major=8, minor=3, loc=(0, y, 0.07), rot=(PI / 2, 0, 0), color=GOLD_D)         # coil rings
    cylY(B, 0.055, 0.055, 0.04, 0.24, seg=8, z=0.2, color=GLOW, emissive=True)                           # plasma flask on top
    cylY(B, 0.065, 0.065, 0.03, 0.05, seg=8, z=0.2, color=GOLD)
    cylY(B, 0.065, 0.065, 0.23, 0.25, seg=8, z=0.2, color=GOLD)
    cog(B, 0.08, 0.03, teeth=6, loc=(0.065, 0.15, 0.08), rot=(0, PI / 2, 0), color=GOLD)
    return B.finish()

@register('fractal-staff')
def fractal_staff():
    B = Builder('fractal-staff')
    cylY(B, 0.03, 0.03, -0.55, 1.1, seg=6, color=WOOD)
    for y in (-0.4, -0.1, 0.2):
        cylY(B, 0.042, 0.042, y - 0.02, y + 0.02, seg=6, color=GOLD_D)
    cylY(B, 0.0, 0.035, -0.68, -0.55, seg=6, color=GOLD)
    cog(B, 0.075, 0.035, teeth=6, loc=(0, 1.12, 0), rot=(PI / 2, 0, 0), color=GOLD)
    cy = 1.4
    for k in range(3):                                                                                   # gimbal rings
        B.torus(0.19 + 0.0 * k, 0.012, major=12, minor=3, loc=(0, cy, 0), rot=((0, 0, 0), (PI / 2, 0, 0), (0, PI / 2, PI / 4))[k], color=GOLD)
    for k in range(4):                                                                                   # prongs holding the rings
        a = rad(90 * k + 45)
        B.loft_path([(0.03 * math.cos(a), 1.15, 0.03 * math.sin(a)), (0.1 * math.cos(a), 1.25, 0.1 * math.sin(a)), (0.17 * math.cos(a), 1.36, 0.17 * math.sin(a))], [0.016, 0.014, 0.012], n=4, color=GOLD, ref=(0, 1, 0), cap_start=False)
    B.ico(0.085, loc=(0, cy, 0), sub=1, color=GLOW, emissive=True)                                       # core
    # fractal levels: 6 icosahedra on the axes, each wearing 4 tiny octahedra
    ax = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    for a in ax:
        p = Vector((0, cy, 0)) + Vector(a) * 0.125
        B.ico(0.04, loc=p, sub=0, color=GLOW2, emissive=True)
        side = [v for v in ax if abs(Vector(v).dot(Vector(a))) < 0.5][:4]
        for s in side[:4]:
            B.sphere(0.017, loc=p + Vector(s) * 0.055, seg=4, rings=2, color=('violet', 12), emissive=True)
    return B.finish()

@register('twin-sickles')
def twin_sickles():
    B = Builder('twin-sickles')
    grip_wrap(B, -0.16, 0.1, 0.03)
    B.sphere(0.04, loc=(0, -0.19, 0), seg=6, rings=4, color=GOLD)
    cog(B, 0.11, 0.05, teeth=6, loc=(0, 0.14, 0), color=GOLD, ratio=0.78)                                # hub cog (flat in XY)
    B.cyl(0.04, 0.04, 0.06, seg=6, loc=(0, 0.14, 0), color=GLOW, emissive=True)
    C = (0.0, 0.40); R = 0.29
    for sx in (1, -1):                                                                                   # two crescent blades, one each side
        outer = []; inner = []
        n = 9
        for i in range(n + 1):
            t = i / n
            a = rad(-100 + 160 * t)                                                                      # bottom -> up the outer side
            w = 0.085 * (1 - t) ** 0.8 + 0.004
            outer.append((sx * (C[0] + R * math.cos(a)), C[1] + R * math.sin(a)))
            inner.append((sx * (C[0] + (R - w) * math.cos(a)), C[1] + (R - w) * math.sin(a)))
        f = B.annulus(outer, inner, 0.03, color=STEEL, wall=STEEL_D, closed=False)
        B.lit(f, 'slate', 9, 1.0)
        B.box((0.05, 0.07, 0.045), loc=(sx * 0.05, 0.14, 0), color=GOLD_D)
    for sx in (1, -1):                                                                                   # glowing rune dots on each blade
        for t in (0.25, 0.5, 0.72):
            a = rad(-100 + 160 * t)
            B.box((0.02, 0.02, 0.034), loc=(sx * (C[0] + (R - 0.03) * math.cos(a)), C[1] + (R - 0.03) * math.sin(a), 0), color=GLOW, emissive=True)
    return B.finish()

@register('eye-tower-shield', views=((25, 18), (90, 8), (155, 18)))
def eye_tower_shield():
    B = Builder('eye-tower-shield')
    # plate in the XZ plane (face toward +Y), grip behind at the origin
    outl = [(-0.31, -0.46), (-0.2, -0.58), (0.2, -0.58), (0.31, -0.46), (0.31, 0.46), (0.17, 0.58), (0, 0.62), (-0.17, 0.58), (-0.31, 0.46)]
    inl = [(x * 0.82, z * 0.86) for x, z in outl]
    R90 = (PI / 2, 0, 0)
    f = B.prism(outl, 0.05, loc=(0, 0.02, 0), rot=R90, color=GOLD_D)                                       # gold rim plate
    f = B.prism(inl, 0.06, loc=(0, 0.03, 0), rot=R90, color=STEEL)                                         # steel face
    B.lit(f, 'slate', 9, 0.7)
    for sx in (1, -1):
        B.box((0.02, 0.06, 1.0), loc=(sx * 0.15, 0.065, 0.0), color=STEEL_D)                               # plate ribs
    # the Omnissiah's eye: eyelid wedges, sclera, glowing iris, slit pupil
    ey = 0.07
    for sz in (1, -1):
        flat_poly(B, [(-0.19, 0), (0, sz * 0.12), (0.19, 0)], 0.04, loc=(0, ey, 0.0), rot=R90, color=GOLD)
    B.sphere(0.13, loc=(0, 0.085, 0), scale=(1.15, 0.5, 0.85), seg=8, rings=5, color=('yellow', 12))
    B.sphere(0.085, loc=(0, 0.12, 0), scale=(1.0, 0.45, 1.0), seg=8, rings=5, color=GLOW, emissive=True)
    B.box((0.02, 0.04, 0.1), loc=(0, 0.14, 0), color=('grey', 0))
    for k in range(10):                                                                                  # cog rays around the eye
        a = rad(36 * k)
        flat_poly(B, [(-0.025, 0.2), (0.025, 0.2), (0, 0.27 + 0.03 * (k % 2))], 0.03, loc=(0, 0.08, 0.0), rot=(PI / 2, 0, 0), color=GOLD) if False else None
    for sz, sxx in ((0.4, 0), (-0.4, 0)):
        cog(B, 0.07, 0.03, teeth=5, loc=(sxx, 0.08, sz), rot=R90, color=GOLD)
    for sx in (1, -1):
        for sz in (0.35, -0.35):
            B.cyl(0.03, 0.03, 0.03, seg=5, loc=(sx * 0.24, 0.07, sz), rot=R90, color=GOLD)
    B.box((0.1, 0.07, 0.03), loc=(0, 0.0, 0.0), color=LEATHER) if False else None
    B.box((0.26, 0.05, 0.05), loc=(0, -0.045, 0), color=LEATHER)                                         # hand grip bar
    B.box((0.04, 0.05, 0.14), loc=(0.13, -0.025, 0), color=GOLD_D)
    B.box((0.04, 0.05, 0.14), loc=(-0.13, -0.025, 0), color=GOLD_D)
    B.box((0.12, 0.04, 0.2), loc=(0, -0.045, 0.28), color=LEATHER_D)                                   # arm strap
    return B.finish()

@register('grapple-gauntlet')
def grapple_gauntlet():
    B = Builder('grapple-gauntlet')
    f = B.box((0.13, 0.14, 0.12), loc=(0, 0.04, 0), color=BRASS, taper=None)                              # fist block
    B.lit(f, 'gold', 7, 1.4)
    for i, x in enumerate((-0.045, -0.015, 0.015, 0.045)):                                               # knuckle plates
        B.box((0.03, 0.05, 0.05), loc=(x, 0.13, 0.04), color=GOLD)
    B.box((0.15, 0.2, 0.1), loc=(0, -0.14, 0.01), color=BRASS_D)                                         # vambrace
    B.box((0.17, 0.05, 0.12), loc=(0, -0.26, 0.01), color=GOLD_D)
    for y in (-0.1, -0.18):
        B.box((0.16, 0.025, 0.11), loc=(0, y, 0.01), color=GOLD)
    B.box((0.05, 0.12, 0.05), loc=(0, 0.0, -0.01), color=LEATHER)                                        # handle bar inside
    # launcher on top: barrel, hook head with three prongs, reel
    cylY(B, 0.032, 0.032, -0.05, 0.3, seg=8, z=0.09, color=STEEL_D)
    cylY(B, 0.04, 0.04, 0.26, 0.31, seg=8, z=0.09, color=GOLD)
    cylY(B, 0.018, 0.018, 0.3, 0.4, seg=6, z=0.09, color=STEEL)
    for k in range(3):                                                                                   # grapple prongs
        a = rad(120 * k + 90)
        pts = [(0.0, 0.4, 0.09), (0.05 * math.cos(a), 0.44, 0.09 + 0.05 * math.sin(a)), (0.09 * math.cos(a), 0.5, 0.09 + 0.09 * math.sin(a)), (0.075 * math.cos(a), 0.56, 0.09 + 0.075 * math.sin(a))]
        B.loft_path(pts, [0.016, 0.014, 0.012, 0.0], n=4, color=STEEL_L, ref=(0, 1, 0))
    cog(B, 0.075, 0.04, teeth=6, loc=(0.1, -0.02, 0.09), rot=(0, PI / 2, 0), color=GOLD)                  # rope reel cog
    B.cyl(0.035, 0.035, 0.045, seg=6, loc=(0.11, -0.02, 0.09), rot=(0, PI / 2, 0), color=GLOW, emissive=True)
    B.torus(0.02, 0.008, major=6, minor=3, loc=(0, 0.4, 0.09), rot=(0, PI / 2, 0), color=GOLD)
    return B.finish()


# gear_items.py -- starter gear, relics, pickups, wearables. Hand items: grip at origin, +Y = business end, Z up. Pickups: origin = bbox centre.

# ------------------------------------------------------------------ starter weapons ("pilgrim" set: plain steel, wood, leather, a little brass)
@register('pilgrim-sword')
def pilgrim_sword():
    B = Builder('pilgrim-sword')
    grip_wrap(B, -0.12, 0.08, 0.026, n=2, ring=BRASS)
    cog(B, 0.05, 0.04, teeth=5, loc=(0, -0.145, 0), rot=(PI / 2, 0, 0), color=BRASS)                 # little cog pommel
    B.box((0.17, 0.04, 0.04), loc=(0, 0.1, 0), color=BRASS)                                          # cross guard
    B.sphere(0.025, loc=(0.085, 0.1, 0), seg=6, rings=4, color=GOLD)
    B.sphere(0.025, loc=(-0.085, 0.1, 0), seg=6, rings=4, color=GOLD)
    blade(B, 0.045, 0.012, 0.12, 0.88, 0.14, STEEL, lit=('slate', 10))
    B.loft_path([(0, 0.2, 0.011), (0, 0.5, 0.011), (0, 0.6, 0.011)], [(0.008, 0.005), (0.008, 0.005), 0.0], n=4, color=GLOW, emissive=True, ref=(0, 0, 1))
    return B.finish()

@register('pilgrim-bow', views=((35, 20), (90, 6), (0, 10)))
def pilgrim_bow():
    B = Builder('pilgrim-bow')
    top = [(0, 0.0, 0.08), (0, -0.01, 0.3), (0, -0.07, 0.48), (0, -0.17, 0.57), (0, -0.27, 0.6)]
    for s in (1, -1):
        pts = [(x, y, s * z) for x, y, z in top]
        B.loft_path(pts, [(0.03, 0.022), (0.027, 0.02), (0.024, 0.018), (0.019, 0.014), (0.01, 0.008)], n=4, color=WOOD, ref=(1, 0, 0), cap_start=(s == 1), lit_spec=('brown', 7, 1.2))
        B.sphere(0.022, loc=(0, -0.28, s * 0.605), seg=5, rings=3, color=GOLD)                       # brass nock caps
    B.box((0.008, 0.008, 1.21), loc=(0, -0.285, 0), color=BONE)                                     # string
    B.box((0.045, 0.06, 0.2), loc=(0, 0.0, 0.0), color=LEATHER)                                      # grip wrap
    for s in (1, -1):
        B.box((0.05, 0.065, 0.025), loc=(0, 0.0, s * 0.115), color=BRASS)
    cog(B, 0.04, 0.02, teeth=5, loc=(0.03, 0.03, 0.0), rot=(0, PI / 2, 0), color=GOLD)               # tiny cog medallion on the riser
    B.box((0.012, 0.05, 0.02), loc=(0, 0.045, 0.08), color=STEEL_D)                                  # arrow rest
    return B.finish()

@register('pilgrim-shield', views=((25, 18), (90, 8), (155, 18)))
def pilgrim_shield():
    B = Builder('pilgrim-shield')
    R90 = (PI / 2, 0, 0)
    f = B.cyl(0.34, 0.34, 0.05, seg=12, loc=(0, 0.02, 0), rot=R90, color=WOOD)                       # wooden disc, face toward +Y
    B.lit(f, 'brown', 7, 0.8)
    B.torus(0.34, 0.025, major=12, minor=3, loc=(0, 0.045, 0), rot=R90, color=STEEL_D)                # iron rim
    for x in (-0.17, 0.0, 0.17):                                                                     # plank seams
        B.box((0.014, 0.012, 0.6 if x == 0 else 0.54), loc=(x, 0.047, 0), color=LEATHER_D)
    B.sphere(0.1, loc=(0, 0.055, 0), scale=(1, 0.55, 1), seg=8, rings=4, color=STEEL)                # boss
    cog(B, 0.15, 0.015, teeth=8, loc=(0, 0.066, 0), rot=R90, color=GOLD, hole=0.095, ratio=0.8)         # painted cog emblem around the boss
    for k in range(6):
        a = rad(60 * k)
        B.cyl(0.018, 0.018, 0.02, seg=4, loc=(math.cos(a) * 0.29, 0.058, math.sin(a) * 0.29), rot=R90, color=GOLD)
    B.box((0.3, 0.05, 0.05), loc=(0, -0.04, 0), color=LEATHER)                                        # handle
    B.box((0.05, 0.04, 0.14), loc=(0.15, -0.025, 0), color=BRASS)
    B.box((0.05, 0.04, 0.14), loc=(-0.15, -0.025, 0), color=BRASS)
    B.box((0.1, 0.04, 0.2), loc=(0, -0.04, 0.2), color=LEATHER_D)                                    # arm strap
    return B.finish()

@register('novice-staff')
def novice_staff():
    B = Builder('novice-staff')
    cylY(B, 0.028, 0.034, -0.55, 1.0, seg=6, color=WOOD)
    for y in (-0.3, 0.1):
        cylY(B, 0.04, 0.04, y - 0.015, y + 0.015, seg=6, color=BRASS)
    cylY(B, 0.0, 0.03, -0.64, -0.55, seg=6, color=BRASS)
    cy = 1.2
    for k in range(3):                                                                               # three bent prongs cradle the orb
        a = rad(120 * k + 30)
        B.loft_path([(0.03 * math.cos(a), 1.0, 0.03 * math.sin(a)), (0.1 * math.cos(a), 1.1, 0.1 * math.sin(a)), (0.11 * math.cos(a), 1.22, 0.11 * math.sin(a)), (0.07 * math.cos(a), 1.3, 0.07 * math.sin(a))],
                    [0.022, 0.02, 0.018, 0.0], n=4, color=WOOD, ref=(0, 1, 0), cap_start=False)
    B.ico(0.065, loc=(0, cy, 0), sub=1, color=GLOW, emissive=True)                                   # small fractal orb: core + 6 satellites
    for a in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
        B.sphere(0.024, loc=Vector((0, cy, 0)) + Vector(a) * 0.1, seg=4, rings=2, color=GLOW2, emissive=True)
    return B.finish()

# ------------------------------------------------------------------ relics / pickups
@register('reliquary-lantern', views=((35, 14), (90, 6), (-40, 40)))
def reliquary_lantern():
    B = Builder('reliquary-lantern')
    # hangs from the origin (top of the bail): -Z is down
    B.torus(0.035, 0.008, major=8, minor=3, loc=(0, 0, 0), rot=(0, PI / 2, 0), color=GOLD)
    B.loft_path([(-0.1, 0, -0.1), (-0.08, 0, -0.035), (0, 0, -0.012), (0.08, 0, -0.035), (0.1, 0, -0.1)], [0.007] * 5, n=4, color=GOLD_D, ref=(0, 1, 0))   # bail handle
    zc = -0.2
    cylZ(B, 0.1, 0.0, zc + 0.1, zc + 0.19, seg=6, color=BRASS)                                       # roof
    cylZ(B, 0.1, 0.1, zc + 0.085, zc + 0.1, seg=6, color=GOLD)
    cylZ(B, 0.085, 0.085, zc - 0.1, zc + 0.09, seg=6, color=('gold', 13), emissive=True)             # glowing glass core
    for k in range(6):                                                                               # cage posts
        a = rad(60 * k)
        cylZ(B, 0.012, 0.012, zc - 0.1, zc + 0.1, seg=4, x=math.cos(a) * 0.092, y=math.sin(a) * 0.092, color=GOLD)
    cylZ(B, 0.1, 0.07, zc - 0.115, zc - 0.1, seg=6, color=GOLD)
    cylZ(B, 0.07, 0.0, zc - 0.17, zc - 0.115, seg=6, color=BRASS)                                     # pointed base
    cog(B, 0.045, 0.012, teeth=6, loc=(0, 0, zc), rot=(PI / 2, 0, 0), color=GOLD_L)                    # the relic: a tiny cog floating in the light
    cog(B, 0.045, 0.012, teeth=6, loc=(0, 0, zc), rot=(0, PI / 2, 0), color=GOLD_L)
    return B.finish()

def _vial(name, liquid, glow, trim, emblem):
    B = Builder(name)
    zs = [-0.115, -0.1, -0.06, -0.01, 0.04, 0.065, 0.085]
    rs = [0.0, 0.03, 0.058, 0.066, 0.04, 0.024, 0.023]
    B.loft_path([(0, 0, z) for z in zs], rs, n=8, color=liquid, emissive=True, ref=(0, 1, 0), cap_end=True)   # liquid-filled flask (single glowing solid)
    cylZ(B, 0.03, 0.026, 0.085, 0.105, seg=6, color=trim)                                             # collar
    cylZ(B, 0.026, 0.03, 0.105, 0.14, seg=6, color=('tan', 8))                                        # cork
    cylZ(B, 0.032, 0.032, -0.118, -0.098, seg=8, color=trim)                                          # brass foot ring
    emblem(B)
    return B.finish()

def _cross(B):
    B.box((0.02, 0.01, 0.075), loc=(0, -0.062, -0.015), color=GOLD_L)
    B.box((0.075, 0.01, 0.02), loc=(0, -0.062, -0.015), color=GOLD_L)

def _drop_star(B):
    flat_poly(B, star_pts(0.045, 0.02, 4), 0.012, loc=(0, -0.062, -0.012), rot=(PI / 2, 0, 0), color=('violet', 12), emissive=True)

@register('health-vial', views=((35, 14), (90, 6), (-40, 25)))
def health_vial():
    return _vial('health-vial', ('red', 9), ('red', 11), GOLD, _cross)

@register('mana-vial', views=((35, 14), (90, 6), (-40, 25)))
def mana_vial():
    return _vial('mana-vial', ('sky', 9), ('sky', 11), GOLD, _drop_star)

@register('cog-crown', views=((35, 18), (90, 10), (0, 55)))
def cog_crown():
    # worn: origin at the centre of the head ring, +Z up, front = +Y (glTF -Z). Head radius ~0.095 m.
    B = Builder('cog-crown')
    R = 0.105
    B.annulus(ring_pts(R, 16), ring_pts(R - 0.012, 16), 0.04, loc=(0, 0, 0.02), color=GOLD)
    B.annulus(ring_pts(R + 0.002, 16), ring_pts(R - 0.006, 16), 0.01, loc=(0, 0, 0.005), color=GOLD_D)
    for k in range(8):                                                                               # prongs, each topped by a small cog
        a = rad(45 * k + 22.5)
        px, py = math.cos(a) * R, math.sin(a) * R
        B.box((0.022, 0.014, 0.05), loc=(px, py, 0.065), rot=(0, 0, a - PI / 2), color=GOLD_D)
        cog(B, 0.03 if k % 2 else 0.036, 0.012, teeth=5, loc=(px * 1.03, py * 1.03, 0.105), rot=(PI / 2, 0, a + PI / 2), color=GOLD if k % 2 else GOLD_D)
    cog(B, 0.055, 0.016, teeth=6, loc=(0, R + 0.012, 0.1), rot=(PI / 2, 0, PI), color=GOLD_L)           # big front cog
    B.sphere(0.024, loc=(0, R + 0.026, 0.1), scale=(1, 0.6, 1), seg=6, rings=4, color=GLOW, emissive=True)
    return B.finish()


def centre_mesh(ob):
    mn, mx = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for v in ob.data.vertices:
        for i in range(3): mn[i] = min(mn[i], v.co[i]); mx[i] = max(mx[i], v.co[i])
    ob.data.transform(Matrix.Translation(-(mn + mx) / 2))
    return ob

@register('spell-tome', views=((150, 22), (-30, 22), (90, 8)))
def spell_tome():
    # origin = centre of the spine; the book extends +X, cover faces +Y (glTF -Z), spine height along Z
    B = Builder('spell-tome')
    f = B.box((0.205, 0.07, 0.29), loc=(0.1, 0, 0), color=('purple', 4))
    B.lit(f, 'purple', 4, 1.2)
    B.box((0.19, 0.055, 0.262), loc=(0.108, 0.0, 0), color=BONE)                                         # page block (visible at the edges)
    B.box((0.205, 0.072, 0.26), loc=(0.1, 0, 0), color=('purple', 4)) if False else None
    B.box((0.035, 0.08, 0.3), loc=(0.0, 0, 0), color=GOLD_D)                                             # spine
    for z in (-0.1, 0.0, 0.1):
        B.box((0.04, 0.085, 0.018), loc=(0.0, 0, z), color=GOLD)
    for sx in (0.2,):                                                                                    # corner guards
        for z in (0.14, -0.14):
            B.box((0.04, 0.078, 0.05), loc=(sx, 0, z), color=GOLD)
    cog(B, 0.065, 0.014, teeth=8, loc=(0.11, 0.041, 0.0), rot=(PI / 2, 0, 0), color=GOLD, ratio=0.8)      # cog emblem on the cover
    B.sphere(0.03, loc=(0.11, 0.05, 0), scale=(1, 0.5, 1), seg=8, rings=4, color=GLOW, emissive=True)    # the eye
    for z in (0.1, -0.1):
        B.box((0.09, 0.012, 0.012), loc=(0.11, 0.04, z), color=GLOW2, emissive=True)
    return B.finish()

@register('brass-key', views=((20, 25), (90, 8), (0, 70)))
def brass_key():
    B = Builder('brass-key')
    cog(B, 0.07, 0.025, teeth=6, loc=(0, -0.17, 0), color=GOLD, hole=0.03, ratio=0.78)                   # cog bow
    B.cyl(0.045, 0.045, 0.03, seg=6, loc=(0, -0.17, 0), color=GLOW, emissive=True) if False else None
    cylY(B, 0.014, 0.014, -0.1, 0.22, seg=6, color=BRASS)                                                # shaft
    cylY(B, 0.022, 0.022, -0.08, -0.06, seg=6, color=GOLD)
    cog(B, 0.035, 0.02, teeth=5, loc=(0, 0.0, 0), rot=(0, 0, 0), color=GOLD_D)
    for i, (y, w) in enumerate(((0.12, 0.07), (0.15, 0.045), (0.18, 0.08), (0.21, 0.05))):              # the bit: a comb of brass teeth
        B.box((w, 0.022, 0.026), loc=(w / 2 + 0.008, y, 0), color=GOLD if i % 2 == 0 else GOLD_D)
    B.sphere(0.015, loc=(0, 0.235, 0), seg=5, rings=3, color=GLOW, emissive=True)
    return centre_mesh(B.finish())

@register('treasure-idol', views=((25, 18), (90, 8), (155, 18)))
def treasure_idol():
    B = Builder('treasure-idol')
    for i, (w, h) in enumerate(((0.22, 0.04), (0.18, 0.04))):                                            # stepped base
        B.box((w, w, h), loc=(0, 0, 0.02 + i * 0.04), color=GOLD_D if i == 0 else GOLD)
    f = B.loft_path([(0, 0, 0.08), (0, 0, 0.16), (0, 0, 0.25), (0, 0, 0.3)], [0.075, 0.085, 0.06, 0.0], n=6, color=GOLD, ref=(0, 1, 0), cap_end=True, lit_spec=('gold', 9, 2.0))
    B.box((0.14, 0.1, 0.1), loc=(0, 0, 0.3), color=GOLD, taper=(0.85, 0.85))                           # head
    B.sphere(0.04, loc=(0, 0.05, 0.31), scale=(1, 0.5, 1), seg=8, rings=5, color=('yellow', 12))
    B.sphere(0.025, loc=(0, 0.065, 0.31), scale=(1, 0.5, 1), seg=6, rings=4, color=GLOW, emissive=True)  # the eye
    cog(B, 0.07, 0.025, teeth=6, loc=(0, -0.02, 0.4), rot=(PI / 2, 0, 0), color=GOLD_L)                  # cog crest
    for sx in (1, -1):                                                                                   # folded arms holding a small cog
        B.box((0.035, 0.05, 0.12), loc=(sx * 0.085, 0.03, 0.17), rot=(0.3, 0, sx * 0.25), color=GOLD_D)
    cog(B, 0.045, 0.02, teeth=5, loc=(0, 0.1, 0.17), rot=(PI / 2, 0, 0), color=BRASS)
    return centre_mesh(B.finish())

@register('pilgrim-hood', views=((155, 14), (90, 6), (25, 20)))
def pilgrim_hood():
    # worn: origin = head centre, +Z up, front = +Y (glTF -Z). Double-sided shell.
    B = Builder('pilgrim-hood')
    zs = [-0.30, -0.20, -0.10, 0.0, 0.08, 0.15, 0.21, 0.27]
    rx = [0.23, 0.19, 0.15, 0.135, 0.125, 0.10, 0.06, 0.0]
    ry = [0.20, 0.17, 0.16, 0.16, 0.15, 0.12, 0.07, 0.0]
    yo = [0.0, 0.0, -0.01, -0.015, -0.02, -0.04, -0.07, -0.11]                                           # the peak droops backwards
    B.loft_path([(0, yo[i], zs[i]) for i in range(8)], [(rx[i], ry[i]) for i in range(8)], n=10, color=LEATHER, ref=(0, 1, 0), cap_start=False, cap_end=True, lit_spec=('brown', 6, 2.0))
    delete_faces(B, lambda c: c.y > 0.05 and abs(c.x) < 0.12 and -0.14 < c.z < 0.13)                   # face opening
    delete_faces(B, lambda c: c.y > 0.05 and abs(c.x) < 0.05 and c.z <= -0.14)                         # open at the throat
    B.sphere(0.022, loc=(0, -0.115, 0.27), seg=6, rings=4, color=GOLD)                                  # brass bobble on the peak
    for sx in (1, -1):                                                                                   # cog clasps pinning the front edges
        cog(B, 0.03, 0.014, teeth=5, loc=(sx * 0.1, 0.14, -0.2), rot=(PI / 2, 0, 0), color=GOLD)
    return B.finish()

@register('gear-halo', views=((30, 30), (90, 8), (0, 80)))
def gear_halo():
    # origin = ring centre, ring lies in the XY plane (glTF XZ), +Z up
    B = Builder('gear-halo')
    B.annulus(ring_pts(0.2, 20), ring_pts(0.18, 20), 0.012, color=GLOW, emissive=True)
    B.torus(0.21, 0.008, major=20, minor=3, color=GOLD_D)
    for k in range(5):
        a = rad(72 * k + 18)
        cog(B, 0.075 if k % 2 == 0 else 0.06, 0.02, teeth=6, loc=(math.cos(a) * 0.2, math.sin(a) * 0.2, 0.0), rot=(0, 0, a * 2), color=GOLD if k % 2 == 0 else GOLD_L, hole=0.02)
    return B.finish()


# moss-grazer: huge gentle moss-backed quadruped (~1.9 m tall, 2.6 m long). Extra clip: graze.
def make():
    C = Creature('moss-grazer', 1.8, die='side', die_lift=0.55, clips={'idle': (60, True), 'walk': (40, True), 'attack': (30, False), 'hit': (16, False), 'die': (56, False), 'graze': (80, True)})
    B = C.B
    FUR = ('brown', 6); FURD = ('brown', 4); BEL = ('tan', 8); MOSS = ('green', 7); MOSS2 = ('moss', 9); ROCK = ('stone', 7); BONE = ('bone', 12); FL = ('pink', 9); EYE = ('yellow', 12)
    C.bone('Root', None, (0, 0, 0.1), (0, 0, 0.3), 'root', bob=0.01, bobw=0.02, sway=1.5)
    C.bone('Body', 'Root', (0, 0.5, 1.0), (0, -0.5, 1.05), 'spine', a=0.6)
    C.bone('Neck', 'Body', (0, -0.65, 1.1), (0, -1.0, 1.0), 'neck')
    C.bone('Head', 'Neck', (0, -1.0, 1.0), (0, -1.4, 0.95), 'head', look=5)
    C.bone('Jaw', 'Head', (0, -1.25, 0.88), (0, -1.5, 0.84), 'jaw', open=25)
    C.bone('Tail', 'Body', (0, 0.9, 1.0), (0, 1.35, 0.85), 'tail', amp=10, i=1)
    for fb, y in (('F', -0.55), ('B', 0.6)):
        for s, sx in (('L', 1), ('R', -1)):
            ph = 0 if (fb == 'F') == (sx > 0) else math.pi
            C.bone(f'Leg{fb}_{s}', 'Root', (sx * 0.38, y, 0.85), (sx * 0.38, y, 0.05), 'leg', phase=ph, swing=18)
    def graze(t, P, C):
        ph = 2 * math.pi * t; d = S(0.0, 0.2, t) * (1 - S(0.8, 1.0, t))
        P.rot('Neck', 'X', 38 * d); P.rot('Head', 'X', 30 * d + 4 * d * math.sin(ph * 4)); P.rot('Jaw', 'X', 4 + 14 * d * max(0, math.sin(ph * 6)))
        P.rot('Body', 'X', -1.2 * math.sin(ph)); P.rot('Tail', 'Z', 10 * math.sin(ph * 2))
    C.custom['graze'] = graze
    B.b('Body')
    B.sphere(1, loc=(0, 0.1, 0.95), scale=(0.62, 1.0, 0.55), seg=10, rings=6, color=FUR)
    B.sphere(1, loc=(0, 0.0, 0.7), scale=(0.5, 0.8, 0.3), seg=8, rings=4, color=BEL)
    # moss back with mushrooms, flowers and rocks
    for (x, y, z, r, c) in ((0, 0.25, 1.4, 0.42, MOSS), (0.25, -0.2, 1.38, 0.3, MOSS2), (-0.28, 0.55, 1.3, 0.3, MOSS2), (-0.2, -0.3, 1.36, 0.26, MOSS), (0.3, 0.6, 1.25, 0.26, MOSS), (0.0, 0.9, 1.15, 0.22, MOSS2)):
        B.ico(r, loc=(x, y, z), scale=(1, 1.1, 0.7), sub=1, color=c)
    for (x, y, z, r) in ((-0.3, 0.1, 1.5, 0.2), (0.35, 0.3, 1.55, 0.15)):
        B.cyl(0.04, 0.05, 0.22, seg=5, loc=(x, y, z + 0.0), color=BONE)
        B.cyl(r * 0.2, r, 0.09, seg=7, loc=(x, y, z + 0.14), color=('red', 7))
    for (x, y, z) in ((0.1, 0.0, 1.62), (-0.1, 0.6, 1.5), (0.3, -0.25, 1.55), (-0.3, -0.25, 1.52), (0.0, 0.9, 1.32)):
        B.ico(0.05, loc=(x, y, z), sub=0 if False else 1, color=FL, emissive=True)
    B.box((0.35, 0.3, 0.3), loc=(-0.2, 0.3, 1.7), rot=(0.3, 0.2, 0.5), color=ROCK); B.box((0.25, 0.25, 0.25), loc=(0.4, 0.0, 1.55), rot=(0.1, 0.5, 0.2), color=ROCK)
    B.b('Neck')
    B.seg((0, -0.6, 1.1), (0, -1.0, 1.0), 0.42, 0.32, n=7, color=FUR)
    B.b('Head')
    B.sphere(1, loc=(0, -1.15, 0.97), scale=(0.34, 0.38, 0.32), seg=8, rings=5, color=FUR)
    B.box((0.3, 0.32, 0.22), loc=(0, -1.42, 0.9), color=BEL, taper=(0.9, 0.9))
    B.box((0.08, 0.04, 0.05), loc=(0.08, -1.58, 0.96), color=FURD); B.box((0.08, 0.04, 0.05), loc=(-0.08, -1.58, 0.96), color=FURD)
    for sx in (1, -1):
        B.sphere(0.055, loc=(sx * 0.27, -1.28, 1.05), seg=6, rings=4, color=EYE, emissive=True)
        B.sphere(0.03, loc=(sx * 0.3, -1.31, 1.05), seg=5, rings=3, color=('grey', 2))
        B.spike((sx * 0.2, -1.05, 1.22), (sx * 0.34, -1.08, 1.62), 0.075, n=5, color=BONE)
        B.seg((sx * 0.3, -1.0, 1.05), (sx * 0.52, -0.95, 0.8), 0.1, 0.05, n=4, color=FURD, sx=0.4)
    B.ico(0.1, loc=(0, -1.1, 1.3), scale=(1, 1, 0.8), sub=1, color=MOSS)
    B.b('Jaw'); B.box((0.24, 0.3, 0.07), loc=(0, -1.4, 0.77), color=FURD)
    B.b('Tail'); B.seg((0, 0.85, 1.05), (0, 1.35, 0.8), 0.14, 0.05, n=5, color=FUR); B.ico(0.12, loc=(0, 1.4, 0.78), sub=1, color=MOSS2)
    for fb, y in (('F', -0.55), ('B', 0.6)):
        for s, sx in (('L', 1), ('R', -1)):
            B.b(f'Leg{fb}_{s}')
            B.seg((sx * 0.38, y, 0.9), (sx * 0.38, y, 0.12), 0.24, 0.17, n=6, color=FUR)
            B.box((0.34, 0.4, 0.14), loc=(sx * 0.38, y - 0.04, 0.07), color=FURD)
    return C

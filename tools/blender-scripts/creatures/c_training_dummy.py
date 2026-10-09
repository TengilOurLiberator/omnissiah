# training-dummy: clockwork practice automaton on a geared base, ~1.9 m. Sways hard when hit.
def make():
    C = Creature('training-dummy', 1.9, die='back', die_lift=0.35, clips={'idle': (60, True), 'walk': (30, True), 'attack': (30, False), 'hit': (20, False), 'die': (48, False)})
    B = C.B
    WD = ('brown', 6); WD2 = ('brown', 4); ST = ('tan', 9); STD = ('tan', 6); RED = ('red', 7); WHT = ('bone', 13); IR = ('slate', 6); GD = ('gold', 7); GL = ('cyan', 12)
    C.bone('Root', None, (0, 0, 0.05), (0, 0, 0.2), 'root', bob=0.0, sway=0.0)
    C.bone('Gear', 'Root', (0, 0, 0.12), (0, 0, 0.2), 'spin', axis='Z', turns=1)
    C.bone('Post', 'Root', (0, 0, 0.25), (0, 0, 1.0), 'spine', a=0.5)
    C.bone('Torso', 'Post', (0, 0, 1.0), (0, 0, 1.55), 'spine', a=0.8)
    C.bone('Head', 'Torso', (0, 0, 1.55), (0, 0, 1.9), 'head', look=2)
    for s, sx in (('L', 1), ('R', -1)):
        C.bone(f'Arm_{s}', 'Torso', (sx * 0.3, 0, 1.4), (sx * 0.75, 0, 1.4), 'arm', strike_arm=False, swing=8)
    def hit(t, P, C):
        b = math.sin(math.pi * min(1.0, t / 0.4)) * (1 - S(0.4, 1.0, t)); w = math.sin(2 * math.pi * 3 * t) * (1 - t)
        P.rot('Post', 'X', -14 * b + 5 * w); P.rot('Torso', 'Z', 10 * w); P.rot('Head', 'X', -10 * b); P.rot('Gear', 'Z', 180 * t)
    C.custom['hit'] = hit
    C.custom['idle'] = lambda t, P, C: P.rot('Post', 'Z', 1.2 * math.sin(2 * math.pi * t))
    B.b('Gear')
    B.cyl(0.62, 0.62, 0.1, seg=10, loc=(0, 0, 0.05), color=WD2)
    B.gear(0.55, 0.1, teeth=14, loc=(0, 0, 0.15), color=GD)
    B.cyl(0.18, 0.2, 0.18, seg=8, loc=(0, 0, 0.26), color=IR)
    B.b('Post')
    B.cyl(0.09, 0.09, 0.8, seg=6, loc=(0, 0, 0.65), color=WD)
    for z in (0.5, 0.9): B.cyl(0.13, 0.13, 0.06, seg=6, loc=(0, 0, z), color=IR)
    B.box((0.06, 0.2, 0.06), loc=(0, 0.14, 0.3), rot=(0.6, 0, 0), color=WD2); B.box((0.06, 0.2, 0.06), loc=(0, -0.14, 0.3), rot=(-0.6, 0, 0), color=WD2)
    B.b('Torso')
    B.cyl(0.3, 0.27, 0.62, seg=8, loc=(0, 0, 1.27), color=ST)                      # straw-stuffed body
    for z in (1.1, 1.45): B.cyl(0.31, 0.31, 0.05, seg=8, loc=(0, 0, z), color=WD2)
    B.cyl(0.2, 0.2, 0.03, seg=10, loc=(0, -0.28, 1.28), rot=(math.pi / 2, 0, 0), color=RED)   # target
    B.cyl(0.13, 0.13, 0.035, seg=10, loc=(0, -0.285, 1.28), rot=(math.pi / 2, 0, 0), color=WHT)
    B.cyl(0.06, 0.06, 0.04, seg=8, loc=(0, -0.29, 1.28), rot=(math.pi / 2, 0, 0), color=RED)
    B.gear(0.1, 0.04, teeth=8, loc=(0, 0.3, 1.3), rot=(math.pi / 2, 0, 0), color=GD)
    B.box((0.22, 0.04, 0.06), loc=(0, 0.3, 1.5), color=GL, emissive=True)
    B.b('Head')
    B.sphere(0.2, loc=(0, 0, 1.72), scale=(1, 0.95, 1.05), seg=8, rings=5, color=STD)
    B.box((0.38, 0.05, 0.1), loc=(0, -0.15, 1.76), rot=(0, 0, 0.0), color=WD2)         # painted eye band
    for sx in (1, -1): B.sphere(0.035, loc=(sx * 0.08, -0.19, 1.76), scale=(1, 0.5, 1), seg=5, rings=3, color=GL, emissive=True)
    B.cyl(0.22, 0.14, 0.12, seg=8, loc=(0, 0, 1.9), color=WD)                          # little pot hat
    B.spike((0, 0, 1.96), (0, 0, 2.12), 0.04, n=4, color=GD)
    for s, sx in (('L', 1), ('R', -1)):
        B.b(f'Arm_{s}')
        B.box((0.5, 0.1, 0.1), loc=(sx * 0.55, 0, 1.4), color=WD)
        B.cyl(0.11, 0.11, 0.22, seg=6, loc=(sx * 0.78, 0, 1.4), rot=(0, math.pi / 2, 0), color=STD)
        B.cyl(0.07, 0.07, 0.06, seg=6, loc=(sx * 0.3, 0, 1.4), rot=(0, math.pi / 2, 0), color=IR)
    B.b('Arm_R'); B.box((0.05, 0.05, 0.5), loc=(-0.78, -0.05, 1.7), color=WD2); B.box((0.16, 0.05, 0.04), loc=(-0.78, -0.05, 1.47), color=IR)   # wooden sword stuck in the hand
    B.b('Arm_L'); B.cyl(0.26, 0.26, 0.05, seg=10, loc=(0.82, -0.12, 1.4), rot=(math.pi / 2, 0, 0), color=RED); B.cyl(0.08, 0.08, 0.07, seg=6, loc=(0.82, -0.12, 1.4), rot=(math.pi / 2, 0, 0), color=GD)
    return C

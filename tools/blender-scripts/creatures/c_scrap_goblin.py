# scrap-goblin: first easy enemy -- a hunched junk-armoured goblin with a bucket helmet and a rusty cleaver, ~1.2 m.
def make():
    C = Creature('scrap-goblin', 1.2, die='back', die_lift=0.14)
    B = C.B
    SK = ('lime', 7); SKD = ('lime', 5); CL = ('brown', 5); RU = ('rust', 6); RU2 = ('rust', 8); ST = ('slate', 8); EYE = ('yellow', 13); TH = ('bone', 13); DK = ('grey', 3)
    C.bone('Root', None, (0, 0, 0.3), (0, 0, 0.45), 'root', bob=0.01, bobw=0.03, lean=3)
    C.bone('Hips', 'Root', (0, 0, 0.45), (0, 0, 0.55), 'spine', a=0.4)
    C.bone('Chest', 'Hips', (0, 0, 0.55), (0, -0.05, 0.85), 'spine', a=1.0)
    C.bone('Head', 'Chest', (0, -0.05, 0.85), (0, -0.07, 1.2), 'head', look=6)
    C.bone('Jaw', 'Head', (0, -0.14, 0.95), (0, -0.22, 0.92), 'jaw', open=30)
    for s, sx in (('L', 1), ('R', -1)):
        C.bone(f'Arm_{s}', 'Chest', (sx * 0.2, -0.04, 0.8), (sx * 0.26, -0.06, 0.55), 'arm', strike_arm=(sx < 0), raise_=130, swing=30)
        C.bone(f'Forearm_{s}', f'Arm_{s}', (sx * 0.26, -0.06, 0.55), (sx * 0.27, -0.14, 0.32), 'forearm')
        C.bone(f'Leg_{s}', 'Root', (sx * 0.1, 0, 0.45), (sx * 0.1, 0, 0.24), 'leg', phase=0 if sx > 0 else math.pi, swing=30)
        C.bone(f'Shin_{s}', f'Leg_{s}', (sx * 0.1, 0, 0.24), (sx * 0.1, -0.02, 0.03), 'shin', phase=0 if sx > 0 else math.pi)
    B.b('Hips'); B.box((0.28, 0.2, 0.16), loc=(0, 0, 0.5), color=CL); B.box((0.1, 0.03, 0.08), loc=(0, -0.11, 0.5), color=RU2)
    B.b('Chest')
    B.sphere(1, loc=(0, -0.03, 0.66), scale=(0.18, 0.15, 0.22), seg=7, rings=5, color=SK)           # pot belly / chest
    B.box((0.3, 0.2, 0.2), loc=(0, -0.03, 0.72), color=CL, taper=(1.1, 1))                            # scrap vest
    B.gear(0.11, 0.03, teeth=8, loc=(0, -0.13, 0.7), rot=(math.pi / 2, 0, 0), color=RU2)
    B.box((0.5, 0.08, 0.04), loc=(0, -0.06, 0.8), rot=(0, 0, rad(-18)), color=DK)                    # strap
    B.box((0.2, 0.1, 0.22), loc=(0, 0.13, 0.7), color=RU)                                              # backpack of junk
    B.cyl(0.03, 0.03, 0.25, seg=5, loc=(0.06, 0.15, 0.95), color=ST)
    B.b('Head')
    B.sphere(1, loc=(0, -0.08, 1.0), scale=(0.15, 0.14, 0.13), seg=8, rings=5, color=SK)
    B.cyl(0.14, 0.16, 0.13, seg=8, loc=(0, -0.06, 1.14), color=RU)                                    # bucket helmet
    B.cyl(0.165, 0.165, 0.025, seg=8, loc=(0, -0.06, 1.07), color=RU2)
    B.box((0.04, 0.04, 0.04), loc=(0.08, -0.18, 1.14), color=ST); B.box((0.04, 0.04, 0.04), loc=(-0.08, -0.18, 1.14), color=ST)
    B.spike((0, -0.06, 1.2), (0.02, -0.03, 1.34), 0.025, n=4, color=ST)
    B.box((0.06, 0.1, 0.05), loc=(0, -0.2, 0.99), rot=(0.3, 0, 0), color=SKD)                          # nose
    for sx in (1, -1):
        B.sphere(0.03, loc=(sx * 0.06, -0.19, 1.04), scale=(1.2, 0.6, 0.7), seg=5, rings=3, color=EYE, emissive=True)
        B.tube([(sx * 0.14, -0.06, 1.02), (sx * 0.3, -0.04, 1.04), (sx * 0.46, -0.02, 1.1)], [0.035, 0.03, 0.0], n=4, color=SK, flat=0.4)   # long ears
    B.b('Jaw'); B.box((0.14, 0.12, 0.04), loc=(0, -0.17, 0.925), color=SKD)
    for sx in (1, -1): B.spike((sx * 0.04, -0.2, 0.945), (sx * 0.04, -0.2, 0.99), 0.015, n=3, color=TH)
    for s, sx in (('L', 1), ('R', -1)):
        B.b(f'Arm_{s}'); B.seg((sx * 0.2, -0.04, 0.8), (sx * 0.26, -0.06, 0.55), 0.045, 0.04, n=5, color=SK)
        B.cyl(0.1, 0.1, 0.05, seg=8, loc=(sx * 0.22, -0.04, 0.82), rot=(0, math.pi / 2 * 0.0, 0), scale=(1, 1, 1), color=RU2) if sx > 0 else B.gear(0.1, 0.05, teeth=7, loc=(sx * 0.24, -0.04, 0.82), rot=(0, math.pi / 2, 0), color=RU)
        B.b(f'Forearm_{s}'); B.seg((sx * 0.26, -0.06, 0.55), (sx * 0.27, -0.14, 0.33), 0.04, 0.035, n=5, color=SK); B.sphere(0.055, loc=(sx * 0.27, -0.15, 0.3), seg=6, rings=4, color=SK)
        B.b(f'Leg_{s}'); B.seg((sx * 0.1, 0, 0.45), (sx * 0.1, 0, 0.24), 0.06, 0.05, n=5, color=CL)
        B.b(f'Shin_{s}'); B.seg((sx * 0.1, 0, 0.26), (sx * 0.1, -0.02, 0.07), 0.05, 0.04, n=5, color=SKD); B.box((0.1, 0.18, 0.06), loc=(sx * 0.1, -0.07, 0.03), color=DK)
    B.b('Forearm_R')   # the rusty cleaver (right hand = -X)
    B.box((0.035, 0.035, 0.14), loc=(-0.27, -0.17, 0.3), color=('brown', 3))
    B.box((0.03, 0.12, 0.2), loc=(-0.27, -0.22, 0.12), rot=(-0.15, 0, 0), color=ST); B.box((0.032, 0.05, 0.05), loc=(-0.27, -0.21, 0.02), color=RU)
    B.b('Forearm_L'); B.cyl(0.13, 0.13, 0.03, seg=8, loc=(0.34, -0.14, 0.4), rot=(0, math.pi / 2, 0), color=RU); B.cyl(0.04, 0.04, 0.04, seg=6, loc=(0.34, -0.14, 0.4), rot=(0, math.pi / 2, 0), color=ST)   # lid shield
    return C

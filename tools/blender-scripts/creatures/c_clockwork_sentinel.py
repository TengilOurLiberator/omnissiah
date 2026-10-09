# clockwork-sentinel: first mini-boss. 3.5 m brass-and-steel automaton knight: glowing core, hammer fist (right), tower shield (left), spinning back cog.
def make():
    C = Creature('clockwork-sentinel', 3.4, die='back', die_lift=0.5)
    B = C.B
    ST = ('slate', 7); STD = ('slate', 4); BR = ('gold', 7); BRD = ('orange', 5); DK = ('grey', 3); RU = ('rust', 6); CORE = ('ember', 11); VIS = ('orange', 12); BONE = ('bone', 12)
    C.bone('Root', None, (0, 0, 0.3), (0, 0, 0.8), 'root', bob=0.006, bobw=0.012, sway=1.5, lunge=0.6)
    C.bone('Hips', 'Root', (0, 0, 1.95), (0, 0, 2.2), 'spine', a=0.4)
    C.bone('Chest', 'Hips', (0, 0, 2.2), (0, 0, 3.0), 'spine', a=1.0, lean=10)
    C.bone('Head', 'Chest', (0, 0, 3.05), (0, 0, 3.55), 'head', look=2)
    C.bone('Core', 'Chest', (0, -0.5, 2.62), (0, -0.7, 2.62), 'spin', axis='Y', turns=1)
    C.bone('Cog', 'Chest', (0, 0.7, 2.6), (0, 0.9, 2.6), 'spin', axis='Y', turns=1, rev=True)
    for s, sx in (('L', 1), ('R', -1)):
        C.bone(f'Pauldron_{s}', 'Chest', (sx * 1.0, 0, 3.0), (sx * 1.2, 0, 3.0), 'spin', axis='X', turns=1, rev=(sx < 0))
        C.bone(f'Arm_{s}', 'Chest', (sx * 0.95, 0, 2.9), (sx * 1.05, -0.1, 2.1), 'arm', strike_arm=(sx < 0), raise_=150, slam=40, swing=20)
        C.bone(f'Forearm_{s}', f'Arm_{s}', (sx * 1.05, -0.1, 2.1), (sx * 1.05, -0.25, 1.4), 'forearm')
        C.bone(f'Leg_{s}', 'Root', (sx * 0.42, 0, 1.95), (sx * 0.42, 0, 1.1), 'leg', phase=0 if sx > 0 else math.pi, swing=22)
        C.bone(f'Shin_{s}', f'Leg_{s}', (sx * 0.42, 0, 1.1), (sx * 0.42, 0.03, 0.3), 'shin', phase=0 if sx > 0 else math.pi, flex=30)
    B.b('Hips')
    B.box((1.15, 0.65, 0.4), loc=(0, 0, 2.05), color=STD); B.box((0.5, 0.05, 0.3), loc=(0, -0.34, 2.05), color=BR)
    B.torus(0.62, 0.05, major=12, minor=4, loc=(0, 0, 2.28), scale=(1, 0.6, 1), color=BRD)
    B.b('Chest')
    B.box((1.7, 1.0, 1.15), loc=(0, 0, 2.7), taper=(1.0, 1.0), color=ST)
    B.box((1.9, 1.1, 0.4), loc=(0, 0, 3.15), color=ST)
    B.box((1.2, 0.08, 0.7), loc=(0, -0.54, 2.8), color=BR)                            # breastplate
    B.box((1.3, 0.08, 0.1), loc=(0, -0.54, 2.35), color=BRD)
    for sx in (1, -1):
        B.cyl(0.08, 0.1, 0.9, seg=6, loc=(sx * 0.55, 0.55, 3.45), color=DK)                 # chimneys
        B.cyl(0.12, 0.12, 0.06, seg=6, loc=(sx * 0.55, 0.55, 3.92), color=STD)
    B.box((0.5, 0.2, 0.5), loc=(0, 0.55, 2.4), color=STD)                                 # gearbox
    B.b('Core')
    B.ico(0.2, loc=(0, -0.58, 2.62), sub=1, color=CORE, emissive=True)
    B.torus(0.3, 0.04, major=8, minor=4, loc=(0, -0.58, 2.62), rot=(math.pi / 2, 0, 0), color=BR)
    B.b('Cog')
    B.gear(0.85, 0.16, teeth=14, loc=(0, 0.8, 2.6), rot=(math.pi / 2, 0, 0), color=BR, hole=0.3)
    B.cyl(0.2, 0.2, 0.22, seg=8, loc=(0, 0.8, 2.6), rot=(math.pi / 2, 0, 0), color=VIS, emissive=True)
    B.b('Head')
    B.box((0.7, 0.62, 0.62), loc=(0, -0.02, 3.35), taper=(0.9, 0.9), color=ST)
    B.box((0.56, 0.06, 0.12), loc=(0, -0.34, 3.42), color=VIS, emissive=True)           # visor slit
    B.box((0.12, 0.7, 0.1), loc=(0, 0, 3.72), color=BR)                                    # crest
    B.spike((0.0, -0.3, 3.68), (0, -0.4, 3.95), 0.05, n=4, color=BONE)
    B.box((0.2, 0.08, 0.3), loc=(0, -0.34, 3.18), color=STD)                               # grille
    for s, sx in (('L', 1), ('R', -1)):
        B.b(f'Pauldron_{s}')
        B.gear(0.52, 0.2, teeth=10, loc=(sx * 1.15, 0, 3.05), rot=(0, math.pi / 2, 0), color=BR)
        B.cyl(0.16, 0.16, 0.26, seg=6, loc=(sx * 1.15, 0, 3.05), rot=(0, math.pi / 2, 0), color=VIS, emissive=True)
        B.b(f'Arm_{s}')
        B.seg((sx * 0.95, 0, 2.9), (sx * 1.05, -0.1, 2.1), 0.26, 0.22, n=6, color=ST)
        B.sphere(0.27, loc=(sx * 0.95, 0, 2.9), seg=6, rings=4, color=BRD)
        B.b(f'Forearm_{s}')
        B.seg((sx * 1.05, -0.1, 2.1), (sx * 1.05, -0.25, 1.4), 0.24, 0.3, n=6, color=ST)
        B.cyl(0.32, 0.32, 0.12, seg=8, loc=(sx * 1.05, -0.12, 2.1), rot=(0, math.pi / 2, 0), color=BRD)
        B.b(f'Leg_{s}')
        B.seg((sx * 0.42, 0, 1.95), (sx * 0.42, 0, 1.1), 0.33, 0.26, n=6, color=ST)
        B.cyl(0.07, 0.07, 0.85, seg=5, loc=(sx * 0.7, -0.05, 1.5), color=BR)               # piston
        B.sphere(0.3, loc=(sx * 0.42, 0, 1.1), seg=6, rings=4, color=BRD)
        B.b(f'Shin_{s}')
        B.seg((sx * 0.42, 0, 1.1), (sx * 0.42, 0.03, 0.32), 0.26, 0.3, n=6, color=ST)
        B.box((0.5, 0.2, 0.7), loc=(sx * 0.42, -0.2, 0.75), color=STD)
        B.box((0.5, 0.95, 0.28), loc=(sx * 0.42, -0.2, 0.14), color=BRD); B.box((0.54, 0.3, 0.12), loc=(sx * 0.42, -0.62, 0.34), color=BR)
    B.b('Forearm_R')    # hammer fist
    B.box((0.9, 0.9, 0.7), loc=(-1.05, -0.3, 1.0), color=BRD)
    B.box((0.92, 0.2, 0.74), loc=(-1.05, -0.78, 1.0), color=BR)
    for k in (-1, 0, 1): B.spike((-1.05 + k * 0.28, -0.8, 1.0), (-1.05 + k * 0.28, -1.12, 1.0), 0.09, n=4, color=BONE)
    B.cyl(0.14, 0.14, 0.1, seg=6, loc=(-1.05, -0.3, 1.38), color=VIS, emissive=True)
    B.b('Forearm_L')    # tower shield
    B.box((0.16, 1.0, 1.6), loc=(1.35, -0.45, 1.5), color=ST)
    B.box((0.2, 0.7, 1.2), loc=(1.38, -0.46, 1.5), color=BR)
    B.gear(0.3, 0.08, teeth=8, loc=(1.5, -0.46, 1.55), rot=(0, math.pi / 2, 0), color=BRD)
    B.cyl(0.1, 0.1, 0.12, seg=6, loc=(1.52, -0.46, 1.55), rot=(0, math.pi / 2, 0), color=VIS, emissive=True)
    B.box((0.3, 0.3, 0.3), loc=(1.05, -0.25, 1.35), color=STD)
    return C

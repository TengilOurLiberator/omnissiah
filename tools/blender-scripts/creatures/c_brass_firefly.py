# brass-firefly: tiny mechanical dragonfly with a glowing abdomen and four wings (buzzes constantly), ~0.3 m span.
def make():
    C = Creature('brass-firefly', 0.15, die='side', die_lift=0.06, clips={'idle': (60, True), 'walk': (30, True), 'attack': (30, False), 'hit': (16, False), 'die': (48, False)})
    B = C.B
    BR = ('gold', 7); DK = ('slate', 3); GL = ('yellow', 12); WG = ('sky', 12); EYE = ('orange', 11)
    C.bone('Root', None, (0, 0, 0.05), (0, 0, 0.12), 'root', bob=0.0)
    C.bone('Body', 'Root', (0, 0.0, 0.12), (0, 0.1, 0.12), 'spine', a=0.5)
    C.bone('Head', 'Body', (0, -0.08, 0.13), (0, -0.14, 0.13), 'head')
    C.bone('Abdomen', 'Body', (0, 0.08, 0.12), (0, 0.22, 0.1), 'sway', axis='X', amp=7, i=1)
    for s, sx in (('L', 1), ('R', -1)):
        C.bone(f'WingF_{s}', 'Body', (sx * 0.03, -0.03, 0.15), (sx * 0.2, -0.04, 0.15), 'wingx')
        C.bone(f'WingB_{s}', 'Body', (sx * 0.03, 0.02, 0.15), (sx * 0.2, 0.04, 0.15), 'wingx')
    def buzz(t, P, C, cyc=6):
        for n in ('WingF_L', 'WingF_R', 'WingB_L', 'WingB_R'):
            sx = 1 if n.endswith('L') else -1
            ph = 2 * math.pi * cyc * t + (0.9 if 'B_' in n else 0)
            P.rot(n, 'Y', -sx * (28 * math.sin(ph) + 4))
        P.loc('Root', 0, 0, 0.012 * math.sin(2 * math.pi * 2 * t))
    C.custom['idle'] = lambda t, P, C: buzz(t, P, C, 8)
    C.custom['walk'] = lambda t, P, C: buzz(t, P, C, 6)
    C.custom['attack'] = lambda t, P, C: buzz(t, P, C, 6)
    C.custom['hit'] = lambda t, P, C: buzz(t, P, C, 4)
    C.custom['die'] = lambda t, P, C: [P.rot(n, 'Y', (1 if n.endswith('L') else -1) * 40 * S(0.2, 0.7, t)) for n in ('WingF_L', 'WingF_R', 'WingB_L', 'WingB_R')]
    B.b('Body')
    B.sphere(1, loc=(0, 0.02, 0.125), scale=(0.045, 0.1, 0.045), seg=6, rings=4, color=BR)
    B.torus(0.045, 0.01, major=8, minor=4, loc=(0, 0.0, 0.125), rot=(math.pi / 2, 0, 0), color=DK)
    for k in range(3):
        B.seg((sx := 0.0, 0.0, 0) if False else (0.03, 0.0 + 0.03 * k, 0.1), (0.07, -0.02 + 0.03 * k, 0.015), 0.006, n=3, color=DK)
        B.seg((-0.03, 0.0 + 0.03 * k, 0.1), (-0.07, -0.02 + 0.03 * k, 0.015), 0.006, n=3, color=DK)
    B.b('Abdomen')
    B.seg((0, 0.08, 0.12), (0, 0.22, 0.1), 0.032, 0.012, n=6, color=GL, emissive=True)
    B.torus(0.028, 0.006, major=8, minor=4, loc=(0, 0.12, 0.116), rot=(math.pi / 2, 0, 0), color=DK)
    B.b('Head')
    B.sphere(0.045, loc=(0, -0.1, 0.13), seg=7, rings=5, color=BR)
    for sx in (1, -1):
        B.sphere(0.028, loc=(sx * 0.03, -0.12, 0.14), seg=6, rings=4, color=EYE, emissive=True)
        B.seg((sx * 0.015, -0.13, 0.17), (sx * 0.05, -0.2, 0.22), 0.004, n=3, color=DK)
    for s, sx in (('L', 1), ('R', -1)):
        B.b(f'WingF_{s}')
        B.tri([(sx * 0.03, -0.03, 0.15), (sx * 0.12, -0.075, 0.152), (sx * 0.25, -0.05, 0.15), (sx * 0.13, 0.0, 0.148)], color=WG, emissive=True, both=True)
        B.b(f'WingB_{s}')
        B.tri([(sx * 0.03, 0.02, 0.15), (sx * 0.12, 0.0, 0.152), (sx * 0.22, 0.06, 0.15), (sx * 0.11, 0.075, 0.148)], color=WG, emissive=True, both=True)
    return C

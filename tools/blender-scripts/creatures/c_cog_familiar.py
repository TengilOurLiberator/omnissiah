# cog-familiar: a small friendly brass companion, ~0.6 m tall. One big cyan eye, spinning cog ears, back cog, antenna bulb.
def make():
    C = Creature('cog-familiar', 0.6, die='side', die_lift=0.13)
    B = C.B; R = C.rig
    BR = ('gold', 10); BR_D = ('orange', 6); DARK = ('slate', 4); EYE = ('cyan', 12); RIM = ('bone', 13); BULB = ('yellow', 12)
    R_ = lambda: None
    C.bone('Root', None, (0, 0, 0.02), (0, 0, 0.12), 'root', bob=0.03)
    C.bone('Body', 'Root', (0, 0, 0.2), (0, 0, 0.34), 'spine', a=0.6)
    C.bone('Head', 'Body', (0, 0, 0.36), (0, 0, 0.6), 'head')
    C.bone('Antenna', 'Head', (0, 0, 0.56), (0, 0, 0.68), 'sway', axis='X', amp=10, i=1)
    C.bone('Cog', 'Body', (0, 0.13, 0.27), (0, 0.2, 0.27), 'spin', axis='Y', turns=1)
    for s, sx in (('L', 1), ('R', -1)):
        C.bone(f'Ear_{s}', 'Head', (sx * 0.13, 0, 0.5), (sx * 0.2, 0, 0.5), 'spin', axis='X', turns=1, rev=(sx < 0))
        C.bone(f'Arm_{s}', 'Body', (sx * 0.1, 0, 0.3), (sx * 0.19, -0.02, 0.2), 'arm', swing=34, raise_=100)
        C.bone(f'Leg_{s}', 'Root', (sx * 0.06, 0, 0.15), (sx * 0.06, 0, 0.05), 'leg', phase=0 if sx > 0 else math.pi, swing=30)
    # ---- body
    B.b('Body')
    B.sphere(0.115, loc=(0, 0, 0.25), scale=(1, 0.92, 1.02), seg=8, rings=6, color=BR)
    B.torus(0.112, 0.016, major=10, minor=4, loc=(0, 0, 0.22), color=DARK)
    B.box((0.09, 0.02, 0.06), loc=(0, -0.105, 0.27), color=BR_D)                      # chest plate
    B.box((0.03, 0.012, 0.03), loc=(0, -0.118, 0.27), color=BULB, emissive=True)      # heart lamp
    B.b('Cog')
    B.gear(0.115, 0.03, teeth=10, loc=(0, 0.14, 0.27), rot=(math.pi / 2, 0, 0), color=BR_D, hole=0.0)
    B.cyl(0.035, 0.035, 0.045, seg=6, loc=(0, 0.155, 0.27), rot=(math.pi / 2, 0, 0), color=EYE, emissive=True)
    B.b('Head')
    B.sphere(0.13, loc=(0, -0.005, 0.47), scale=(1.12, 1.0, 0.86), seg=9, rings=6, color=BR)
    B.box((0.2, 0.05, 0.1), loc=(0, -0.11, 0.465), color=DARK, taper=(1, 1))                  # visor
    B.sphere(0.052, loc=(0, -0.135, 0.465), scale=(1, 0.45, 1), seg=8, rings=5, color=EYE, emissive=True)
    B.sphere(0.02, loc=(-0.02, -0.158, 0.48), scale=(1, 0.5, 1), seg=5, rings=3, color=RIM, emissive=True)
    B.box((0.075, 0.015, 0.014), loc=(0.055, -0.14, 0.53), rot=(0, 0, rad(-12)), color=BR_D)   # brows
    B.box((0.075, 0.015, 0.014), loc=(-0.055, -0.14, 0.53), rot=(0, 0, rad(12)), color=BR_D)
    B.b('Antenna')
    B.seg((0, 0, 0.57), (0, 0, 0.665), 0.011, 0.008, n=4, color=BR_D)
    B.ico(0.032, loc=(0, 0, 0.69), sub=1, color=BULB, emissive=True)
    for s, sx in (('L', 1), ('R', -1)):
        B.b(f'Ear_{s}')
        B.gear(0.082, 0.025, teeth=8, loc=(sx * 0.15, 0, 0.5), rot=(0, math.pi / 2, 0), color=BR_D)
        B.cyl(0.02, 0.02, 0.032, seg=5, loc=(sx * 0.15, 0, 0.5), rot=(0, math.pi / 2, 0), color=EYE, emissive=True)
        B.b(f'Arm_{s}')
        B.seg((sx * 0.1, 0, 0.3), (sx * 0.19, -0.02, 0.2), 0.026, 0.02, n=5, color=BR_D)
        B.gear(0.045, 0.026, teeth=6, loc=(sx * 0.2, -0.025, 0.19), rot=(0, math.pi / 2, 0), color=BR)
        B.b(f'Leg_{s}')
        B.seg((sx * 0.06, 0, 0.15), (sx * 0.06, 0, 0.07), 0.024, 0.02, n=5, color=DARK)
        B.sphere(0.05, loc=(sx * 0.06, -0.015, 0.045), scale=(0.9, 1.3, 0.8), seg=6, rings=4, color=BR_D)
    return C


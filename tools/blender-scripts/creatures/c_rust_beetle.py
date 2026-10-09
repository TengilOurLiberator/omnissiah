# rust-beetle: easy enemy, a rust-plated six-legged beetle with a horn and snapping mandibles, 0.85 m long.
def make():
    C = Creature('rust-beetle', 0.45, die='flip', die_lift=0.42, clips={'idle': (60, True), 'walk': (24, True), 'attack': (30, False), 'hit': (16, False), 'die': (48, False)})
    B = C.B
    RU = ('rust', 6); RU2 = ('rust', 8); DK = ('grey', 3); ST = ('slate', 6); EYE = ('orange', 12); BONE = ('bone', 11); BELLY = ('brown', 4)
    C.bone('Root', None, (0, 0, 0.1), (0, 0, 0.25), 'root', bob=0.01, bobw=0.03, sway=2)
    C.bone('Body', 'Root', (0, 0.1, 0.3), (0, -0.2, 0.3), 'spine', a=0.5)
    C.bone('Head', 'Body', (0, -0.3, 0.27), (0, -0.46, 0.27), 'head', look=5)
    C.bone('Jaw', 'Head', (0, -0.46, 0.2), (0, -0.56, 0.18), 'jaw', open=30)
    for s, sx in (('L', 1), ('R', -1)):
        C.bone(f'Elytra_{s}', 'Body', (sx * 0.04, -0.05, 0.42), (sx * 0.2, 0.1, 0.4), 'wing', flap=9)
        C.bone(f'Antenna_{s}', 'Head', (sx * 0.05, -0.45, 0.33), (sx * 0.12, -0.55, 0.42), 'sway', axis='Z', amp=12, i=sx > 0)
        for nm, y, ph in (('F', -0.17, 0), ('M', 0.05, math.pi), ('B', 0.27, 0)):
            ph2 = ph if sx > 0 else ph + math.pi
            C.bone(f'Leg{nm}_{s}', 'Root', (sx * 0.17, y, 0.28), (sx * 0.46, y + (-0.06 if nm == 'F' else 0.06 if nm == 'B' else 0), 0.02), 'leg', phase=ph2, swing=26)
    B.b('Body')
    B.sphere(1, loc=(0, 0.05, 0.27), scale=(0.2, 0.3, 0.12), seg=8, rings=5, color=DK)
    B.sphere(1, loc=(0, -0.2, 0.31), scale=(0.15, 0.14, 0.12), seg=7, rings=4, color=RU)         # thorax
    B.box((0.2, 0.05, 0.05), loc=(0, -0.3, 0.32), color=RU2)
    B.b('Head')
    B.sphere(1, loc=(0, -0.4, 0.27), scale=(0.12, 0.1, 0.09), seg=7, rings=4, color=RU)
    B.spike((0, -0.42, 0.33), (0, -0.62, 0.5), 0.045, n=4, color=BONE)                                 # horn
    for sx in (1, -1):
        B.sphere(0.03, loc=(sx * 0.08, -0.46, 0.3), seg=5, rings=3, color=EYE, emissive=True)
    B.b('Jaw')
    for sx in (1, -1):
        B.seg((sx * 0.05, -0.46, 0.2), (sx * 0.08, -0.56, 0.18), 0.03, 0.02, n=4, color=ST)
        B.spike((sx * 0.08, -0.56, 0.18), (sx * 0.02, -0.65, 0.18), 0.022, n=4, color=BONE)
    for s, sx in (('L', 1), ('R', -1)):
        B.b(f'Elytra_{s}')
        B.sphere(1, loc=(sx * 0.1, 0.06, 0.37), scale=(0.115, 0.34, 0.14), seg=7, rings=4, color=RU)
        B.box((0.05, 0.3, 0.02), loc=(sx * 0.1, 0.06, 0.5), rot=(0.05, 0, 0), color=RU2)
        B.cyl(0.03, 0.03, 0.02, seg=6, loc=(sx * 0.12, 0.2, 0.48), color=ST)
        B.b(f'Antenna_{s}'); B.seg((sx * 0.05, -0.45, 0.33), (sx * 0.12, -0.55, 0.42), 0.012, 0.008, n=3, color=ST)
        for nm, y in (('F', -0.17), ('M', 0.05), ('B', 0.27)):
            B.b(f'Leg{nm}_{s}')
            dy = -0.06 if nm == 'F' else 0.06 if nm == 'B' else 0
            B.seg((sx * 0.17, y, 0.28), (sx * 0.34, y + dy * 0.4, 0.32), 0.03, 0.026, n=4, color=ST)
            B.seg((sx * 0.34, y + dy * 0.4, 0.32), (sx * 0.46, y + dy, 0.02), 0.026, 0.012, n=4, color=DK)
    return C

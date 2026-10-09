# wisp: a drifting will-o-wisp, glowing core with a flickering tail and orbiting motes, ~0.8 m tall. Pops when killed.
def make():
    C = Creature('wisp', 0.8, die='pop', clips={'idle': (60, True), 'walk': (40, True), 'attack': (30, False), 'hit': (16, False), 'die': (36, False)})
    B = C.B
    CORE = ('cyan', 11); HALO = ('sky', 11); TAIL = ('teal', 10); MOTE = ('mint', 12); EYE = ('slate', 2)
    C.bone('Root', None, (0, 0, 0.05), (0, 0, 0.2), 'float', bob=0.08)
    C.bone('Core', 'Root', (0, 0, 0.5), (0, 0, 0.62), 'head', look=6)
    for i, z in enumerate((0.36, 0.22, 0.1), 1):
        C.bone(f'Tail{i}', 'Core' if i == 1 else f'Tail{i-1}', (0, 0.02 * i, z + 0.13), (0, 0.04 * i, z), 'tail', amp=16, i=i, axis='X')
    C.bone('Orb1', 'Root', (0, 0, 0.5), (0, 0, 0.6), 'spin', axis='Z', turns=1)
    C.bone('Orb2', 'Root', (0, 0, 0.5), (0, 0, 0.6), 'spin', axis='Z', turns=1, rev=True)
    B.b('Core')
    B.ico(0.19, loc=(0, 0, 0.52), scale=(1, 0.95, 1.15), sub=1, color=CORE, emissive=True)
    B.torus(0.27, 0.025, major=10, minor=4, loc=(0, 0, 0.52), rot=(math.pi / 2.6, 0, 0), color=HALO, emissive=True)
    for sx in (1, -1):
        B.sphere(0.045, loc=(sx * 0.075, -0.17, 0.55), scale=(0.8, 0.5, 1.4), seg=5, rings=3, color=EYE)
    B.spike((0, 0.0, 0.7), (0, 0.04, 0.88), 0.07, n=5, color=HALO, emissive=True)
    B.spike((0.09, 0.0, 0.68), (0.2, 0.03, 0.8), 0.045, n=4, color=HALO, emissive=True)
    B.spike((-0.09, 0.0, 0.68), (-0.2, 0.03, 0.8), 0.045, n=4, color=HALO, emissive=True)
    rr = (0.15, 0.1, 0.055)
    for i, z in enumerate((0.36, 0.22, 0.1), 1):
        B.b(f'Tail{i}')
        B.seg((0, 0.02 * i, z + 0.13), (0, 0.04 * i, z), rr[i - 1], rr[i - 1] * 0.6 if i < 3 else 0.0, n=5, color=TAIL, emissive=True)
    B.b('Orb1'); B.ico(0.045, loc=(0.34, 0, 0.5), sub=1, color=MOTE, emissive=True)
    B.b('Orb2'); B.ico(0.04, loc=(-0.3, 0.1, 0.62), sub=1, color=MOTE, emissive=True)
    return C

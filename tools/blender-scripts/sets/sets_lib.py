# sets_lib.py -- shared helpers for the architecture / world set-piece models (Blender, headless).
#   blender.exe --background --python D:\omnissiah\tools\blender-scripts\sets\run_sets.py -- <model> [<model> ...]
# Reuses the hero palette builders from .cache/blender/tools (hero_lib, props_lib). NEVER calls make_palette_png():
# hero-palette.png is shared by every hero model and must not be rewritten.
import sys, os, math, random, json
TOOLS = r'D:\omnissiah\.cache\blender\tools'
for _f in ('hero_lib', 'hero_lib_patch', 'props_lib'):
    exec(compile(open(os.path.join(TOOLS, _f + '.py'), encoding='utf-8-sig').read(), _f, 'exec'), globals())

SETS_OUT = BL + r'\export'
THUMBS = PREV + r'\sets'
os.makedirs(THUMBS, exist_ok=True)

PI = math.pi
def rad(d): return math.radians(d)

# ---- colour shorthands (family, shade) -- all from the shared palette
STONE = ('stone', 7); STONE_D = ('stone', 4); STONE_L = ('stone', 10); STONE_LL = ('stone', 12)
MOSS = ('moss', 7); MOSS_D = ('moss', 5); GRASS = ('green', 7)
GOLD = ('gold', 9); GOLD_D = ('gold', 6); GOLD_L = ('gold', 12)
BRASS = ('tan', 8); BRASS_D = ('brown', 7); COPPER = ('orange', 7)
STEEL = ('slate', 9); STEEL_D = ('slate', 6); DARK = ('grey', 4); IRON = ('grey', 6)
GLOW = ('cyan', 10); GLOW_W = ('cyan', 13); GLOW2 = ('violet', 10); FIRE = ('orange', 11); FIRE_Y = ('yellow', 12)
WOOD = ('brown', 6); WOOD_D = ('brown', 4); WOOD_L = ('tan', 8); BARK = ('brown', 5)
CLOTH_R = ('crimson', 7); CLOTH_B = ('blue', 8); CLOTH_G = ('teal', 8); CLOTH_Y = ('gold', 11); CLOTH_W = ('bone', 13)
LEAF = ('green', 8); LEAF_L = ('lime', 9)

# ---------------------------------------------------------------- the set container: named parts -> separate objects (chunks)
class SetModel:
    def __init__(self, name):
        self.name = name
        self.parts = {}        # part name -> Builder
        self.supports = {}     # part name -> list of part names it rests on ([] = ground)
        self.order = []
        self.notes = {}
    def part(self, name, supports=None):
        if name not in self.parts:
            self.parts[name] = Builder(name)
            self.order.append(name)
        if supports is not None: self.supports[name] = list(supports)
        return self.parts[name]
    def build(self):
        obs = []
        for n in self.order:
            b = self.parts[n]
            if len(b.bm.faces) == 0:
                b.bm.free(); continue
            ob = b.finish()
            obs.append(ob)
        return obs

def xf(B, M):
    """transform every vertex of a Builder by Matrix M (do it before finish())"""
    for v in B.bm.verts: v.co = M @ v.co

def clip_below(B, z=0.0):
    """remove everything of the Builder's mesh below height z (buried parts cost no triangles)"""
    bm = B.bm
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1), clear_inner=True, clear_outer=False)

def rock(B, c, r, rng, color=STONE_D, sq=(1, 1, 0.7), sub=1, jit=0.25, lit=('stone', 5), emissive=False):
    f = B.ico(r, loc=c, rot=(0, 0, rng.uniform(0, 6.28)), scale=sq, sub=sub, color=color, emissive=emissive)
    wob(f, r * jit, rng, keep_z0=False)
    if lit: B.lit(f, lit[0], lit[1], 1.8)
    return f

def pal_noise(fam, base, rng, spread=1):
    return (fam, max(0, min(15, base + rng.randint(-spread, spread))))

# ---------------------------------------------------------------- geometry helpers
def verts_of(faces):
    vs = set()
    for f in faces:
        if f.is_valid:
            for v in f.verts: vs.add(v)
    return vs

def wob(faces, amp, rng, keep_z0=True, axes=(1, 1, 1)):
    """random vertex jitter on the given faces (hand-hewn ruin look). keep_z0: do not lift verts that sit on the ground."""
    for v in verts_of(faces):
        if keep_z0 and v.co.z < 0.02:
            v.co.x += rng.uniform(-amp, amp) * axes[0] * 0.5; v.co.y += rng.uniform(-amp, amp) * axes[1] * 0.5
            continue
        v.co.x += rng.uniform(-amp, amp) * axes[0]; v.co.y += rng.uniform(-amp, amp) * axes[1]; v.co.z += rng.uniform(-amp, amp) * axes[2]

def jag_top(faces, zmax, depth, rng, band=0.05):
    """drop the vertices that sit at the top (z >= zmax-band) by a random 0..depth: a broken stump"""
    for v in verts_of(faces):
        if v.co.z >= zmax - band:
            v.co.z -= rng.uniform(0, depth)

def jag_side(faces, axis, limit, depth, rng, sign=1, band=0.05):
    """push vertices beyond `limit` on `axis` back toward the inside by 0..depth (a snapped end)"""
    for v in verts_of(faces):
        c = v.co[axis]
        if sign > 0 and c >= limit - band: v.co[axis] -= rng.uniform(0, depth)
        if sign < 0 and c <= limit + band: v.co[axis] += rng.uniform(0, depth)

def arch_poly(R_out, R_in, a0=0, a1=180, n=10, cx=0.0, cz=0.0):
    """two equal-length polylines (x, z) of an arch band (angles in degrees, 0 = +x, 90 = up) for Builder.annulus with rot=(rad(90),0,0).
    NOTE annulus works in local XY then extrudes along Z; with rot X=90deg the local Y becomes world Z and the extrusion runs along world Y."""
    outer = []; inner = []
    for i in range(n + 1):
        a = rad(a0 + (a1 - a0) * i / n)
        outer.append((cx + R_out * math.cos(a), cz + R_out * math.sin(a)))
        inner.append((cx + R_in * math.cos(a), cz + R_in * math.sin(a)))
    return outer, inner

def cog(B, R, depth, teeth=10, loc=(0, 0, 0), rot=(0, 0, 0), color=GOLD, hole=0.0, ratio=0.82, wall=None, w0=0.10, w1=0.42):
    """a gear disc (axis = local Z). hole>0: round hole (annulus)."""
    pts = gear_pts(R * ratio, R, teeth, w0=w0, w1=w1)
    if hole > 0:
        inner = [(hole * math.cos(math.atan2(y, x)), hole * math.sin(math.atan2(y, x))) for x, y in pts]
        return B.annulus(pts, inner, depth, loc=loc, rot=rot, color=color, wall=wall or color)
    return B.prism(pts, depth, loc=loc, rot=rot, color=color)

def ring3(B, R, r, major=16, minor=4, loc=(0, 0, 0), rot=(0, 0, 0), color=GOLD, emissive=False, scale=(1, 1, 1)):
    return B.torus(R, r, major=major, minor=minor, loc=loc, rot=rot, scale=scale, color=color, emissive=emissive)

def crystal(B, base, height, r, color=GLOW, emissive=True, tilt=(0, 0), sides=6, tip=0.0, belly=0.55, twist=0.0, lit=None, base_k=0.55):
    """a faceted crystal: lofted hex prism that swells at `belly` and tapers to a point at the top. tilt = (rot about x, rot about y) in radians."""
    base = Vector(base)
    m = Euler((tilt[0], tilt[1], 0), 'XYZ').to_matrix()
    secs = [(0.0, r * base_k), (belly * height, r), (height * 0.88, r * 0.62), (height, tip)]
    rings = []
    for k, (z, rr) in enumerate(secs):
        ring = []
        for i in range(sides):
            a = 2 * PI * i / sides + twist * k
            p = Vector((rr * math.cos(a), rr * math.sin(a), z))
            ring.append(B.bm.verts.new(base + m @ p))
        rings.append(ring)
    faces = []
    for k in range(len(rings) - 1):
        for i in range(sides):
            j = (i + 1) % sides
            if k == len(rings) - 2 and tip == 0.0:
                faces.append(B.bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j])))
            else:
                faces.append(B.bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i])))
    faces.append(B.bm.faces.new(tuple(reversed(rings[0]))))
    if tip != 0.0: faces.append(B.bm.faces.new(tuple(rings[-1])))
    bmesh.ops.recalc_face_normals(B.bm, faces=faces)
    B.add(faces, color, emissive)
    if lit: B.lit(faces, *lit)
    return faces

def rune_strip(B, p0, p1, up, n=5, w=0.05, h=0.14, d=0.03, color=GLOW, emissive=True, seed=1, out=(0, -1, 0)):
    """a row of small glowing glyph blocks along p0->p1 (circuit-rune look): alternating tall/short bars + a connecting thin line.
    `out` = the surface normal the glyphs stand proud of."""
    rng = random.Random(seed)
    p0 = Vector(p0); p1 = Vector(p1)
    d_ = (p1 - p0); L = d_.length; T = d_.normalized()
    O = Vector(out).normalized()
    # basis: x = T, y = O (out of surface), z = up_axis (T x O)
    Z = T.cross(O).normalized() if abs(T.dot(O)) < 0.99 else Vector((0, 0, 1))
    m = Matrix((T, O, Z)).transposed()
    for i in range(n):
        t = (i + 0.5) / n
        c = p0 + T * (L * t) + O * (d * 0.5)
        hh = h * rng.choice((0.5, 0.8, 1.0, 1.0, 0.65))
        sz = Vector((w, d, hh))
        mm = Matrix.LocRotScale(c, m.to_quaternion(), sz)
        r = bmesh.ops.create_cube(B.bm, size=1.0, matrix=mm)
        B.add(B._faces_of(r['verts']), color, emissive)
    # connecting line
    mm = Matrix.LocRotScale(p0 + T * (L * 0.5) + O * (d * 0.4), m.to_quaternion(), Vector((L * 0.95, d * 0.8, w * 0.35)))
    r = bmesh.ops.create_cube(B.bm, size=1.0, matrix=mm)
    B.add(B._faces_of(r['verts']), color, emissive)

def lit_box(B, size, loc, color_fam, base, k=2.0, rot=(0, 0, 0), taper=None):
    f = B.box(size, loc=loc, rot=rot, color=(color_fam, base), taper=taper)
    B.lit(f, color_fam, base, k)
    return f

def human_ref():
    """a 1.8 m reference figure for the thumbnails only (name starts with '_', never exported)."""
    B = Builder('_human')
    B.box((0.5, 0.3, 0.8), loc=(0, 0, 1.0), color=('red', 9))
    B.box((0.16, 0.2, 0.7), loc=(-0.12, 0, 0.35), color=('red', 6)); B.box((0.16, 0.2, 0.7), loc=(0.12, 0, 0.35), color=('red', 6))
    B.sphere(0.14, loc=(0, 0, 1.65), color=('peach', 10), seg=6, rings=4)
    return B.finish()

def tricount(obs):
    return sum(tri_count(o, False) for o in obs)

def export_set(sm, objs):
    """export every object of `objs` as BL/export/<name>_raw.glb (+Y up) and write <name>.json with the chunk list."""
    for o in bpy.data.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=SETS_OUT + rf'\{sm.name}_raw.glb', export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_animations=False, export_skins=False, export_image_format='AUTO', export_materials='EXPORT', export_extras=False, export_cameras=False, export_lights=False)
    info = {'name': sm.name, 'chunks': [{'name': o.name, 'supports': sm.supports.get(o.name, []), 'tris': tri_count(o, False)} for o in objs], 'notes': sm.notes}
    json.dump(info, open(SETS_OUT + rf'\{sm.name}.json', 'w'), indent=1)
    return info



def circuit_face(B, c, V, N, w, h, rng, color=GLOW, t=0.05, d=0.035, segs=7, node=True, emissive=True, stubs=2):
    """glowing circuit-rune path drawn on a flat face. c = face-centre point, V = 'up' along the face, N = outward normal,
    w x h = drawing area. Orthogonal polyline with square nodes at the bends and a few stubs."""
    c = Vector(c); N = Vector(N).normalized(); V = (Vector(V) - N * Vector(V).dot(N)).normalized(); U = V.cross(N).normalized()
    q = Matrix((U, V, N)).transposed().to_quaternion()
    def box(a, b, size=None):
        p0 = c + U * a[0] + V * a[1]; p1 = c + U * b[0] + V * b[1]
        mid = (p0 + p1) / 2 + N * (d * 0.5)
        sz = Vector((max(abs(b[0] - a[0]), t), max(abs(b[1] - a[1]), t), d))
        if size is not None: sz = Vector((size, size, d * 1.4))
        r = bmesh.ops.create_cube(B.bm, size=1.0, matrix=Matrix.LocRotScale(mid, q, sz))
        B.add(B._faces_of(r['verts']), color, emissive)
    u = -w / 2; v = rng.uniform(-h * 0.35, h * 0.35)
    pts = [(u, v)]
    for i in range(segs):
        if i % 2 == 0:
            u2 = min(w / 2, u + rng.uniform(0.18, 0.4) * w)
            if u2 - u < 0.08: u2 = u + 0.08
            box((u, v), (u2, v)); u = u2
        else:
            dv = rng.choice((-1, 1)) * rng.uniform(0.12, 0.32) * h
            v2 = max(-h / 2, min(h / 2, v + dv))
            box((u, v), (u, v2)); v = v2
        pts.append((u, v))
        if node: box((u, v), (u, v), size=t * 2.0)
        if u >= w / 2 - 0.02: break
    for k in range(stubs):
        a = pts[rng.randint(1, len(pts) - 1)]
        dv = rng.choice((-1, 1)) * rng.uniform(0.1, 0.25) * h
        b = (a[0], max(-h / 2, min(h / 2, a[1] + dv)))
        box(a, b); box(b, b, size=t * 2.4)
    box(pts[-1], pts[-1], size=t * 3.0)

LEATHER = ('brown', 5)

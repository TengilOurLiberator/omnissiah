# clib.py -- shared library for the Omnissiah creature/boss models (headless Blender 5.2, exec'd by run.py).
# Builds ONE rigid-skinned mesh (palette-UV faces, vertex groups = bones) + an armature + procedural clips (idle walk attack hit die ...).
# Coordinates: Blender Z up, the creature FACES -Y (-> glTF +Z, like the dragon), its LEFT is +X. Metres. Feet/lowest point at z = 0.
import bpy, bmesh, math, colorsys, os, json
from mathutils import Vector, Matrix, Quaternion, Euler

ROOT = r'D:\omnissiah'
CR = ROOT + r'\.cache\creatures'
EXP = CR + r'\export'
PREV = CR + r'\previews'
HERO = ROOT + r'\public\assets\hero'
PAL_PNG = HERO + r'\hero-palette.png'
for _d in (CR, EXP, PREV):
    os.makedirs(_d, exist_ok=True)

# ---------------------------------------------------------------- palette (identical table to the shipped hero-palette.png; the PNG is never rewritten here)
FAMILIES = [
    ('grey', 0.0, 0.0), ('stone', 0.10, 0.14), ('brown', 0.07, 0.55), ('tan', 0.09, 0.62),
    ('red', 0.0, 0.78), ('crimson', 0.97, 0.72), ('orange', 0.07, 0.92), ('gold', 0.125, 0.88),
    ('yellow', 0.165, 0.85), ('lime', 0.23, 0.62), ('green', 0.33, 0.55), ('teal', 0.47, 0.62),
    ('cyan', 0.54, 0.85), ('blue', 0.62, 0.68), ('purple', 0.76, 0.55), ('pink', 0.89, 0.62),
    ('moss', 0.27, 0.26), ('slate', 0.60, 0.22), ('ash', 0.76, 0.12), ('sand', 0.13, 0.40), ('olive', 0.18, 0.5), ('maroon', 0.99, 0.5), ('violet', 0.80, 0.8), ('bone', 0.12, 0.30),
    ('rust', 0.04, 0.72), ('sky', 0.57, 0.9), ('mint', 0.41, 0.5), ('rose', 0.95, 0.8), ('indigo', 0.68, 0.7), ('forest', 0.38, 0.45), ('peach', 0.06, 0.78), ('ember', 0.02, 0.95)]
FAM = {f[0]: i for i, f in enumerate(FAMILIES)}
NFAM = len(FAMILIES)

def pal(fam, shade):
    if isinstance(fam, str): fam = FAM[fam]
    return ((shade + 0.5) / 16.0, (fam + 0.5) / float(NFAM))

def get_palette_image():
    img = bpy.data.images.get('hero-palette.png') or bpy.data.images.get('hero-palette')
    if img is None or img.size[0] == 0:
        img = bpy.data.images.load(PAL_PNG)
    img.colorspace_settings.name = 'sRGB'
    return img

def make_materials():
    img = get_palette_image()
    mats = {}
    for name in ('Palette', 'Emissive'):
        m = bpy.data.materials.get(name)
        if m: bpy.data.materials.remove(m)
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes): nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.6
        if name == 'Emissive':
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 1.0
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        m.diffuse_color = (0.8, 0.8, 0.8, 1)
        mats[name] = m
    return mats

def rad(d): return math.radians(d)
def V(*a): return Vector(a if len(a) == 3 else a[0])

# ---------------------------------------------------------------- mesh builder (one mesh, every face palette-painted + bone-weighted)
LIGHT = Vector((0.45, -0.55, 0.7)).normalized()

class Builder:
    def __init__(self, name, shade_k=3.4, shade_bias=-1.1):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.dl = self.bm.verts.layers.deform.verify()
        self.groups = {}
        self.bone = None
        self.k = shade_k; self.bias = shade_bias
        self._det = 1.0

    # ---- bone assignment
    def b(self, bone):
        self.bone = bone
        if bone not in self.groups: self.groups[bone] = len(self.groups)
        return self

    def _m(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        m = Matrix.LocRotScale(Vector(loc), Euler(rot, 'XYZ'), Vector(scale))
        self._det = m.determinant()
        return m

    def _faces_of(self, verts):
        fs = set()
        for v in verts:
            for f in v.link_faces: fs.add(f)
        return list(fs)

    @staticmethod
    def spec(color):
        if isinstance(color, str): return FAM[color], 8
        f, s = color
        return (FAM[f] if isinstance(f, str) else f), s

    def add(self, faces, color, emissive=False, recalc=False, shade=True):
        faces = [f for f in faces if isinstance(f, bmesh.types.BMFace)]
        if self._det < 0: bmesh.ops.reverse_faces(self.bm, faces=faces)
        self._det = 1.0
        if recalc: bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        fam, base = self.spec(color)
        gi = self.groups[self.bone] if self.bone is not None else None
        if self.bone is not None and self.bone not in self.groups: gi = self.groups.setdefault(self.bone, len(self.groups))
        for f in faces:
            f.normal_update()
            sh = base
            if shade and not emissive and self.k:
                sh = base + int(round(self.k * f.normal.dot(LIGHT) + self.bias))
            sh = max(0, min(15, sh))
            u, v = pal(fam, sh)
            f.material_index = 1 if emissive else 0
            f.smooth = False
            for l in f.loops: l[self.uv].uv = (u, v)
            if gi is not None:
                for vt in f.verts: vt[self.dl][gi] = 1.0
        return faces

    # ---- primitives (all in bind-pose world coordinates; no negative scales please)
    def box(self, size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), color='grey', emissive=False, taper=None, **kw):
        m = self._m(loc, rot, size)
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        if taper is not None:   # (top_x, top_y) multipliers applied to the +local-Z verts
            mm = Matrix.LocRotScale(Vector(loc), Euler(rot, 'XYZ'), Vector((1, 1, 1))); inv = mm.inverted()
            for v in r['verts']:
                lv = inv @ v.co
                if lv.z > 0: lv.x *= taper[0]; lv.y *= taper[1]
                v.co = mm @ lv
        return self.add(self._faces_of(r['verts']), color, emissive, **kw)

    def cyl(self, r1=0.5, r2=None, depth=1.0, seg=8, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), color='grey', emissive=False, caps=True, **kw):
        if r2 is None: r2 = r1
        m = self._m(loc, rot, scale)
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth, matrix=m)
        return self.add(self._faces_of(res['verts']), color, emissive, **kw)

    def sphere(self, r=0.5, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), seg=8, rings=6, color='grey', emissive=False, **kw):
        m = self._m(loc, rot, scale)
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=r, matrix=m)
        return self.add(self._faces_of(res['verts']), color, emissive, **kw)

    def ico(self, r=0.5, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), sub=1, color='grey', emissive=False, **kw):
        m = self._m(loc, rot, scale)
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=r, matrix=m)
        return self.add(self._faces_of(res['verts']), color, emissive, **kw)

    def seg(self, p0, p1, r0, r1=None, n=6, color='grey', emissive=False, sx=1.0, sy=1.0, caps=True, roll=0.0, **kw):
        """frustum from p0 (radius r0) to p1 (radius r1); sx = width across the leg's sideways axis, sy = depth."""
        p0 = Vector(p0); p1 = Vector(p1)
        if r1 is None: r1 = r0
        d = p1 - p0; L = d.length
        if L < 1e-6: return []
        z = d / L
        ref = Vector((0, 0, 1)) if abs(z.z) < 0.95 else Vector((0, 1, 0))
        x = ref.cross(z).normalized(); y = z.cross(x)
        R = Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z)))
        if roll: R = R @ Matrix.Rotation(roll, 3, 'Z')
        m = Matrix.Translation((p0 + p1) / 2) @ R.to_4x4() @ Matrix.Diagonal((sx, sy, 1, 1))
        self._det = m.determinant()
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=n, radius1=max(r0, 1e-4), radius2=max(r1, 1e-4), depth=L, matrix=m)
        return self.add(self._faces_of(res['verts']), color, emissive, **kw)

    def spike(self, base, tip, r, n=4, color='bone', emissive=False, **kw):
        return self.seg(base, tip, r, 0.0, n=n, color=color, emissive=emissive, caps=True, **kw)

    def torus(self, R=1.0, r=0.1, major=16, minor=4, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), color='grey', emissive=False, **kw):
        m = self._m(loc, rot, scale)
        rings = []
        for i in range(major):
            a = 2 * math.pi * i / major
            ring = []
            for j in range(minor):
                bb = 2 * math.pi * j / minor
                ring.append(self.bm.verts.new(m @ Vector(((R + r * math.cos(bb)) * math.cos(a), (R + r * math.cos(bb)) * math.sin(a), r * math.sin(bb)))))
            rings.append(ring)
        faces = []
        for i in range(major):
            for j in range(minor):
                a = rings[i][j]; b2 = rings[i][(j + 1) % minor]; c = rings[(i + 1) % major][(j + 1) % minor]; d = rings[(i + 1) % major][j]
                faces.append(self.bm.faces.new((a, d, c, b2)))
        return self.add(faces, color, emissive, recalc=True, **kw)

    def prism(self, pts, depth, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), color='grey', emissive=False, center=True, **kw):
        m = self._m(loc, rot, scale)
        z0 = -depth / 2 if center else 0; z1 = depth / 2 if center else depth
        bot = [self.bm.verts.new(m @ Vector((x, y, z0))) for x, y in pts]
        top = [self.bm.verts.new(m @ Vector((x, y, z1))) for x, y in pts]
        n = len(pts)
        faces = [self.bm.faces.new(tuple(reversed(bot))), self.bm.faces.new(tuple(top))]
        for i in range(n): faces.append(self.bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i])))
        return self.add(faces, color, emissive, recalc=True, **kw)

    def loft(self, sections, caps=True, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), color='grey', emissive=False, **kw):
        """sections: list of (z, [(x,y)...]) same point count, lofted along local Z."""
        m = self._m(loc, rot, scale)
        rings = [[self.bm.verts.new(m @ Vector((x, y, z))) for x, y in pts] for z, pts in sections]
        n = len(rings[0]); faces = []
        for k in range(len(rings) - 1):
            for i in range(n):
                faces.append(self.bm.faces.new((rings[k][i], rings[k][(i + 1) % n], rings[k + 1][(i + 1) % n], rings[k + 1][i])))
        if caps:
            faces.append(self.bm.faces.new(tuple(reversed(rings[0])))); faces.append(self.bm.faces.new(tuple(rings[-1])))
        return self.add(faces, color, emissive, recalc=True, **kw)

    def tube(self, pts, radii, n=6, color='grey', emissive=False, caps=True, ref=(0, 0, 1), flat=1.0, **kw):
        """tube along a polyline (curved tentacles, tails). radii: float or (rx, rz) per point."""
        self._det = 1.0
        pts = [Vector(p) for p in pts]; rings = []
        for i, c in enumerate(pts):
            T = (pts[1] - c) if i == 0 else (c - pts[i - 1]) if i == len(pts) - 1 else (pts[i + 1] - pts[i - 1])
            T.normalize(); rf = Vector(ref)
            if abs(T.dot(rf)) > 0.95: rf = Vector((0, 1, 0)) if abs(T.y) < 0.9 else Vector((1, 0, 0))
            S = T.cross(rf).normalized(); U = S.cross(T).normalized()
            r = radii[i]; rx, rz = (r, r) if not isinstance(r, tuple) else r
            rings.append([self.bm.verts.new(c + S * (math.cos(2 * math.pi * k / n) * rx) + U * (math.sin(2 * math.pi * k / n) * rz * flat)) for k in range(n)])
        faces = []
        for i in range(len(rings) - 1):
            for k in range(n):
                faces.append(self.bm.faces.new((rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k])))
        if caps:
            faces.append(self.bm.faces.new(tuple(reversed(rings[0])))); faces.append(self.bm.faces.new(tuple(rings[-1])))
        return self.add(faces, color, emissive, recalc=True, **kw)

    def tri(self, pts, color='grey', emissive=False, both=False, **kw):
        """single polygon (wing membranes, flags, fins); both=True adds the reverse face too."""
        self._det = 1.0
        vs = [self.bm.verts.new(Vector(p)) for p in pts]
        fs = [self.bm.faces.new(vs)]
        out = self.add(fs, color, emissive, **kw)
        if both:
            vs2 = [self.bm.verts.new(Vector(p)) for p in reversed(pts)]
            out += self.add([self.bm.faces.new(vs2)], color, emissive, **kw)
        return out

    def gear(self, R, depth, teeth=10, loc=(0, 0, 0), rot=(0, 0, 0), color=('gold', 9), hole=0.0, ratio=0.8, emissive=False, **kw):
        """a cog disc (axis = local Z); hole>0 -> annulus."""
        pts = gear_pts(R * ratio, R, teeth)
        if hole > 0:
            inner = [(hole * math.cos(math.atan2(y, x)), hole * math.sin(math.atan2(y, x))) for x, y in pts]
            return self.annulus(pts, inner, depth, loc=loc, rot=rot, color=color, emissive=emissive, **kw)
        return self.prism(pts, depth, loc=loc, rot=rot, color=color, emissive=emissive, **kw)

    def annulus(self, outer, inner, depth, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), color='grey', emissive=False, **kw):
        m = self._m(loc, rot, scale)
        z0 = -depth / 2; z1 = depth / 2; n = len(outer)
        vo0 = [self.bm.verts.new(m @ Vector((x, y, z0))) for x, y in outer]; vo1 = [self.bm.verts.new(m @ Vector((x, y, z1))) for x, y in outer]
        vi0 = [self.bm.verts.new(m @ Vector((x, y, z0))) for x, y in inner]; vi1 = [self.bm.verts.new(m @ Vector((x, y, z1))) for x, y in inner]
        faces = []
        for i in range(n):
            j = (i + 1) % n
            faces.append(self.bm.faces.new((vo1[i], vo1[j], vi1[j], vi1[i])))
            faces.append(self.bm.faces.new((vo0[j], vo0[i], vi0[i], vi0[j])))
            faces.append(self.bm.faces.new((vo0[i], vo0[j], vo1[j], vo1[i])))
            faces.append(self.bm.faces.new((vi0[j], vi0[i], vi1[i], vi1[j])))
        return self.add(faces, color, emissive, recalc=True, **kw)

def gear_pts(r_in, r_out, teeth, phase=0.0, w0=0.10, w1=0.42):
    pts = []; s = 2 * math.pi / teeth
    for i in range(teeth):
        a = phase + i * s
        for ang, r in ((a, r_in), (a + w0 * s, r_out), (a + w1 * s, r_out), (a + (w1 + w0) * s, r_in)):
            pts.append((r * math.cos(ang), r * math.sin(ang)))
    return pts

def circ_pts(r, n, phase=0.0):
    return [(r * math.cos(phase + 2 * math.pi * i / n), r * math.sin(phase + 2 * math.pi * i / n)) for i in range(n)]

# ---------------------------------------------------------------- rig definition
class Rig:
    def __init__(self):
        self.bones = []      # dicts
        self.by = {}
    def add(self, name, parent, head, tail=None, role='', **p):
        head = Vector(head)
        if tail is None: tail = head + Vector((0, 0, 0.1))
        tail = Vector(tail)
        if (tail - head).length < 1e-4: tail = head + Vector((0, 0, 0.05))
        b = dict(name=name, parent=parent, head=head, tail=tail, role=role, p=p)
        self.bones.append(b); self.by[name] = b
        return b

def build_armature(rig, name):
    ad = bpy.data.armatures.new(name + 'Rig')
    ob = bpy.data.objects.new(name + 'Rig', ad)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    for o in bpy.data.objects: o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for b in rig.bones:
        e = ad.edit_bones.new(b['name'])
        e.head = b['head']; e.tail = b['tail']
        eb[b['name']] = e
    for b in rig.bones:
        if b['parent']: eb[b['name']].parent = eb[b['parent']]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob

def finish_mesh(B, arm_ob, name):
    bm = B.bm
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    mats = make_materials()
    me.materials.append(mats['Palette']); me.materials.append(mats['Emissive'])
    for g, i in sorted(B.groups.items(), key=lambda kv: kv[1]): ob.vertex_groups.new(name=g)
    for p in me.polygons: p.use_smooth = False
    ob.parent = arm_ob
    md = ob.modifiers.new('Armature', 'ARMATURE'); md.object = arm_ob
    bm.free()
    return ob

def tri_count(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg); me = eo.to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    eo.to_mesh_clear()
    return n

def mesh_bounds(ob, evaluated=True):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg) if evaluated else ob
    me = eo.to_mesh()
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for v in me.vertices:
        w = ob.matrix_world @ v.co
        mn = Vector((min(mn[i], w[i]) for i in range(3))); mx = Vector((max(mx[i], w[i]) for i in range(3)))
    eo.to_mesh_clear()
    return mn, mx

# ---------------------------------------------------------------- poses
AXV = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}
_M3 = {}

def _q(arm, bone, axis, deg):
    key = (arm.name, bone)
    if key not in _M3: _M3[key] = arm.pose.bones[bone].bone.matrix_local.to_3x3().inverted()
    wa = AXV[axis] if isinstance(axis, str) else Vector(axis).normalized()
    la = (_M3[key] @ wa).normalized()
    return Quaternion(la, math.radians(deg))

class Pose:
    def __init__(self): self.r = {}; self.l = {}; self.s = {}
    def scl(self, bone, s): self.s[bone] = s; return self
    def rot(self, bone, axis, deg):
        self.r.setdefault(bone, []).append((axis, deg)); return self
    def loc(self, bone, x=0, y=0, z=0):
        o = self.l.get(bone, (0, 0, 0)); self.l[bone] = (o[0] + x, o[1] + y, o[2] + z); return self

def apply_pose(arm, P):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        q = Quaternion((1, 0, 0, 0))
        for ax, deg in P.r.get(pb.name, []): q = _q(arm, pb.name, ax, deg) @ q
        pb.rotation_quaternion = q
        pb.location = (0, 0, 0)
        pb.scale = (P.s.get(pb.name, 1.0),) * 3
    for b, (x, y, z) in P.l.items():
        pb = arm.pose.bones[b]
        key = (arm.name, b)
        if key not in _M3: _M3[key] = pb.bone.matrix_local.to_3x3().inverted()
        pb.location = _M3[key] @ Vector((x, y, z))
    bpy.context.view_layer.update()

# ---------------------------------------------------------------- generic procedural clips driven by bone roles
def S(a, b, x):
    u = max(0.0, min(1.0, (x - a) / (b - a))); return u * u * (3 - 2 * u)
def sgn(name): return 1 if name.endswith('_L') else -1 if name.endswith('_R') else 1

CLIP_DEFS = {   # name: (frames @30fps, loop)
    'idle': (60, True), 'walk': (30, True), 'attack': (30, False), 'hit': (16, False), 'die': (48, False),
}

class Creature:
    """name, H (body height in m, scales bobbing), die = 'back' | 'side' | 'sink' | 'fall' | 'collapse'"""
    def __init__(self, name, H, die='back', die_lift=None, die_side=1, clips=None, shade_k=3.4):
        self.name = name; self.H = H; self.die = die; self.die_lift = H * 0.1 if die_lift is None else die_lift; self.die_side = die_side
        self.B = Builder(name, shade_k=shade_k); self.rig = Rig(); self.clips = dict(CLIP_DEFS)
        self.custom = {}      # clip -> fn(t, P, C)  (adds to the generic pose)  /  replace-mode if fn.replace
        self.idle_secs = 2.0
        if clips: self.clips.update(clips)
    def bone(self, name, parent, head, tail=None, role='', **p):
        return self.rig.add(name, parent, head, tail, role, **p)
    def has(self, n): return n in self.rig.by

    # -- the generic pose generator
    def pose(self, clip, t):
        P = Pose(); H = self.H
        ph = 2 * math.pi * t
        u = t
        pw = S(0, 0.38, u) * (1 - S(0.38, 0.5, u)) if clip == 'attack' else 0.0     # wind-up amount
        ps = S(0.38, 0.5, u) * (1 - S(0.62, 1.0, u)) if clip == 'attack' else 0.0   # strike amount
        opn = S(0.15, 0.4, u) * (1 - S(0.6, 0.85, u)) if clip == 'attack' else 0.0   # mouth open
        bump = math.sin(math.pi * min(1.0, u / 0.55)) * (1 - S(0.55, 1.0, u)) if clip == 'hit' else 0.0
        fall = S(0.10, 0.62, u) if clip == 'die' else 0.0
        slump = S(0.3, 1.0, u) if clip == 'die' else 0.0
        jolt = math.sin(math.pi * min(1.0, u / 0.15)) * (1 - S(0.15, 0.3, u)) if clip == 'die' else 0.0
        for b in self.rig.bones:
            n = b['name']; r = b['role']; p = b['p']; sx = sgn(n); a = p.get('a', 1.0)
            ang = p.get('lag', 0.0)
            if clip == 'idle':
                if r == 'root': P.loc(n, 0, 0, p.get('bob', 0.012) * H * math.sin(2 * ph)); P.rot(n, 'Z', 1.0 * math.sin(ph))
                elif r == 'spine': P.rot(n, 'X', -1.4 * a * math.sin(ph + 0.5 + ang))
                elif r in ('neck', 'head'): P.rot(n, 'X', 1.8 * a * math.sin(ph + 1.0 + ang)); P.rot(n, 'Z', p.get('look', 3.0) * math.sin(ph * 0.5 + ang + n.__hash__() % 7))
                elif r == 'jaw': P.rot(n, 'X', p.get('rest', 2.0) + 1.5 * math.sin(ph))
                elif r in ('arm', 'wing_arm'): P.rot(n, 'X', 2.0 * a * math.sin(ph + 0.4 + (0 if sx > 0 else 0.3))); P.rot(n, 'Y', -sx * p.get('sway', 1.2) * math.sin(ph))
                elif r == 'forearm': P.rot(n, 'X', -3 * a + 2 * math.sin(ph + 0.8))
                elif r == 'wing': P.rot(n, 'Y', -sx * p.get('flap', 6.0) * 0.5 * math.sin(ph + ang))
                elif r in ('tail', 'sway'): P.rot(n, p.get('axis', 'Z'), p.get('amp', 8.0) * math.sin(ph - 0.7 * p.get('i', 0) + ang)); P.rot(n, 'X' if p.get('axis', 'Z') != 'X' else 'Z', 0.4 * p.get('amp', 8.0) * math.sin(ph * 2 - 0.5 * p.get('i', 0)))
                elif r == 'spin': P.rot(n, p.get('axis', 'Z'), 360.0 * p.get('turns', 1) * t * (-1 if p.get('rev') else 1))
                elif r == 'float': P.loc(n, 0, 0, p.get('bob', 0.03) * H * math.sin(ph + ang))
            elif clip == 'walk':
                if r == 'root': P.loc(n, 0, 0, p.get('bobw', p.get('bob', 0.012) * 1.6) * H * math.sin(2 * ph + 1.2)); P.rot(n, 'Z', p.get('sway', 2.5) * math.sin(ph)); P.rot(n, 'X', p.get('lean', 0))
                elif r == 'spine': P.rot(n, 'Z', -3.0 * a * math.sin(ph + ang)); P.rot(n, 'X', 1.5 * a * math.sin(2 * ph))
                elif r in ('neck', 'head'): P.rot(n, 'Z', 3.0 * a * math.sin(ph + 0.4 + ang)); P.rot(n, 'X', 2.0 * a * math.sin(2 * ph + 1.0))
                elif r == 'jaw': P.rot(n, 'X', p.get('rest', 2.0))
                elif r == 'arm': P.rot(n, 'X', p.get('swing', 26.0) * a * sx * math.sin(ph + p.get('phase', 0.0))); P.rot(n, 'Y', -sx * p.get('sway', 1.2))
                elif r == 'forearm': P.rot(n, 'X', -8 * a - 14 * a * max(0, sx * math.sin(ph + p.get('phase', 0.0))))
                elif r == 'leg':
                    pp = ph + p.get('phase', 0.0)
                    P.rot(n, 'X', -p.get('swing', 24.0) * a * math.sin(pp))
                elif r == 'shin':
                    pp = ph + p.get('phase', 0.0)
                    P.rot(n, 'X', p.get('flex', 36.0) * a * max(0.0, math.cos(pp)) + 3)
                elif r == 'foot':
                    pp = ph + p.get('phase', 0.0)
                    P.rot(n, 'X', 14 * max(0.0, math.cos(pp)) - 6 * math.sin(pp))
                elif r == 'wing': P.rot(n, 'Y', -sx * p.get('flap', 6.0) * math.sin(ph * p.get('flapx', 2) + ang))
                elif r in ('tail', 'sway'): P.rot(n, p.get('axis', 'Z'), p.get('amp', 8.0) * 1.3 * math.sin(ph - 0.7 * p.get('i', 0) + ang))
                elif r == 'spin': P.rot(n, p.get('axis', 'Z'), 360.0 * p.get('turns', 1) * 2 * t * (-1 if p.get('rev') else 1))
                elif r == 'float': P.loc(n, 0, 0, p.get('bob', 0.03) * 1.5 * H * math.sin(ph * 2 + ang))
            elif clip == 'attack':
                lean = -p.get('lean', 8.0) * pw + p.get('strike', 12.0) * ps
                if r == 'root': P.rot(n, 'X', -4 * pw + 6 * ps); P.loc(n, 0, -0.10 * H * ps * p.get('lunge', 1.0) + 0.04 * H * pw, 0)
                elif r == 'spine': P.rot(n, 'X', lean * a)
                elif r in ('neck', 'head'): P.rot(n, 'X', (-p.get('lean', 8.0) * 1.2 * pw + p.get('strike', 12.0) * 1.3 * ps) * a)
                elif r == 'jaw': P.rot(n, 'X', p.get('open', 38.0) * opn + p.get('rest', 2.0))
                elif r == 'arm':
                    if p.get('strike_arm', True): P.rot(n, 'X', -p.get('raise', 140.0) * pw - p.get('slam', 35.0) * ps); P.rot(n, 'Y', -sx * 8 * pw)
                    else: P.rot(n, 'X', -20 * pw + 10 * ps)
                elif r == 'forearm': P.rot(n, 'X', -30 * pw - 8 * ps)
                elif r == 'leg': P.rot(n, 'X', -p.get('swing', 24.0) * 0.45 * a * (-pw * sx * 0 + ps * (1 if p.get('phase', 0) == 0 else -1)))
                elif r == 'wing': P.rot(n, 'Y', -sx * (p.get('flap', 6.0) * 2.5 * pw - p.get('flap', 6.0) * 2 * ps))
                elif r in ('tail', 'sway'): P.rot(n, p.get('axis', 'Z'), p.get('amp', 8.0) * (1.5 * ps - 1.0 * pw) * (1 if p.get('i', 0) % 2 else -1))
                elif r == 'spin': P.rot(n, p.get('axis', 'Z'), 360.0 * p.get('turns', 1) * 3 * t * (-1 if p.get('rev') else 1))
                elif r == 'float': P.loc(n, 0, 0, p.get('bob', 0.03) * H * (math.sin(ph) * 0.5))
            elif clip == 'hit':
                if r == 'root': P.rot(n, 'X', -7 * bump * p.get('hitamp', 1.0)); P.loc(n, 0, 0.05 * H * bump, 0)
                elif r == 'spine': P.rot(n, 'X', -7 * a * bump)
                elif r in ('neck', 'head'): P.rot(n, 'X', -14 * a * bump); P.rot(n, 'Z', 6 * a * bump)
                elif r == 'jaw': P.rot(n, 'X', 18 * bump + p.get('rest', 2.0))
                elif r == 'arm': P.rot(n, 'X', 18 * bump); P.rot(n, 'Y', -sx * 10 * bump)
                elif r == 'wing': P.rot(n, 'Y', -sx * p.get('flap', 6.0) * 3 * bump)
                elif r in ('tail', 'sway'): P.rot(n, p.get('axis', 'Z'), p.get('amp', 8.0) * 1.8 * bump * (1 if p.get('i', 0) % 2 else -1))
                elif r == 'spin': P.rot(n, p.get('axis', 'Z'), 40 * bump)
            elif clip == 'die':
                if r == 'root':
                    if self.die == 'back':
                        P.rot(n, 'X', -88 * fall); P.loc(n, 0, 0, self.die_lift * fall)
                    elif self.die == 'side':
                        P.rot(n, 'Y', 88 * fall * self.die_side); P.rot(n, 'X', 4 * fall); P.loc(n, 0, 0, self.die_lift * fall)
                    elif self.die == 'sink':
                        P.loc(n, 0, 0, -p.get('sink', 0.9) * H * fall); P.rot(n, 'X', 14 * fall)
                    elif self.die == 'collapse':
                        P.loc(n, 0, 0, -p.get('sink', 0.35) * H * fall); P.rot(n, 'X', -30 * fall)
                    elif self.die == 'flip':
                        P.rot(n, 'Y', 178 * fall * self.die_side); P.loc(n, 0, 0, self.die_lift * fall)
                    elif self.die == 'pop':
                        P.scl(n, max(0.04, 1 - 0.96 * S(0.25, 0.9, u))); P.loc(n, 0, 0, 0.1 * H * fall)
                    elif self.die == 'fall':
                        P.rot(n, 'Y', 70 * fall * self.die_side); P.rot(n, 'X', 25 * fall); P.loc(n, 0, 0, self.die_lift * fall)
                    P.rot(n, 'X', -6 * jolt)
                elif r == 'spine': P.rot(n, 'X', -8 * a * jolt + 8 * a * slump)
                elif r in ('neck', 'head'): P.rot(n, 'X', -18 * a * jolt + 22 * a * slump)
                elif r == 'jaw': P.rot(n, 'X', 20 * jolt + 28 * slump)
                elif r == 'arm': P.rot(n, 'X', 15 * jolt - 30 * slump * (1 if sx > 0 else 0.4)); P.rot(n, 'Y', -sx * 25 * slump)
                elif r == 'forearm': P.rot(n, 'X', -25 * slump)
                elif r == 'leg': P.rot(n, 'X', -18 * slump * (1 if sx > 0 else -0.5))
                elif r == 'shin': P.rot(n, 'X', 24 * slump)
                elif r == 'wing': P.rot(n, 'Y', sx * 50 * slump)
                elif r in ('tail', 'sway'): P.rot(n, p.get('axis', 'Z'), 20 * slump * (1 if p.get('i', 0) % 2 else 0.5))
        fn = self.custom.get(clip)
        if fn: fn(t, P, self)
        return P

    def bake(self, arm, step=2):
        arm.animation_data_create(); ad = arm.animation_data
        for a in list(bpy.data.actions): bpy.data.actions.remove(a)
        for tr in list(ad.nla_tracks): ad.nla_tracks.remove(tr)
        info = {}
        for name, (nfr, loop) in self.clips.items():
            act = bpy.data.actions.new(name); act.use_fake_user = True
            ad.action = act
            frames = list(range(0, nfr + 1, step))
            if frames[-1] != nfr: frames.append(nfr)
            for fr in frames:
                P = self.pose(name, fr / nfr)
                apply_pose(arm, P)
                for pb in arm.pose.bones:
                    pb.keyframe_insert('rotation_quaternion', frame=fr + 1)
                    if pb.name in P.l or pb.name == self.rig.bones[0]['name']: pb.keyframe_insert('location', frame=fr + 1)
                    if pb.name in P.s: pb.keyframe_insert('scale', frame=fr + 1)
            act.use_frame_range = True; act.frame_start = 1; act.frame_end = (nfr if loop else nfr + 1)
            info[name] = (len(frames), nfr)
            ad.action = None
            tr = ad.nla_tracks.new(); tr.name = name
            st = tr.strips.new(name, 1, act); st.name = name
        # leave the rig at rest
        apply_pose(arm, Pose())
        return info

# ---------------------------------------------------------------- build / export / preview
def build_creature(C):
    """finish the mesh + armature of a Creature definition -> (arm_ob, mesh_ob)"""
    arm = build_armature(C.rig, C.name)
    ob = finish_mesh(C.B, arm, C.name)
    return arm, ob

def export_glb(C, arm, ob, path=None):
    path = path or (EXP + rf'\{C.name}_raw.glb')
    for o in bpy.data.objects: o.select_set(False)
    arm.select_set(True); ob.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.context.scene.render.fps = 30
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1, export_skins=True, export_def_bones=False,
        export_image_format='AUTO', export_materials='EXPORT', export_extras=False, export_cameras=False, export_lights=False, export_optimize_animation_size=True)
    return path

def _stitch(paths, out):
    import numpy as np
    imgs = [bpy.data.images.load(p) for p in paths]
    w, h = imgs[0].size
    arrs = []
    for im in imgs:
        a = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(a); arrs.append(a.reshape(h, w, 4))
    full = np.concatenate(arrs, axis=1)
    o = bpy.data.images.new('stitch', full.shape[1], full.shape[0], alpha=True)
    o.pixels.foreach_set(full.ravel()); o.filepath_raw = out; o.file_format = 'PNG'; o.save()
    for im in imgs + [o]: bpy.data.images.remove(im)

def preview(name, ob, views=((35, 16), (-60, 14), (150, 16)), res=520, margin=1.0, dist_mul=1.0, bg=(0.2, 0.22, 0.27), out=None, center=None, radius=None):
    sc = bpy.context.scene
    mn, mx = mesh_bounds(ob)
    ctr = (mn + mx) / 2 if center is None else Vector(center)
    rad_ = ((mx - mn).length / 2) if radius is None else radius
    cam = bpy.data.objects.get('_cam')
    if cam is None:
        cd = bpy.data.cameras.new('_cam'); cam = bpy.data.objects.new('_cam', cd); sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 50; cam.data.sensor_width = 36; cam.data.clip_end = 1000; cam.data.clip_start = 0.01; cam.data.type = 'PERSP'
    dist = rad_ * 2.5 * margin * dist_mul
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'; sh.show_cavity = False; sh.show_shadows = False; sh.show_specular_highlight = False
    sh.show_object_outline = True; sh.object_outline_color = (0, 0, 0)
    sc.display.render_aa = '8'
    sc.render.resolution_x = res; sc.render.resolution_y = res; sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new('W'); sc.world.color = bg
    sc.render.image_settings.file_format = 'PNG'; sc.view_settings.view_transform = 'Standard'
    paths = []
    for i, (az, el) in enumerate(views):
        a = math.radians(az); e = math.radians(el)
        d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
        cam.location = ctr + d * dist
        cam.rotation_euler = (ctr - cam.location).normalized().to_track_quat('-Z', 'Y').to_euler()
        p = PREV + rf'\_tmp_{name}_{i}.png'
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    out = out or (PREV + rf'\{name}.png')
    _stitch(paths, out)
    for p in paths:
        try: os.remove(p)
        except Exception: pass
    return out

def pose_sheet(C, arm, ob, items, name, res=420, **kw):
    """items: list of (clip, t) -> one stitched png of the posed model (front 3/4)."""
    paths = []
    if arm.animation_data: arm.animation_data.use_nla = False
    mn, mx = mesh_bounds(ob); ctr = (mn + mx) / 2; r_ = (mx - mn).length / 2
    for i, (clip, t) in enumerate(items):
        apply_pose(arm, C.pose(clip, t))
        paths.append(preview(f'{name}_p{i}', ob, views=((35, 16),), res=res, center=ctr, radius=r_, out=PREV + rf'\_ps_{name}_{i}.png', **kw))
    out = PREV + rf'\{name}_poses.png'
    _stitch(paths, out)
    for p in paths:
        try: os.remove(p)
        except Exception: pass
    apply_pose(arm, Pose())
    return out



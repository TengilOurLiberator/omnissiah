# props_lib.py -- extra Builder shapes for the static hero props (cogs, rings, lofted paths, lit shading)

def gear_pts(r_in, r_out, teeth, phase=0.0, w0=0.10, w1=0.42):
    pts = []
    s = 2 * math.pi / teeth
    for i in range(teeth):
        a = phase + i * s
        for ang, r in ((a, r_in), (a + w0 * s, r_out), (a + w1 * s, r_out), (a + (w1 + w0) * s, r_in)):
            pts.append((r * math.cos(ang), r * math.sin(ang)))
    return pts

def circ_pts(r, n, phase=0.0):
    return [(r * math.cos(phase + 2 * math.pi * i / n), r * math.sin(phase + 2 * math.pi * i / n)) for i in range(n)]

def _lit_apply(self):
    for faces, fam, base, k in self._lit:
        for f in faces:
            if not f.is_valid: continue
            n = f.normal
            sh = base + int(round(n.z * k + n.x * 0.7 - n.y * 0.4))
            self._paint([f], (fam, max(0, min(15, sh))), f.material_index == 1)

def lit(self, faces, fam, base, k=2.2):
    if not hasattr(self, '_lit'): self._lit = []
    self._lit.append((faces, fam, base, k))
Builder.lit = lit

def _finish2(self, link=True, loc=(0, 0, 0)):
    bm = self.bm
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if hasattr(self, '_lit'): _lit_apply(self)
    return _orig_finish(self, link, loc)
_orig_finish = Builder.finish
Builder.finish = _finish2

def annulus(self, outer, inner, depth, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), color='grey', wall=None, emissive=False, closed=True, center=True):
    """Extruded ring between two equal-length polylines (XY plane, extrude along Z)."""
    m = self._m(loc, rot, scale)
    z0 = -depth / 2 if center else 0; z1 = depth / 2 if center else depth
    n = len(outer)
    vo0 = [self.bm.verts.new(m @ Vector((x, y, z0))) for x, y in outer]; vo1 = [self.bm.verts.new(m @ Vector((x, y, z1))) for x, y in outer]
    vi0 = [self.bm.verts.new(m @ Vector((x, y, z0))) for x, y in inner]; vi1 = [self.bm.verts.new(m @ Vector((x, y, z1))) for x, y in inner]
    top = []; bot = []; wo = []; wi = []
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        j = (i + 1) % n
        top.append(self.bm.faces.new((vo1[i], vo1[j], vi1[j], vi1[i])))
        bot.append(self.bm.faces.new((vo0[j], vo0[i], vi0[i], vi0[j])))
        wo.append(self.bm.faces.new((vo0[i], vo0[j], vo1[j], vo1[i])))
        wi.append(self.bm.faces.new((vi0[j], vi0[i], vi1[i], vi1[j])))
    caps = []
    if not closed:
        caps.append(self.bm.faces.new((vo0[0], vi0[0], vi1[0], vo1[0])))
        caps.append(self.bm.faces.new((vi0[n - 1], vo0[n - 1], vo1[n - 1], vi1[n - 1])))
    if getattr(self, '_det', 1.0) < 0 if False else False: pass
    self.add(top + bot, color, emissive)
    self.add(wo + wi + caps, wall or color, emissive)
    return top + bot + wo + wi
Builder.annulus = annulus

def loft_path(self, pts, radii, n=6, color='grey', emissive=False, cap_start=True, cap_end=True, ref=(0, 0, 1), flat=1.0, lit_spec=None):
    """Tube along a polyline. radii: float or (rx, rz) per point (0 = pinch to a point)."""
    pts = [Vector(p) for p in pts]
    rings = []
    for i, c in enumerate(pts):
        if i == 0: T = pts[1] - c
        elif i == len(pts) - 1: T = c - pts[i - 1]
        else: T = pts[i + 1] - pts[i - 1]
        T.normalize()
        rf = Vector(ref)
        if abs(T.dot(rf)) > 0.95: rf = Vector((0, 1, 0)) if abs(T.y) < 0.9 else Vector((0, 0, 1))
        S = T.cross(rf).normalized(); U = S.cross(T).normalized()
        r = radii[i]; rx, rz = (r, r) if not isinstance(r, tuple) else r
        ring = [self.bm.verts.new(c + S * (math.cos(2 * math.pi * k / n) * rx) + U * (math.sin(2 * math.pi * k / n) * rz * flat)) for k in range(n)]
        rings.append(ring)
    faces = []
    for i in range(len(rings) - 1):
        for k in range(n):
            faces.append(self.bm.faces.new((rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k])))
    if cap_start: faces.append(self.bm.faces.new(tuple(reversed(rings[0]))))
    if cap_end: faces.append(self.bm.faces.new(tuple(rings[-1])))
    bmesh.ops.recalc_face_normals(self.bm, faces=faces)
    self.add(faces, color, emissive)
    if lit_spec: self.lit(faces, *lit_spec)
    return faces
Builder.loft_path = loft_path

def arc_pts(c, r, a0, a1, n, plane='xz'):
    """points on an arc: plane 'xz' (x right, z up) or 'yz' or 'xy'; angles in degrees."""
    out = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        u, v = r * math.cos(a), r * math.sin(a)
        if plane == 'xz': out.append((c[0] + u, c[1], c[2] + v))
        elif plane == 'yz': out.append((c[0], c[1] + u, c[2] + v))
        else: out.append((c[0] + u, c[1] + v, c[2]))
    return out

def star_pts(r_out, r_in, n=5, phase=math.pi / 2):
    pts = []
    for i in range(2 * n):
        r = r_out if i % 2 == 0 else r_in
        a = phase + math.pi * i / n
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts

def new_obj(name):
    return Builder(name)

def export_static(ob, name, extra_scale=1.0):
    """export just `ob` as BL/export/<name>_raw.glb (+Y up, modifiers applied)"""
    for o in bpy.data.objects: o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=BL + rf'\export\{name}_raw.glb', export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_animations=False, export_skins=False, export_image_format='AUTO', export_materials='EXPORT', export_extras=False, export_cameras=False, export_lights=False)


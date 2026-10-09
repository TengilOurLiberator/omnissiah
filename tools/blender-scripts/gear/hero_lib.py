# hero_lib.py -- shared helpers for the Omnissiah hero-asset Blender scripts.
# Usage inside Blender:  exec(open(r'D:\omnissiah\.cache\blender\tools\hero_lib.py').read())
import bpy, bmesh, math, colorsys, os, json
from mathutils import Vector, Matrix, Quaternion, Euler

ROOT = r'D:\omnissiah'
BL = ROOT + r'\.cache\blender'
PREV = BL + r'\previews'
HERO = ROOT + r'\public\assets\hero'
PAL_PNG = HERO + r'\hero-palette.png'
for _d in (BL, PREV, HERO, BL + r'\export'):
    os.makedirs(_d, exist_ok=True)

# ---------------------------------------------------------------- palette: 16 families x 16 shades, 16px cells in a 256px png
FAMILIES = [  # (name, hue, saturation)
    ('grey', 0.0, 0.0), ('stone', 0.10, 0.14), ('brown', 0.07, 0.55), ('tan', 0.09, 0.62),
    ('red', 0.0, 0.78), ('crimson', 0.97, 0.72), ('orange', 0.07, 0.92), ('gold', 0.125, 0.88),
    ('yellow', 0.165, 0.85), ('lime', 0.23, 0.62), ('green', 0.33, 0.55), ('teal', 0.47, 0.62),
    ('cyan', 0.54, 0.85), ('blue', 0.62, 0.68), ('purple', 0.76, 0.55), ('pink', 0.89, 0.62),
    ('moss', 0.27, 0.26), ('slate', 0.60, 0.22), ('ash', 0.76, 0.12), ('sand', 0.13, 0.40), ('olive', 0.18, 0.5), ('maroon', 0.99, 0.5), ('violet', 0.80, 0.8), ('bone', 0.12, 0.30),
    ('rust', 0.04, 0.72), ('sky', 0.57, 0.9), ('mint', 0.41, 0.5), ('rose', 0.95, 0.8), ('indigo', 0.68, 0.7), ('forest', 0.38, 0.45), ('peach', 0.06, 0.78), ('ember', 0.02, 0.95)]
FAM = {f[0]: i for i, f in enumerate(FAMILIES)}

def palette_rgb(fam, shade):
    name, h, s = FAMILIES[fam]
    t = shade / 15.0
    L = 0.05 + 0.92 * (t ** 0.95)
    sat = s * (0.55 + 0.45 * math.sin(min(1.0, t * 1.15) * math.pi * 0.95 + 0.0)) if s > 0 else 0
    sat = min(1.0, sat if t < 0.97 else sat * 0.5)
    r, g, b = colorsys.hls_to_rgb(h, L, sat)
    return (r, g, b)

NFAM = len(FAMILIES)
PAL =[[palette_rgb(f, s) for s in range(16)] for f in range(NFAM)]

def pal(fam, shade):
    """-> (u, v) centre of the palette cell. fam: name or index. shade 0 (dark) .. 15 (light)."""
    if isinstance(fam, str): fam = FAM[fam]
    return ((shade + 0.5) / 16.0, (fam + 0.5) / float(NFAM))  # v measured from the bottom row = family index

_pal_cache = {}
def nearest_cell(rgb):
    """rgb in sRGB 0..1 -> (fam, shade) nearest in the palette."""
    key = tuple(round(c, 3) for c in rgb)
    if key in _pal_cache: return _pal_cache[key]
    best = None; bd = 1e9
    for f in range(NFAM):
        for s in range(16):
            p = PAL[f][s]
            d = 2 * (p[0] - rgb[0]) ** 2 + 4 * (p[1] - rgb[1]) ** 2 + 3 * (p[2] - rgb[2]) ** 2
            if d < bd: bd = d; best = (f, s)
    _pal_cache[key] = best
    return best

def make_palette_png():
    img = bpy.data.images.get('hero-palette')
    if img: bpy.data.images.remove(img)
    img = bpy.data.images.new('hero-palette', 256, 16 * NFAM, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'sRGB'
    px = [0.0] * (256 * 16 * NFAM * 4)
    for f in range(NFAM):
        for s in range(16):
            r, g, b = PAL[f][s]
            # pixels are stored sRGB-encoded numbers; blender treats float pixels as linear -> write the raw numbers and save as 8 bit
            for yy in range(16):
                for xx in range(16):
                    X = s * 16 + xx; Y = f * 16 + yy
                    i = (Y * 256 + X) * 4
                    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 1.0
    img.pixels = px
    img.filepath_raw = PAL_PNG
    img.file_format = 'PNG'
    # save without colour transform: raw numbers (byte buffer image with sRGB colourspace stores them as-is)
    img.save()
    return img

def get_palette_image():
    img = bpy.data.images.get('hero-palette.png') or bpy.data.images.get('hero-palette')
    if img is None or img.size[0] == 0:
        img = bpy.data.images.load(PAL_PNG)
    img.colorspace_settings.name = 'sRGB'
    return img

# ---------------------------------------------------------------- materials
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
        tex.interpolation = 'Closest' if False else 'Linear'
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

# ---------------------------------------------------------------- mesh builder: accumulate coloured shapes into ONE mesh
class Builder:
    """Collects geometry in a bmesh; every face gets a palette colour (UV) and a material slot (0 Palette, 1 Emissive)."""
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')

    def _paint(self, faces, color, emissive=False):
        if isinstance(color, str):
            f, s = FAM[color], 8
        elif len(color) == 3:
            f, s = nearest_cell(tuple(color))
        else:
            f, s = (FAM[color[0]] if isinstance(color[0], str) else color[0]), color[1]
        u, v = pal(f, s)
        for face in faces:
            face.material_index = 1 if emissive else 0
            face.smooth = False
            for l in face.loops: l[self.uv].uv = (u, v)

    def _new_faces(self, geom):
        return [g for g in geom if isinstance(g, bmesh.types.BMFace)]

    def add(self, geom, color, emissive=False, xform=None):
        faces = self._new_faces(geom)
        self._paint(faces, color, emissive)
        return faces

    def _m(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        return Matrix.LocRotScale(Vector(loc), Euler(rot, 'XYZ'), Vector(scale))

    def box(self, size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), color='grey', emissive=False, taper=None):
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=self._m(loc, rot, size))
        geom = self._faces_of(r['verts'])
        if taper is not None:  # taper = (top_scale_x, top_scale_y) scale of +Z verts in local x/y
            m = self._m(loc, rot, (1, 1, 1))
            inv = m.inverted()
            for v in r['verts']:
                lv = inv @ v.co
                if lv.z > 0:
                    lv.x *= taper[0]; lv.y *= taper[1]
                v.co = m @ lv
        return self.add(geom, color, emissive)

    def _faces_of(self, verts):
        fs = set()
        for v in verts:
            for f in v.link_faces: fs.add(f)
        return list(fs)

    def cyl(self, r1=0.5, r2=None, depth=1.0, seg=8, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), color='grey', emissive=False, caps=True):
        """Cone/cylinder along local Z, centred on loc. r1 = bottom radius (z=-d/2), r2 = top radius."""
        if r2 is None: r2 = r1
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth,
                                    matrix=self._m(loc, rot, scale))
        return self.add(self._faces_of(res['verts']), color, emissive)

    def sphere(self, r=0.5, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), seg=8, rings=6, color='grey', emissive=False):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=r, matrix=self._m(loc, rot, scale))
        return self.add(self._faces_of(res['verts']), color, emissive)

    def ico(self, r=0.5, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), sub=1, color='grey', emissive=False):
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=r, matrix=self._m(loc, rot, scale))
        return self.add(self._faces_of(res['verts']), color, emissive)

    def torus(self, R=1.0, r=0.1, major=16, minor=6, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), color='grey', emissive=False):
        """Torus in local XY plane (axis Z)."""
        m = self._m(loc, rot, scale)
        verts = []
        rings = []
        for i in range(major):
            a = 2 * math.pi * i / major
            ring = []
            for j in range(minor):
                b = 2 * math.pi * j / minor
                x = (R + r * math.cos(b)) * math.cos(a); y = (R + r * math.cos(b)) * math.sin(a); z = r * math.sin(b)
                ring.append(self.bm.verts.new(m @ Vector((x, y, z))))
            rings.append(ring)
        faces = []
        for i in range(major):
            for j in range(minor):
                a = rings[i][j]; b = rings[i][(j + 1) % minor]; c = rings[(i + 1) % major][(j + 1) % minor]; d = rings[(i + 1) % major][j]
                faces.append(self.bm.faces.new((a, d, c, b)))
        return self.add(faces, color, emissive)

    def prism(self, pts, depth, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), color='grey', emissive=False, center=True):
        """Extrude a 2D polygon (list of (x,y) CCW) along local Z by depth."""
        m = self._m(loc, rot, scale)
        z0 = -depth / 2 if center else 0
        z1 = depth / 2 if center else depth
        bot = [self.bm.verts.new(m @ Vector((x, y, z0))) for x, y in pts]
        top = [self.bm.verts.new(m @ Vector((x, y, z1))) for x, y in pts]
        n = len(pts)
        faces = [self.bm.faces.new(tuple(reversed(bot))), self.bm.faces.new(tuple(top))]
        for i in range(n):
            faces.append(self.bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i])))
        return self.add(faces, color, emissive)

    def poly_loft(self, sections, closed_ends=True, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), color='grey', emissive=False):
        """sections: list of (z, [(x,y)...]) with the same number of points; lofted along Z."""
        m = self._m(loc, rot, scale)
        rings = [[self.bm.verts.new(m @ Vector((x, y, z))) for x, y in pts] for z, pts in sections]
        n = len(rings[0]); faces = []
        for k in range(len(rings) - 1):
            for i in range(n):
                faces.append(self.bm.faces.new((rings[k][i], rings[k][(i + 1) % n], rings[k + 1][(i + 1) % n], rings[k + 1][i])))
        if closed_ends:
            faces.append(self.bm.faces.new(tuple(reversed(rings[0]))))
            faces.append(self.bm.faces.new(tuple(rings[-1])))
        return self.add(faces, color, emissive)

    def tri_fan_pt(self, verts_xyz, color='grey', emissive=False):
        vs = [self.bm.verts.new(v) for v in verts_xyz]
        return self.add([self.bm.faces.new(vs)], color, emissive)

    def finish(self, link=True, loc=(0, 0, 0)):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        mats = make_materials() if 'Palette' not in bpy.data.materials or 'Emissive' not in bpy.data.materials else {k: bpy.data.materials[k] for k in ('Palette', 'Emissive')}
        me.materials.append(mats['Palette'])
        me.materials.append(mats['Emissive'])
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = loc
        for p in me.polygons: p.use_smooth = False
        return ob

def tri_count(ob, evaluated=True):
    if evaluated:
        dg = bpy.context.evaluated_depsgraph_get()
        me = ob.evaluated_get(dg).to_mesh()
        n = sum(len(p.vertices) - 2 for p in me.polygons)
        ob.evaluated_get(dg).to_mesh_clear()
        return n
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

# ---------------------------------------------------------------- scene housekeeping
def clear_scene(keep_images=True):
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for d in list(coll):
            if d.users == 0 or True:
                try: coll.remove(d)
                except Exception: pass
    for m in list(bpy.data.materials):
        if m.name not in ('Palette', 'Emissive'):
            try: bpy.data.materials.remove(m)
            except Exception: pass
    if not keep_images:
        for i in list(bpy.data.images):
            try: bpy.data.images.remove(i)
            except Exception: pass
    bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

# ---------------------------------------------------------------- preview rendering (workbench, texture colours, flat lighting)
def _stitch(paths, out):
    imgs = [bpy.data.images.load(p) for p in paths]
    w, h = imgs[0].size
    import numpy as np
    arrs = []
    for im in imgs:
        a = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(a); arrs.append(a.reshape(h, w, 4))
    full = np.concatenate(arrs, axis=1)
    o = bpy.data.images.new('stitch', full.shape[1], full.shape[0], alpha=True)
    o.pixels.foreach_set(full.ravel()); o.filepath_raw = out; o.file_format = 'PNG'; o.save()
    for im in imgs + [o]: bpy.data.images.remove(im)

def preview(name, objects, views=((35, 20), (-35, 20), (90, 5)), res=420, ortho=False, margin=1.15, center=None, size=None, hide_others=True, bg=(0.16, 0.17, 0.2), extra_dist=1.0):
    """Render each view (azimuth deg, elevation deg) of the given objects (+ children) and stitch into previews/<name>.png.
    azimuth 0 = looking from -Y toward +Y (front, Blender), 90 = from +X."""
    sc = bpy.context.scene
    allobs = set()
    for o in objects:
        allobs.add(o)
        for c in o.children_recursive: allobs.add(c)
    if hide_others:
        for o in bpy.data.objects:
            if o.type in ('MESH', 'ARMATURE', 'EMPTY', 'CURVE') and o not in allobs and not o.name.startswith('_cam'):
                o.hide_render = True
    for o in allobs:
        o.hide_render = False
    # bounds of mesh objects
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    dg = bpy.context.evaluated_depsgraph_get()
    for o in allobs:
        if o.type != 'MESH' or o.hide_render: continue
        if o.name.startswith('_'): continue
        eo = o.evaluated_get(dg)
        for c in eo.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector((min(mn[i], w[i]) for i in range(3))); mx = Vector((max(mx[i], w[i]) for i in range(3)))
    ctr = (mn + mx) / 2 if center is None else Vector(center)
    rad = ((mx - mn).length / 2) if size is None else size
    cam = bpy.data.objects.get('_cam')
    if cam is None:
        cd = bpy.data.cameras.new('_cam'); cam = bpy.data.objects.new('_cam', cd); sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 50
    cam.data.sensor_width = 36
    cam.data.clip_end = 1000; cam.data.clip_start = 0.01
    if ortho:
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = rad * 2 * margin
    else:
        cam.data.type = 'PERSP'
    dist = rad * 2.6 * margin * extra_dist if not ortho else rad * 4
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'; sh.show_cavity = False; sh.show_shadows = False
    sh.studio_light = 'studio.sl' if 'studio.sl' in [s.name for s in bpy.context.preferences.studio_lights] else sh.studio_light
    sh.show_specular_highlight = False
    sh.show_object_outline = True
    sh.object_outline_color = (0, 0, 0)
    sc.display.render_aa = '8'
    sc.render.resolution_x = res; sc.render.resolution_y = res; sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new('W')
    sc.world.color = bg
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'Standard'
    paths = []
    for i, (az, el) in enumerate(views):
        a = math.radians(az); e = math.radians(el)
        d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
        cam.location = ctr + d * dist
        direction = (ctr - cam.location).normalized()
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        p = PREV + f'\\_tmp_{i}.png'
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    out = PREV + f'\\{name}.png'
    _stitch(paths, out)
    for p in paths:
        try: os.remove(p)
        except Exception: pass
    for o in bpy.data.objects: o.hide_render = False
    return out


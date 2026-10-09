# gear_lib.py -- helpers for the "gear" hero models (weapons, relics, wearables, vehicles). Exec'd into the same namespace as hero_lib.py / props_lib.py.
# Blender space: Z up, +Y forward (-> glTF -Z), +X right. Hand items: grip at the origin, business end along +Y. Exports as glTF Y-up.
BL = ROOT + r'\.cache\gear'
PREV = BL + r'\thumbs'
for _d in (BL, PREV, BL + r'\export'):
    os.makedirs(_d, exist_ok=True)
PI = math.pi
def rad(d): return math.radians(d)

GOLD = ('gold', 9); GOLD_D = ('gold', 6); GOLD_L = ('gold', 12); BRASS = ('gold', 7); BRASS_D = ('gold', 4); STEEL = ('slate', 9); STEEL_D = ('slate', 6); STEEL_L = ('slate', 12)
DARK = ('grey', 3); IRON = ('grey', 5); STONE = ('stone', 7); STONE_D = ('stone', 4); LEATHER = ('brown', 5); LEATHER_D = ('brown', 3); WOOD = ('brown', 7)
GLOW = ('cyan', 10); GLOW2 = ('violet', 10); FIRE = ('orange', 10); RED = ('red', 8); CRIMSON = ('crimson', 7); BONE = ('bone', 12); CREAM = ('bone', 13)

# ------------------------------------------------------------------ shape helpers (all in Blender space, +Y = forward / along the item)
def cylY(B, r1, r2, y0, y1, seg=6, x=0.0, z=0.0, color=GOLD, emissive=False, caps=True):
    """cone/cylinder along +Y from y0 (radius r1) to y1 (radius r2)."""
    return B.cyl(r1, r2, y1 - y0, seg=seg, loc=(x, (y0 + y1) / 2, z), rot=(-PI / 2, 0, 0), color=color, emissive=emissive, caps=caps)

def cylX(B, r1, r2, x0, x1, seg=6, y=0.0, z=0.0, color=GOLD, emissive=False, caps=True):
    return B.cyl(r1, r2, x1 - x0, seg=seg, loc=((x0 + x1) / 2, y, z), rot=(0, PI / 2, 0), color=color, emissive=emissive, caps=caps)

def cylZ(B, r1, r2, z0, z1, seg=6, x=0.0, y=0.0, color=GOLD, emissive=False, caps=True):
    return B.cyl(r1, r2, z1 - z0, seg=seg, loc=(x, y, (z0 + z1) / 2), color=color, emissive=emissive, caps=caps)

def cog(B, R, depth, teeth=6, loc=(0, 0, 0), rot=(0, 0, 0), color=GOLD, hole=0.0, ratio=0.78, w0=0.12, w1=0.40, wall=None):
    """gear disc, axis = local Z (use rot=(PI/2,0,0) for axis Y, rot=(0,PI/2,0) for axis X). hole>0 punches a round hole."""
    pts = gear_pts(R * ratio, R, teeth, w0=w0, w1=w1)
    if hole > 0:
        inner = [(hole * math.cos(math.atan2(y, x)), hole * math.sin(math.atan2(y, x))) for x, y in pts]
        return B.annulus(pts, inner, depth, loc=loc, rot=rot, color=color, wall=wall or color)
    return B.prism(pts, depth, loc=loc, rot=rot, color=color)

def blade(B, w, t, y0, y1, tip, color=STEEL, x=0.0, z=0.0, lit=None, k=1.4):
    """diamond-section blade along +Y: width w (half), thickness t (half), from y0 to the point at y1."""
    f = B.loft_path([(x, y0, z), (x, y1 - tip, z), (x, y1, z)], [(w, t), (w, t), 0.0], n=4, color=color, ref=(0, 0, 1))
    if lit: B.lit(f, lit[0], lit[1], k)
    return f

def flat_poly(B, pts, thick, loc=(0, 0, 0), rot=(0, 0, 0), color=STEEL, emissive=False, lit=None, k=1.4):
    f = B.prism(pts, thick, loc=loc, rot=rot, color=color, emissive=emissive, center=True)
    if lit: B.lit(f, lit[0], lit[1], k)
    return f

def grip_wrap(B, y0, y1, r=0.03, color=LEATHER, ring=GOLD_D, n=3, seg=6, x=0.0, z=0.0):
    cylY(B, r, r, y0, y1, seg=seg, x=x, z=z, color=color)
    for i in range(n):
        y = y0 + (y1 - y0) * (i + 0.5) / n
        cylY(B, r * 1.25, r * 1.25, y - 0.01, y + 0.01, seg=seg, x=x, z=z, color=ring)

def ring_pts(R, n, a0=0.0, a1=2 * PI):
    return [(R * math.cos(a0 + (a1 - a0) * i / n), R * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n)]

def zig(B, pts, w, thick, loc=(0, 0, 0), rot=(0, 0, 0), color=GLOW, emissive=True):
    """a zig-zag ribbon (lightning) in the local XY plane through pts (list of (x,y)), width w, extruded by thick along Z."""
    left = []; right = []
    for i, p in enumerate(pts):
        a = Vector(pts[max(0, i - 1)]); b = Vector(pts[min(len(pts) - 1, i + 1)])
        d = (b - a); d.normalize()
        nrm = Vector((-d.y, d.x))
        wi = w * (1.0 - 0.7 * i / max(1, len(pts) - 1))
        left.append((p[0] + nrm.x * wi, p[1] + nrm.y * wi)); right.append((p[0] - nrm.x * wi, p[1] - nrm.y * wi))
    poly = left + list(reversed(right))
    return B.prism(poly, thick, loc=loc, rot=rot, color=color, emissive=emissive, center=True)

def delete_faces(B, pred):
    import bmesh as _bm
    dead = [f for f in B.bm.faces if pred(f.calc_center_median())]
    _bm.ops.delete(B.bm, geom=dead, context='FACES')
    return len(dead)

def mk(name, builder_fn, loc=(0, 0, 0), parent=None):
    """build one object from a function(B) and place it (origin = pivot)"""
    B = Builder(name)
    builder_fn(B)
    ob = B.finish(loc=loc)
    if parent is not None: ob.parent = parent
    return ob

def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    if parent is not None: e.parent = parent
    return e

def tris_of(root):
    n = 0
    for o in [root] + list(root.children_recursive):
        if o.type == 'MESH': n += tri_count(o, False)
    return n

def bounds_of(root):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    bpy.context.view_layer.update()
    for o in [root] + list(root.children_recursive):
        if o.type != 'MESH': continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(min(mn[i], w[i]) for i in range(3)); mx = Vector(max(mx[i], w[i]) for i in range(3))
    return mn, mx

def export_model(root, name):
    """export root + all descendants as BL/export/<name>_raw.glb (Y up, modifiers applied, no animation: clips are added by finalize_gear.mjs)"""
    for o in bpy.data.objects: o.select_set(False)
    for o in [root] + list(root.children_recursive): o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=BL + rf'\export\{name}_raw.glb', export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_animations=False, export_skins=False, export_image_format='AUTO', export_materials='EXPORT', export_extras=False, export_cameras=False, export_lights=False)

def one_view(path, root, az, el, res=512, dist_mul=1.0):
    """render a single view of root to path"""
    mn, mx = bounds_of(root)
    ctr = (mn + mx) / 2; rad_ = (mx - mn).length / 2
    sc = bpy.context.scene
    for o in bpy.data.objects:
        if o.type in ('MESH', 'EMPTY') and o.name != '_cam': o.hide_render = not (o is root or o in root.children_recursive)
    cam = bpy.data.objects.get('_cam')
    if cam is None:
        cd = bpy.data.cameras.new('_cam'); cam = bpy.data.objects.new('_cam', cd); sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 50; cam.data.sensor_width = 36; cam.data.clip_end = 1000; cam.data.clip_start = 0.01; cam.data.type = 'PERSP'
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'; sh.show_cavity = False; sh.show_shadows = False; sh.show_specular_highlight = False
    sh.show_object_outline = True; sh.object_outline_color = (0, 0, 0)
    sc.display.render_aa = '8'
    sc.render.resolution_x = res; sc.render.resolution_y = res; sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new('W')
    sc.world.color = (0.16, 0.17, 0.2)
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'Standard'
    a = rad(az); e = rad(el)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = ctr + d * rad_ * 2.6 * 1.15 * dist_mul * 0.88
    cam.rotation_euler = (ctr - cam.location).normalized().to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)

def grid_stitch(paths, out, cols):
    import numpy as np
    imgs = [bpy.data.images.load(p) for p in paths]
    w, h = imgs[0].size
    rows = (len(imgs) + cols - 1) // cols
    full = np.zeros((rows * h, cols * w, 4), dtype=np.float32); full[..., 3] = 1
    for i, im in enumerate(imgs):
        a = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(a); a = a.reshape(h, w, 4)
        r, c = divmod(i, cols)
        full[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = a
    o = bpy.data.images.new('stitch', cols * w, rows * h, alpha=True)
    o.pixels.foreach_set(full.ravel()); o.filepath_raw = out; o.file_format = 'PNG'; o.save()
    for im in imgs + [o]: bpy.data.images.remove(im)

# ------------------------------------------------------------------ driver
def build_model(name, views=None):
    clear_scene(); make_materials()
    spec = GEAR[name]
    root = spec['fn']()
    root.name = name
    bpy.context.view_layer.update()
    n = tris_of(root)
    mn, mx = bounds_of(root)
    export_model(root, name)
    vs = views or spec.get('views') or ((35, 22), (90, 6), (-40, 55))
    tiles = []
    for i, (az, el) in enumerate(vs):
        p = PREV + rf'\_t_{name}_{i}.png'
        one_view(p, root, az, el, res=spec.get('res', 400))
        tiles.append(p)
    # the catalogue thumbnail = the first (three-quarter) view at 512px; the review sheet = all views side by side
    one_view(PREV + rf'\{name}.png', root, vs[0][0], vs[0][1], res=512)
    grid_stitch(tiles, PREV + rf'\{name}_views.png', len(tiles))
    for p in tiles:
        try: os.remove(p)
        except Exception: pass
    print(f'GEAR {name} tris={n} min=({mn.x:.3f},{mn.y:.3f},{mn.z:.3f}) max=({mx.x:.3f},{mx.y:.3f},{mx.z:.3f})')
    return n

GEAR = {}
def register(name, **kw):
    def deco(fn):
        GEAR[name] = dict(fn=fn, **kw)
        return fn
    return deco

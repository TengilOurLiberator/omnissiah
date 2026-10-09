# Headless Blender: decimate a generated GLB to <= MAXTRIS triangles, textures <= TEX px, keep 1-unit normalisation / base at y=0.
#   blender.exe --background --factory-startup --python optimize_blender.py -- in.glb out.glb [maxtris] [tex]
# Prints one line:  OPT {"tris_before":..,"tris_after":..,"bbox_before":[..],"bbox_after":[..]}
import bpy, bmesh, sys, json, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
MAXTRIS = int(argv[2]) if len(argv) > 2 else 2500
TEX = int(argv[3]) if len(argv) > 3 else 512

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit('no mesh')

def bbox(objs):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3))); hi = Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi

def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)

# detach from any parent (keeps world transform), then bake transforms
for o in meshes:
    m = o.matrix_world.copy(); o.parent = None; o.matrix_world = m
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1: bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
before = tris(ob)
lo0, hi0 = bbox([ob])

# weld + triangulate
bm = bmesh.new(); bm.from_mesh(ob.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bmesh.ops.triangulate(bm, faces=bm.faces[:])
bm.to_mesh(ob.data); bm.free()

# collapse decimation (UVs are kept per loop); iterate until under the budget
for _ in range(16):
    n = tris(ob)
    if n <= MAXTRIS: break
    ratio = max(0.02, min(0.97, MAXTRIS * 0.92 / n))
    mod = ob.modifiers.new('dec', 'DECIMATE'); mod.decimate_type = 'COLLAPSE'; mod.ratio = ratio; mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if tris(ob) >= n - 20:   # stalled: weld more aggressively (up to 0.6 % - more shreds thin sails/ropes; such models may stay over budget), then try again
        weld = globals().get('weld', 0.0015) * 2
        if weld > 0.006: break
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld)
        bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges[:])
        bm.to_mesh(ob.data); bm.free()
after = tris(ob)

# restore the original normalisation: same size, same xy centre, same base height
lo1, hi1 = bbox([ob])
long0 = max((hi0 - lo0)); long1 = max((hi1 - lo1))
s = long0 / long1 if long1 > 0 else 1.0
ob.scale = (s, s, s); bpy.ops.object.transform_apply(scale=True)
lo1, hi1 = bbox([ob])
c0 = (lo0 + hi0) / 2; c1 = (lo1 + hi1) / 2
ob.location = (c0.x - c1.x, c0.y - c1.y, lo0.z - lo1.z)
bpy.ops.object.transform_apply(location=True)
lo2, hi2 = bbox([ob])

# textures: downscale to <= TEX px
for img in bpy.data.images:
    if img.size[0] > TEX or img.size[1] > TEX:
        k = TEX / max(img.size[0], img.size[1])
        img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
ob.data.calc_tangents() if False else None

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85,
                          export_yup=True, export_apply=True, export_materials='EXPORT')

def y_up(lo, hi):  # blender (x,y,z) -> gltf (x,z,-y)
    return [round(v, 4) for v in (lo.x, lo.z, -hi.y, hi.x, hi.z, -lo.y)]
print('OPT ' + json.dumps({'tris_before': before, 'tris_after': after, 'bbox_before': y_up(lo0, hi0), 'bbox_after': y_up(lo2, hi2)}))

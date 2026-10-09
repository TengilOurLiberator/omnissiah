# Headless Blender: make a Quest-light twin of a RIGGED character GLB (skin weights and baked clips preserved).
#   blender.exe --background --factory-startup --python lite_blender.py -- in.rigged.glb out.glb [maxtris=4000] [tex=512]
# Collapse-decimates the skinned mesh (Blender interpolates vertex-group weights while collapsing), re-limits to 4 influences per vertex, downsizes textures,
# exports skinned glTF with every action. Prints one line:  LITE {"tris_before":..,"tris_after":..,"clips":[..],"bones":N}
import bpy, bmesh, sys, json

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
MAXTRIS = int(argv[2]) if len(argv) > 2 else 4000
TEX = int(argv[3]) if len(argv) > 3 else 512

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
if not meshes or not arms:
    raise SystemExit('LITE_FAIL no mesh/armature')
actions = [a.name for a in bpy.data.actions]

def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)

before = sum(tris(o) for o in meshes)
bpy.ops.object.select_all(action='DESELECT')
for ob in meshes:
    bpy.context.view_layer.objects.active = ob
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data); bm.free()
    share = max(0.05, tris(ob) / max(1, before))
    budget = int(MAXTRIS * share)
    for _ in range(12):
        n = tris(ob)
        if n <= budget: break
        mod = ob.modifiers.new('dec', 'DECIMATE'); mod.decimate_type = 'COLLAPSE'; mod.ratio = max(0.02, min(0.97, budget * 0.95 / n)); mod.use_collapse_triangulate = True
        # keep the armature modifier first / untouched: move decimate to the top so applying it never bakes the pose
        while ob.modifiers[0] != mod: bpy.ops.object.modifier_move_up(modifier=mod.name)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        if tris(ob) >= n - 20: break
    # limit influences to 4 per vertex and normalise
    if len(ob.vertex_groups):
        ob.select_set(True)
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
        ob.select_set(False)
after = sum(tris(o) for o in meshes)

for img in bpy.data.images:
    if img.size[0] > TEX or img.size[1] > TEX:
        k = TEX / max(img.size[0], img.size[1])
        img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85, export_yup=True,
                          export_apply=False, export_materials='EXPORT', export_skins=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_force_sampling=True, export_optimize_animation_size=False,
                          export_anim_single_armature=True, export_nla_strips=False)
print('LITE ' + json.dumps({'tris_before': before, 'tris_after': after, 'clips': actions, 'bones': len(arms[0].data.bones)}))

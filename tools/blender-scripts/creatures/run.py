# run.py -- headless driver.  blender --background --factory-startup --python run.py -- <model-name> [<model-name> ...] [--nosheet]
# For each name: exec c_<name with _>.py (defines make() -> Creature), build mesh+armature, bake clips, export raw GLB, render thumbnails, save .blend, print a JSON report line.
import sys, os, json, traceback
D = r'D:\omnissiah\tools\blender-scripts\creatures'
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
flags = [a for a in argv if a.startswith('--')]
names = [a for a in argv if not a.startswith('--')]
exec(compile(open(D + r'\clib.py', encoding='utf-8-sig').read(), 'clib.py', 'exec'), globals())

for name in names:
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        _M3.clear()
        src = D + rf'\c_{name.replace("-", "_")}.py'
        exec(compile(open(src, encoding='utf-8-sig').read(), src, 'exec'), globals())
        C = make()
        arm, ob = build_creature(C)
        tris = tri_count(ob)
        mn, mx = mesh_bounds(ob)
        info = C.bake(arm)
        raw = export_glb(C, arm, ob)
        th = preview(name, ob)
        sheet = None
        if '--nosheet' not in flags:
            sheet = pose_sheet(C, arm, ob, [('walk', 0.0), ('walk', 0.25), ('attack', 0.3), ('attack', 0.5), ('hit', 0.25), ('die', 1.0)], name)
        bpy.ops.wm.save_as_mainfile(filepath=CR + rf'\{name}.blend', copy=True)
        print('REPORT ' + json.dumps({'name': name, 'tris': tris, 'min': [round(c, 3) for c in mn], 'max': [round(c, 3) for c in mx], 'bones': len(C.rig.bones),
                                      'clips': {k: v[1] for k, v in info.items()}, 'raw': raw, 'thumb': th, 'sheet': sheet}))
    except Exception:
        print('FAILED ' + name)
        traceback.print_exc()

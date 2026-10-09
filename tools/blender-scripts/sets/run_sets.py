# run_sets.py -- build, thumbnail and export set-piece models.
#   blender.exe --background --python run_sets.py -- <model> [<model> ...] [--nothumb] [--noexport] [--views=a,b]
# Models are registered in SETS by the sets_*.py files next to this script.
import sys, os, glob
HERE = r'D:\omnissiah\tools\blender-scripts\sets'
exec(compile(open(HERE + r'\sets_lib.py', encoding='utf-8-sig').read(), 'sets_lib', 'exec'), globals())
SETS = {}
for _f in sorted(glob.glob(HERE + r'\sets_[a-z]*.py')):
    if _f.endswith('sets_lib.py'): continue
    exec(compile(open(_f, encoding='utf-8-sig').read(), _f, 'exec'), globals())

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
flags = [a for a in args if a.startswith('--')]
names = [a for a in args if not a.startswith('--')]
if names == ['all']: names = list(SETS)
get_palette_image()
for n in names:
    clear_scene()
    make_materials()
    sm = SETS[n]()
    objs = sm.build()
    tris = tricount(objs)
    ref = human_ref()
    _mx = max((o.matrix_world @ Vector(c)).x for o in objs for c in o.bound_box)
    _mn = min((o.matrix_world @ Vector(c)).y for o in objs for c in o.bound_box)
    ref.location = getattr(sm, 'ref_at', (_mx + 0.8, _mn - 0.2 if _mn > -3 else -1.5, 0))
    if '--nohuman' in flags: ref.hide_render = True
    views = getattr(sm, 'views', ((35, 18), (-55, 18)))
    for f in flags:
        if f.startswith('--views='):
            views = tuple(tuple(int(x) for x in v.split(':')) for v in f[8:].split(','))
    if '--nothumb' not in flags:
        out = preview(n, objs + ([] if '--nohuman' in flags else [ref]), views=views, res=getattr(sm, 'res', 560), center=getattr(sm, 'ctr', None), size=getattr(sm, 'rad', None), margin=1.05)
        os.replace(out, THUMBS + rf'\{n}.png')
    # the reference figure must never be exported
    bpy.data.objects.remove(ref, do_unlink=True)
    if '--noexport' not in flags:
        info = export_set(sm, objs)
    print(f'SET {n}: tris={tris} parts={len(objs)}')

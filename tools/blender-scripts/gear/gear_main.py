# gear_main.py -- build the gear hero models headless:
#   blender.exe --background --factory-startup --python gear_main.py -- name1 name2 ...   (or: all)
# Writes <ROOT>\.cache\gear\export\<name>_raw.glb and thumbnails <ROOT>\.cache\gear\thumbs\<name>.png + <name>_views.png.
# Post-process with finalize_gear.mjs (palette texture, clips) and register with catalog_gear.mjs.
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
G = globals()
for _f in ('hero_lib.py', 'hero_lib_patch.py', 'props_lib.py', 'gear_lib.py', 'gear_weapons.py', 'gear_items.py', 'gear_vehicles.py'):
    _p = os.path.join(HERE, _f)
    if os.path.exists(_p):
        exec(compile(open(_p, encoding='utf-8-sig').read(), _f, 'exec'), G)
_args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
_names = list(GEAR.keys()) if (not _args or _args == ['all']) else _args
for _n in _names:
    try:
        build_model(_n)
    except Exception:
        import traceback; traceback.print_exc()
        print('GEAR FAILED', _n)

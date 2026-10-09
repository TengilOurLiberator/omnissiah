# sheet_gear.py -- contact sheet of thumbnails:  blender --background --factory-startup --python sheet_gear.py -- out.png cols name1 name2 ...
import sys, os, bpy, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
out, cols, names = a[0], int(a[1]), a[2:]
T = r'D:\omnissiah\.cache\gear\thumbs'
imgs = [bpy.data.images.load(os.path.join(T, n + '.png')) for n in names]
w, h = imgs[0].size
rows = (len(imgs) + cols - 1) // cols
full = np.zeros((rows * h, cols * w, 4), dtype=np.float32); full[..., 3] = 1
for i, im in enumerate(imgs):
    arr = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(arr); arr = arr.reshape(h, w, 4)
    r, c = divmod(i, cols)
    full[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = arr
o = bpy.data.images.new('s', cols * w, rows * h, alpha=True)
o.pixels.foreach_set(full.ravel()); o.filepath_raw = out; o.file_format = 'PNG'; o.save()

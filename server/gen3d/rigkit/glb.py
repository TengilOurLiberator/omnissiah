"""Read the pipeline's static GLB (one mesh, one JPEG texture) and write a skinned GLB with baked animation clips.

Output (loads with stock GLTFLoader, no extensions): scene = [bone tree (node 'root' ...), mesh node bound to the skin];
JOINTS_0 unsigned byte, WEIGHTS_0 float (normalised, <= 4 influences), inverse bind = translation(-rest joint),
bones have translation-only rest transforms (identity rotations), animations sample rotation per bone (+ translation /
scale on the ground root) at 30 fps.
"""
import json
import struct
import numpy as np

COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    off = 12
    js, binchunk = None, b""
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        body = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(body)
        elif ctype == 0x004E4942:
            binchunk = body
        off += 8 + clen
    return js, binchunk


def accessor(js, binchunk, idx):
    a = js["accessors"][idx]
    bv = js["bufferViews"][a["bufferView"]]
    fmt, size = COMP[a["componentType"]]
    n = NCOMP[a["type"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", size * n)
    count = a["count"]
    if stride == size * n:
        arr = np.frombuffer(binchunk, dtype=np.dtype(fmt).newbyteorder("<"), count=count * n, offset=start).reshape(count, n)
    else:
        arr = np.stack([np.frombuffer(binchunk, dtype=np.dtype(fmt).newbyteorder("<"), count=n, offset=start + i * stride) for i in range(count)])
    return arr.astype(np.float64) if fmt == "f" else arr.astype(np.int64)


def load_static(path):
    """-> dict(verts, normals, uv, faces, image(bytes), mime, material(dict), name)"""
    js, binchunk = read_glb(path)
    mesh = js["meshes"][0]
    prim = mesh["primitives"][0]
    at = prim["attributes"]
    out = dict(verts=accessor(js, binchunk, at["POSITION"]),
               normals=accessor(js, binchunk, at["NORMAL"]) if "NORMAL" in at else None,
               uv=accessor(js, binchunk, at["TEXCOORD_0"]) if "TEXCOORD_0" in at else None,
               faces=accessor(js, binchunk, prim["indices"]).reshape(-1, 3))
    # node transform (TRELLIS output has none, but be safe)
    mat = js["materials"][prim.get("material", 0)] if js.get("materials") else {}
    out["material"] = {k: v for k, v in mat.items() if k in ("pbrMetallicRoughness", "doubleSided", "alphaMode", "emissiveFactor", "name")}
    pbr = out["material"].get("pbrMetallicRoughness", {})
    out["image"], out["mime"] = None, "image/jpeg"
    bct = pbr.get("baseColorTexture")
    if bct is not None and js.get("textures"):
        img = js["images"][js["textures"][bct["index"]]["source"]]
        bv = js["bufferViews"][img["bufferView"]]
        out["image"] = bytes(binchunk[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]])
        out["mime"] = img.get("mimeType", "image/jpeg")
        out["sampler"] = js["samplers"][js["textures"][bct["index"]]["sampler"]] if "sampler" in js["textures"][bct["index"]] and js.get("samplers") else None
    return out


class Builder:
    def __init__(self):
        self.bin = bytearray()
        self.views, self.accessors = [], []

    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin += data
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            v["target"] = target
        self.views.append(v)
        return len(self.views) - 1

    def acc(self, arr, ctype, atype, target=None, minmax=False, normalized=False):
        dt = {5126: "<f4", 5121: "u1", 5123: "<u2", 5125: "<u4"}[ctype]
        a = np.ascontiguousarray(np.asarray(arr).astype(dt))
        bvi = self.view(a.tobytes(), target)
        d = {"bufferView": bvi, "componentType": ctype, "count": int(a.shape[0]), "type": atype}
        if normalized:
            d["normalized"] = True
        if minmax:
            d["min"] = [float(x) for x in a.reshape(a.shape[0], -1).min(0)]
            d["max"] = [float(x) for x in a.reshape(a.shape[0], -1).max(0)]
        self.accessors.append(d)
        return len(self.accessors) - 1


def write_rigged(path, static, verts, normals, joint_idx, joint_w, names, parents, rest, clips, meta=None, drop_still=1e-5):
    """clips: list of dict(name, ts (K,), rot (K,J,4), trans (K,3) or None, scale (K,3) or None, loop)"""
    J = len(names)
    b = Builder()
    prim_attrs = {}
    prim_attrs["POSITION"] = b.acc(verts, 5126, "VEC3", 34962, minmax=True)
    if normals is not None:
        prim_attrs["NORMAL"] = b.acc(normals, 5126, "VEC3", 34962)
    if static.get("uv") is not None:
        prim_attrs["TEXCOORD_0"] = b.acc(static["uv"], 5126, "VEC2", 34962)
    prim_attrs["JOINTS_0"] = b.acc(joint_idx, 5121, "VEC4", 34962)
    prim_attrs["WEIGHTS_0"] = b.acc(joint_w, 5126, "VEC4", 34962)
    nverts = len(verts)
    idx = b.acc(static["faces"].reshape(-1), 5125 if nverts > 65535 else 5123, "SCALAR", 34963)
    ibm = np.zeros((J, 16))
    for j in range(J):
        m = np.eye(4)
        m[:3, 3] = -rest[j]
        ibm[j] = m.T.reshape(-1)  # column-major
    ibm_acc = b.acc(ibm, 5126, "MAT4")

    nodes = []
    for j in range(J):
        p = parents[j]
        t = rest[j] - (rest[p] if p >= 0 else 0.0)
        n = {"name": names[j]}
        if np.linalg.norm(t) > 0:
            n["translation"] = [float(x) for x in t]
        nodes.append(n)
    for j in range(J):
        p = parents[j]
        if p >= 0:
            nodes[p].setdefault("children", []).append(j)
    mesh_node = len(nodes)
    nodes.append({"name": "mesh", "mesh": 0, "skin": 0})
    skins = [{"joints": list(range(J)), "inverseBindMatrices": ibm_acc, "skeleton": 0}]

    images, textures, samplers = [], [], []
    material = dict(static.get("material") or {})
    if static.get("image") is not None:
        bvi = b.view(static["image"])
        images.append({"bufferView": bvi, "mimeType": static["mime"]})
        samplers.append(static.get("sampler") or {"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071})
        textures.append({"source": 0, "sampler": 0})
        material.setdefault("pbrMetallicRoughness", {})["baseColorTexture"] = {"index": 0}
    material.setdefault("pbrMetallicRoughness", {}).setdefault("baseColorFactor", [1, 1, 1, 1])

    anims = []
    for c in clips:
        ts = np.asarray(c["ts"], np.float64)
        t_acc = b.acc(ts, 5126, "SCALAR", minmax=True)
        samplers_a, channels = [], []
        rot = np.asarray(c["rot"])
        for j in range(J):
            q = rot[:, j]
            if np.abs(q - q[0]).max() < drop_still and np.abs(q[0] - np.array([0, 0, 0, 1.0])).max() < drop_still:
                continue
            o = b.acc(q, 5126, "VEC4")
            samplers_a.append({"input": t_acc, "output": o, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers_a) - 1, "target": {"node": j, "path": "rotation"}})
        if c.get("trans") is not None:
            trn = np.asarray(c["trans"])
            if np.abs(trn).max() > drop_still:
                o = b.acc(trn + rest[0], 5126, "VEC3")   # the ground root has no parent: node translation = rest[0] + animated offset
                samplers_a.append({"input": t_acc, "output": o, "interpolation": "LINEAR"})
                channels.append({"sampler": len(samplers_a) - 1, "target": {"node": 0, "path": "translation"}})
        if c.get("scale") is not None and np.abs(np.asarray(c["scale"]) - 1).max() > drop_still:
            o = b.acc(c["scale"], 5126, "VEC3")
            samplers_a.append({"input": t_acc, "output": o, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers_a) - 1, "target": {"node": 0, "path": "scale"}})
        anims.append({"name": c["name"], "samplers": samplers_a, "channels": channels})

    gl = {
        "asset": {"version": "2.0", "generator": "omnissiah-gen3d-rig", **({"extras": meta} if meta else {})},
        "scene": 0,
        "scenes": [{"nodes": [0, mesh_node]}],
        "nodes": nodes,
        "meshes": [{"name": "body", "primitives": [{"attributes": prim_attrs, "indices": idx, "material": 0, "mode": 4}]}],
        "skins": skins,
        "materials": [material],
        "accessors": b.accessors,
        "bufferViews": b.views,
        "buffers": [{"byteLength": len(b.bin)}],
        "animations": anims,
    }
    if images:
        gl["images"], gl["textures"], gl["samplers"] = images, textures, samplers
    jb = json.dumps(gl, separators=(",", ":")).encode()
    while len(jb) % 4:
        jb += b" "
    binb = bytes(b.bin)
    while len(binb) % 4:
        binb += b"\0"
    total = 12 + 8 + len(jb) + 8 + len(binb)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A) + jb)
        f.write(struct.pack("<II", len(binb), 0x004E4942) + binb)
    return total

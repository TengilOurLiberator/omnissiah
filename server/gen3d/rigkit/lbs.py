"""Independent re-evaluation of a written rigged GLB (pure numpy): node hierarchy, animation sampling, linear blend skinning.
Used for validation (bind pose, loop continuity, foot sliding) and for quick frame renders; shares no code with gait.py/pose.py."""
import numpy as np
from . import glb as G
from . import mathx as mx


class RiggedGLB:
    def __init__(self, path):
        self.js, self.bin = G.read_glb(path)
        js = self.js
        self.nodes = js["nodes"]
        self.skin = js["skins"][0]
        self.joints = self.skin["joints"]
        self.J = len(self.joints)
        prim = js["meshes"][0]["primitives"][0]
        at = prim["attributes"]
        self.verts = G.accessor(js, self.bin, at["POSITION"])
        self.normals = G.accessor(js, self.bin, at["NORMAL"]) if "NORMAL" in at else None
        self.jidx = G.accessor(js, self.bin, at["JOINTS_0"])
        self.jw = G.accessor(js, self.bin, at["WEIGHTS_0"])
        self.faces = G.accessor(js, self.bin, prim["indices"]).reshape(-1, 3)
        self.ibm = G.accessor(js, self.bin, self.skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get("children", []):
                self.parent[c] = i
        self.anims = {}
        for a in js.get("animations", []):
            ch = {}
            for c in a["channels"]:
                s = a["samplers"][c["sampler"]]
                ts = G.accessor(js, self.bin, s["input"])[:, 0]
                v = G.accessor(js, self.bin, s["output"])
                ch[(c["target"]["node"], c["target"]["path"])] = (ts, v)
            dur = max((ts[-1] for ts, _ in ch.values()), default=0.0)
            self.anims[a["name"]] = dict(ch=ch, duration=float(dur))

    def local_pose(self, clip, t):
        L = len(self.nodes)
        trans = np.array([n.get("translation", [0, 0, 0]) for n in self.nodes], np.float64)
        rot = np.array([n.get("rotation", [0, 0, 0, 1]) for n in self.nodes], np.float64)
        scl = np.array([n.get("scale", [1, 1, 1]) for n in self.nodes], np.float64)
        if clip is not None:
            a = self.anims[clip]
            for (node, path), (ts, v) in a["ch"].items():
                tt = t % a["duration"] if a["duration"] > 0 else 0.0
                i = int(np.clip(np.searchsorted(ts, tt, side="right") - 1, 0, len(ts) - 2))
                f = (tt - ts[i]) / max(ts[i + 1] - ts[i], 1e-9)
                if path == "rotation":
                    rot[node] = mx.qslerp(v[i], v[i + 1], f)
                elif path == "translation":
                    trans[node] = v[i] * (1 - f) + v[i + 1] * f
                else:
                    scl[node] = v[i] * (1 - f) + v[i + 1] * f
        return trans, rot, scl

    def world(self, trans, rot, scl):
        L = len(self.nodes)
        M = np.zeros((L, 4, 4))
        for i in range(L):  # parents come first in our files
            m = np.eye(4)
            m[:3, :3] = mx.mat_from_q(rot[i]) * scl[i][None, :]
            m[:3, 3] = trans[i]
            p = self.parent.get(i)
            M[i] = m if p is None else M[p] @ m
        return M

    def skinned(self, clip=None, t=0.0):
        tr, rt, sc = self.local_pose(clip, t)
        M = self.world(tr, rt, sc)
        S = np.stack([M[j] @ self.ibm[k] for k, j in enumerate(self.joints)])   # (J,4,4)
        v = np.concatenate([self.verts, np.ones((len(self.verts), 1))], 1)
        out = np.zeros((len(v), 3))
        for k in range(4):
            m = S[self.jidx[:, k]]
            out += self.jw[:, k:k + 1] * np.einsum("nij,nj->ni", m, v)[:, :3]
        joints_world = np.stack([M[j][:3, 3] for j in self.joints])
        return out, joints_world

"""Skeleton container + clean-up of a raw UniRig prediction (drop dead leaves, merge near-duplicate / redundant joints,
cap the bone count, smooth and compress skin weights to <= 4 influences)."""
import numpy as np
import scipy.sparse as sp


class Skeleton:
    def __init__(self, names, parents, rest):
        self.names = list(names)
        self.parents = np.asarray([-1 if p is None else int(p) for p in parents], np.int64)
        self.rest = np.asarray(rest, np.float64).reshape(-1, 3).copy()

    @property
    def n(self):
        return len(self.names)

    def children(self):
        ch = [[] for _ in range(self.n)]
        for j, p in enumerate(self.parents):
            if p >= 0:
                ch[p].append(j)
        return ch

    def depth(self):
        d = np.zeros(self.n, np.int64)
        for j in range(self.n):
            if self.parents[j] >= 0:
                d[j] = d[self.parents[j]] + 1
        return d

    def path_to_root(self, j):
        out = []
        while j >= 0:
            out.append(j)
            j = self.parents[j]
        return out

    def subtree(self, j, ch=None):
        ch = ch or self.children()
        out, st = [], [j]
        while st:
            k = st.pop()
            out.append(k)
            st.extend(ch[k])
        return out

    def is_descendant(self, j, anc):
        while j >= 0:
            if j == anc:
                return True
            j = self.parents[j]
        return False

    def copy(self):
        return Skeleton(self.names, self.parents, self.rest)


def _remove(skel, weights, j, into):
    """Delete joint j: its skin weight goes to joint `into`, its children are re-parented to j's parent."""
    weights[:, into] += weights[:, j]
    p = skel.parents[j]
    for c in range(skel.n):
        if skel.parents[c] == j:
            skel.parents[c] = p
    keep = np.array([i for i in range(skel.n) if i != j])
    remap = -np.ones(skel.n, np.int64)
    remap[keep] = np.arange(len(keep))
    new_parents = np.array([remap[p_] if p_ >= 0 else -1 for p_ in skel.parents[keep]], np.int64)
    skel.names = [skel.names[i] for i in keep]
    skel.parents = new_parents
    skel.rest = skel.rest[keep]
    return weights[:, keep]


def vertex_adjacency(n, faces):
    e = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]], 0)
    e = np.concatenate([e, e[:, ::-1]], 0)
    a = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)).tocsr()
    a.data[:] = 1.0
    return a


def smooth_weights(weights, faces, iters=2, alpha=0.5):
    n = weights.shape[0]
    A = vertex_adjacency(n, faces)
    deg = np.asarray(A.sum(1)).ravel() + 1e-9
    W = weights.copy()
    for _ in range(iters):
        W = (1 - alpha) * W + alpha * (A @ W) / deg[:, None]
    return W


def topk_weights(weights, k=4, thresh=0.02):
    """-> joints (N,k) int, weights (N,k) float, normalised; vertices with no weight are bound to the nearest... bone 0."""
    N, J = weights.shape
    k = min(k, J)
    idx = np.argsort(-weights, axis=1)[:, :k]
    w = np.take_along_axis(weights, idx, 1)
    w = np.where(w < thresh, 0.0, w)
    # never lose the strongest influence
    first = np.take_along_axis(weights, idx[:, :1], 1)[:, 0]
    w[:, 0] = np.where(w[:, 0] <= 0, first, w[:, 0])
    s = w.sum(1, keepdims=True)
    unbound = s[:, 0] < 1e-8
    w[unbound, 0] = 1.0
    idx[unbound, 0] = 0
    s = w.sum(1, keepdims=True)
    w = w / s
    if k < 4:
        idx = np.pad(idx, ((0, 0), (0, 4 - k)))
        w = np.pad(w, ((0, 0), (0, 4 - k)))
    return idx.astype(np.int64), w


def clean(skel, weights, verts, faces, max_bones=36, min_mass=0.0015, log=None):
    """Return (Skeleton, weights) with dead / redundant joints removed. weights: (N, J) rows should sum to ~1."""
    skel = skel.copy()
    W = np.asarray(weights, np.float64).copy()
    N = W.shape[0]
    H = float(verts[:, 1].max() - verts[:, 1].min())
    report = {"input_bones": skel.n, "removed": []}

    # renormalise rows (UniRig leaves a few rows empty on thin geometry)
    rs = W.sum(1, keepdims=True)
    empty = rs[:, 0] < 1e-6
    if empty.any():
        # bind to the nearest joint
        d = np.linalg.norm(verts[empty][:, None, :] - skel.rest[None], axis=-1)
        W[empty] = 0
        W[np.where(empty)[0], d.argmin(1)] = 1.0
        rs = W.sum(1, keepdims=True)
    W = W / rs

    def kids(j):
        return [c for c in range(skel.n) if skel.parents[c] == j]

    # 1. leaves that move almost nothing
    changed = True
    while changed:
        changed = False
        mass = W.sum(0) / N
        for j in range(skel.n - 1, 0, -1):
            if skel.parents[j] >= 0 and not kids(j) and mass[j] < min_mass:
                report["removed"].append(("dead-leaf", skel.names[j]))
                W = _remove(skel, W, j, skel.parents[j])
                changed = True
                break

    # 2. joints sitting on top of their parent
    changed = True
    while changed:
        changed = False
        for j in range(1, skel.n):
            p = skel.parents[j]
            if p >= 0 and np.linalg.norm(skel.rest[j] - skel.rest[p]) < 0.006 * H and kids(j):
                report["removed"].append(("coincident", skel.names[j]))
                W = _remove(skel, W, j, p)
                changed = True
                break

    # 3. cap the bone count: drop the single-child interior joint whose removal bends the chain the least
    while skel.n > max_bones:
        ch = skel.children()
        best, cost = None, 1e9
        mass = W.sum(0) / N
        for j in range(1, skel.n):
            p = skel.parents[j]
            if p < 1 or len(ch[j]) != 1 or len(ch[p]) != 1 and False:
                continue
            c = ch[j][0]
            if len(ch[p]) > 1 and p == 0:
                pass
            a, b, m = skel.rest[p], skel.rest[c], skel.rest[j]
            seg = b - a
            L2 = float(seg @ seg) + 1e-12
            t = np.clip(((m - a) @ seg) / L2, 0, 1)
            dev = np.linalg.norm(m - (a + t * seg)) / H
            # joints that start a limb (parent branches) are expensive to lose
            pen = 0.05 if len(ch[p]) > 1 else 0.0
            cst = dev + pen + 0.3 * mass[j]
            if cst < cost:
                best, cost = j, cst
        if best is None:
            break
        report["removed"].append(("cap", skel.names[best]))
        # weight goes to the parent (rigidly follows it); child re-parented by _remove
        W = _remove(skel, W, best, skel.parents[best])
    report["bones"] = skel.n
    return skel, W, report

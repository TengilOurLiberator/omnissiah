"""Pose evaluation for world-aligned bones.

Every bone's rest rotation is identity (the glTF nodes only carry translations), so a pose is described by one
*world-axis delta rotation* D[t, j] per bone: bone j's total world rotation is  W[j] = D[j] * W[parent]  (apply the
parent's rotation first, then rotate about joint j's pivot with world axes). That makes procedural animation easy:
body pitch is a delta on the hips, a tail wave is a delta per tail bone, an IK limb solves positions and then writes
D[j] = W_wanted[j] * W[parent]^-1. The glTF local rotation of node j is  q_local = W[parent]^-1 * W[j].
Bone 0 is the ground root and the only bone with a translation (and scale) track.
"""
import numpy as np
from . import mathx as mx


class Anim:
    def __init__(self, rest, parents, T):
        self.rest = np.asarray(rest, np.float64)
        self.parents = np.asarray(parents, np.int64)
        self.J = len(self.rest)
        self.T = T
        self.off = self.rest - np.where(self.parents[:, None] >= 0, self.rest[np.maximum(self.parents, 0)], 0.0)
        self.D = mx.qid((T, self.J))
        self.rootT = np.zeros((T, 3))
        self.rootS = np.ones((T, 3))
        self._fk = None

    # ---- forward kinematics ------------------------------------------------------------
    def fk(self, cache=False):
        W = np.zeros((self.T, self.J, 4))
        P = np.zeros((self.T, self.J, 3))
        for j in range(self.J):
            p = self.parents[j]
            if p < 0:
                W[:, j] = self.D[:, j]
                P[:, j] = self.rest[j] + self.rootT
            else:
                W[:, j] = mx.qmul(self.D[:, j], W[:, p])
                P[:, j] = P[:, p] + mx.qrot(W[:, p], self.off[j])
        return W, P

    def add(self, j, q):
        """extra world-axis rotation about joint j (applies to the whole subtree)"""
        self.D[:, j] = mx.qmul(q, self.D[:, j])

    def set_world(self, j, Wj, Wparent):
        self.D[:, j] = mx.qmul(Wj, mx.qinv(Wparent))

    def local_quats(self):
        W, _ = self.fk()
        L = np.zeros_like(W)
        for j in range(self.J):
            p = self.parents[j]
            L[:, j] = W[:, j] if p < 0 else mx.qmul(mx.qinv(W[:, p]), W[:, j])
        return mx.qfix_continuity(L)

    def positions(self):
        return self.fk()[1]


# ---- IK ------------------------------------------------------------------------------------
def two_bone(A, G, l1, l2, pole):
    """A, G: (T,3) hip and target; pole: (T,3) direction the knee should bend toward. Returns knee K and end E."""
    d_vec = G - A
    d = np.linalg.norm(d_vec, axis=-1, keepdims=True)
    dmax = (l1 + l2) * 0.9995
    dmin = abs(l1 - l2) * 1.001 + 1e-4
    dc = np.clip(d, dmin, dmax)
    u = d_vec / (d + 1e-12)
    a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc)
    h = np.sqrt(np.maximum(l1 * l1 - a * a, 0.0))
    p = pole - np.sum(pole * u, -1, keepdims=True) * u
    pn = np.linalg.norm(p, axis=-1, keepdims=True)
    # degenerate pole: pick any perpendicular
    alt = np.cross(u, np.array([1.0, 0, 0]))
    alt = np.where(np.linalg.norm(alt, axis=-1, keepdims=True) < 1e-4, np.cross(u, np.array([0, 1.0, 0])), alt)
    p = np.where(pn < 1e-6, alt, p)
    p = p / (np.linalg.norm(p, axis=-1, keepdims=True) + 1e-12)
    K = A + u * a + p * h
    E = A + u * dc
    return K, E


def fabrik(A, G, lengths, init, iters=12):
    """A: (T,3) fixed root, G: (T,3) target, lengths: list of n-1, init: (T,n,3) starting positions (root first)."""
    P = init.copy()
    n = P.shape[1]
    total = float(sum(lengths))
    d = np.linalg.norm(G - A, axis=-1, keepdims=True)
    Gc = A + (G - A) * np.minimum(1.0, 0.9995 * total / (d + 1e-12))
    for _ in range(iters):
        P[:, -1] = Gc
        for i in range(n - 2, -1, -1):
            v = P[:, i] - P[:, i + 1]
            P[:, i] = P[:, i + 1] + v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12) * lengths[i]
        P[:, 0] = A
        for i in range(1, n):
            v = P[:, i] - P[:, i - 1]
            P[:, i] = P[:, i - 1] + v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12) * lengths[i - 1]
    return P


def solve_chain(anim, chain, G, W, P, pole_rest=None, foot_world=None, force_pole=False):
    """Pose `chain` (joint indices, hip first, effector last) so the effector reaches G (T,3).

    W, P: world rotations / positions of the *current* pose (from anim.fk()) - the hip's parent rotation and the hip
    position are read from there. Writes D for every chain joint except the effector; if foot_world is given
    (T,4 quaternions), the effector joint gets that world rotation (feet stay flat)."""
    rest = anim.rest
    n = len(chain)
    hip = chain[0]
    par = anim.parents[hip]
    Wp = W[:, par] if par >= 0 else mx.qid((anim.T,))
    A = P[:, hip]
    lens = [float(np.linalg.norm(rest[b] - rest[a])) for a, b in zip(chain[:-1], chain[1:])]
    if n == 3:
        # rest bend direction (knee off the hip->foot line) rotated with the parent
        line = rest[chain[2]] - rest[chain[0]]
        kv = rest[chain[1]] - rest[chain[0]]
        bend = kv - (kv @ line) / (line @ line + 1e-12) * line
        if force_pole and pole_rest is not None:
            bend = np.asarray(pole_rest, float)
        elif np.linalg.norm(bend) < 0.05 * sum(lens):   # a (nearly) straight rest limb: use the caller's preferred bend (knees forward, elbows back)
            bend = pole_rest if pole_rest is not None else np.array([0, 0, 1.0])
        pole = mx.qrot(Wp, bend / np.linalg.norm(bend))
        K, E = two_bone(A, G, lens[0], lens[1], pole)
        pos = np.stack([A, K, E], 1)
    elif n == 2:
        v = G - A
        pos = np.stack([A, A + mx.norm(v) * lens[0]], 1)
    else:
        init = np.stack([P[:, hip] + mx.qrot(Wp, rest[c] - rest[hip]) for c in chain], 1)
        pos = fabrik(A, G, lens, init)
    # directions -> world rotations (shortest arc from the rest direction)
    Wprev = Wp
    for i in range(n - 1):
        j = chain[i]
        rest_dir = rest[chain[i + 1]] - rest[j]
        Wj = mx.qarc(np.broadcast_to(rest_dir, (anim.T, 3)), pos[:, i + 1] - pos[:, i], hint=np.array([0, 0, 1.0]))
        anim.set_world(j, Wj, Wprev)
        Wprev = Wj
    if foot_world is not None:
        anim.set_world(chain[-1], foot_world, Wprev)
    return pos

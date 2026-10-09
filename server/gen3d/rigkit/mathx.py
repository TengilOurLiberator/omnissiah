"""Quaternion / vector helpers. Quaternions are (x, y, z, w) like glTF; every function broadcasts over leading dims."""
import numpy as np

EPS = 1e-9
UP = np.array([0.0, 1.0, 0.0])
FWD = np.array([0.0, 0.0, 1.0])
RIGHT = np.array([1.0, 0.0, 0.0])


def norm(v, axis=-1):
    v = np.asarray(v, np.float64)
    return v / (np.linalg.norm(v, axis=axis, keepdims=True) + EPS)


def qid(shape=()):
    q = np.zeros(tuple(shape) + (4,))
    q[..., 3] = 1.0
    return q


def qnorm(q):
    return q / (np.linalg.norm(q, axis=-1, keepdims=True) + EPS)


def qmul(a, b):
    ax, ay, az, aw = np.moveaxis(np.asarray(a, np.float64), -1, 0)
    bx, by, bz, bw = np.moveaxis(np.asarray(b, np.float64), -1, 0)
    return np.stack([aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw,
                     aw * bw - ax * bx - ay * by - az * bz], -1)


def qinv(q):
    q = np.asarray(q, np.float64)
    return np.concatenate([-q[..., :3], q[..., 3:]], -1)


def qaxis(axis, angle):
    axis = norm(axis)
    angle = np.asarray(angle, np.float64)
    s = np.sin(angle / 2)[..., None]
    return np.concatenate([axis * s, np.cos(angle / 2)[..., None]], -1)


def qrot(q, v):
    """Rotate vectors v by quaternions q (broadcast)."""
    q = np.asarray(q, np.float64)
    v = np.asarray(v, np.float64)
    u = q[..., :3]
    w = q[..., 3:4]
    t = 2 * np.cross(u, v)
    return v + w * t + np.cross(u, t)


def qarc(a, b, hint=None):
    """Shortest-arc rotation taking direction a onto direction b. With `hint` (an axis), nearly opposite directions rotate about that axis
    (continuously) instead of about an arbitrary perpendicular one, so a limb swinging through "straight up" never flips."""
    a, b = norm(a), norm(b)
    d = np.sum(a * b, -1, keepdims=True)
    c = np.cross(a, b)
    if hint is not None:
        s = np.linalg.norm(c, axis=-1, keepdims=True)
        h = np.asarray(hint, np.float64)
        hp = h - np.sum(h * a, -1, keepdims=True) * a
        hp = hp / (np.linalg.norm(hp, axis=-1, keepdims=True) + EPS)
        n = norm(c + hp * np.clip(0.3 - s, 0, None) * 6.0)
        ang = np.arccos(np.clip(d, -1, 1))
        mixed = np.concatenate([n * np.sin(ang / 2), np.cos(ang / 2)], -1)
        use = (d < -0.5)
        return qnorm(np.where(use, mixed, np.concatenate([c, 1 + d], -1)))
    q = np.concatenate([c, 1 + d], -1)
    # antiparallel: pick any perpendicular axis
    anti = (1 + d[..., 0]) < 1e-7
    if np.any(anti):
        perp = np.cross(a, np.array([1.0, 0, 0]))
        bad = np.linalg.norm(perp, axis=-1) < 1e-6
        perp = np.where(bad[..., None], np.cross(a, np.array([0, 1.0, 0])), perp)
        perp = norm(perp)
        q = np.where(anti[..., None], np.concatenate([perp, np.zeros_like(d)], -1), q)
    return qnorm(q)


def qslerp(a, b, t):
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    d = np.sum(a * b, -1, keepdims=True)
    b = np.where(d < 0, -b, b)
    d = np.abs(d)
    t = np.asarray(t, np.float64)[..., None]
    lin = d > 0.9995
    th = np.arccos(np.clip(d, -1, 1))
    s = np.sin(th) + EPS
    out = (np.sin((1 - t) * th) / s) * a + (np.sin(t * th) / s) * b
    out = np.where(lin, a + t * (b - a), out)
    return qnorm(out)


def qpow(q, f):
    """q ** f (scale the rotation angle)."""
    q = qnorm(np.asarray(q, np.float64))
    w = np.clip(q[..., 3], -1, 1)
    ang = 2 * np.arccos(np.abs(w))
    sgn = np.where(w < 0, -1.0, 1.0)[..., None]
    ax = q[..., :3] * sgn
    n = np.linalg.norm(ax, axis=-1, keepdims=True)
    axis = np.where(n > 1e-9, ax / (n + EPS), np.array([0, 1.0, 0]))
    return qaxis(axis, ang * np.asarray(f, np.float64))


def qfix_continuity(q):
    """q: (T, ..., 4): flip signs so consecutive frames take the short path (glTF slerp needs this)."""
    q = np.array(q, np.float64)
    for t in range(1, q.shape[0]):
        d = np.sum(q[t] * q[t - 1], -1, keepdims=True)
        q[t] = np.where(d < 0, -q[t], q[t])
    return q


def mat_from_q(q):
    x, y, z, w = np.moveaxis(np.asarray(q, np.float64), -1, 0)
    m = np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
                  2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
                  2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], -1)
    return m.reshape(m.shape[:-1] + (3, 3))


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = np.clip(x, 0, 1)
    return 1 - (1 - x) ** 3


def project_perp(v, axis):
    axis = norm(axis)
    return v - np.sum(v * axis, -1, keepdims=True) * axis

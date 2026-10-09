"""Procedural animation clips from a body-plan analysis. All motion is baked (keyframes at 30 fps) so the game needs no
special runtime. See pose.py for the pose model (world-axis delta rotation per bone; bone 0 = ground root).

Conventions: the creature faces +Z, up is +Y, +X is its left. Distances are in model units (longest side = 1).
"""
import math
import numpy as np
from . import mathx as mx
from .pose import Anim, solve_chain

FPS = 30
FWD = np.array([0, 0, 1.0])
UP = np.array([0, 1.0, 0])
SIDE = np.array([1.0, 0, 0])
TAU = 2 * math.pi


class Rig:
    """What the animator needs: skeleton in final indices (0 = ground root, 1 = hips) + analysis with shifted indices."""

    def __init__(self, names, parents, rest, plan, verts):
        self.names, self.parents, self.rest, self.plan, self.verts = names, np.asarray(parents), np.asarray(rest, float), plan, verts
        self.J = len(names)
        self.size = plan["dims"]["size"]
        self.H = plan["dims"]["height"]
        self.kind = plan["body_plan"]
        self.ch = [[] for _ in range(self.J)]
        for j, p in enumerate(self.parents):
            if p >= 0:
                self.ch[p].append(j)
        self.sample = verts[:: max(1, len(verts) // 1500)]
        self.setup_limbs()

    # ------------------------------------------------------------------ limbs
    def setup_limbs(self):
        rest, pl = self.rest, self.plan
        self.legs = []
        for k, d in enumerate(pl["legs"]):
            joints = d["chain"][1:]
            L = [float(np.linalg.norm(rest[b] - rest[a])) for a, b in zip(joints[:-1], joints[1:])]
            foot = None
            ik = list(joints)
            seg = rest[joints[-1]] - rest[joints[-2]]
            flat_foot = np.hypot(seg[0], seg[2]) > 0.9 * abs(seg[1])       # the last bone lies down: a foot (ankle -> toe)
            if len(joints) >= 4 and (L[-1] < 0.6 * L[-2] or flat_foot):
                foot = joints[-1]
                ik = joints[:-1]
            hip_to_eff = float(np.linalg.norm(rest[ik[-1]] - rest[ik[0]]))
            self.legs.append(dict(d, ik=ik, foot=foot, joints=joints, reach=sum(L[: len(ik) - 1]) if len(ik) > 1 else 0.0,
                                  height=float(rest[ik[0], 1]), eff_rest=rest[ik[-1]].copy(), span=hip_to_eff,
                                  row=0, col=0))
        # rows front->back, side +1 = x > 0
        legs = sorted(self.legs, key=lambda l: -rest[l["ik"][0], 2])
        n = len(legs)
        sides = {1: [l for l in legs if l["side"] > 0], -1: [l for l in legs if l["side"] < 0]}
        for s, ls in sides.items():
            ls.sort(key=lambda l: -rest[l["ik"][0], 2])
            for r, l in enumerate(ls):
                l["row"] = r
        self.legs = legs
        self.nrows = max([len(v) for v in sides.values()] + [0])
        self.arms = [dict(d, joints=d["chain"][1:]) for d in pl["arms"]]
        self.wings = [dict(d, joints=d["chain"][1:]) for d in pl["wings"]]
        self.tails = [dict(d, joints=d["chain"][1:] if d["chain"][0] in pl["spine"] else d["chain"][1:]) for d in pl["tails"]]
        self.spine = pl["spine"]
        self.head = pl["head_joint"]

    @property
    def stubby(self):
        """legs too short to walk on (an owl, a chick, a stool-legged blob): the creature hops instead"""
        return bool(self.legs) and float(np.mean([l["height"] for l in self.legs])) < 0.13 * self.H

    @property
    def leg_len(self):
        if not self.legs:
            return 0.25 * self.H
        return float(np.mean([l["height"] for l in self.legs]))


def times(duration):
    n = max(2, int(round(duration * FPS)))
    return np.arange(n + 1) / FPS, n


def new_anim(rig, duration):
    ts, n = times(duration)
    return Anim(rig.rest, rig.parents, len(ts)), ts


def sway(anim, chain, axis, amp, ts, period, lag=0.5, taper=1.0, phase=0.0, harmonic=1, bias=0.0):
    """Delta rotations about `axis` through the chain: bone i turns amp*taper**i*sin(2 pi h t/T - i*lag + phase)."""
    for i, j in enumerate(chain):
        a = amp * (taper ** i) * np.sin(TAU * harmonic * ts / period - i * lag + phase) + bias
        anim.add(j, mx.qaxis(axis, a))


def fall_axis(rest_dir, up=UP):
    """axis that tilts a limb sideways (perpendicular to both the limb and up)"""
    a = np.cross(rest_dir, up)
    return a / (np.linalg.norm(a) + 1e-9) if np.linalg.norm(a) > 1e-6 else SIDE


def gait_params(rig, run):
    legs = rig.legs
    n = len(legs)
    L = float(np.mean([l["height"] for l in legs])) if legs else 0.2
    base = 1.1 * math.sqrt(max(L, 0.05) / 0.3)
    T = float(np.clip(base, 0.6, 1.6))
    if n >= 6:
        T *= 0.75
    if run:
        T *= 0.58
    duty = {2: 0.62 if not run else 0.42, 4: 0.72 if not run else 0.46, 6: 0.58 if not run else 0.5, 8: 0.72 if not run else 0.6}.get(n, 0.65 if not run else 0.5)
    amp = (0.30 if not run else 0.46) * L                # half stride (excursion about the rest foot position)
    if n >= 6:
        amp *= 0.8
    lift = (0.22 if not run else 0.34) * L
    return dict(T=T, duty=duty, amp=amp, lift=lift, L=L)


def leg_phases(rig, run):
    legs = rig.legs
    n = len(legs)
    ph = {}
    for i, l in enumerate(legs):
        r, s = l["row"], l["side"]
        if n == 2:
            ph[i] = 0.0 if s > 0 else 0.5
        elif n == 4:
            if run:   # diagonal-pair trot
                ph[i] = 0.0 if ((r == 0) == (s > 0)) else 0.5
            else:     # lateral-sequence walk: rear-left, front-left, rear-right, front-right
                ph[i] = {(1, 1): 0.0, (0, 1): 0.25, (1, -1): 0.5, (0, -1): 0.75}.get((min(r, 1), s), 0.0) if rig.nrows <= 2 else 0.0
        elif n == 6:   # alternating tripods
            ph[i] = 0.0 if ((r % 2 == 0) == (s > 0)) else 0.5
        elif n == 8 and rig.nrows == 4:  # metachronal wave, opposite sides half a cycle apart
            ph[i] = ((3 - r) * 0.125 + (0.0 if s > 0 else 0.5)) % 1.0
        else:
            ph[i] = (0.5 * ((r + (0 if s > 0 else 1)) % 2) + 0.07 * r) % 1.0
    return ph


def foot_offsets(phase, duty, amp, lift):
    """phase: (T,) in [0,1). Returns forward offset dz (stance: +amp -> -amp backwards; swing: back to front) and height dy."""
    dz = np.zeros_like(phase)
    dy = np.zeros_like(phase)
    st = phase < duty
    u = np.where(st, phase / duty, 0.0)
    dz = np.where(st, amp - 2 * amp * u, 0.0)
    v = np.where(~st, (phase - duty) / (1 - duty), 0.0)
    sv = mx.smoothstep(v)
    dz = np.where(~st, -amp + 2 * amp * sv, dz)
    dy = np.where(~st, lift * np.sin(np.pi * np.clip(v, 0, 1)) ** 1.2, 0.0)
    return dz, dy


def stable_foot(anim, leg, G, W, P, pitch=None):
    chain = leg["ik"]
    foot_w = None
    if leg["foot"] is not None:
        foot_w = mx.qid((anim.T,)) if pitch is None else mx.qaxis(SIDE, pitch)
    solve_chain(anim, chain, G, W, P, pole_rest=FWD, foot_world=foot_w)


# =====================================================================================================
# locomotion (legs)
# =====================================================================================================
def walk_legged(rig, run=False):
    gp = gait_params(rig, run)
    T, duty, amp, lift = gp["T"], gp["duty"], gp["amp"], gp["lift"]
    anim, ts = new_anim(rig, T)
    cyc = (ts / T) % 1.0
    legs = rig.legs
    n = len(legs)
    ph = leg_phases(rig, run)
    kind = rig.kind
    # ---- body layer (before the legs so the hips know where they are)
    bob = 0.045 * gp["L"] * (1.5 if run else 1.0)
    freq = 2 if n in (2,) else (2 if n == 4 and run else 4 if n >= 6 else 2)
    if n == 2:
        mids = [(ph[i] + duty / 2) % 1.0 for i in range(2)]
        anim.rootT[:, 1] -= bob * (1 - np.cos(TAU * 2 * (cyc - mids[0]))) * 0.5
    else:
        anim.rootT[:, 1] -= bob * (1 - np.cos(TAU * freq * cyc)) * 0.5
    hips = 1
    # pelvis roll / yaw alternate with the legs
    roll = (0.05 if not run else 0.07) * (1.0 if n == 2 else 0.5)
    yawa = (0.07 if not run else 0.09) * (1.0 if n == 2 else 0.6)
    anim.add(hips, mx.qaxis(FWD, roll * np.sin(TAU * cyc)))
    anim.add(hips, mx.qaxis(UP, yawa * np.sin(TAU * cyc)))
    if n >= 4:
        anim.add(hips, mx.qaxis(SIDE, (0.03 if not run else 0.06) * np.sin(TAU * 2 * cyc)))
    # spine counter-motion and head stabilisation
    spine = [j for j in rig.spine if j > 1]
    for k, j in enumerate(spine):
        anim.add(j, mx.qaxis(UP, -0.5 * yawa * np.sin(TAU * cyc - 0.25 * k)))
        anim.add(j, mx.qaxis(FWD, -0.5 * roll * np.sin(TAU * cyc)))
    # tails: lateral wave, one cycle late
    for tl in rig.tails:
        sway(anim, tl["joints"], UP, 0.22, ts, T, lag=0.6, taper=1.08, phase=-0.8)
        sway(anim, tl["joints"], SIDE, 0.05, ts, T / 2, lag=0.4, phase=0.5, bias=0.05)   # never dips: a tail on the ground must not enter it
    # arms swing against the legs
    arm_swing(rig, anim, ts, T, cyc, run, ph)
    # wings: held half-folded while walking
    wings_fold(rig, anim, 0.5)
    W, P = anim.fk()
    # ---- legs
    for i, l in enumerate(legs):
        dz, dy = foot_offsets((cyc + ph[i]) % 1.0, duty, amp, lift)
        G = l["eff_rest"][None] + dz[:, None] * FWD + dy[:, None] * UP
        pitch = None
        if l["foot"] is not None:
            v = ((cyc + ph[i]) % 1.0 - duty) / (1 - duty)
            pitch = np.where(v > 0, -0.5 * np.sin(np.pi * np.clip(v, 0, 1)), 0.0)
        stable_foot(anim, l, G, W, P, pitch)
    speed = 2 * amp / (duty * T)
    return anim, T, dict(speed=float(speed), stride=float(2 * amp), cadence=float(1 / T), duty=float(duty))


def arm_swing(rig, anim, ts, T, cyc, run, ph):
    arms = rig.arms
    if not arms:
        return
    legs = rig.legs
    for a in arms:
        j = a["joints"]
        if len(j) < 2:
            continue
        d = rig.rest[j[1]] - rig.rest[j[0]]
        d = d / (np.linalg.norm(d) + 1e-9)
        s = a["side"]
        # opposite leg phase: left arm with right leg
        base = 0.0 if s > 0 else 0.5
        if legs:
            base = (0.5 if s > 0 else 0.0) if len(legs) == 2 else base
        phase = np.sin(TAU * (cyc + base))
        amp = 0.45 if not run else 0.9
        if abs(d[1]) > 0.55:      # hanging arm: swing about the lateral axis
            ax = SIDE
        else:                       # arm held out sideways: swing about the vertical axis
            ax = UP * (1 if d[0] * s >= 0 else -1) * s
            lower = mx.qaxis(fall_axis(d), 0.0)
        anim.add(j[0], mx.qaxis(ax, amp * 0.5 * phase * (1 if ax is SIDE else 0.8)))
        if len(j) > 2:
            elbow = (0.25 + 0.2 * run) * (0.5 + 0.5 * phase)
            anim.add(j[1], mx.qaxis(SIDE if ax is SIDE else UP, -elbow * s if ax is not SIDE else -elbow))


def wings_fold(rig, anim, amount):
    """rotate wing roots backwards about the vertical axis (a resting, folded wing)"""
    for w in rig.wings:
        if amount <= 0:
            continue
        j0 = w["joints"][0]
        s = w["side"]
        anim.add(j0, mx.qaxis(UP, np.full(anim.T, s * amount * 1.2)))


# =====================================================================================================
# helpers shared by the other clips
# =====================================================================================================
def body_chain(rig):
    """head -> tail ordered joints of the central line (hips included), for serpents and tails"""
    sp = [j for j in rig.spine if j > 0]
    head_side = list(reversed(sp))           # head ... hips
    tail = rig.tails[0]["joints"] if rig.tails else []
    return head_side, tail


def interp_keys(u, keys):
    """piece-wise smoothstep interpolation of keyframes [(u0, value0), ...]; values are numpy arrays of equal shape"""
    u = np.asarray(u)
    us = np.array([k[0] for k in keys])
    vs = np.array([np.asarray(k[1], float) for k in keys])
    out = np.zeros((len(u),) + vs.shape[1:])
    for n in range(len(u)):
        i = int(np.clip(np.searchsorted(us, u[n], side="right") - 1, 0, len(us) - 2))
        f = (u[n] - us[i]) / max(us[i + 1] - us[i], 1e-9)
        f = mx.smoothstep(f)
        out[n] = vs[i] * (1 - f) + vs[i + 1] * f
    return out


def pulse(u, up=0.35):
    """0 -> 1 -> 0 with the peak at `up` (fast rise, slower fall)"""
    u = np.clip(u, 0, 1)
    return np.where(u < up, mx.smoothstep(u / up), mx.smoothstep((1 - u) / (1 - up)))


def min_y_after(rig, anim_W0, T_rot, extra=None):
    pass


def rigid_ground_lift(rig, q, pivot=np.zeros(3), skip=1):
    """lowest point of the (rigidly rotated) mesh per frame; q: (T,4)"""
    pts = rig.sample[::skip] - pivot
    out = np.zeros(len(q))
    for t in range(len(q)):
        r = mx.qrot(q[t], pts)
        out[t] = r[:, 1].min() + pivot[1]
    return out


def arm_chain(arm):
    j = arm["joints"]
    return j[:3] if len(j) >= 3 else j


def hand_target(rig, arm, offs):
    """world target for the arm effector: shoulder + body-basis offsets (fwd, up, side) in units of arm length"""
    j = arm["joints"]
    ch = arm_chain(arm)
    S0 = rig.rest[ch[0]]
    reach = float(sum(np.linalg.norm(rig.rest[b] - rig.rest[a]) for a, b in zip(ch[:-1], ch[1:])))
    offs = np.asarray(offs, float)
    # never ask the hand to be closer than ~0.35 arm lengths to the shoulder (the elbow would fold and flip)
    ln = np.linalg.norm(offs, axis=-1, keepdims=True)
    offs = np.where(ln < 0.35, offs / np.maximum(ln, 1e-6) * 0.35, offs)
    offs = np.where(ln < 1e-6, np.array([0.1, -0.35, 0.0]), offs)
    return S0 + reach * (offs[..., 0:1] * FWD + offs[..., 1:2] * UP + offs[..., 2:3] * SIDE * arm["side"])


def drive_arm(rig, anim, arm, offs, W, P):
    ch = arm_chain(arm)
    if len(ch) < 2:
        return
    G = hand_target(rig, arm, offs)
    # elbows bend back / down / outwards: a mixed direction, so reaching along any axis never makes the pole degenerate
    pole = np.array([0.3 * arm["side"], -0.5, -1.0])
    solve_chain(anim, ch, G, W, P, pole_rest=pole / np.linalg.norm(pole), force_pole=True)


def lower_tpose_arms(rig, anim, amount=0.9):
    """arms held out sideways at rest hang down a little in every clip (constant pose layer)"""
    for a in rig.arms:
        j = a["joints"]
        if len(j) < 2:
            continue
        d = rig.rest[j[1]] - rig.rest[j[0]]
        d /= np.linalg.norm(d) + 1e-9
        if abs(d[1]) < 0.5:
            # rotate about the forward axis so the arm points down: side>0 arm (x>0) down = negative rotation about +z
            anim.add(j[0], mx.qaxis(FWD, np.full(anim.T, -a["side"] * amount * (1 - abs(d[1])))))


# =====================================================================================================
# flying / hovering
# =====================================================================================================
def wing_axis(rig, w):
    j = w["joints"]
    d = rig.rest[j[-1]] - rig.rest[j[0]] if len(j) > 1 else SIDE * w["side"]
    d = np.array([d[0], 0.0, d[2]])
    if np.linalg.norm(d) < 1e-6:
        d = SIDE * w["side"]
    d /= np.linalg.norm(d)
    a = np.cross(d, UP)
    return a / (np.linalg.norm(a) + 1e-9)


def fly(rig, hover=False):
    T = float(np.clip(0.55 + 1.1 * rig.size * (rig.size if False else 1.0), 0.6, 1.3)) if not hover else 1.6
    if rig.kind == "winged" and rig.plan["dims"]["size"] > 0.9:
        T = 1.0 if not hover else 1.8
    anim, ts = new_anim(rig, T)
    cyc = ts / T
    amp = 0.75 if not hover else 0.25
    for w in rig.wings:
        ax = wing_axis(rig, w)
        # right-hand rotation about `ax` lifts the tip (ax = dir x up): +angle = up
        n = len(w["joints"])
        for i, j in enumerate(w["joints"][:3]):
            a = amp * (0.55 if i == 0 else 0.45 if i == 1 else 0.35) * np.sin(TAU * cyc - 0.7 * i)
            anim.add(j, mx.qaxis(ax, a))
    # body bobs against the downstroke, leans, tail trails
    anim.rootT[:, 1] += (0.035 if not hover else 0.02) * rig.size * np.cos(TAU * cyc + 0.3)
    anim.add(1, mx.qaxis(SIDE, (0.08 if not hover else 0.03) * np.sin(TAU * cyc + 0.6)))
    for tl in rig.tails:
        sway(anim, tl["joints"], UP, 0.12, ts, T, lag=0.45, taper=1.06)
        sway(anim, tl["joints"], SIDE, 0.18 if not hover else 0.08, ts, T, lag=0.5, phase=-0.9)
    for k, j in enumerate([j for j in rig.spine if j > 1]):
        anim.add(j, mx.qaxis(SIDE, 0.03 * np.sin(TAU * cyc - 0.5 * k)))
    anim.add(rig.head, mx.qaxis(SIDE, -0.06 * np.sin(TAU * cyc + 0.6)))
    lower_tpose_arms(rig, anim)
    # legs tuck up and back
    if rig.legs:
        W, P = anim.fk()
        for l in rig.legs:
            L = l["height"]
            G = l["eff_rest"][None] + (-0.25 * L) * FWD + (0.4 * L) * UP + 0.0 * SIDE
            G = np.broadcast_to(G, (anim.T, 3)).copy()
            G[:, 1] += 0.03 * L * np.sin(TAU * cyc + 1.0)
            stable_foot(anim, l, G, W, P)
    return anim, T, {"speed": float(1.4 * rig.size) if not hover else 0.0}


# =====================================================================================================
# serpents / floating / blobs / vehicles / plants
# =====================================================================================================
def slither(rig, run=False):
    T = 1.5 if not run else 0.8
    anim, ts = new_anim(rig, T)
    cyc = ts / T
    head_side, tail = body_chain(rig)
    L = rig.plan["dims"]["spine_length"] + sum(np.linalg.norm(rig.rest[b] - rig.rest[a]) for a, b in zip(([1] + tail)[:-1], ([1] + tail)[1:]))
    L = max(L, 0.3 * rig.size)
    lam = max(L / 1.6, 0.05)
    k = TAU / lam
    amp0 = 0.14 * lam * (1.0 if not run else 1.15)

    def seg_angles(chain, base_rest, sgn):
        # distance along the body measured from the head
        pts = [rig.rest[j] for j in chain]
        s = np.zeros(len(chain))
        for i in range(1, len(chain)):
            s[i] = s[i - 1] + np.linalg.norm(pts[i] - pts[i - 1])
        return s

    # head side: from head (s=0) to hips; angle for joint i from slope of u(s,t) = A(s) sin(k s - w t)
    omega = TAU / T
    sm = {}
    s_head = seg_angles(head_side, None, 1)
    s_total_h = s_head[-1] if len(s_head) else 0.0
    # body coordinate s_body: head = 0, hips = s_total_h, tail beyond
    S = {}
    for i, j in enumerate(head_side):
        S[j] = s_head[i]
    tl = list(tail)
    s0 = s_total_h
    prev = 1
    for j in tl:
        s0 += np.linalg.norm(rig.rest[j] - rig.rest[prev])
        S[j] = s0
        prev = j

    def slope(s):
        A = amp0 * (0.45 + 0.75 * np.clip(s / L, 0, 1))
        return A * k * np.cos(k * s - omega * ts)

    world_prev = {}
    # head chain: hips (index len-1) is the root of this part; walk from hips outward to the head
    for i in range(len(head_side) - 2, -1, -1):
        j = head_side[i]
        phi = np.arctan(slope(S[j]))
        prev_phi = np.arctan(slope(S[head_side[i + 1]])) if i + 1 < len(head_side) - 1 else 0.0 * phi
        anim.add(j, mx.qaxis(UP, (phi - prev_phi)))
    prev_phi = 0.0 * ts
    for j in tl:
        phi = -np.arctan(slope(S[j]))
        anim.add(j, mx.qaxis(UP, phi - prev_phi))
        prev_phi = phi
    anim.rootT[:, 1] += 0.0
    return anim, T, {"speed": float(0.6 * lam / T), "wavelength": float(lam)}


def hop(rig, run=False, kind="blob"):
    T = 1.0 if not run else 0.62
    anim, ts = new_anim(rig, T)
    u = (ts / T) % 1.0
    h = (0.16 if not run else 0.24) * rig.size
    # crouch 0-0.2, launch+air 0.2-0.75, land squash 0.75-0.9, settle
    air = np.clip((u - 0.2) / 0.55, 0, 1)
    y = h * 4 * air * (1 - air) * ((u > 0.2) & (u < 0.75))
    crouch = pulse(np.clip(u / 0.2, 0, 1), 0.99) * (u < 0.2)
    land = np.where(u >= 0.75, pulse(np.clip((u - 0.75) / 0.25, 0, 1), 0.3), 0.0)
    sq = np.clip(crouch * 0.28 + land * 0.30, 0, 0.4)
    st = np.where((u > 0.2) & (u < 0.75), 0.18 * np.sin(np.pi * air), 0.0)
    sy = 1 - sq + st
    sxz = 1 + 0.55 * (sq) - 0.35 * st
    anim.rootT[:, 1] = y
    anim.rootS = np.stack([sxz, sy, sxz], 1)
    dist = (0.55 if not run else 0.9) * 0.5 * rig.size
    # chains wobble behind the hop
    for tl in rig.tails:
        sway(anim, tl["joints"], SIDE, 0.25, ts, T, lag=0.5, phase=-1.0)
    return anim, T, {"speed": float(dist / T), "stride": float(dist)}


def glide(rig, run=False):
    """floating things: bob, lean into the motion, tentacles / tails trail"""
    T = 2.0 if not run else 1.2
    anim, ts = new_anim(rig, T)
    cyc = ts / T
    lean = 0.14 if not run else 0.3
    anim.rootT[:, 1] += 0.025 * rig.size * np.sin(TAU * cyc)
    anim.add(1, mx.qaxis(SIDE, lean + 0.04 * np.sin(TAU * cyc + 0.5)))
    anim.add(1, mx.qaxis(FWD, 0.05 * np.sin(TAU * cyc + 1.3)))
    for tl in rig.tails:
        sway(anim, tl["joints"], UP, 0.2, ts, T, lag=0.6, taper=1.07)
    tentacles(rig, anim, ts, T, 0.3 if not run else 0.45)
    pulse_scale(anim, cyc, 0.06 if not run else 0.1)
    for w in rig.wings:
        ax = wing_axis(rig, w)
        sway(anim, w["joints"][:3], ax, 0.45 if run else 0.3, ts, T / (2 if run else 1), lag=0.6)
    return anim, T, {"speed": float((0.35 if not run else 0.8) * rig.size)}


def tentacles(rig, anim, ts, T, amp):
    """hanging chains (legs of a floating thing, tentacles) wave with phase offsets"""
    for i, l in enumerate(rig.legs):
        j = l["joints"]
        ax = np.cross(rig.rest[j[-1]] - rig.rest[j[0]], UP)
        n = np.linalg.norm(ax)
        ax = ax / n if n > 1e-6 else SIDE
        sway(anim, j, ax, amp, ts, T, lag=0.7, taper=1.1, phase=i * 1.3)
        sway(anim, j, UP, amp * 0.6, ts, T, lag=0.5, taper=1.05, phase=i * 0.7 + 1.0)


def pulse_scale(anim, cyc, amt):
    anim.rootS = np.stack([1 + amt * 0.6 * np.sin(TAU * cyc + np.pi), 1 + amt * np.sin(TAU * cyc), 1 + amt * 0.6 * np.sin(TAU * cyc + np.pi)], 1)


def vehicle_drive(rig, run=False):
    T = 0.5 if not run else 0.3
    anim, ts = new_anim(rig, T)
    cyc = ts / T
    anim.rootT[:, 1] += 0.008 * rig.size * np.sin(TAU * 2 * cyc)
    anim.add(1, mx.qaxis(SIDE, 0.012 * np.sin(TAU * cyc + 0.5)))
    anim.add(1, mx.qaxis(FWD, 0.01 * np.sin(TAU * 2 * cyc)))
    return anim, T, {"speed": float((1.2 if not run else 2.4) * rig.size)}


def plant_sway(rig, strong=False):
    T = 3.2 if not strong else 1.4
    anim, ts = new_anim(rig, T)
    chain = [j for j in rig.spine if j > 0]
    sway(anim, chain, SIDE, 0.05 if not strong else 0.12, ts, T, lag=0.35, taper=1.12)
    sway(anim, chain, FWD, 0.04 if not strong else 0.1, ts, T, lag=0.4, taper=1.1, phase=1.1)
    for l in rig.legs + rig.arms + rig.wings:
        sway(anim, l["joints"], SIDE, 0.08, ts, T, lag=0.5, phase=0.7)
    return anim, T, {}


# =====================================================================================================
# idle
# =====================================================================================================
def _front_legs(rig):
    if not rig.legs:
        return []
    rows = sorted({l["row"] for l in rig.legs})
    return [l for l in rig.legs if l["row"] == rows[0]]


def attack(rig, variant=1):
    """1: strike with the arm / lunge-and-bite; 2: claw swipe with the front limbs (or tail whip / slam)"""
    T = 0.95
    anim, ts = new_anim(rig, T)
    u = ts / T
    hit_at = 0.45
    size = rig.size
    arms = sorted(rig.arms, key=lambda a: a["side"])   # side -1 = the creature's right hand strikes
    plan = rig.kind
    lunge = interp_keys(u, [(0.0, [0.0]), (0.3, [-0.35]), (hit_at, [1.0]), (0.62, [0.7]), (1.0, [0.0])])[:, 0]
    pit = interp_keys(u, [(0.0, [0.0]), (0.28, [-0.25]), (hit_at, [0.35]), (0.7, [0.18]), (1.0, [0.0])])[:, 0]
    anim.rootT[:, 2] += 0.07 * size * lunge * (1.0 if plan not in ("plant",) else 0.2)
    spine = [j for j in rig.spine if j > 1]
    anim.add(1, mx.qaxis(SIDE, 0.12 * pit))
    for k, j in enumerate(spine):
        anim.add(j, mx.qaxis(SIDE, 0.09 * pit * (1 + 0.3 * k)))
        anim.add(j, mx.qaxis(UP, 0.0))
    anim.add(rig.head, mx.qaxis(SIDE, 0.55 * pit))
    for tl in rig.tails:
        sway(anim, tl["joints"], UP, 0.3, ts, T, lag=0.5, phase=1.0 + (0.5 if variant == 2 else 0))
        anim.add(tl["joints"][0], mx.qaxis(SIDE, -0.15 * lunge))
    for w in rig.wings:
        ax = wing_axis(rig, w)
        wp = pulse(u, hit_at)
        anim.add(w["joints"][0], mx.qaxis(ax, 0.5 * wp))
    lower_tpose_arms(rig, anim)
    W, P = anim.fk()
    used_arm = False
    if arms and variant == 1:
        strike = arms[0]
        key = [(0.0, [0.0, -0.15, 0.1]), (0.3, [-0.25, 0.85, 0.25]), (hit_at, [0.85, -0.05, 0.1]), (0.7, [0.6, -0.5, 0.15]), (1.0, [0.0, -0.15, 0.1])]
        offs = interp_keys(u, key)
        drive_arm(rig, anim, strike, offs, W, P)
        used_arm = True
        # torso twist into the blow
        for j in spine:
            anim.add(j, mx.qaxis(UP, -0.3 * strike["side"] * (pulse(u, hit_at) - 0.3 * np.sin(np.pi * np.clip(u / 0.3, 0, 1)))))
    fl = _front_legs(rig)
    if fl and (variant == 2 or (not used_arm and plan in ("quadruped", "multileg", "winged"))):
        # rear up on the hind legs, front limbs claw down (every other front leg alternates)
        W, P = anim.fk()
        for i, l in enumerate(fl):
            ph = 0.0 if l["side"] > 0 else 0.12
            key = [(0.0, [0, 0, 0]), (0.3 + ph * 0.5, [0.15, 0.9, 0.2]), (hit_at + ph * 0.3, [0.7, 0.1, 0.15]), (0.75, [0.3, -0.05, 0.05]), (1.0, [0, 0, 0])]
            offs = interp_keys(u, key)
            L = l["height"] * 1.1
            G = l["eff_rest"][None] + L * (offs[:, 0:1] * FWD + offs[:, 1:2] * UP + offs[:, 2:3] * SIDE * l["side"])
            stable_foot(anim, l, G, W, P)
    # the other legs stay planted at their rest positions
    W, P = anim.fk()
    for l in rig.legs:
        if l in fl and (variant == 2 or (not used_arm and plan in ("quadruped", "multileg", "winged"))):
            continue
        G = np.broadcast_to(l["eff_rest"], (anim.T, 3)).copy()
        stable_foot(anim, l, G, W, P)
    if plan in ("blob", "floating"):
        sq = pulse(u, 0.3)
        anim.rootS = np.stack([1 + 0.3 * sq - 0.25 * pulse(u, hit_at) * 0, 1 - 0.3 * sq + 0.35 * np.where(u > 0.3, pulse((u - 0.3) / 0.4, 0.3), 0), 1 + 0.3 * sq], 1)
    if plan == "serpent":
        head_side, tail = body_chain(rig)
        for k, j in enumerate(head_side[:-1]):
            anim.add(j, mx.qaxis(UP, 0.35 * (1 - pulse(u, hit_at)) * (-1) ** k * 0.5 * np.sin(TAU * u * 2)))
    return anim, T, {"hit_time": float(hit_at * T), "variant": variant}


def hit(rig):
    T = 0.55
    anim, ts = new_anim(rig, T)
    u = ts / T
    p = pulse(u, 0.22)
    anim.rootT[:, 2] -= 0.045 * rig.size * p
    anim.add(1, mx.qaxis(SIDE, -0.14 * p))
    anim.add(1, mx.qaxis(FWD, 0.06 * p))
    for k, j in enumerate([j for j in rig.spine if j > 1]):
        anim.add(j, mx.qaxis(SIDE, -0.10 * p * (1 + 0.2 * k)))
    anim.add(rig.head, mx.qaxis(SIDE, -0.3 * p))
    for tl in rig.tails:
        sway(anim, tl["joints"], UP, 0.35, ts, T, lag=0.4, phase=0.0)
        anim.add(tl["joints"][0], mx.qaxis(SIDE, 0.2 * p))
    for w in rig.wings:
        anim.add(w["joints"][0], mx.qaxis(wing_axis(rig, w), 0.5 * p))
    for a in rig.arms:
        anim.add(a["joints"][0], mx.qaxis(SIDE, -0.5 * p))
    if rig.kind in ("blob", "floating"):
        anim.rootS = np.stack([1 + 0.25 * p, 1 - 0.3 * p, 1 + 0.25 * p], 1)
    if rig.legs:
        W, P = anim.fk()
        for l in rig.legs:
            G = np.broadcast_to(l["eff_rest"], (anim.T, 3)).copy()
            G[:, 2] += 0.06 * l["height"] * p * 0
            stable_foot(anim, l, G, W, P)
    return anim, T, {}


def die(rig):
    T = 1.5
    anim, ts = new_anim(rig, T)
    u = np.clip(ts / T, 0, 1)
    fall = np.where(u < 0.75, (u / 0.75) ** 2, 1.0)          # accelerates into the ground
    settle = np.where(u >= 0.75, np.sin(np.pi * np.clip((u - 0.75) / 0.25, 0, 1) * 1.0) * 0.06, 0.0)   # small bounce
    kind = rig.kind
    if kind in ("blob", "floating"):
        s = mx.smoothstep(u / 0.8)
        anim.rootS = np.stack([1 + 0.45 * s, 1 - 0.7 * s, 1 + 0.45 * s], 1)
        for tl in rig.tails:
            sway(anim, tl["joints"], UP, 0.3 * (1 - u[0]), ts, T, lag=0.5)
        tentacles(rig, anim, ts, T, 0.1)
        for l in rig.legs:
            anim.add(l["joints"][0], mx.qaxis(SIDE, 0.8 * s))
        anim.rootT[:, 1] = 0.0
        return anim, T, {}
    if kind == "plant":
        ang = -1.45 * fall
        anim.add(0, mx.qaxis(FWD, ang))
    else:
        biped = kind == "biped" and rig.plan.get("upright", False)
        axis = SIDE if biped else FWD
        ang = (-1.5 if biped else 1.45) * fall
        q = mx.qaxis(axis, ang)
        anim.D[:, 0] = q
        # limp limbs: spine droops, tail drops, head lolls
        for k, j in enumerate([j for j in rig.spine if j > 1]):
            anim.add(j, mx.qaxis(SIDE if not biped else FWD, 0.12 * fall))
        anim.add(rig.head, mx.qaxis(UP, 0.4 * fall))
        for tl in rig.tails:
            sway(anim, tl["joints"], UP, 0.25 * (1 - fall), ts, T, lag=0.5)
        for l in rig.legs:   # legs splay / fold
            ax = np.cross(rig.rest[l["joints"][-1]] - rig.rest[l["joints"][0]], UP)
            ax = ax / (np.linalg.norm(ax) + 1e-9)
            anim.add(l["joints"][0], mx.qaxis(ax, 0.5 * fall * l["side"] * 0.5))
        for a in rig.arms:
            anim.add(a["joints"][0], mx.qaxis(SIDE, -0.6 * fall))
        for w in rig.wings:
            anim.add(w["joints"][0], mx.qaxis(wing_axis(rig, w), -0.6 * fall))
        if kind == "serpent":
            head_side, tail = body_chain(rig)
            for k, j in enumerate(head_side[:-1]):
                anim.add(j, mx.qaxis(UP, 0.25 * np.sin(TAU * 1.5 * u + k * 0.8) * (1 - u)))
        # rest the body on the ground: lowest sample point under the rigid rotation
        low = rigid_ground_lift(rig, np.repeat(q[None] if q.ndim == 1 else q, 1, 0) if q.ndim == 2 else q)
        anim.rootT[:, 1] = np.maximum(0.0, -low) + settle * rig.size * 0.3
    return anim, T, {}


# =====================================================================================================
# flavour motions (people first): wave, cheer, dance, bow, taunt, jump
# =====================================================================================================
def _plant_all(rig, anim, lift=None):
    """IK every leg back onto its rest foot position (after root / spine motion). lift: dict leg index -> (T,) height."""
    W, P = anim.fk()
    for i, l in enumerate(rig.legs):
        G = np.broadcast_to(l["eff_rest"], (anim.T, 3)).copy()
        if lift and i in lift:
            G[:, 1] += lift[i]
        stable_foot(anim, l, G, W, P)


def _arms_pose(rig, anim, per_arm):
    """per_arm: {arm index: offs (T,3)} -> IK hand targets (fwd, up, side in arm lengths from the shoulder)"""
    W, P = anim.fk()
    for i, offs in per_arm.items():
        drive_arm(rig, anim, rig.arms[i], offs, W, P)


def arc_blend(a, b, f):
    """blend two shoulder-relative hand offsets along an arc (direction slerp, length lerp): never through the shoulder"""
    la, lb = np.linalg.norm(a, axis=-1, keepdims=True), np.linalg.norm(b, axis=-1, keepdims=True)
    da, db = a / (la + 1e-9), b / (lb + 1e-9)
    f = np.asarray(f)[..., None]
    dot = np.clip(np.sum(da * db, -1, keepdims=True), -1, 1)
    th = np.arccos(dot)
    s = np.sin(th) + 1e-9
    d = np.where(th < 1e-4, da, (np.sin((1 - f) * th) / s) * da + (np.sin(f * th) / s) * db)
    return d / (np.linalg.norm(d, axis=-1, keepdims=True) + 1e-9) * (la * (1 - f) + lb * f)


def wave(rig):
    T = 2.0
    anim, ts = new_anim(rig, T)
    cyc = ts / T
    e = mx.smoothstep(np.minimum(cyc / 0.12, (1 - cyc) / 0.12))
    lower_tpose_arms(rig, anim)
    anim.add(rig.head, mx.qaxis(UP, 0.2 * np.sin(TAU * cyc)))
    arms = sorted(range(len(rig.arms)), key=lambda i: rig.arms[i]["side"])
    if arms:
        i = arms[0]
        rest = hand_target(rig, rig.arms[i], np.zeros(3))
        offs = np.stack([0.15 * np.ones(anim.T), 0.95 * np.ones(anim.T), (0.45 + 0.3 * np.sin(TAU * 3 * cyc))], 1)
        r0 = np.array([0.0, -0.9, 0.2])
        _arms_pose(rig, anim, {i: arc_blend(np.broadcast_to(r0, offs.shape), offs, e)})
    _plant_all(rig, anim)
    return anim, T, {}


def cheer(rig):
    T = 1.2
    anim, ts = new_anim(rig, T)
    cyc = ts / T
    anim.rootT[:, 1] += 0.02 * rig.H * np.abs(np.sin(TAU * cyc))
    lower_tpose_arms(rig, anim)
    anim.add(rig.head, mx.qaxis(SIDE, -0.25))
    per = {}
    for i in range(len(rig.arms)):
        offs = np.stack([0.1 * np.ones(anim.T), 0.95 + 0.12 * np.sin(TAU * cyc + i * np.pi), 0.35 * np.ones(anim.T)], 1)
        per[i] = offs
    _arms_pose(rig, anim, per)
    _plant_all(rig, anim)
    return anim, T, {}


def dance(rig):
    T = 2.0
    anim, ts = new_anim(rig, T)
    cyc = ts / T
    anim.rootT[:, 1] += 0.015 * rig.H * np.abs(np.sin(TAU * 2 * cyc))
    anim.rootT[:, 0] += 0.03 * rig.size * np.sin(TAU * cyc)
    anim.add(1, mx.qaxis(FWD, 0.12 * np.sin(TAU * cyc)))
    anim.add(1, mx.qaxis(UP, 0.25 * np.sin(TAU * 2 * cyc)))
    for k, j in enumerate([j for j in rig.spine if j > 1]):
        anim.add(j, mx.qaxis(FWD, -0.06 * np.sin(TAU * cyc)))
        anim.add(j, mx.qaxis(UP, -0.2 * np.sin(TAU * 2 * cyc + 0.3 * k)))
    anim.add(rig.head, mx.qaxis(FWD, 0.15 * np.sin(TAU * 2 * cyc)))
    for tl in rig.tails:
        sway(anim, tl["joints"], UP, 0.35, ts, T, lag=0.5)
    lower_tpose_arms(rig, anim)
    per = {}
    for i in range(len(rig.arms)):
        ph = i * np.pi
        offs = np.stack([0.25 + 0.2 * np.sin(TAU * 2 * cyc + ph), 0.55 + 0.4 * np.sin(TAU * cyc + ph), 0.45 + 0.1 * np.cos(TAU * 2 * cyc)], 1)
        per[i] = offs
    _arms_pose(rig, anim, per)
    lifts = {}
    for i, l in enumerate(rig.legs):
        s = 0.5 if l["side"] > 0 else 0.0
        lifts[i] = 0.28 * l["height"] * np.maximum(0, np.sin(TAU * (cyc + s))) ** 2
    _plant_all(rig, anim, lifts)
    return anim, T, {}


def bow(rig):
    T = 2.2
    anim, ts = new_anim(rig, T)
    u = ts / T
    k = interp_keys(u, [(0.0, [0.0]), (0.35, [1.0]), (0.62, [1.0]), (1.0, [0.0])])[:, 0]
    sp = [j for j in rig.spine if j > 1]
    anim.add(1, mx.qaxis(SIDE, 0.35 * k))
    for j in sp:
        anim.add(j, mx.qaxis(SIDE, 0.28 * k))
    anim.add(rig.head, mx.qaxis(SIDE, 0.2 * k))
    lower_tpose_arms(rig, anim)
    _plant_all(rig, anim)
    return anim, T, {}


def taunt(rig):
    T = 1.6
    anim, ts = new_anim(rig, T)
    u = ts / T
    k = interp_keys(u, [(0.0, [0.0]), (0.25, [-1.0]), (0.5, [1.0]), (0.8, [0.6]), (1.0, [0.0])])[:, 0]   # lean back, then shout forward
    anim.add(1, mx.qaxis(SIDE, -0.2 * k))
    for j in [j for j in rig.spine if j > 1]:
        anim.add(j, mx.qaxis(SIDE, -0.15 * k))
    anim.add(rig.head, mx.qaxis(SIDE, -0.5 * k))
    anim.rootT[:, 1] += 0.02 * rig.H * np.maximum(k, 0)
    for tl in rig.tails:
        sway(anim, tl["joints"], UP, 0.3, ts, T, lag=0.5)
    for w in rig.wings:
        anim.add(w["joints"][0], mx.qaxis(wing_axis(rig, w), 0.7 * np.maximum(-k, 0)))
    lower_tpose_arms(rig, anim)
    per = {}
    for i in range(len(rig.arms)):
        per[i] = np.stack([0.2 * np.ones(anim.T), 0.4 + 0.55 * np.maximum(k, 0) * 0.7, 0.8 + 0.2 * k], 1)
    _arms_pose(rig, anim, per)
    _plant_all(rig, anim)
    return anim, T, {}


def jump(rig):
    T = 0.9
    anim, ts = new_anim(rig, T)
    u = ts / T
    crouch = pulse(np.clip(u / 0.25, 0, 1), 0.99) * (u < 0.25)
    air = np.clip((u - 0.25) / 0.5, 0, 1)
    h = 0.35 * rig.H
    y = h * 4 * air * (1 - air) * ((u > 0.25) & (u < 0.75))
    land = np.where(u >= 0.75, pulse(np.clip((u - 0.75) / 0.25, 0, 1), 0.3), 0.0)
    anim.rootT[:, 1] = y - 0.12 * rig.H * (crouch + land) * (1 if rig.legs else 0)
    anim.add(1, mx.qaxis(SIDE, 0.12 * crouch - 0.08 * np.sin(np.pi * air)))
    lower_tpose_arms(rig, anim)
    per = {}
    for i in range(len(rig.arms)):
        per[i] = np.stack([0.2 * np.ones(anim.T), 0.4 + 0.5 * np.sin(np.pi * air), 0.4 * np.ones(anim.T)], 1)
    _arms_pose(rig, anim, per)
    for w in rig.wings:
        anim.add(w["joints"][0], mx.qaxis(wing_axis(rig, w), 0.6 * np.sin(np.pi * air)))
    lifts = {i: 0.35 * l["height"] * np.sin(np.pi * air) for i, l in enumerate(rig.legs)}
    W, P = anim.fk()
    for i, l in enumerate(rig.legs):
        G = np.broadcast_to(l["eff_rest"], (anim.T, 3)).copy()
        G[:, 1] += lifts[i] + y * 0.0
        G[:, 1] = np.maximum(G[:, 1], l["eff_rest"][1]) + np.where(y > 0, y, 0)
        stable_foot(anim, l, G, W, P)
    return anim, T, {}


def idle(rig):
    T = 3.0
    anim, ts = new_anim(rig, T)
    cyc = ts / T
    breath = np.sin(TAU * cyc)
    anim.rootT[:, 1] += 0.004 * rig.H * breath
    spine = [j for j in rig.spine if j > 1]
    for k, j in enumerate(spine):
        anim.add(j, mx.qaxis(SIDE, -0.018 * breath * (1 + 0.3 * k)))
    anim.add(1, mx.qaxis(FWD, 0.012 * np.sin(TAU * cyc + 0.6)))
    # head looks about
    anim.add(rig.head, mx.qaxis(UP, 0.12 * np.sin(TAU * cyc) * np.cos(TAU * cyc * 2 + 0.3)))
    anim.add(rig.head, mx.qaxis(SIDE, 0.04 * np.sin(TAU * 2 * cyc)))
    for tl in rig.tails:
        sway(anim, tl["joints"], UP, 0.12, ts, T, lag=0.55, taper=1.07, phase=0.4)
        sway(anim, tl["joints"], SIDE, 0.03, ts, T, lag=0.4, phase=1.2, bias=0.03)
    for a in rig.arms:
        j = a["joints"]
        anim.add(j[0], mx.qaxis(SIDE, 0.03 * np.sin(TAU * cyc + 1.0)))
        if len(j) > 2:
            anim.add(j[1], mx.qaxis(SIDE, 0.04 * (1 + np.sin(TAU * cyc + 1.4))))
    for w in rig.wings:
        sway(anim, w["joints"], fall_axis(rig.rest[w["joints"][1]] - rig.rest[w["joints"][0]] if len(w["joints"]) > 1 else SIDE) * w["side"], 0.05, ts, T, lag=0.5, phase=0.3)
    if rig.kind in ("winged",) and rig.legs:
        wings_fold(rig, anim, 0.5)
    if rig.kind in ("blob", "floating"):
        pulse_scale(anim, cyc, 0.035)
        tentacles(rig, anim, ts, T, 0.16)
        if rig.kind == "floating":
            anim.rootT[:, 1] += 0.02 * rig.size * np.sin(TAU * cyc + 1.0)
    if rig.kind == "serpent":
        head_side, tail = body_chain(rig)
        for k, j in enumerate(head_side[:-1]):
            anim.add(j, mx.qaxis(UP, 0.05 * np.sin(TAU * cyc - 0.6 * k)))
        sway(anim, tail, UP, 0.07, ts, T, lag=0.6, phase=0.3)
    if rig.kind == "plant":
        sway(anim, [j for j in rig.spine if j > 0], SIDE, 0.03, ts, T, lag=0.4, taper=1.1)
    # weight shift: feet stay planted, hips slide a bit
    if rig.legs and rig.kind not in ("floating", "blob"):
        anim.rootT[:, 0] += 0.006 * rig.size * np.sin(TAU * cyc)
        W, P = anim.fk()
        for l in rig.legs:
            G = np.broadcast_to(l["eff_rest"], (anim.T, 3)).copy()
            stable_foot(anim, l, G, W, P)
    return anim, T, {}


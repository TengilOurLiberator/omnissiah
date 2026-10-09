"""Body-plan analysis of a (cleaned) skeleton + mesh.

Everything is Y-up. The skeleton is first aligned so the body's mirror plane is x = cx (yaw search), then:

  * the *midline tree* = joints close to the mirror plane, connected to the root: spine, neck, head, tail(s)
  * lateral subtrees hanging off the midline = legs / arms / wings / accessories
  * head = the midline leaf with the best head score (thick, high, forward); facing = root -> head (horizontal)
  * body plan from the limb counts and proportions: biped, quadruped, multileg (6/8/..), winged, serpent, floating,
    blob, plant, vehicle (the last three are mostly prompt driven: geometry alone cannot tell a bush from a bean)

Returns a plain dict (JSON friendly except numpy arrays under 'geom').
"""
import numpy as np
from . import mathx as mx

FLY_WORDS = ("jellyfish", "jelly", "ghost", "wisp", "spirit", "orb", "floating", "floats", "hovering", "flying", "eyeball", "eye ", "balloon",
             "cloud", "drone", "bat", "bee", "wasp", "butterfly", "moth", "dragonfly", "bird", "eagle", "owl", "hawk", "crow", "raven", "phoenix",
             "dragon", "wyvern", "angel", "fairy", "pixie", "seraph", "gargoyle", "manta", "specter", "spectre", "phantom", "wraith", "will-o")
FLOAT_WORDS = ("jellyfish", "jelly", "ghost", "wisp", "spirit", "orb", "floating", "floats", "hovering", "eyeball", "eye ", "balloon", "cloud",
               "specter", "spectre", "phantom", "wraith", "will-o", "manta", "drone", "sentinel", "beholder", "wisp")
SERPENT_WORDS = ("snake", "serpent", "worm", "eel", "viper", "cobra", "python", "naga", "centipede", "caterpillar", "leech", "slug", "tentacle worm", "wyrm", "lamprey")
VEHICLE_WORDS = ("car", "truck", "tank", "wagon", "cart", "carriage", "bike", "motorcycle", "bicycle", "tractor", "bus", "van", "locomotive", "train", "mech", "robot car", "buggy", "chariot")
PLANT_WORDS = ("tree", "bush", "plant", "flower", "cactus", "mushroom", "shrub", "vine", "grass", "fern", "palm", "pine", "oak", "sapling")
BLOB_WORDS = ("slime", "blob", "jelly cube", "ooze", "gel", "pudding", "puddle", "amoeba", "mimic", "boulder", "rock monster")


def hint_words(prompt):
    p = " " + str(prompt or "").lower() + " "
    return {k: [w for w in ws if (" " + w) in p or w in p] for k, ws in
            dict(fly=FLY_WORDS, float=FLOAT_WORDS, serpent=SERPENT_WORDS, vehicle=VEHICLE_WORDS, plant=PLANT_WORDS, blob=BLOB_WORDS).items()}


def rotate_y(p, ang):
    c, s = np.cos(ang), np.sin(ang)
    R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.asarray(p) @ R.T


def align_yaw(rest, verts, weights=None):
    """Yaw (radians, about +Y) that makes the body mirror-symmetric about x = cx. Search 0..180 deg, fine step."""
    pts = np.concatenate([rest, verts[:: max(1, len(verts) // 1500)]], 0)
    best, best_s = 0.0, 1e9
    from scipy.spatial import cKDTree
    for deg in np.arange(0, 180, 3.0):
        a = np.radians(deg)
        q = rotate_y(pts, a)
        cx = (q[:, 0].min() + q[:, 0].max()) / 2
        m = q.copy()
        m[:, 0] = 2 * cx - m[:, 0]
        d, _ = cKDTree(q).query(m)
        s = float(np.mean(d))
        if s < best_s - 1e-9:
            best, best_s = a, s
    # refine
    for deg in np.arange(np.degrees(best) - 3, np.degrees(best) + 3.01, 0.5):
        a = np.radians(deg)
        q = rotate_y(pts, a)
        cx = (q[:, 0].min() + q[:, 0].max()) / 2
        m = q.copy()
        m[:, 0] = 2 * cx - m[:, 0]
        d, _ = cKDTree(q).query(m)
        s = float(np.mean(d))
        if s < best_s - 1e-9:
            best, best_s = a, s
    return best, best_s


def _chain_len(rest, chain):
    return float(sum(np.linalg.norm(rest[b] - rest[a]) for a, b in zip(chain[:-1], chain[1:])))


def analyse(skel, verts, weights, faces, prompt="", yaw_hint=None, log=lambda *a: None):
    """skel: Skeleton (cleaned, Y-up, mesh base at y=0). weights (N,J) dense. Returns dict plan (see module doc)."""
    rest = skel.rest
    J = skel.n
    ch = skel.children()
    lo, hi = verts.min(0), verts.max(0)
    ext = hi - lo
    H = float(ext[1])
    size = float(ext.max())
    hints = hint_words(prompt)
    dom = weights.argmax(1)
    mass = weights.sum(0)

    plan = dict(hints={k: v for k, v in hints.items() if v}, bones=J)

    # ---- 1. mirror plane: the pipeline puts the front toward +Z, but verify on the skeleton (a wolf may face +X)
    yaw, sym = align_yaw(rest, verts)
    # keep the original orientation whenever it is nearly as symmetric (stable for humanoids)
    q0 = rotate_y(rest, 0.0)
    pts0 = np.concatenate([rest, verts[:: max(1, len(verts) // 1500)]], 0)
    from scipy.spatial import cKDTree
    cx0 = (pts0[:, 0].min() + pts0[:, 0].max()) / 2
    m0 = pts0.copy(); m0[:, 0] = 2 * cx0 - m0[:, 0]
    sym0 = float(np.mean(cKDTree(pts0).query(m0)[0]))
    if sym0 <= sym * 1.15 + 0.004 or abs(((np.degrees(yaw) + 90) % 180) - 90) < 4:
        yaw = 0.0
    plan["yaw_align"] = float(yaw)
    plan["symmetry_error"] = float(min(sym, sym0))
    if abs(yaw) > 1e-6:
        rest = rotate_y(rest, yaw)
        verts = rotate_y(verts, yaw)
        lo, hi = verts.min(0), verts.max(0)
        ext = hi - lo
    cx = float((lo[0] + hi[0]) / 2)
    cz = float((lo[2] + hi[2]) / 2)
    tau = 0.045 * size

    # ---- 2. midline tree
    from scipy.spatial import cKDTree as _KD
    _tree = _KD(rest)

    def has_partner(j):
        """a joint on the other side of the mirror plane (arm / leg / wing pairs have one, a sideways-curled tail has not)"""
        m = rest[j].copy()
        m[0] = 2 * cx - m[0]
        d, k = _tree.query(m)
        return bool(d < 0.07 * size and k != j and abs(rest[k, 0] - cx) > 0.5 * abs(rest[j, 0] - cx))

    central = np.zeros(J, bool)
    central[0] = True
    for j in range(1, J):
        p = skel.parents[j]
        if central[p] and (abs(rest[j, 0] - cx) <= tau or (len(ch[p]) == 1 and not has_partner(j))):
            central[j] = True   # (a curled tail stays on the midline tree: single children continue the chain, unless they have a mirror twin)
    leaf = np.array([len(ch[j]) == 0 for j in range(J)])

    def vsub(joints):
        m = np.isin(dom, joints)
        return np.where(m)[0]

    def end_blob(j, depth=3):
        """vertex set + radius of the last few bones of a chain ending at leaf j"""
        js = [j]
        for _ in range(depth - 1):
            p = skel.parents[js[-1]]
            if p <= 0 or len(ch[p]) > 1:
                break
            js.append(p)
        idx = vsub(js)
        if len(idx) < 8:
            return 0.0, 0
        v = verts[idx]
        return float(np.sqrt(((v - v.mean(0)) ** 2).sum(1).mean())), len(idx)

    c_leaves = [j for j in range(J) if central[j] and leaf[j] and j != 0]
    if not c_leaves and J > 1:
        c_leaves = [int(np.argmax(rest[:, 1]))]

    def path_from_root(j):
        return list(reversed(skel.path_to_root(j)))

    # head score: thick end, high, long enough path, not hugging the ground when other candidates exist
    scored = []
    for j in c_leaves:
        rr, nv = end_blob(j)
        p = path_from_root(j)
        plen = _chain_len(rest, p)
        sc = 2.0 * rr / size + 0.9 * (rest[j, 1] - lo[1]) / max(H, 1e-6) + 0.2 * plen / size
        # tails are long & thin: penalise a thin end on a long chain
        if rr / max(plen, 1e-6) < 0.07:
            sc -= 0.25
        scored.append((sc, j, rr, plen))
    scored.sort(reverse=True)
    head_leaf = scored[0][1] if scored else int(np.argmax(rest[:, 1]))
    spine_path = path_from_root(head_leaf)

    # ---- 3. head joint: the spine joint closest to the head blob centre
    rr, nv = end_blob(head_leaf, depth=4)
    hv = vsub(skel.subtree(head_leaf, ch) + skel.path_to_root(head_leaf)[:3])
    hv = hv if len(hv) > 8 else vsub([head_leaf])
    head_centre = verts[hv].mean(0) if len(hv) else rest[head_leaf]
    cand = [j for j in spine_path if j > 0] or [head_leaf]
    # only the upper part of the path can be "the head"
    tail_part = cand[max(0, len(cand) - 4):]
    head_joint = min(tail_part, key=lambda j: np.linalg.norm(rest[j] - head_centre))
    plan["head_leaf"], plan["head_joint"] = int(head_leaf), int(head_joint)

    # ---- 4. facing = root -> head, horizontal
    root_p = rest[0]
    hvec = rest[head_joint] - root_p
    horiz = np.array([hvec[0], 0.0, hvec[2]])
    vert = abs(hvec[1])
    upright = np.linalg.norm(horiz) < 0.55 * max(vert, 1e-6)
    flip = False
    if not upright:
        flip = horiz[2] < 0  # rotate 180 deg about Y so the head faces +Z
    else:
        # upright bodies: trust the +Z convention, but a head blob displaced backwards means flip
        off = head_centre[2] - rest[head_joint][2]
        flip = False
    if flip:
        rest = rotate_y(rest, np.pi)
        verts = rotate_y(verts, np.pi)
        yaw += np.pi
        lo, hi = verts.min(0), verts.max(0)
        cx = float((lo[0] + hi[0]) / 2)
        head_centre = rotate_y(head_centre, np.pi)
    plan["yaw_total"] = float(yaw)
    plan["upright"] = bool(upright)

    # ---- 5. lateral subtrees off the midline
    limbs = []   # dict(root, chain, kind, side, ...)
    tails, accessories = [], []
    spine_set = set(spine_path)

    def main_chain(rootj, anchor):
        """longest path (by length) from the anchor through rootj to a leaf of its subtree"""
        sub = skel.subtree(rootj, ch)
        best, bl = [anchor, rootj], -1
        for l in sub:
            if len(ch[l]) == 0:
                p = [anchor] + list(reversed(skel.path_to_root(l)[: skel.path_to_root(l).index(rootj) + 1]))
                L = _chain_len(rest, p)
                if L > bl:
                    best, bl = p, L
        return best

    for b in range(J):
        if not central[b]:
            continue
        for c in ch[b]:
            if central[c] and (c in spine_set or True):
                continue
            # lateral (or off-plane) child of a midline joint
            sub = skel.subtree(c, ch)
            chain = main_chain(c, b)
            L = _chain_len(rest, chain)
            v = vsub(sub)
            end = rest[chain[-1]]
            start = rest[b]
            drop = start[1] - end[1]
            vertical_frac = drop / max(L, 1e-9)
            leaf_y = min(rest[l, 1] for l in sub if len(ch[l]) == 0) - lo[1]
            side = 1 if (rest[c, 0] - cx) >= 0 or (rest[chain[-1], 0] - cx) >= 0 else -1
            if abs(rest[chain[-1], 0] - cx) > 0.02 * size:
                side = 1 if rest[chain[-1], 0] > cx else -1
            d = dict(root=int(c), anchor=int(b), chain=[int(x) for x in chain], length=float(L), side=int(side), leaf_y=float(leaf_y),
                     vertical_frac=float(vertical_frac), start_y=float(start[1] - lo[1]), nverts=int(len(v)), sub=[int(x) for x in sub],
                     lateral=float(abs(end[0] - cx)), fwd=float(end[2] - start[2]))
            if len(v) >= 12:
                pts = verts[v] - verts[v].mean(0)
                ev = np.sort(np.linalg.eigvalsh(np.cov(pts.T) + 1e-12 * np.eye(3)))[::-1]
                s = np.sqrt(np.maximum(ev, 1e-12))
                d["flat"] = float(s[2] / s[1]); d["width_ratio"] = float(s[1] / s[0])
            else:
                d["flat"], d["width_ratio"] = 1.0, 0.0
            limbs.append(d)

    # also: central side branches off the spine (tails, horns, crests)
    for b in spine_path:
        for c in ch[b]:
            if central[c] and c not in spine_set:
                sub = skel.subtree(c, ch)
                chain = [b] + [x for x in main_chain(c, b)[1:]]
                accessories.append(dict(root=int(c), anchor=int(b), chain=[int(x) for x in chain], length=_chain_len(rest, chain), sub=[int(x) for x in sub]))

    # the spine can continue past the head joint (jaw, crest): ignore. Classify the central branches: tails vs others
    for a in accessories:
        end = rest[a["chain"][-1]]
        a["fwd"] = float(end[2] - rest[a["anchor"]][2])
        a["horiz"] = float(np.hypot(end[0] - rest[a["anchor"]][0], end[2] - rest[a["anchor"]][2]))
        a["down"] = float(rest[a["anchor"]][1] - end[1])
    # tail: the longest central branch that does not go to the head, longer than 12 % of the body size
    cand_tails = [a for a in accessories if a["length"] > 0.12 * size and not (set(a["sub"]) & {head_joint}) and all(central[x] for x in a["sub"])]
    # the part of the spine *behind* the root also counts: if root is mid-body the 'other' direction is a spine chain
    cand_tails.sort(key=lambda a: -a["length"])
    tails = cand_tails[:2]
    tail_roots = {a["root"] for a in tails}
    accessories = [a for a in accessories if a["root"] not in tail_roots]

    # ---- 6. classify lateral limbs
    legs, arms, wings, small = [], [], [], []
    cont_thr = 0.2 * H
    for d in limbs:
        flat = d["flat"] < 0.35 and d["width_ratio"] > 0.28 and d["length"] > 0.18 * size
        contact = d["leaf_y"] <= cont_thr and (d["vertical_frac"] >= 0.45 or d["start_y"] <= 0.62 * H)   # sprawling legs (spiders, lizards) drop little but start low
        if d["length"] < 0.08 * size and d["nverts"] < 0.03 * len(verts):
            small.append(d); d["kind"] = "accessory"; continue
        if contact and d["start_y"] > d["leaf_y"] + 0.04 * H and not (d["flat"] < 0.2 and d["length"] > 0.35 * size and d["leaf_y"] > 0.08 * H):
            d["kind"] = "leg"; legs.append(d)
        elif flat and d["lateral"] > 0.12 * size:
            d["kind"] = "wing"; wings.append(d)
        elif d["start_y"] > 0.35 * H and d["length"] > 0.08 * size:
            d["kind"] = "arm"; arms.append(d)
        elif d["length"] > 0.12 * size and d["lateral"] > 0.1 * size and contact:
            d["kind"] = "leg"; legs.append(d)
        else:
            d["kind"] = "accessory"; small.append(d)

    # tails: wings made of two lateral halves have no central root; legs/arms keep chain order [anchor ... leaf]
    # rows: sort legs front -> back along +Z (after alignment)
    legs.sort(key=lambda d: -rest[d["chain"][1], 2])
    n_legs = len(legs)
    plan.update(n_legs=n_legs, n_arms=len(arms), n_wings=len(wings), n_tails=len(tails))

    # ---- 7. geometry numbers
    root_h = float(rest[0, 1] - lo[1])
    plan["dims"] = dict(size=size, height=H, width=float(ext[0]), length=float(ext[2]), root_height=root_h,
                        body_len=float(np.hypot(*(rest[head_joint][[0, 2]] - rest[0][[0, 2]]))))
    spine_len = _chain_len(rest, spine_path)
    # thickness of the trunk: sqrt of mean squared distance of spine-owned vertices to the spine polyline
    sv = vsub([j for j in spine_path if j != head_joint])
    thick = float(np.sqrt(((verts[sv][:, [0, 2]] - np.array([cx, cz])) ** 2).sum(1).mean())) if len(sv) > 20 else 0.1 * size
    plan["dims"]["trunk_thickness"] = thick
    plan["dims"]["spine_length"] = float(spine_len)

    # ---- 8. body plan
    h = hints
    n_w = len(wings)
    plan_name = None
    reason = []
    flies_hint = bool(h["fly"])
    if h["plant"] and n_legs == 0 and not h["fly"]:
        plan_name, _ = "plant", reason.append("prompt: plant, no legs")
    elif h["vehicle"] and n_legs <= 1:
        plan_name = "vehicle"; reason.append("prompt: vehicle")
    elif h["serpent"] and n_legs <= 1 and len(wings) == 0:
        plan_name = "serpent"; reason.append("prompt: serpent, no legs")
    elif n_w >= 1 and n_legs == 0 and flies_hint and not h["float"]:
        plan_name = "winged"; reason.append("wings, no legs")
    elif h["float"] and n_legs <= 2:
        plan_name = "floating"; reason.append("prompt: floating thing")
    elif n_w >= 1 and n_legs >= 1:
        plan_name = "winged"; reason.append("wings and legs")
    elif n_w >= 1:
        plan_name = "winged"; reason.append("wings")
    elif n_legs == 2:
        plan_name = "biped"; reason.append("2 legs")
    elif n_legs == 4:
        plan_name = "quadruped"; reason.append("4 legs")
    elif n_legs in (3, 5, 6, 7, 8) or n_legs > 8:
        plan_name = "multileg"; reason.append(f"{n_legs} legs")
    elif n_legs == 1:
        plan_name = "blob"; reason.append("1 leg: treated as a hopper")
    else:  # no legs at all
        slender = spine_len > 3.0 * max(thick, 1e-6) and (ext[0] > 0.5 * ext.max() or ext[2] > 0.5 * ext.max()) and ext[1] < 0.6 * ext.max()
        if slender:
            plan_name = "serpent"; reason.append("no limbs, long and low")
        elif h["blob"]:
            plan_name = "blob"; reason.append("prompt: blob")
        elif flies_hint:
            plan_name = "floating"; reason.append("prompt: flies/floats")
        elif upright and H > 1.6 * max(ext[0], ext[2]) and not len(arms):
            plan_name = "plant"; reason.append("tall, no limbs")
        elif len(arms) >= 2 and upright:
            plan_name = "biped"; reason.append("upright with arms, no legs: robed figure / ghost-like")
        else:
            plan_name = "blob"; reason.append("no limbs")
    plan["body_plan"] = plan_name
    plan["body_plan_reason"] = "; ".join(reason)
    plan["humanoid"] = bool(plan_name == "biped" and len(arms) >= 2 and upright)

    # ---- 9. facing flag + mouth
    fvec = np.array([0, 0, 1.0])
    snout = None
    if len(hv) > 8:
        pts = verts[hv]
        proj = (pts - rest[head_joint]) @ fvec
        k = np.argsort(-proj)[: max(5, len(pts) // 60)]
        snout = pts[k].mean(0)
    plan["mouth"] = None if snout is None else [float(x) for x in snout]
    plan["head_centre"] = [float(x) for x in head_centre]
    plan["head_radius"] = float(rr) if rr else 0.05 * size

    plan["spine"] = [int(x) for x in spine_path]
    plan["legs"] = legs
    plan["arms"] = arms
    plan["wings"] = wings
    plan["tails"] = tails
    plan["accessories"] = accessories + small
    plan["central"] = [int(j) for j in np.where(central)[0]]
    plan["cx"], plan["cz"], plan["lo"], plan["hi"] = cx, cz, [float(x) for x in lo], [float(x) for x in hi]
    plan["rest"] = rest        # aligned skeleton
    plan["verts"] = verts      # aligned vertices
    plan["yaw_final"] = float(yaw)
    return plan

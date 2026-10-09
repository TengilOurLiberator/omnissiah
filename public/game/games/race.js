// games/race.js - Time Trial: glowing gates that must be passed IN ORDER against the clock.
// MODE A (automatic): the AI-made roadster (scene object 'roadster') and racetrack (creations/racetrack.js) exist and the player is near the circuit -> 2 laps of the
//   circuit through 6 gates (gate 0 = the start gantry), a ghost of the best lap, progress counted from the car's chassis when the player drives, else from his head.
// MODE B: a foot race on a procedural ring (~140 m x g.k) of 8 gates round the player's spot against 3 NPC runners (rubber-banded a little, running in their own lanes).
// Gates are crossed by a plane test (travel direction, lateral window), so car speeds cannot tunnel through them. Wrong order does nothing.
export const meta = {
  name: 'race', title: 'Time Trial', aliases: ['racing', 'lap', 'time trial', 'foot race', 'checkpoint race', 'race'], icon: '🏁',
  description: 'checkpoint race against the clock: pass every gate in order (your car on the racetrack, otherwise a foot race against 3 runners)',
  hint: 'Run through every gate in order', distance: 0, size: 60, par: 600,
};

// Copied from creations/racetrack.js (READ ONLY dependency): the circuit's fixed control points and resolution. Its road ribbon is a Mesh with (N + 1) * 5 = 2105 vertices.
const CTRL = [[12, -45], [32, -44], [50, -30], [52, -5], [36, 10], [40, 32], [22, 50], [-5, 46], [-22, 34], [-46, 36], [-56, 14], [-44, -8], [-52, -30], [-34, -46], [-12, -46]];
const N = 420, ROAD_VERTS = (N + 1) * 5, ROAD_HALF = 4.5;
const SHIRTS = [0xe84a4a, 0x4a8ae8, 0xe8c84a], LANES = [-3.6, 3.2, 5.2], SPEEDS = [0.93, 1.0, 1.07];
const TAU = Math.PI * 2, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmtS = (s) => s.toFixed(1) + 's';

export default function (g) {
  const { THREE } = g, K = g.k, kit = g.world.kit, head = g.head, { Vector3 } = THREE;
  const _w = new Vector3(), _l = { x: 0, z: 0 };
  const MAT = [0x39b8ff, 0xffd23a, 0x45e07a].map((c) => g.track(new THREE.MeshBasicMaterial({ color: c, fog: false }))); // idle / next / done
  const beamMat = g.track(new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.3, depthWrite: false, fog: false }));
  const arrowMat = g.track(new THREE.MeshBasicMaterial({ color: 0xffd23a, fog: false }));
  const ghostMat = g.track(new THREE.MeshBasicMaterial({ color: 0x8affff, transparent: true, opacity: 0.28, depthWrite: false }));
  const beam = g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 8, 1, true), beamMat), g.root);
  const arrow = g.add(new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 8).rotateX(Math.PI), arrowMat), g.root);
  const ghost = g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat), g.root);
  for (const m of [beam, arrow, ghost]) m.userData.ownGeo = true;
  for (const m of [beam, arrow, ghost]) { m.userData.noShadow = m.userData.noOutline = m.userData.noCull = true; m.visible = false; }

  let C = null, level = 1, state = 'idle';
  let idx = 0, started = false, tStart = 0, lapT0 = 0, laps = 0, done = 0, hwMul = 1, runners = [], bestLap = Infinity, tick = 0, hudT = -9;
  let sPrev = 0, prevOk = false, lastSrc = 0, lastHx = 0, lastHz = 0, rigSpeed = 0, playerPhi = 0, prevRaw = 0, inCar = false, place = 1, lastTxt = '';
  const MAXS = 700, DT = 0.2, recBuf = new Float32Array(MAXS * 2), ghostBuf = new Float32Array(MAXS * 2); let recN = 0, ghostN = 0;

  // ---------------------------------------------------------------- course
  function findCar() { // the roadster + the circuit, detected at runtime (nothing of them is edited)
    const sc = g.ctx.scene; if (!sc || !sc.getObjectByName) return null;
    const car = sc.getObjectByName('roadster'); if (!car) return null;
    let road = null; sc.traverse((o) => { if (!road && o.isMesh && !o.isInstancedMesh && o.geometry && o.geometry.index && o.geometry.attributes.position && o.geometry.attributes.position.count === ROAD_VERTS) road = o; });
    if (!road) return null;
    let near = 1e9; for (const [x, z] of CTRL) near = Math.min(near, Math.hypot(head.x - x, head.z - z));
    return near < 75 ? car : null;
  }
  function gateMesh(geo, x, y, z, tx, tz, r, own) {
    const m = new THREE.Mesh(geo, MAT[0]); m.position.set(x, y + r + 0.05, z); m.rotation.y = Math.atan2(tx, tz);
    m.userData.noShadow = m.userData.noOutline = true; if (own) m.userData.ownGeo = true; return g.add(m, g.root);
  }
  function buildCourse(car) {
    if (C) { for (const gt of C.gates) gt.m.removeFromParent(); C.geo.dispose(); }
    const gates = [];
    if (car) {
      const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, z]) => new Vector3(x, 0, z)), true, 'centripetal'), pts = curve.getSpacedPoints(N), len = curve.getLength();
      const n = 6, r = ROAD_HALF + 0.2, geo = new THREE.TorusGeometry(r, 0.22, 8, 36);
      for (let i = 0; i < n; i++) {
        const k = Math.round(i / n * N), a = pts[(k - 1 + N) % N], b = pts[(k + 1) % N], d = Math.hypot(b.x - a.x, b.z - a.z) || 1, tx = (b.x - a.x) / d, tz = (b.z - a.z) / d, p = pts[k];
        const y = g.groundAt(p.x, p.z); gates.push({ x: p.x, y, z: p.z, tx, tz, r, hw: ROAD_HALF + 1.8, m: gateMesh(geo, p.x, y, p.z, tx, tz, r, i === 0) });
      }
      C = { mode: 'car', car, gates, geo, laps: 2, parT: len * 2 / 12, cap: len * 2 / 12 * 3 + 40, len, beamH: 30 };
      ghost.scale.set(1.7, 0.8, 3.6);
    } else {
      const R = 22.3 * K, n = 8, r = Math.max(1.2, 1.9 * K), geo = new THREE.TorusGeometry(r, 0.12, 8, 28);
      for (let i = 0; i < n; i++) {
        const f = i / n * TAU, a = g.at(R - R * Math.cos(f - 0.01), 0, -R * Math.sin(f - 0.01)), b = g.at(R - R * Math.cos(f + 0.01), 0, -R * Math.sin(f + 0.01)), p = g.at(R - R * Math.cos(f), 0, -R * Math.sin(f));
        const d = Math.hypot(b.x - a.x, b.z - a.z) || 1, tx = (b.x - a.x) / d, tz = (b.z - a.z) / d, y = g.groundAt(p.x, p.z);
        gates.push({ x: p.x, y, z: p.z, tx, tz, r, hw: r + 0.9, m: gateMesh(geo, p.x, y, p.z, tx, tz, r, i === 0) });
      }
      C = { mode: 'foot', car: null, gates, geo, laps: 1, parT: R * TAU / 5.2, cap: R * TAU / 5.2 * 3 + 20, len: R * TAU, R, beamH: 12 };
      ghost.scale.set(0.5, 1.7, 0.5);
    }
    bestLap = Infinity; ghostN = 0;
  }
  const setGate = (i, s) => { C.gates[i].m.material = MAT[s]; };
  function setTarget() { // beacon + arrow over the gate that is next
    const gt = C.gates[idx]; setGate(idx, 1);
    beam.scale.set(1, C.beamH, 1); beam.position.set(gt.x, gt.y + C.beamH / 2, gt.z); beam.visible = true; arrow.visible = true;
  }
  function resetColors() { for (let i = 0; i < C.gates.length; i++) setGate(i, 0); }
  const sdist = (gt, x, z) => (x - gt.x) * gt.tx + (z - gt.z) * gt.tz;

  // ---------------------------------------------------------------- foot runners
  const angOf = (lx, lz) => Math.atan2(-lz, C.R - lx); // 0 at the start, increasing along the loop
  function spawnRunners() {
    runners = [];
    if (C.mode !== 'foot' || !kit || !kit.humanoid || g.world.perf?.allow?.('actors', 3) === false) return;
    const st = C.gates[0];
    for (let i = 0; i < 3; i++) {
      const R = C.R + LANES[i]; g.at(C.R - R, 0, 0.7 * i + 0.4, _w);
      const a = kit.humanoid(g.ctx, { height: 1.7, shirt: SHIRTS[i], pants: 0x2a2a3a, x: _w.x, z: _w.z, yaw: Math.atan2(st.tx, st.tz), speed: 3, damageable: false, faction: 'neutral' });
      if (!a) continue; g.round(a); runners.push({ a, d: LANES[i], f: SPEEDS[i], phi: 0, raw: 0, t: 0, done: false });
    }
  }
  function stepRunners(dt) {
    const pS = playerPhi * C.R, base = 2.9 + 0.35 * level;
    for (const r of runners) {
      if (r.done || r.a.removed) continue;
      g.toLocal(r.a.position.x, r.a.position.z, _l);
      const raw = angOf(_l.x, _l.z); let d = raw - r.raw; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; r.raw = raw; r.phi += d;
      if (r.phi >= TAU - 0.04) { r.done = true; r.t = g.time - tStart; r.a.stop(); r.a.wave(3); r.a.say(place > 1 || playerPhi < TAU ? 'I won!' : 'Hee hee', 3); continue; }
      const R = C.R + r.d, f = r.phi + 3.2 / R;
      g.at(C.R - R * Math.cos(f), 0, -R * Math.sin(f), _w); // carrot ahead on its own lane: no stop-and-go at waypoints
      r.a.setSpeed(base * r.f * (1 + clamp((pS - r.phi * C.R) / 40, -0.12, 0.18))); r.a.walkTo(_w.x, _w.z);
    }
  }

  // ---------------------------------------------------------------- race flow
  function status(txt) { if (txt !== lastTxt) { lastTxt = txt; g.status(txt); } }
  function finishRace(dnf) {
    const T = g.time - tStart, sc = dnf ? done * 8 : Math.max(0, Math.round(600 * (2 - T / C.parT)));
    const rating = dnf ? 0.05 : clamp((1.8 - T / C.parT) / 0.9, 0, 1);
    place = 1; for (const r of runners) if (r.done) place++;
    const detail = C.mode === 'car' ? `${T.toFixed(1)}s lap ${bestLap < 1e8 ? bestLap.toFixed(1) : '-'}` : `${T.toFixed(1)}s P${place}`;
    g.note(dnf ? `The player did not finish the time trial: ${done} gates passed.` : `The player finished the ${C.mode} time trial in ${T.toFixed(1)} seconds${C.mode === 'foot' ? `, place ${place} of ${runners.length + 1}` : `, best lap ${bestLap.toFixed(1)} seconds`}.`, !dnf && rating > 0.8);
    g.end({ score: sc, rating, text: dnf ? 'DNF' : fmtS(T), detail });
  }
  function passGate(i) {
    const gt = C.gates[i]; setGate(i, 2); _w.set(gt.x, gt.y + gt.r, gt.z); done++;
    g.sfx('coin', _w); g.pulse('both', 0.5, 60); g.pop(_w, 14, 'spark');
    if (i === 0) {
      if (!started) { started = true; tStart = lapT0 = g.time; recN = 0; g.float(_w, 'GO!', 0x7fe3a0); g.sfx('go'); }
      else {
        const lt = g.time - lapT0; laps++;
        if (lt < bestLap) { bestLap = lt; ghostN = recN; ghostBuf.set(recBuf.subarray(0, recN * 2)); g.float(_w, `Lap ${fmtS(lt)}`, 0xffe27a); } else g.float(_w, `Lap ${fmtS(lt)}`, 0xeceeff);
        g.ctx.hud?.show?.(`Lap ${laps}: ${fmtS(lt)}`, 3);
        if (laps >= C.laps) { finishRace(false); return; }
        lapT0 = g.time; recN = 0; resetColors();
      }
      idx = 1;
    } else { g.float(_w, `${i}/${C.gates.length - 1}  ${fmtS(g.time - tStart)}`, 0x7fe3a0); idx = i + 1 >= C.gates.length ? 0 : i + 1; }
    setTarget(); prevOk = false;
  }
  function trackPoint() { // where the player counts: the chassis when he drives it, else his head
    const car = C.car;
    inCar = !!(car && car.parent && Math.hypot(head.x - car.position.x, head.z - car.position.z) < 4 && (g.world.player?.enabled === false || rigSpeed > 8));
    return inCar ? car.position : head;
  }
  function animate(dt, t) {
    if (!beam.visible) return;
    const gt = C.gates[idx]; arrow.position.set(gt.x, gt.y + gt.r * 2 + 1.1 + Math.sin(t * 4) * 0.25, gt.z); arrow.rotation.y += dt * 2;
  }

  return {
    reset(lv) {
      level = lv; state = 'idle'; hwMul = 1.15 - 0.06 * lv;
      const car = findCar(); if (!C || (C.mode === 'car') !== !!car || (car && C.car !== car)) buildCourse(car);
      ghost.visible = false; idx = 0; started = false; laps = 0; done = 0; recN = 0; lastTxt = ''; place = 1; prevOk = false; playerPhi = 0; prevRaw = 0;
      resetColors(); setTarget(); spawnRunners();
      g.status(C.mode === 'car' ? `Drive through the gates, ${C.laps} laps` : meta.hint);
    },
    play(lv) {
      level = lv; state = 'play'; tick = 0; done = 0; laps = 0; recN = 0;
      if (C.mode === 'foot') { started = true; tStart = lapT0 = 0; done = 1; setGate(0, 2); idx = 1; g.toLocal(head.x, head.z, _l); prevRaw = angOf(_l.x, _l.z); playerPhi = 0; for (const r of runners) { r.a.say('Hee hee', 2); r.a.setSpeed(3); } }
      else { started = false; idx = 0; }
      setTarget(); lastSrc = 0; prevOk = false; lastHx = head.x; lastHz = head.z;
      g.status(C.mode === 'car' ? 'Cross the start line' : 'Go!'); ghost.visible = false;
    },
    idle(dt, t) { animate(dt, t); },
    update(dt, t) {
      rigSpeed = Math.hypot(head.x - lastHx, head.z - lastHz) / Math.max(dt, 1e-3); lastHx = head.x; lastHz = head.z;
      const pp = trackPoint(), src = inCar ? 1 : 0, gt = C.gates[idx], s1 = sdist(gt, pp.x, pp.z);
      if (src !== lastSrc) { lastSrc = src; prevOk = false; }
      if (prevOk && sPrev < 0 && s1 >= 0 && s1 - sPrev < 9) {
        const l = Math.abs(-(pp.x - gt.x) * gt.tz + (pp.z - gt.z) * gt.tx);
        if (l < gt.hw * hwMul) { passGate(idx0(gt)); if (state !== 'play' || !C) return; }
      }
      const g2 = C.gates[idx]; sPrev = g2 === gt ? s1 : sdist(g2, pp.x, pp.z); prevOk = true;
      // foot: player angle, runners, place
      if (C.mode === 'foot') {
        g.toLocal(head.x, head.z, _l); const raw = angOf(_l.x, _l.z); let d = raw - prevRaw; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; prevRaw = raw; playerPhi += d;
        stepRunners(dt); place = 1; for (const r of runners) if (r.done || r.phi > playerPhi) place++;
      }
      // ghost of the best lap + recording of this lap
      if (started) {
        const lt = g.time - lapT0, u = lt / DT;
        if (recN < MAXS && u >= recN) { recBuf[recN * 2] = pp.x; recBuf[recN * 2 + 1] = pp.z; recN++; }
        const i = Math.floor(u);
        if (ghostN > 1 && i + 1 < ghostN) {
          const f = u - i, ax = ghostBuf[i * 2], az = ghostBuf[i * 2 + 1], bx = ghostBuf[i * 2 + 2], bz = ghostBuf[i * 2 + 3], x = ax + (bx - ax) * f, z = az + (bz - az) * f;
          ghost.position.set(x, g.groundAt(x, z) + ghost.scale.y / 2 + 0.1, z); if ((bx - ax) * (bx - ax) + (bz - az) * (bz - az) > 1e-4) ghost.rotation.y = Math.atan2(bx - ax, bz - az); ghost.visible = true;
        } else ghost.visible = false;
        if (g.time - tStart > C.cap) { finishRace(true); return; }
      }
      animate(dt, t);
      // board text a few times a second
      if ((tick += dt) > 0.25) {
        tick = 0; const nG = C.gates.length, inLap = idx === 0 ? nG : idx;
        g.headline(started ? `${inLap}/${nG}${C.laps > 1 ? ` L${Math.min(laps + 1, C.laps)}` : ''}` : 'START');
        status(started ? `${fmtS(g.time - tStart)}${C.mode === 'foot' ? `  P${place}/${runners.length + 1}` : ''}` : 'Cross the start line');
      }
    },
    stop() { state = 'idle'; ghost.visible = false; },
    info: { get C() { return C; }, get idx() { return idx; }, get started() { return started; }, get laps() { return laps; }, get done() { return done; }, get runners() { return runners; }, get inCar() { return inCar; }, get playerPhi() { return playerPhi; }, get bestLap() { return bestLap; }, get ghostN() { return ghostN; }, get ghost() { return ghost; }, get beam() { return beam; }, get place() { return place; } },
  };
  function idx0(gt) { return C.gates.indexOf(gt); }
}

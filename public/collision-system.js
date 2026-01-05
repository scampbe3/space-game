/* collision-system.js */
import * as THREE from './libs/build/three.module.js';

export function createCollisionSystem({
  asteroidGroup,
  laserSystem,          // module with getActive()
  enemyShips,            // array of visible enemy meshes   ← NEW
  enemyLasers,           // array of visible enemy lasers  ← NEW
  bossMesh,
  damageBoss,
  playerMesh,
  playerRadius,
  stationMesh,        // ← NEW
  damageStation,      // ← NEW
  asteroidPassage = null,   // optional { getMesh(), collider }
  staticHazards = [],       // optional array of additional colliders {mesh, collider}
  hazardPlayerCollisionEnabled = true,  // toggle player vs set-piece hazards
  hazardLaserCollisionEnabled  = true,  // toggle lasers vs set-piece hazards
  hazardEnemyCollisionEnabled  = true,  // toggle enemy vs set-piece hazards
  asteroidHazardCollisionEnabled = false, // toggle asteroids vs set-piece hazards
  onLaserHit  = () => {},
  onPlayerHit = () => {},
  onEnemyDestroyed = () => {},          // NEW; called with position vector
  onEnemyNeutralized = () => {},        // NEW; non-scoring deaths (hazards)
  onAsteroidDestroyed = () => {},       // called with asteroid world position
  onShotHit = () => {},                 // player shot hit a damageable target
  isRolling       = () => false,
  androssBeams    = () => []

}) {
  const tmp = new THREE.Vector3();    // shared scratch
  const tmpShip = new THREE.Vector3();
  const tmpRock = new THREE.Vector3();
  const segDir = new THREE.Vector3();
  const segMin = new THREE.Vector3();
  const segMax = new THREE.Vector3();
  const segBox = new THREE.Box3();
  const segTmpA = new THREE.Vector3();
  const segTmpB = new THREE.Vector3();
  const BOSS_R2 = 100;      // 10²  (≈ bounding-sphere²)
  const Z_GATE  = 120;      // quick reject on z-axis
  const ASTEROID_Z_PAD = 120; // coarse reject for asteroid checks
  const tmpHandLocal = new THREE.Vector3();
  const tmpHandClosest = new THREE.Vector3();
  const handHitCooldowns = new WeakMap();
  const beamBoxWorld = new THREE.Box3();
  const beamClosest = new THREE.Vector3();
  const beamSegA = new THREE.Vector3();
  const beamSegB = new THREE.Vector3();
  const tmpSphere = new THREE.Sphere();
  const tmpCenter = new THREE.Vector3();
  const tmpSize = new THREE.Vector3();
  const tmpLocal = new THREE.Vector3();
  const tmpLocalPrev = new THREE.Vector3();
  const tmpLocalCurr = new THREE.Vector3();
  const tmpHit = new THREE.Vector3();
  const BEAM_HIT_COOLDOWN = 0.5;
  let beamHitTimer = 0;


/* ── cached station collision geometry (if a station exists) ── */
  const stationCollider = stationMesh?.userData?.collider ?? null;

  /* collect static hazards (tunnels, flats, etc.) */
  const hazards = [];
  function addHazard(entry) {
    if (!entry) return;
    const mesh = entry.getMesh ? entry.getMesh() : entry.mesh ?? null;
    const collider = entry.collider ?? mesh?.userData?.collider ?? null;
    if (!mesh || !collider) return;
    hazards.push({
      mesh,
      collider,
      laserCollisionEnabled: mesh.userData?.laserCollisionEnabled !== false,
      gateCylinder: mesh.userData?.gateCylinder ?? null,
      playerState: { insideTimer: 0, colliding: false },
      enemyState : new WeakMap()
    });
  }
  addHazard(asteroidPassage);
  (staticHazards ?? []).forEach(addHazard);

  let stationInsideTimer = 0;
  let stationColliding = false;

  function killRock(rock) {
    if (!rock || rock.userData.dead) return;
    rock.visible = false;
    rock.userData.dead = true;
    const pos = rock.getWorldPosition ? rock.getWorldPosition(tmpRock) : rock.position;
    onAsteroidDestroyed(pos);
  }

  function awardEnemyKill(ship, { awardScore = true } = {}) {
    if (!ship) return;
    const shouldScore = awardScore && !ship.userData?.noScore;
    (shouldScore ? onEnemyDestroyed : onEnemyNeutralized)(ship.position, ship);
  }

  function damageEnemyShip(ship, { awardScore = true } = {}) {
    if (!ship?.visible || !ship.userData) return false;

    /* boss parts handle their own HP bookkeeping */
    if (ship.userData.androssPart && ship.userData.damageFn) {
      const owner = ship.userData.androssOwner ?? ship;
      const died = ship.userData.damageFn(1);
      if (died) awardEnemyKill(owner, { awardScore });
      return died;
    }

    const hp = ship.userData.hp ?? 1;
    if (hp > 1) {
      ship.userData.hp = hp - 1;
      ship.userData.blink?.();
      return false;
    }

    ship.userData.blink?.();
    ship.visible = false;
    ship.userData.dead = true;
    ship.userData.lockRing && (ship.userData.lockRing.visible = false);
    awardEnemyKill(ship, { awardScore });
    return true;
  }

  /* scratch vectors */
  function segmentHitsCollider(collider, mesh, prev, curr) {
    if (!collider || !mesh?.visible) return false;
    if (collider.worldAABB) {
      // quick reject: if segment AABB doesn't touch collider bounds, skip
      segMin.set(Math.min(prev.x, curr.x), Math.min(prev.y, curr.y), Math.min(prev.z, curr.z));
      segMax.set(Math.max(prev.x, curr.x), Math.max(prev.y, curr.y), Math.max(prev.z, curr.z));
      segBox.min.copy(segMin);
      segBox.max.copy(segMax);
      if (!segBox.intersectsBox(collider.worldAABB)) return false;
    }
    const aabb = collider.worldAABB;
    if (aabb) {
      segMin.set(Math.min(prev.x, curr.x), Math.min(prev.y, curr.y), Math.min(prev.z, curr.z));
      segMax.set(Math.max(prev.x, curr.x), Math.max(prev.y, curr.y), Math.max(prev.z, curr.z));
      segBox.min.copy(segMin);
      segBox.max.copy(segMax);
      if (!segBox.intersectsBox(aabb)) return false; // coarse reject
    }
    segDir.copy(curr).sub(prev);
    const dist = segDir.length();
    if (dist < 1e-5) return false;
    segDir.multiplyScalar(1 / dist);
    const hit = collider.linecast(prev, segDir, dist);
    if (hit.hit) {
      curr.copy(hit.point);
      return true;
    }
    return false;
  }

  function segmentIntersectsBox(a, b, box) {
    let tmin = 0;
    let tmax = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    if (Math.abs(dx) < 1e-8) {
      if (a.x < box.min.x || a.x > box.max.x) return false;
    } else {
      const inv = 1 / dx;
      let t1 = (box.min.x - a.x) * inv;
      let t2 = (box.max.x - a.x) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
    if (Math.abs(dy) < 1e-8) {
      if (a.y < box.min.y || a.y > box.max.y) return false;
    } else {
      const inv = 1 / dy;
      let t1 = (box.min.y - a.y) * inv;
      let t2 = (box.max.y - a.y) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
    if (Math.abs(dz) < 1e-8) {
      if (a.z < box.min.z || a.z > box.max.z) return false;
    } else {
      const inv = 1 / dz;
      let t1 = (box.min.z - a.z) * inv;
      let t2 = (box.max.z - a.z) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
    return true;
  }

  function segmentHitsHazard(prev, curr, onHit) {
    for (const h of hazards) {
      if (!h.mesh?.visible) continue;
      if (h.laserCollisionEnabled === false) continue;
      // coarse Z gate to avoid hitting heavy mesh colliders unless near
      if (h.gateZ !== undefined && h.gateHalfZ !== undefined) {
        const prevZ = prev.z, currZ = curr.z;
        const zGate = h.gateHalfZ + 80; // padded gate
        if (Math.abs(prevZ - h.gateZ) > zGate && Math.abs(currZ - h.gateZ) > zGate) {
          continue;
        }
      }
      if (h.gateCylinder) {
        const gate = h.gateCylinder;
        const segMinY = Math.min(prev.y, curr.y);
        const segMaxY = Math.max(prev.y, curr.y);
        if (segMaxY < gate.minY || segMinY > gate.maxY) {
          continue;
        }
        const distSq = segmentDistSq2D(gate.x, gate.z, prev, curr);
        if (distSq > gate.radius * gate.radius) {
          continue;
        }
      }
      if (segmentHitsCollider(h.collider, h.mesh, prev, curr)) {
        onHit && onHit(h);
        return true;
      }
    }
    return false;
  }

  function damageHazard(hazard, damage = 1) {
    const mesh = hazard?.mesh;
    const destructible = mesh?.userData?.destructible;
    if (!mesh?.visible || !destructible) return false;
    const currentHp = Number.isFinite(destructible.hp) ? destructible.hp : 0;
    const nextHp = currentHp - damage;
    destructible.hp = nextHp;
    if (nextHp > 0) return false;
    mesh.visible = false;
    mesh.userData.dead = true;
    mesh.userData.laserCollisionEnabled = false;
    if (typeof mesh.userData.onDestroyed === 'function') {
      const pos = mesh.getWorldPosition ? mesh.getWorldPosition(tmpHit) : mesh.position;
      mesh.userData.onDestroyed(pos, mesh);
    }
    return true;
  }

  function segmentDistSq2D(cx, cz, a, b) {
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const acx = cx - a.x;
    const acz = cz - a.z;
    const abLenSq = abx * abx + abz * abz;
    let t = 0;
    if (abLenSq > 1e-8) t = (acx * abx + acz * abz) / abLenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = a.x + abx * t - cx;
    const dz = a.z + abz * t - cz;
    return dx * dx + dz * dz;
  }

  function update(dt = 0) {
    if (beamHitTimer > 0 && dt > 0) {
      beamHitTimer = Math.max(0, beamHitTimer - dt);
    }

    /* -------- lasers × static hazards (tunnels, flats) ------- */
    if (hazardLaserCollisionEnabled && hazards.length) {
      const playerBolts = laserSystem.getActive();
      for (let i = 0; i < playerBolts.length; i++) {
        const bolt = playerBolts[i];
        if (!bolt.visible) continue;
        const prev = bolt.userData.prev ?? bolt.position;
        if (segmentHitsHazard(prev, bolt.position, (hazard) => {
          const dmg = bolt.userData?.damage ?? 1;
          damageHazard(hazard, dmg);
        })) bolt.visible = false;
      }
      const enemyBoltArr = enemyLasers();
      for (let i = 0; i < enemyBoltArr.length; i++) {
        const bolt = enemyBoltArr[i];
        if (!bolt?.position) continue;
        const prev = bolt.prev ?? bolt.position;
        if (segmentHitsHazard(prev, bolt.position)) {
          if (bolt.userData) bolt.userData.life = 0;
        }
      }
    }

    /* ------------- player laser × boss -------------- */
    if (bossMesh.visible){
      const playerBolts = laserSystem.getActive();
      for (let i = 0; i < playerBolts.length; i++) {
        const b = playerBolts[i];
        if(!b.visible) continue;
        if(Math.abs(b.position.z-bossMesh.position.z)>Z_GATE) continue;
        if(bossMesh.position.distanceToSquared(b.position)<BOSS_R2){
          const dmg = b.userData?.damage ?? 1;
          if (b.userData?.shotId) onShotHit(b.userData.shotId);
          b.visible=false;
          damageBoss(dmg);
        }
      }
      /* reflected enemy / boss bolts hurt boss too */
      const enemyBoltArr = enemyLasers();
      for (let i = 0; i < enemyBoltArr.length; i++) {
        const b = enemyBoltArr[i];
        if(!b.visible||!b.userData.bounced) continue;
        if(Math.abs(b.position.z-bossMesh.position.z)>Z_GATE) continue;
        if(bossMesh.position.distanceToSquared(b.position)<BOSS_R2){
          b.visible=false;
          damageBoss(1);
        }
      }
    }

    /* laser vs asteroid */
    laserSystem.getActive().forEach(laser => {
      asteroidGroup.children.forEach(rock => {
        if (!rock.visible) return;
        const r = rock.scale.x;          // bounding-sphere
        if (laser.position.distanceToSquared(rock.position) < r*r) {
          killRock(rock);
          laser.visible = false;
          if (laser.userData?.shotId) onShotHit(laser.userData.shotId);
          onLaserHit();
        }
      });
    });

  /* ---------- enemy laser × asteroid (no score) ---------- */
    enemyLasers().forEach(bolt=>{
      if (!bolt?.position) return;
      const playerPosZ = playerMesh.getWorldPosition(tmp).z;
      if (Math.abs(bolt.position.z - playerPosZ) > ASTEROID_Z_PAD) return;
      asteroidGroup.children.forEach(rock=>{
        if (!rock.visible || rock.userData.dead) return;
        if (Math.abs(rock.position.z - bolt.position.z) > ASTEROID_Z_PAD) return;
        const r = rock.scale.x;
        if (bolt.position.distanceToSquared(rock.position) < r*r){
          killRock(rock);
          bolt.userData && (bolt.userData.life = 0);
        }
      });
    });

    /* ---------- enemy ship × asteroid (both vanish) ---------- */
    enemyShips().forEach(ship=>{
      asteroidGroup.children.forEach(rock=>{
        if (!rock.visible || rock.userData.dead || !ship.visible) return;
        const r = rock.scale.x * 1.2;
        if (ship.position.distanceToSquared(rock.position) < r*r){
      ship.userData.collided = true;
      ship.userData.finishPath?.('collision');
      /* NEW: spiders take 1 HP, others still explode outright */
      if (ship.userData.hp > 1) {            // → multi‑hit spider
        ship.userData.hp--;                  //   −1 HP
        ship.userData.blink();               //   0.15 s red flash

        /* asteroid is still destroyed */
        killRock(rock);

        /* if that was the last HP, clean up just like a laser kill */
        if (ship.userData.hp === 0) ship.visible = false;

     } else {                               // → one‑hit fighters
        ship.userData.blink();
        killRock(rock);
        ship.visible = false;
      }
        }
      });
    });

/* ---------- enemy laser × player ---------- */
const shipPos = playerMesh.getWorldPosition(tmp);

enemyLasers().forEach(bolt => {
  if (!bolt?.position) return;
  const bounced = bolt.userData?.bounced ?? false;
  if (bounced) return;

  const hit =
    shipPos.distanceToSquared(bolt.position) <
    (playerRadius + 0.5) ** 2;
  if (!hit) return;

  /* while rolling → reflect and ignore damage */
  if (isRolling()) {
    if (bolt.userData){
      bolt.userData.bounced = true;   // mark so we’ll ignore it next frames
      bolt.userData.dir *= -1;        // reverse direction
    }
    return;                         // <-- no heart loss
  }

  /* not rolling → normal damage */
  if (bolt.userData) bolt.userData.life = 0;
  onPlayerHit(bolt.position);
});

    /* ---------- boss beams × player ---------- */
    const beams = androssBeams ? androssBeams() : [];
    if (beams && beams.length) {
      for (const beam of beams) {
        if (!beam?.visible || !beam.geometry) continue;
        beam.updateMatrixWorld(true);
        if (!beam.geometry.boundingBox) beam.geometry.computeBoundingBox?.();
        const bbox = beam.geometry.boundingBox;
        if (!bbox) continue;
        // treat beam as a segment from bbox.min.z to bbox.max.z in local space
        beamSegA.set(0, 0, bbox.min.z).applyMatrix4(beam.matrixWorld);
        beamSegB.set(0, 0, bbox.max.z).applyMatrix4(beam.matrixWorld);
        const beamWidth = (bbox.max.x - bbox.min.x) * (beam.scale?.x ?? 1);
        const radius = (beamWidth * 0.5) + 0.1; // small margin
        const distSq = pointSegmentDistSq(shipPos, beamSegA, beamSegB, beamClosest);
        const hit = distSq <= radius * radius;
        if (hit && beamHitTimer <= 0) {
          tmpHit.copy(shipPos).sub(beamClosest);
          if (tmpHit.lengthSq() > 1e-6) {
            tmpHit.normalize().multiplyScalar(playerRadius).add(shipPos);
          } else {
            tmpHit.copy(shipPos);
          }
          onPlayerHit(tmpHit);
          beamHitTimer = BEAM_HIT_COOLDOWN;
          break; // apply cooldown before checking other beams this frame
        }
      }
    }




    /* ---------- player laser × enemy ship ---------- */
    laserSystem.getActive().forEach(bolt=>{
      enemyShips().forEach(ship=>{
        if (!bolt.visible) return;
        if (!ship.visible) return;
        const hitR = ship.userData.hitRadius ?? 3;
        const shipWorld = ship.getWorldPosition ? ship.getWorldPosition(tmpShip) : ship.position;
        const hitBoxes = ship.userData?.hitBoxes;
        const prev = bolt.userData?.prev ?? bolt.position;
        let hit = false;

        if (hitBoxes && hitBoxes.length) {
          tmpLocalPrev.copy(prev);
          tmpLocalCurr.copy(bolt.position);
          ship.worldToLocal(tmpLocalPrev);
          ship.worldToLocal(tmpLocalCurr);
          for (let i = 0; i < hitBoxes.length; i++) {
            if (segmentIntersectsBox(tmpLocalPrev, tmpLocalCurr, hitBoxes[i])) { hit = true; break; }
          }
          if (!hit) return;
        } else {
          hit = bolt.position.distanceToSquared(shipWorld) < hitR * hitR;
          if (!hit) return;
        }

        const dmg = bolt.userData?.damage ?? 1;
        /* special handling for multi-HP (spiders) and bosses */
        if (ship.userData.androssPart && ship.userData.damageFn) {
          const owner = ship.userData.androssOwner ?? ship;
          const died = ship.userData.damageFn(dmg);
          bolt.visible = false;
          if (bolt.userData?.shotId) onShotHit(bolt.userData.shotId);
          if (died) awardEnemyKill(owner);
          return;
        }

        /* spiders take 5 hits, others die in 1 */
        const hp = ship.userData.hp ?? 1;
        if (hp > dmg) {
          ship.userData.hp = hp - dmg;
          ship.userData.blink();           // red flash
          bolt.visible = false;          // consume the laser
          if (bolt.userData?.shotId) onShotHit(bolt.userData.shotId);
        } else {
          ship.userData.blink();
          bolt.visible = ship.visible = false;  // destroy fighter
          ship.userData.dead = true;
          if (bolt.userData?.shotId) onShotHit(bolt.userData.shotId);
          awardEnemyKill(ship);      // +100 pts + explosion
        }
      });
    });

    /* ---------- reflected enemy laser × enemy ship (incl. Andross parts) ---------- */
    enemyLasers().forEach(bolt=>{
      if (!bolt?.position) return;
      if (!bolt.userData?.bounced) return;
      enemyShips().forEach(ship=>{
        if (bolt.userData?.life <= 0 || bolt.visible === false) return;
        if (!ship.visible || !ship.userData?.hp || !ship.userData?.blink) return;
        const hitR = ship.userData.hitRadius ?? 3;
        const shipWorld = ship.getWorldPosition ? ship.getWorldPosition(tmpShip) : ship.position;
        const hitBoxes = ship.userData?.hitBoxes;
        const prev = bolt.prev ?? bolt.position;
        let hit = false;
        if (hitBoxes && hitBoxes.length) {
          tmpLocalPrev.copy(prev);
          tmpLocalCurr.copy(bolt.position);
          ship.worldToLocal(tmpLocalPrev);
          ship.worldToLocal(tmpLocalCurr);
          hit = hitBoxes.some(box => segmentIntersectsBox(tmpLocalPrev, tmpLocalCurr, box));
        } else {
          hit = bolt.position.distanceToSquared(shipWorld) < hitR * hitR;
        }
        if (hit) {
          if (ship.userData.androssPart && ship.userData.damageFn) {
            const owner = ship.userData.androssOwner ?? ship;
            const died = ship.userData.damageFn(1);
            bolt.userData && (bolt.userData.life = 0);
            if (died) awardEnemyKill(owner);
            return;
          }
          /* reflected bolts should damage just like player lasers */
          if (ship.userData.hp > 1) {
            ship.userData.hp--;
            ship.userData.blink();          // red flash
            if (bolt.userData) bolt.userData.life = 0;             // consume the bolt
          } else {
            ship.userData.blink();            // ← keep
            if (bolt.userData) bolt.userData.life = 0;
            ship.visible       = false;
            ship.userData.dead = true;
            awardEnemyKill(ship);               // +100 pts
          }
        }
      });
    });

    /* player vs asteroid */
    const playerPosZ = playerMesh.getWorldPosition(tmp).z;
    asteroidGroup.children.forEach(rock => {
      if (!rock.visible) return;
      if (Math.abs(rock.position.z - playerPosZ) > ASTEROID_Z_PAD) return;
      const r = rock.scale.x * 1.2;
      const shipPos = playerMesh.getWorldPosition(tmp);
      if (shipPos.distanceToSquared(rock.position) <
          (playerRadius + r) * (playerRadius + r)) {
        killRock(rock);
        tmpHit.copy(shipPos).sub(rock.position);
        if (tmpHit.lengthSq() > 1e-6) {
          tmpHit.normalize().multiplyScalar(playerRadius).add(shipPos);
        } else {
          tmpHit.copy(shipPos);
        }
        onPlayerHit(tmpHit);
      }
    });

    /* player vs static hazards (solid shell + interior) */
    if (hazardPlayerCollisionEnabled && dt > 0 && hazards.length) {
      const shipPos = playerMesh.getWorldPosition(tmpShip);
      hazards.forEach(h => {
        const state = h.playerState;
        if (!h.collider || !h.mesh?.visible) {
          state.insideTimer = 0;
          state.colliding = false;
          return;
        }
        if (h.gateZ !== undefined && h.gateHalfZ !== undefined) {
          const zGate = h.gateHalfZ + 80;
          if (Math.abs(shipPos.z - h.gateZ) > zGate) {
            state.insideTimer = 0;
            state.colliding = false;
            return;
          }
        }
        if (h.collider.worldAABB &&
            !h.collider.worldAABB.intersectsSphere(tmpSphere.set(shipPos, playerRadius))) {
          state.insideTimer = 0;
          state.colliding = false;
          return;
        }
        const hit = h.collider.testSphere(shipPos, playerRadius);
        const skipInside = Boolean(h.mesh?.userData?.skipInsideCheck);
        const inside = hit.hit || (!skipInside && h.collider.isPointInside(shipPos));
        const hitPoint = hit.hit ? hit.point : shipPos;
        if (inside) {
          if (!state.colliding) {
            tmpHit.copy(shipPos).sub(hitPoint);
            if (tmpHit.lengthSq() > 1e-6) {
              tmpHit.normalize().multiplyScalar(playerRadius).add(shipPos);
            } else {
              tmpHit.copy(shipPos);
            }
            onPlayerHit(tmpHit);
            state.insideTimer = 0;
          }
          state.colliding = true;
          state.insideTimer += dt;
          while (state.insideTimer >= 1) {
            tmpHit.copy(shipPos).sub(hitPoint);
            if (tmpHit.lengthSq() > 1e-6) {
              tmpHit.normalize().multiplyScalar(playerRadius).add(shipPos);
            } else {
              tmpHit.copy(shipPos);
            }
            onPlayerHit(tmpHit);
            state.insideTimer -= 1;
          }
        } else {
          state.insideTimer = 0;
          state.colliding = false;
        }
      });
    } else if (hazardPlayerCollisionEnabled && hazards.length) {
      hazards.forEach(h => {
        h.playerState.insideTimer = 0;
        h.playerState.colliding = false;
      });
    }

    /* enemy vs static hazards (same rules, no points) */
    if (hazardEnemyCollisionEnabled && dt > 0 && hazards.length) {
      const enemies = enemyShips();
      if (enemies && enemies.length) {
        hazards.forEach(h => {
          if (!h.collider || !h.mesh?.visible) {
            h.enemyState = new WeakMap();
            return;
          }
          const zGate = h.gateHalfZ !== undefined ? h.gateHalfZ + 80 : null;
          const stateMap = h.enemyState;
          enemies.forEach(ship => {
            if (!ship?.visible || ship.userData?.dead) return;
            if (zGate !== null && Math.abs(ship.position.z - h.gateZ) > zGate) {
              const state = stateMap.get(ship);
              if (state) {
                state.insideTimer = 0;
                state.colliding = false;
              }
              return;
            }
            const hitR = ship.userData?.hitRadius ?? 3;
            const shipPos = ship.getWorldPosition ? ship.getWorldPosition(tmpShip) : ship.position;
            if (h.collider.worldAABB &&
                !h.collider.worldAABB.intersectsSphere(tmpSphere.set(shipPos, hitR))) {
              const state = stateMap.get(ship);
              if (state) {
                state.insideTimer = 0;
                state.colliding = false;
              }
              return;
            }
            const state = stateMap.get(ship) ?? { insideTimer: 0, colliding: false };
            const hit = h.collider.testSphere(shipPos, hitR);
            const skipInside = Boolean(h.mesh?.userData?.skipInsideCheck);
            const inside = hit.hit || (!skipInside && h.collider.isPointInside(shipPos));
            if (inside) {
              ship.userData.collided = true;
              ship.userData.finishPath?.('collision');
              if (!state.colliding) {
                if (damageEnemyShip(ship, { awardScore: false })) {
                  stateMap.delete(ship);
                  return;
                }
                state.insideTimer = 0;
              }
              state.colliding = true;
              state.insideTimer += dt;
              while (state.insideTimer >= 1 && ship.visible && !ship.userData?.dead) {
                damageEnemyShip(ship, { awardScore: false });
                if (!ship.visible || ship.userData?.dead) break;
                state.insideTimer -= 1;
              }
            } else {
              state.insideTimer = 0;
              state.colliding = false;
            }

            if (!ship.visible || ship.userData?.dead) {
              stateMap.delete(ship);
            } else {
              stateMap.set(ship, state);
            }
          });
        });
      } else {
        hazards.forEach(h => { h.enemyState = new WeakMap(); });
      }
    } else if (hazardEnemyCollisionEnabled && hazards.length) {
      hazards.forEach(h => { h.enemyState = new WeakMap(); });
    }

    /* asteroids vs static hazards */
    if (asteroidHazardCollisionEnabled && hazards.length) {
      asteroidGroup.children.forEach(rock => {
        if (!rock.visible || rock.userData.dead) return;
        const r = rock.scale.x;
        for (const h of hazards) {
          if (!h.collider || !h.mesh?.visible) continue;
          if (h.collider.worldAABB) {
            h.collider.worldAABB.getCenter(tmpCenter);
            h.collider.worldAABB.getSize(tmpSize);
            const halfZ = tmpSize.z * 0.5;
            if (Math.abs(rock.position.z - tmpCenter.z) > halfZ + 150) continue;
          }
          if (h.collider.worldAABB &&
              !h.collider.worldAABB.intersectsSphere(tmpSphere.set(rock.position, r))) {
            continue;
          }
          const hit = h.collider.testSphere(rock.position, r);
          const skipInside = Boolean(h.mesh?.userData?.skipInsideCheck);
          const inside = hit.hit || (!skipInside && h.collider.isPointInside(rock.position));
          if (inside) {
            killRock(rock);
            break;
          }
        }
      });
    }

    /* player vs station boss (solid mesh) */
    if (stationCollider && stationMesh?.visible && dt > 0) {
      const shipPos = playerMesh.getWorldPosition(tmpShip);
      if (stationCollider.worldAABB?.containsPoint(shipPos)) {
        const hit = stationCollider.testSphere(shipPos, playerRadius);
        const inside = hit.hit || stationCollider.isPointInside(shipPos);
        const hitPoint = hit.hit ? hit.point : shipPos;
        if (inside) {
          if (!stationColliding) {
            tmpHit.copy(shipPos).sub(hitPoint);
            if (tmpHit.lengthSq() > 1e-6) {
              tmpHit.normalize().multiplyScalar(playerRadius).add(shipPos);
            } else {
              tmpHit.copy(shipPos);
            }
            onPlayerHit(tmpHit);
            stationInsideTimer = 0;
          }
          stationColliding = true;
          stationInsideTimer += dt;
          while (stationInsideTimer >= 1) {
            tmpHit.copy(shipPos).sub(hitPoint);
            if (tmpHit.lengthSq() > 1e-6) {
              tmpHit.normalize().multiplyScalar(playerRadius).add(shipPos);
            } else {
              tmpHit.copy(shipPos);
            }
            onPlayerHit(tmpHit);
            stationInsideTimer -= 1;
          }
        } else {
          stationInsideTimer = 0;
          stationColliding = false;
        }
      } else {
        stationInsideTimer = 0;
        stationColliding = false;
      }
    } else {
      stationInsideTimer = 0;
      stationColliding = false;
    }

    /* ---------- enemy laser × enemy ship ---------- */
    enemyLasers().forEach(bolt=>{
  if (!bolt?.position) return;
  if (!bolt.userData?.bounced) return;
  enemyShips().forEach(ship=>{
  if (!ship.visible || !ship.userData?.hp || !ship.userData?.blink) return;
    const hitR = ship.userData.hitRadius ?? 3;
    const shipWorld = ship.getWorldPosition ? ship.getWorldPosition(tmpShip) : ship.position;
    const hit = bolt.position.distanceToSquared(shipWorld) < hitR*hitR;
if (hit) {

  /* reflected bolts should damage just like player lasers */
  if (ship.userData.hp > 1) {
    ship.userData.hp--;
ship.userData.blink();          // red flash
    if (bolt.userData) bolt.userData.life = 0;             // consume the bolt
  } else {
      ship.userData.blink();            // ← keep
    if (bolt.userData) bolt.userData.life = 0;
    ship.visible       = false;
    ship.userData.dead = true;
    awardEnemyKill(ship);               // +100 pts
  }
}
  });
});


    /* ---------- player × enemy ship (includes Andross hands) ---------- */
    enemyShips().forEach(ship=>{
      if (!ship.visible) {
        handHitCooldowns.delete(ship);
        return;
      }
      const androssPart = ship.userData?.androssPart;
      if (androssPart === 'eyes' || androssPart === 'palmL' || androssPart === 'palmR') {
        return;
      }
      const shipPos = playerMesh.getWorldPosition(tmp);
      const handCol = ship.userData?.handCollider;
      const isHand = ship.userData?.androssPart === 'handL' || ship.userData?.androssPart === 'handR';
      let collided = false;
      const cd = Math.max(0, (handHitCooldowns.get(ship) ?? 0) - dt);
      handHitCooldowns.set(ship, cd);

      if (handCol?.box) {
        const playerLocal = ship.worldToLocal(tmpHandLocal.copy(shipPos));
        const min = handCol.box.min;
        const max = handCol.box.max;
        tmpHandClosest.set(
          THREE.MathUtils.clamp(playerLocal.x, min.x, max.x),
          THREE.MathUtils.clamp(playerLocal.y, min.y, max.y),
          THREE.MathUtils.clamp(playerLocal.z, min.z, max.z)
        );
        const rHand = playerRadius * 0.4; // hand-only contact uses smaller sphere
        collided = playerLocal.distanceToSquared(tmpHandClosest) < rHand * rHand;
      } else {
        const ENEMY_R = 3;                             // ~half 5-u fighter length
        collided = shipPos.distanceToSquared(ship.position) <
          (playerRadius + ENEMY_R) ** 2;
      }

      if (!collided) return;

      if (isHand) {
        if (cd === 0) {
          tmpHit.copy(tmpHandClosest).applyMatrix4(ship.matrixWorld);
          tmpHit.copy(shipPos).sub(tmpHit);
          if (tmpHit.lengthSq() > 1e-6) {
            tmpHit.normalize().multiplyScalar(playerRadius).add(shipPos);
          } else {
            tmpHit.copy(shipPos);
          }
          onPlayerHit(tmpHit);
          handHitCooldowns.set(ship, 0.75); // cap to one heart while overlapping
        }
        return;
      }

      ship.visible = false;
      awardEnemyKill(ship);             // +100 pts
      tmpHit.copy(shipPos).sub(ship.position);
      if (tmpHit.lengthSq() > 1e-6) {
        tmpHit.normalize().multiplyScalar(playerRadius).add(shipPos);
      } else {
        tmpHit.copy(shipPos);
      }
      onPlayerHit(tmpHit);
    });

    /* ---------- player laser × station ---------- */
    if (stationCollider && stationMesh?.visible){
      laserSystem.getActive().forEach(bolt=>{
        if (!bolt.visible) return;
        const prev = bolt.userData.prev ?? bolt.position;
        if (segmentHitsCollider(stationCollider, stationMesh, prev, bolt.position)){
          const dmg = bolt.userData?.damage ?? 1;
          bolt.visible = false;
          if (bolt.userData?.shotId) onShotHit(bolt.userData.shotId);
          damageStation?.(dmg);
        }
      });

      /* reflected bolts hurt station too */
      enemyLasers().forEach(bolt=>{
        if (!bolt?.position) return;
        if (!bolt.userData?.bounced) return;
        const prev = bolt.prev ?? bolt.position;
        if (segmentHitsCollider(stationCollider, stationMesh, prev, bolt.position)){
          if (bolt.userData) bolt.userData.life = 0;
          damageStation?.(1);
        }
      });
    }



  }

  function pointSegmentDistSq(p, a, b, out = null) {
    segTmpA.copy(b).sub(a);           // ab
    const lenSq = segTmpA.lengthSq();
    if (lenSq === 0) {
      if (out) out.copy(a);
      return p.distanceToSquared(a);
    }
    segTmpB.copy(p).sub(a);           // ap
    const t = Math.max(0, Math.min(1, segTmpB.dot(segTmpA) / lenSq));
    if (out) out.copy(a).addScaledVector(segTmpA, t);
    return segTmpB.copy(a).addScaledVector(segTmpA, t).distanceToSquared(p);
  }

  return { update };
}

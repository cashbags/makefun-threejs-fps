// The other nine players: four Vanguard attackers and five Wardens — no, four Wardens.
// Five a side: the player plus four bots against five bots. A bot sees through a raycast,
// hears shots, walks a waypoint graph, and plays a role: rush a site, hold an angle,
// roam mid, rotate to a plant, or defuse. It shoots in bursts with an aim error that
// grows with distance and target speed, so stopping to aim still pays — for both sides.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS, damageAt } from './weapons.js';
import { createBody, createMover } from './mover.js';
import { range, pick } from './rng.js';

const NAMES = {
  attackers: ['Ash', 'Brick', 'Cinder', 'Dusk'],
  defenders: ['Heron', 'Ivy', 'Juno', 'Kite', 'Wren'],
};
const HEALTH = 100;
const SEE_RANGE = 55;
const HEAR_RANGE = 28;
const VISION_PERIOD = 0.12;

const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _to = new THREE.Vector3();

function bfs(adjacency, from, to) {
  if (from === to) return [to];
  const prev = new Array(adjacency.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const node = queue.shift();
    for (const next of adjacency[node]) {
      if (prev[next] !== -1) continue;
      prev[next] = node;
      if (next === to) {
        const path = [to];
        let at = to;
        while (at !== from) {
          at = prev[at];
          path.unshift(at);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

function angleTo(from, tx, tz) {
  return Math.atan2(-(tx - from.x), -(tz - from.z));
}

function turnToward(body, targetYaw, rate, dt) {
  let diff = targetYaw - body.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, diff));
  body.yaw += step;
  return Math.abs(diff - step) < 0.06;
}

function segmentBlockedBySmoke(from, to, smokes) {
  for (const smoke of smokes) {
    _to.copy(to).sub(from);
    const length = _to.length();
    if (length === 0) continue;
    _to.multiplyScalar(1 / length);
    _dir.copy(smoke.center).sub(from);
    const along = Math.max(0, Math.min(length, _dir.dot(_to)));
    const closest = _dir.copy(from).addScaledVector(_to, along);
    if (closest.distanceTo(smoke.center) < smoke.radius) return true;
  }
  return false;
}

export function createBots(scene, map, rng, hooks) {
  const mover = createMover(map.colliders);
  const raycaster = new THREE.Raycaster();
  raycaster.far = 80;
  const bots = [];
  const hitMeshes = [];

  const bodyMaterial = {
    attackers: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.6, metalness: 0.05 }),
    defenders: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.defender), roughness: 0.6, metalness: 0.05 }),
  };
  const darkMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.155, 16, 12);
  const legGeometry = new THREE.BoxGeometry(0.18, 0.8, 0.2);
  const gunGeometry = new THREE.BoxGeometry(0.08, 0.1, 0.6);

  function makeBot(team, index) {
    const spawn = map.spawns[team][index];
    const body = createBody(spawn.x, spawn.z, spawn.yaw);
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeometry, bodyMaterial[team]);
    torso.position.y = 1.0;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeometry, darkMaterial);
    head.position.y = 1.53;
    head.userData.part = 'head';
    const legL = new THREE.Mesh(legGeometry, darkMaterial);
    legL.position.set(-0.14, 0.4, 0);
    const legR = new THREE.Mesh(legGeometry, darkMaterial);
    legR.position.set(0.14, 0.4, 0);
    const gun = new THREE.Mesh(gunGeometry, darkMaterial);
    gun.position.set(0.28, 1.15, -0.25);
    group.add(torso, head, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);

    const bot = {
      id: `${team}-${index}`,
      name: NAMES[team][index],
      team,
      spawnIndex: index,
      body,
      group,
      torso,
      head,
      legL,
      legR,
      health: HEALTH,
      armor: 0,
      alive: true,
      def: team === 'attackers' ? WEAPONS.vk47 : WEAPONS.vk47,
      mag: WEAPONS.vk47.mag,
      reserve: WEAPONS.vk47.reserve,
      cooldown: 0,
      reloadLeft: 0,
      role: 'hold',
      site: 'A',
      holdNode: 0,
      path: [],
      pathIndex: 0,
      goalNode: -1,
      enemy: null,
      lastSeen: -99,
      lastSeenPos: new THREE.Vector3(),
      reactAt: 0,
      burstLeft: 0,
      burstPauseUntil: 0,
      skill: range(rng, 0.7, 1.0),
      plantProgress: 0,
      defuseProgress: 0,
      stuckAt: 0,
      lastX: spawn.x,
      lastZ: spawn.z,
      walkPhase: rng() * 6,
      hasBomb: false,
      hearPos: null,
      hearAt: -99,
      visionAt: rng() * VISION_PERIOD,
      fall: 0,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) makeBot('attackers', i);
  for (let i = 0; i < 5; i += 1) makeBot('defenders', i);

  function setGoal(bot, node) {
    if (bot.goalNode === node) return;
    bot.goalNode = node;
    const from = map.nearestNode(bot.body.position.x, bot.body.position.z);
    bot.path = bfs(map.adjacency, from, node);
    bot.pathIndex = 0;
  }

  function visibleEnemy(bot, ctx) {
    const eye = _eye.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    const candidates = [];
    if (ctx.player.alive) candidates.push({ kind: 'player', pos: ctx.player.body.position, eyeY: ctx.player.body.eye });
    for (const other of bots) {
      if (other.alive && other.team !== bot.team) {
        candidates.push({ kind: 'bot', bot: other, pos: other.body.position, eyeY: other.body.eye });
      }
    }
    for (const cand of candidates) {
      const chest = _to.set(cand.pos.x, cand.pos.y + 1.2, cand.pos.z);
      const distance = eye.distanceTo(chest);
      if (distance > SEE_RANGE) continue;
      _dir.copy(chest).sub(eye).normalize();
      // Outside a ~110 degree cone the bot does not notice, unless the target is close.
      const forward = new THREE.Vector3(-Math.sin(bot.body.yaw), 0, -Math.cos(bot.body.yaw));
      if (distance > 8 && _dir.dot(forward) < 0.35) continue;
      if (segmentBlockedBySmoke(eye, chest, ctx.smokes)) continue;
      raycaster.set(eye, _dir);
      raycaster.far = distance;
      const blocked = raycaster.intersectObjects(ctx.shootables, false)[0];
      if (blocked && blocked.distance < distance - 0.4) continue;
      return { cand, distance };
    }
    return null;
  }

  function shootAt(bot, ctx, target, distance) {
    const eye = _eye.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    const err = (0.35 + distance * 0.012) * (1.25 - bot.skill * 0.5);
    _aim.set(
      target.pos.x + (rng() * 2 - 1) * err,
      target.pos.y + 1.2 + (rng() * 2 - 1) * err * 0.7,
      target.pos.z + (rng() * 2 - 1) * err,
    );
    _dir.copy(_aim).sub(eye).normalize();
    raycaster.set(eye, _dir);
    raycaster.far = 90;
    const targets = ctx.shootables.concat(ctx.playerHitMeshes, hitMeshes);
    const hit = raycaster.intersectObjects(targets, false)[0];
    const end = hit ? hit.point : _aim.clone().addScaledVector(_dir, 60);
    hooks.onShot(eye.clone(), end, bot.team, bot);
    if (!hit) return;
    if (hit.object.userData.bot && hit.object.userData.bot !== bot && hit.object.userData.bot.alive) {
      const victim = hit.object.userData.bot;
      damage(victim, damageAt(bot.def, hit.distance, hit.object.userData.part), hit.object.userData.part, bot, ctx);
    } else if (hit.object.userData.isPlayer && ctx.player.alive) {
      hooks.onPlayerHit(damageAt(bot.def, hit.distance, hit.object.userData.part), hit.object.userData.part, bot);
    } else {
      hooks.onImpact(hit.point);
    }
  }

  function damage(bot, amount, part, attacker, ctx) {
    if (!bot.alive) return false;
    let left = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, left * 0.5);
      bot.armor -= absorbed;
      left -= absorbed;
    }
    bot.health -= left;
    // Being shot at tells the bot where the fire came from.
    if (attacker) {
      bot.lastSeen = ctx.time;
      bot.lastSeenPos.copy(attacker === 'player' ? ctx.player.body.position : attacker.body.position);
      bot.enemy = attacker;
      bot.reactAt = Math.min(bot.reactAt, ctx.time + 0.15);
    }
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.health = 0;
    bot.fall = 0;
    hooks.onKill(attacker, bot, part === 'head');
    return true;
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.group.rotation.x = -bot.fall * 1.45;
      return;
    }
    bot.cooldown = Math.max(0, bot.cooldown - dt);
    if (bot.reloadLeft > 0) {
      bot.reloadLeft = Math.max(0, bot.reloadLeft - dt);
      if (bot.reloadLeft === 0) {
        const need = bot.def.mag - bot.mag;
        const take = Math.min(need, bot.reserve);
        bot.mag += take;
        bot.reserve -= take;
      }
    }

    // A flashed bot sees nothing and fights nothing until its eyes clear.
    const blinded = ctx.time < (bot.blindUntil || 0);
    // Perception, staggered so nine raycasts never land on the same step.
    bot.visionAt -= dt;
    if (!blinded && bot.visionAt <= 0) {
      bot.visionAt = VISION_PERIOD;
      const seen = visibleEnemy(bot, ctx);
      if (seen) {
        bot.enemy = seen.cand.kind === 'player' ? 'player' : seen.cand.bot;
        bot.lastSeen = ctx.time;
        bot.lastSeenPos.copy(seen.cand.pos);
        if (bot.reactAt < ctx.time) bot.reactAt = ctx.time + range(rng, 0.3, 0.55) * (1.2 - bot.skill * 0.4);
      } else if (ctx.time - bot.lastSeen > 2.5) {
        bot.enemy = null;
      }
    }

    // Bomb work comes before movement: planting, defusing, picking the bomb up.
    const bomb = ctx.bomb;
    if (bot.team === 'attackers' && bomb.state === 'dropped') {
      const d = Math.hypot(bot.body.position.x - bomb.position.x, bot.body.position.z - bomb.position.z);
      if (d < 1.2) {
        bomb.state = 'carried';
        bomb.carrier = bot;
        bot.hasBomb = true;
        hooks.onBombPickup(bot);
      }
    }
    if (bot.hasBomb && bomb.state === 'carried' && bomb.carrier === bot) {
      for (const site of map.sites) {
        if (map.inSite(bot.body.position, site)) {
          bot.plantProgress += dt;
          if (bot.plantProgress >= 3) {
            bot.plantProgress = 0;
            bot.hasBomb = false;
            hooks.onPlant(site, bot);
          }
          return; // planting holds the bot still
        }
      }
      bot.plantProgress = 0;
    }
    if (bot.team === 'defenders' && bomb.state === 'planted') {
      const d = Math.hypot(bot.body.position.x - bomb.position.x, bot.body.position.z - bomb.position.z);
      if (d < 1.6) {
        bot.defuseProgress += dt;
        if (bot.defuseProgress >= 5) {
          bot.defuseProgress = 0;
          hooks.onDefuse(bot);
        }
        return; // defusing holds the bot still
      }
      bot.defuseProgress = 0;
    }

    // Choose a destination.
    let goal = bot.holdNode;
    let combat = !blinded && bot.enemy && ctx.time - bot.lastSeen < 2.5 && ctx.time >= bot.reactAt;
    if (bot.team === 'defenders' && bomb.state === 'planted') {
      goal = map.nearestNode(bomb.position.x, bomb.position.z);
    } else if (bot.team === 'attackers' && bot.hasBomb) {
      goal = map.nearestNode(map.sites[bot.site === 'A' ? 0 : 1].center.x, map.sites[bot.site === 'A' ? 0 : 1].center.z);
    } else if (bot.role === 'rush') {
      goal = map.nearestNode(map.sites[bot.site === 'A' ? 0 : 1].center.x, map.sites[bot.site === 'A' ? 0 : 1].center.z);
    } else if (bot.role === 'hunt' && ctx.time - bot.lastSeen < 6) {
      goal = map.nearestNode(bot.lastSeenPos.x, bot.lastSeenPos.z);
    } else if (bot.role === 'roam') {
      if (bot.goalNode === -1 || bot.pathIndex >= bot.path.length) {
        goal = pick(rng, [11, 12, 22, 23, 24, 25]);
      } else {
        goal = bot.goalNode;
      }
    }
    if (combat) {
      // Fight from here: face the enemy, strafe a little, fire in bursts.
      const target = bot.enemy === 'player' ? ctx.player.body : bot.enemy.body;
      const tx = bot.enemy === 'player' ? target.position.x : target.position.x;
      const tz = bot.enemy === 'player' ? target.position.z : target.position.z;
      const dist = Math.hypot(tx - bot.body.position.x, tz - bot.body.position.z);
      const aimed = turnToward(bot.body, angleTo(bot.body.position, tx, tz), 8, dt);
      bot.body.pitch = Math.max(-1.45, Math.min(1.45, Math.atan2(target.position.y + 1.2 - (bot.body.position.y + bot.body.eye), dist)));
      if (aimed && bot.cooldown === 0 && bot.reloadLeft === 0) {
        if (bot.burstLeft > 0) {
          if (bot.mag === 0) {
            bot.reloadLeft = bot.def.reloadTime;
          } else {
            bot.mag -= 1;
            bot.burstLeft -= 1;
            bot.cooldown = bot.def.fireGap;
            shootAt(bot, ctx, { pos: target.position }, dist);
          }
        } else if (ctx.time >= bot.burstPauseUntil) {
          bot.burstLeft = 3 + Math.floor(rng() * 3);
          bot.burstPauseUntil = ctx.time + 0.5 + rng() * 0.7;
        }
      }
      // Crouch when holding an angle at range; strafe between bursts.
      const input = { forward: 0, strafe: 0, jump: false, crouch: dist > 14 && rng() < 0.5 };
      if (bot.burstLeft === 0 && ctx.time < bot.burstPauseUntil) {
        input.strafe = Math.sin(ctx.time * 1.3 + bot.walkPhase) > 0 ? 1 : -1;
      }
      mover.step(bot.body, dt, input);
    } else {
      setGoal(bot, goal);
      const node = bot.path[bot.pathIndex];
      if (node !== undefined) {
        const nx = map.nodes[node][0];
        const nz = map.nodes[node][1];
        const dx = nx - bot.body.position.x;
        const dz = nz - bot.body.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.7) {
          bot.pathIndex += 1;
        } else {
          const arrived = turnToward(bot.body, angleTo(bot.body.position, nx, nz), 6, dt);
          const input = { forward: arrived ? 1 : 0.4, strafe: 0, jump: false, crouch: false };
          mover.step(bot.body, dt, input);
          // Stuck against a wall: skip this node and carry on.
          if (Math.hypot(bot.body.position.x - bot.lastX, bot.body.position.z - bot.lastZ) < 0.02) {
            bot.stuckAt += dt;
            if (bot.stuckAt > 2) {
              bot.pathIndex += 1;
              bot.stuckAt = 0;
            }
          } else {
            bot.stuckAt = 0;
          }
          bot.lastX = bot.body.position.x;
          bot.lastZ = bot.body.position.z;
        }
      }
    }

    // Walk cycle and facing.
    const speed = mover.groundSpeed(bot.body);
    bot.walkPhase += dt * speed * 1.6;
    bot.legL.rotation.x = Math.sin(bot.walkPhase) * 0.5 * Math.min(1, speed / 3);
    bot.legR.rotation.x = -Math.sin(bot.walkPhase) * 0.5 * Math.min(1, speed / 3);
    bot.group.position.copy(bot.body.position);
    bot.group.rotation.y = bot.body.yaw;
  }

  function reset(round, bombCarrier) {
    for (const bot of bots) {
      const spawn = map.spawns[bot.team][bot.spawnIndex];
      bot.body.position.set(spawn.x, 0, spawn.z);
      bot.body.velocity.set(0, 0, 0);
      bot.body.yaw = spawn.yaw;
      bot.body.pitch = 0;
      bot.health = HEALTH;
      bot.armor = 0;
      bot.alive = true;
      bot.mag = bot.def.mag;
      bot.reserve = bot.def.reserve;
      bot.cooldown = 0;
      bot.reloadLeft = 0;
      bot.fall = 0;
      bot.group.rotation.set(0, bot.body.yaw, 0);
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.path = [];
      bot.pathIndex = 0;
      bot.goalNode = -1;
      bot.enemy = null;
      bot.lastSeen = -99;
      bot.hasBomb = false;
      bot.hearPos = null;
      bot.group.visible = true;
      // Roles: two attackers rush the bomb site, one follows the carrier, one roams;
      // two defenders hold each site, one roams mid.
      if (bot.team === 'attackers') {
        const i = bots.filter((b) => b.team === 'attackers').indexOf(bot);
        bot.site = i < 2 ? bombCarrier.site : i === 2 ? bombCarrier.site : pick(rng, ['A', 'B']);
        bot.role = i < 2 ? 'rush' : i === 2 ? 'hunt' : 'roam';
        bot.holdNode = bot.site === 'A' ? 9 : 19;
      } else {
        const i = bots.filter((b) => b.team === 'defenders').indexOf(bot);
        bot.site = i < 2 ? 'A' : i < 4 ? 'B' : 'A';
        bot.role = i === 4 ? 'roam' : 'hold';
        bot.holdNode = bot.site === 'A' ? pick(rng, [8, 20, 31]) : pick(rng, [18, 21, 32]);
        bot.def = i % 2 === 0 ? WEAPONS.vk47 : WEAPONS.stinger;
        bot.mag = bot.def.mag;
        bot.reserve = bot.def.reserve;
      }
    }
  }

  return {
    bots,
    hitMeshes,
    step(dt, ctx) {
      for (const bot of bots) stepBot(bot, dt, ctx);
    },
    // Copy every body to its mesh without stepping the AI: for scripted shots,
    // where bots are placed by hand while the round is frozen.
    sync() {
      for (const bot of bots) {
        bot.group.position.copy(bot.body.position);
        bot.group.rotation.y = bot.body.yaw;
      }
    },
    damage,
    reset,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    hearShot(position, time) {
      for (const bot of bots) {
        if (!bot.alive) continue;
        const d = Math.hypot(bot.body.position.x - position.x, bot.body.position.z - position.z);
        if (d < HEAR_RANGE) {
          // A shot heard is a place to investigate: the bot hunts the sound.
          bot.lastSeenPos.copy(position);
          bot.lastSeen = time;
          if (bot.role === 'hold') bot.role = 'hunt';
        }
      }
    },
  };
}

// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. The player is Vanguard; four bot teammates and five Wardens share the depot.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createMap } from './map.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, GEAR, damageAt } from './weapons.js';
import { createBots } from './bots.js';
import { createGrenades } from './grenades.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createRounds } from './rounds.js';
import { createInput } from './input.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#20242c');
scene.fog = new THREE.Fog(new THREE.Color('#20242c'), 26, 78);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const hud = createHud();
const audio = createAudio();
const effects = createEffects(scene);
const player = createPlayer(map.colliders, map.spawns.attackers[0]);
const weapon = createWeapon(camera, WEAPONS.p9);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

// The player's own hitbox: invisible to the eye, solid to a bot's raycast.
const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
const playerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), hitMaterial);
const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), hitMaterial);
playerTorso.userData.isPlayer = true;
playerTorso.userData.part = 'torso';
playerHead.userData.isPlayer = true;
playerHead.userData.part = 'head';
scene.add(playerTorso, playerHead);
const playerHitMeshes = [playerTorso, playerHead];

const you = {
  health: 100,
  armor: 0,
  alive: true,
  current: 'p9',
  ammo: { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } },
  grenades: { frag: 0, smoke: 0, flash: 0 },
  hasBomb: true,
  plantProgress: 0,
  bloom: 0,
  scoped: false,
};

// The charge itself: a small box with a blinking light, shown planted or dropped.
const bombMesh = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.2, 0.22),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.danger), roughness: 0.5, metalness: 0.3 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 6),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) }),
);
bombLight.position.set(0, 0.14, 0);
bombMesh.add(bombBox, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

const grenades = createGrenades(scene, {
  onExplosion(at) {
    effects.explosion(at);
    audio.explosion();
  },
  onFlash() {
    audio.shot();
  },
  onSmoke() {},
  onPlayerDamage(amount, part) {
    damagePlayer(amount, part, null);
  },
  onPlayerFlash(seconds) {
    hud.flash(seconds);
  },
});

const rounds = createRounds(random, {
  onRoundStart(round) {
    respawnPlayer();
    bots.reset(round, { site: random() < 0.5 ? 'A' : 'B' });
    grenades.reset();
    bombMesh.visible = false;
    hud.hideBanner();
    hud.setScore(rounds.state.score.attackers, rounds.state.score.defenders, round);
    // The first round starts behind the start overlay: the buy menu opens only
    // once the player has clicked Play, so two dialogs never stack on load.
    if (hasPlayed) {
      hud.showBuy(round, rounds.state.money, rounds.state.loadout);
      if (!shot) document.exitPointerLock?.();
    }
  },
  onLive() {
    hud.hideBuy();
    hud.showBanner(`Round ${rounds.state.round}`, 'Plant the charge or clear the Wardens.', null);
    if (!shot && !document.pointerLockElement) hud.showOverlay('paused');
  },
  onRoundEnd(winner, reason, score) {
    const won = winner === 'attackers';
    hud.showBanner(won ? 'Vanguard wins the round' : 'Wardens win the round', `${reason}  ${score.attackers} — ${score.defenders}`, won);
    if (won) audio.roundWin();
    else audio.roundLoss();
    hud.setScore(score.attackers, score.defenders, rounds.state.round);
  },
  onMatchEnd(winner, score) {
    const detail =
      winner === 'draw'
        ? `A draw, ${score.attackers} — ${score.defenders}.`
        : `${winner === 'attackers' ? 'Vanguard takes Depot 9' : 'Wardens hold Depot 9'}, ${score.attackers} — ${score.defenders}.`;
    hud.showOverlay('matchover', detail);
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onBuy(itemId, money) {
    applyLoadout();
    hud.setMoney(money);
    hud.updateBuy(money, rounds.state.loadout);
    syncWeaponHud();
  },
  onPlant(site) {
    audio.plant();
    bombMesh.position.copy(site.center).setY(0.15);
    bombMesh.visible = true;
  },
});

const bots = createBots(scene, map, random, {
  onShot(from, to, team, bot) {
    effects.tracer(from, to);
    if (bot) bot.lastShotAt = elapsed;
    audio.enemyShot();
  },
  onKill(attacker, victim, headshot) {
    const killerName = attacker === 'player' ? 'You' : attacker.name;
    const killerTeam = attacker === 'player' ? 'attackers' : attacker.team;
    hud.killfeed(killerName, killerTeam, victim.name, victim.team, headshot);
    if (attacker === 'player') {
      rounds.addKillReward();
      hud.setMoney(rounds.state.money);
      audio.kill();
    }
    if (victim.hasBomb) dropBomb(victim.body.position);
  },
  onPlayerHit(amount, part, bot) {
    damagePlayer(amount, part, bot);
  },
  onPlant(site, bot) {
    rounds.plant(site);
  },
  onDefuse() {
    rounds.defuse();
  },
  onBombPickup(bot) {
    hud.setBomb(`${bot.name} picked up the charge.`);
  },
  onImpact(point) {
    effects.impact(point);
  },
});

const input = createInput(renderer.domElement, onLockChange);
const body = player.state;

let elapsed = 0;
let frozen = false;
let started = false;
let hasPlayed = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let minimapAt = 0;

hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.state.def.name);
hud.setHealth(you.health, you.armor);
hud.setMoney(rounds.state.money);
hud.setScore(0, 0, 1);
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  hasPlayed = true;
  if (rounds.state.phase === 'matchover') {
    rounds.startMatch();
  }
  hud.hideOverlay();
  // During the buy freeze the mouse buys; the pointer locks when play resumes.
  if (rounds.state.phase === 'buy') {
    hud.showBuy(rounds.state.round, rounds.state.money, rounds.state.loadout);
  } else {
    input.requestLock();
  }
});
hud.onBuy((itemId) => rounds.buy(itemId));
hud.onBuyDone(() => {
  hud.hideBuy();
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (started && rounds.state.phase === 'live' && you.alive && !hud.isBuyOpen()) {
    hud.showOverlay('paused');
  }
}

function respawnPlayer() {
  const spawn = map.spawns.attackers[0];
  player.reset(spawn);
  you.health = 100;
  you.armor = rounds.state.loadout.kevlar ? 50 : 0;
  you.alive = true;
  you.hasBomb = true;
  you.plantProgress = 0;
  you.bloom = 0;
  applyLoadout();
  hud.setHealth(you.health, you.armor);
  syncWeaponHud();
}

function applyLoadout() {
  const loadout = rounds.state.loadout;
  if (loadout.primary && !you.ammo[loadout.primary]) {
    you.ammo[loadout.primary] = { mag: WEAPONS[loadout.primary].mag, reserve: WEAPONS[loadout.primary].reserve };
  }
  you.grenades = { ...loadout.grenades };
  you.armor = loadout.kevlar ? 50 : you.armor;
  if (loadout.primary) equip(loadout.primary);
  else equip('p9');
}

function equip(id) {
  const def = WEAPONS[id];
  if (!def || you.current === id) {
    if (def) {
      weapon.state.mag = you.ammo[id].mag;
      weapon.state.reserve = you.ammo[id].reserve;
    }
    return;
  }
  you.ammo[you.current] = { mag: weapon.state.mag, reserve: weapon.state.reserve };
  if (!you.ammo[id]) you.ammo[id] = { mag: def.mag, reserve: def.reserve };
  you.current = id;
  weapon.setDef(def);
  weapon.state.mag = you.ammo[id].mag;
  weapon.state.reserve = you.ammo[id].reserve;
  you.scoped = false;
  syncWeaponHud();
}

function syncWeaponHud() {
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.state.def.name);
  hud.setGear(you.grenades.frag, you.grenades.smoke, you.grenades.flash, you.hasBomb);
}

function dropBomb(position) {
  const bomb = rounds.state.bomb;
  if (bomb.state !== 'carried') return;
  bomb.state = 'dropped';
  bomb.carrier = null;
  bomb.position = new THREE.Vector3(position.x, 0.15, position.z);
  you.hasBomb = false;
  bombMesh.position.copy(bomb.position);
  bombMesh.visible = true;
  hud.setBomb('The charge is on the ground — pick it up.');
  syncWeaponHud();
}

function damagePlayer(amount, part, attacker) {
  if (!you.alive) return;
  let left = amount;
  if (you.armor > 0) {
    const absorbed = Math.min(you.armor, left * 0.5);
    you.armor -= absorbed;
    left -= absorbed;
  }
  you.health -= left;
  hud.damageFlash();
  hud.setHealth(you.health, you.armor);
  if (you.health > 0) return;
  you.health = 0;
  you.alive = false;
  if (you.hasBomb) dropBomb(body.position);
  if (document.pointerLockElement) document.exitPointerLock();
  hud.setBomb('You are down — your team fights on.');
  hud.setHealth(0, you.armor);
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  playerTorso.position.set(body.position.x, body.position.y + 1.0, body.position.z);
  playerTorso.rotation.y = body.yaw;
  playerHead.position.set(body.position.x, body.position.y + 1.53, body.position.z);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  if (!weapon.takeRound()) return false;
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const targets = map.shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(targets, false)[0];
  muzzle.copy(camera.position).addScaledVector(direction, 0.6);
  muzzle.x += Math.cos(body.yaw) * 0.2;
  muzzle.z -= Math.sin(body.yaw) * 0.2;
  const end = hit ? hit.point : camera.position.clone().addScaledVector(direction, 60);
  effects.tracer(muzzle, end);
  if (hit && hit.object.userData.bot) {
    const victim = hit.object.userData.bot;
    const killed = bots.damage(victim, damageAt(weapon.state.def, hit.distance, hit.object.userData.part), hit.object.userData.part, 'player', botCtx());
    hud.hitMarker(killed, shot ? 4000 : 90);
    if (killed) audio.kill();
    else audio.hit();
  } else if (hit) {
    effects.impact(hit.point);
  }
  weapon.pullTrigger();
  player.recoil(weapon.state.def.kick + you.bloom, (random() * 2 - 1) * weapon.state.def.kick * 0.4);
  you.bloom = Math.min(0.012, you.bloom + 0.002);
  audio.shot();
  bots.hearShot(body.position, elapsed);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.state.def.name);
  return true;
}

function botCtx() {
  return {
    time: elapsed,
    player: { body, alive: you.alive },
    playerHitMeshes,
    shootables: map.shootables,
    smokes: grenades.smokes,
    bomb: rounds.state.bomb,
    camera,
    damageBot: (bot, amount, part, attacker) => bots.damage(bot, amount, part, attacker, botCtx()),
  };
}

function throwGrenade(type) {
  if (you.grenades[type] <= 0) return;
  you.grenades[type] -= 1;
  camera.getWorldDirection(direction);
  grenades.throwGrenade(type, camera.position.clone(), direction.clone());
  syncWeaponHud();
}

function step(dt) {
  elapsed += dt;
  const phase = rounds.state.phase;
  const keys = input.state.keys;

  if (phase === 'buy') {
    if (input.takePressed('KeyB')) {
      if (hud.isBuyOpen()) {
        hud.hideBuy();
        input.requestLock();
      } else {
        hud.showBuy(rounds.state.round, rounds.state.money, rounds.state.loadout);
      }
    }
    for (let i = 0; i < 8; i += 1) {
      if (input.takePressed(`Digit${i + 1}`)) {
        const items = [...Object.values(WEAPONS).filter((w) => w.slot === 'primary'), ...Object.values(GEAR)];
        if (items[i]) rounds.buy(items[i].id);
      }
    }
  }

  if (phase === 'live' && you.alive) {
    const look = input.takeLook();
    const sensitivity = you.scoped ? 0.0009 : 0.0022;
    player.look(look.x, look.y, sensitivity);
    const moveInput = {
      forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      strafe: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      jump: keys.has('Space'),
      crouch: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'),
    };
    player.step(dt, moveInput);
    you.bloom = Math.max(0, you.bloom - dt * 0.02);

    const firing = input.state.firing;
    const wantFire = weapon.state.def.auto ? firing : firing && !prevFiring;
    prevFiring = firing;
    if (wantFire && weapon.ready()) {
      shoot(weapon.spread(player.groundSpeed()) + you.bloom);
    }
    if (keys.has('KeyR') && weapon.state.reloadLeft === 0) {
      weapon.reload();
      audio.reload();
    }
    if (input.takePressed('Digit1') && rounds.state.loadout.primary) equip(rounds.state.loadout.primary);
    if (input.takePressed('Digit2')) equip('p9');
    if (input.takePressed('Digit4')) throwGrenade('frag');
    if (input.takePressed('Digit5')) throwGrenade('smoke');
    if (input.takePressed('Digit6')) throwGrenade('flash');

    you.scoped = input.state.aiming && weapon.state.def.scoped === true;
    camera.fov += ((you.scoped ? 30 : 74) - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();

    // Planting: hold E inside a site while carrying the charge.
    if (you.hasBomb && keys.has('KeyE')) {
      for (const site of map.sites) {
        if (map.inSite(body.position, site)) {
          you.plantProgress += dt;
          hud.setBomb(`Planting at Site ${site.id}… ${(3 - you.plantProgress).toFixed(1)}s`);
          if (you.plantProgress >= 3) {
            you.plantProgress = 0;
            you.hasBomb = false;
            rounds.plant(site);
            syncWeaponHud();
          }
          break;
        }
      }
    } else {
      you.plantProgress = Math.max(0, you.plantProgress - dt * 2);
    }

    // Picking up a dropped charge.
    const bomb = rounds.state.bomb;
    if (bomb.state === 'dropped' && bomb.position) {
      const d = Math.hypot(body.position.x - bomb.position.x, body.position.z - bomb.position.z);
      if (d < 1.2) {
        bomb.state = 'carried';
        bomb.carrier = 'player';
        you.hasBomb = true;
        bombMesh.visible = false;
        hud.setBomb('You carry the charge — take it to a site.');
        syncWeaponHud();
      }
    }
  }

  weapon.step(dt);
  effects.step(dt);
  if (phase === 'live') bots.step(dt, botCtx());
  grenades.step(dt, {
    ...botCtx(),
    bots: bots.bots,
    player: { body, alive: you.alive },
  });
  rounds.tick(dt, {
    attackersAlive: (you.alive ? 1 : 0) + bots.aliveCount('attackers'),
    defendersAlive: bots.aliveCount('defenders'),
    playerAlive: you.alive,
  });

  // HUD, throttled where it is cheap to do so.
  minimapAt -= dt;
  if (minimapAt <= 0) {
    minimapAt = 0.1;
    hud.drawMinimap(map, body, bots.bots, rounds.state.bomb, elapsed);
  }
  hud.setTimer(rounds.state.timer, phase);
  hud.setCrosshairGap(weapon.spread(player.groundSpeed()) + you.bloom);
  const bomb = rounds.state.bomb;
  if (phase === 'live') {
    if (bomb.state === 'planted') {
      hud.setBomb(`Charge planted at Site ${bomb.site} — ${Math.ceil(bomb.timer)}s`);
      bombLight.material.color.setHex(Math.floor(elapsed * 3) % 2 ? 0xd95b4a : 0x3a0d08);
    } else if (bomb.state === 'carried' && bomb.carrier === 'player' && you.plantProgress === 0) {
      hud.setBomb('You carry the charge — take it to Site A or B.');
    } else if (bomb.state === 'dropped' && you.plantProgress === 0) {
      hud.setBomb('The charge is on the ground — pick it up.');
    }
  }
  syncCamera();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  rounds.startMatch();
  hud.hideBuy(); // startMatch opens the buy menu; each shot re-opens what it needs
  if (name === 'start') {
    body.position.set(0, 0, 16);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    // Two Wardens holding the mid angles, in frame from the spawn.
    const defenders = bots.bots.filter((b) => b.team === 'defenders');
    defenders[0].body.position.set(-3, 0, 4);
    defenders[0].body.yaw = Math.PI;
    defenders[1].body.position.set(4, 0, 0);
    defenders[1].body.yaw = Math.PI;
    bots.sync();
    syncCamera();
    hud.showOverlay('start');
    paintTwiceThenReady();
    return;
  }
  if (name === 'play') {
    rounds.state.phase = 'live';
    rounds.state.timer = 83;
    rounds.state.score.attackers = 2;
    rounds.state.score.defenders = 1;
    rounds.state.money = 2450;
    rounds.state.round = 4;
    equip('vk47');
    weapon.state.mag = 24;
    // West lane firefight: a clear lane from the crates to Site A, tanks behind.
    body.position.set(-16, 0, 10);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    const defenders = bots.bots.filter((b) => b.team === 'defenders');
    const target = defenders[0];
    target.body.position.set(-17.5, 0, -4);
    target.body.yaw = Math.PI;
    defenders[1].body.position.set(-13, 0, -8);
    defenders[1].body.yaw = Math.PI * 0.75;
    bots.sync();
    settle(6);
    for (let round = 0; round < 3; round += 1) {
      // Aim at where the target stands now, not where it was placed.
      aimAt(tmpVec.set(target.body.position.x, target.body.position.y + 1.2, target.body.position.z));
      shoot(0);
      settle(round < 2 ? 6 : 2);
    }
    hud.setScore(2, 1, 4);
    hud.setMoney(2450);
    hud.setTimer(83, 'live');
    paintTwiceThenReady();
    return;
  }
  if (name === 'buy') {
    rounds.state.money = 4100;
    rounds.state.round = 3;
    hud.setMoney(4100);
    hud.setScore(1, 1, 3);
    body.position.set(0, 0, 16);
    body.yaw = 0.3;
    body.pitch = 0;
    settle(20);
    hud.showBuy(3, 4100, rounds.state.loadout);
    paintTwiceThenReady();
    return;
  }
  // end: settle first while the round is still in its buy freeze — settling after
  // the phase flips to 'over' would run the end timer out and start the next round.
  body.position.set(-12, 0, -8);
  body.yaw = -0.9;
  body.pitch = 0;
  settle(20);
  rounds.state.phase = 'over';
  rounds.state.score.attackers = 3;
  rounds.state.score.defenders = 2;
  rounds.state.round = 6;
  rounds.state.timer = 4;
  hud.setScore(3, 2, 6);
  hud.setTimer(0, 'over');
  hud.showBanner('Vanguard wins the round', 'The charge detonated at Site A.  3 — 2', true);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
rounds.startMatch();
if (shot) runShot(shot);
else requestAnimationFrame(frame);

// Thrown things: frag, smoke and flash. A grenade flies a parabola, lands, and does
// its job — frag hurts by distance and line of sight, smoke blocks every eye for 15 s,
// flash blinds whoever is looking at it. Bots throw none; the player buys and throws.
import * as THREE from 'three';

const GRAVITY = 12;
const SMOKE_SECONDS = 15;
const SMOKE_RADIUS = 4;

const _v = new THREE.Vector3();
const _from = new THREE.Vector3();

export function createGrenades(scene, hooks) {
  const active = [];
  const smokes = [];
  const raycaster = new THREE.Raycaster();
  const ballGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const ballMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.4 });
  const smokeGeometry = new THREE.SphereGeometry(1, 16, 12);
  const smokeMaterial = new THREE.MeshBasicMaterial({
    color: 0xb8bcc0, transparent: true, opacity: 0.32, depthWrite: false,
  });

  function throwGrenade(type, from, direction) {
    const mesh = new THREE.Mesh(ballGeometry, ballMaterial);
    mesh.position.copy(from);
    scene.add(mesh);
    const fuse = type === 'frag' ? 1.6 : type === 'flash' ? 1.2 : 0;
    active.push({
      type,
      mesh,
      velocity: direction.clone().multiplyScalar(13).add(new THREE.Vector3(0, 3.5, 0)),
      fuse,
      landed: false,
    });
  }

  function explodeFrag(at, ctx) {
    hooks.onExplosion(at);
    const victims = [];
    if (ctx.player.alive) victims.push({ kind: 'player', pos: ctx.player.body.position });
    for (const bot of ctx.bots) if (bot.alive) victims.push({ kind: 'bot', bot, pos: bot.body.position });
    for (const victim of victims) {
      const distance = at.distanceTo(_v.set(victim.pos.x, victim.pos.y + 1, victim.pos.z));
      if (distance > 9) continue;
      // A wall between the blast and the victim takes the blast.
      _from.copy(at);
      _v.sub(_from).normalize();
      raycaster.set(_from, _v);
      raycaster.far = distance;
      const blocked = raycaster.intersectObjects(ctx.shootables, false)[0];
      if (blocked && blocked.distance < distance - 0.4) continue;
      const amount = Math.max(10, 120 - distance * 13);
      if (victim.kind === 'player') hooks.onPlayerDamage(amount, 'blast', null);
      else ctx.damageBot(victim.bot, amount, 'torso', null);
    }
  }

  function explodeFlash(at, ctx) {
    hooks.onFlash(at);
    const eye = ctx.player.body.position;
    const toFlash = _v.set(at.x - eye.x, at.y - (eye.y + ctx.player.body.eye), at.z - eye.z);
    const distance = toFlash.length();
    if (distance < 26) {
      toFlash.normalize();
      const forward = new THREE.Vector3();
      ctx.camera.getWorldDirection(forward);
      if (forward.dot(toFlash) > 0.2) {
        raycaster.set(_from.set(eye.x, eye.y + ctx.player.body.eye, eye.z), toFlash);
        raycaster.far = distance;
        const blocked = raycaster.intersectObjects(ctx.shootables, false)[0];
        if (!blocked || blocked.distance > distance - 0.4) {
          hooks.onPlayerFlash(Math.max(0.4, 2.6 - distance * 0.09));
        }
      }
    }
    for (const bot of ctx.bots) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.body.position.x - at.x, bot.body.position.z - at.z);
      if (d < 22) bot.blindUntil = ctx.time + Math.max(0.5, 2.2 - d * 0.08);
    }
  }

  function step(dt, ctx) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const g = active[i];
      g.velocity.y -= GRAVITY * dt;
      g.mesh.position.addScaledVector(g.velocity, dt);
      const p = g.mesh.position;
      if (p.y <= 0.1) {
        p.y = 0.1;
        if (Math.abs(g.velocity.y) > 2) g.velocity.y *= -0.35;
        else g.velocity.y = 0;
        g.velocity.x *= 0.7;
        g.velocity.z *= 0.7;
        g.landed = true;
      }
      g.fuse -= dt;
      if (g.fuse > 0) continue;
      if (g.type === 'frag') explodeFrag(p.clone(), ctx);
      else if (g.type === 'flash') explodeFlash(p.clone(), ctx);
      else {
        const mesh = new THREE.Mesh(smokeGeometry, smokeMaterial);
        mesh.position.copy(p).setY(1.2);
        mesh.scale.setScalar(SMOKE_RADIUS);
        scene.add(mesh);
        smokes.push({ center: mesh.position.clone(), radius: SMOKE_RADIUS, mesh, left: SMOKE_SECONDS });
        hooks.onSmoke(p.clone());
      }
      scene.remove(g.mesh);
      active.splice(i, 1);
    }
    for (let i = smokes.length - 1; i >= 0; i -= 1) {
      const s = smokes[i];
      s.left -= dt;
      s.mesh.material.opacity = 0.32 * Math.min(1, s.left / 3);
      if (s.left <= 0) {
        scene.remove(s.mesh);
        smokes.splice(i, 1);
      }
    }
  }

  function reset() {
    for (const g of active) scene.remove(g.mesh);
    active.length = 0;
    for (const s of smokes) scene.remove(s.mesh);
    smokes.length = 0;
  }

  return { throwGrenade, step, reset, smokes };
}

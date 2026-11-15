// Tracers, impact dust and explosions, from fixed pools: nothing is allocated in
// the hot loop, a tracer or a puff is just a reused mesh with its clock reset.
import * as THREE from 'three';

const TRACERS = 24;
const PUFFS = 16;

export function createEffects(scene) {
  const tracerMaterial = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  const tracers = [];
  for (let i = 0; i < TRACERS; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, tracerMaterial.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, left: 0 });
  }
  let tracerNext = 0;

  const puffMaterial = new THREE.MeshBasicMaterial({ color: 0x8a7f6a, transparent: true, opacity: 0.7 });
  const puffs = [];
  const puffGeometry = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  for (let i = 0; i < PUFFS; i += 1) {
    const mesh = new THREE.Mesh(puffGeometry, puffMaterial.clone());
    mesh.visible = false;
    scene.add(mesh);
    puffs.push({ mesh, left: 0, velocity: new THREE.Vector3() });
  }
  let puffNext = 0;

  const boomLight = new THREE.PointLight(0xff9a3c, 0, 18);
  scene.add(boomLight);
  const boomSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb45e, transparent: true, opacity: 0.0, depthWrite: false }),
  );
  boomSphere.visible = false;
  scene.add(boomSphere);
  let boomLeft = 0;

  function tracer(from, to) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % TRACERS;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.line.material.opacity = 0.9;
    t.left = 0.07;
  }

  function impact(point) {
    const p = puffs[puffNext];
    puffNext = (puffNext + 1) % PUFFS;
    p.mesh.position.copy(point);
    p.mesh.visible = true;
    p.mesh.material.opacity = 0.8;
    p.mesh.scale.setScalar(1);
    p.velocity.set((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2);
    p.left = 0.3;
  }

  function explosion(point) {
    boomLight.position.copy(point).setY(point.y + 1);
    boomLight.intensity = 60;
    boomSphere.position.copy(point);
    boomSphere.visible = true;
    boomLeft = 0.5;
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.left <= 0) continue;
      t.left -= dt;
      t.line.material.opacity = Math.max(0, t.left / 0.07) * 0.9;
      if (t.left <= 0) t.line.visible = false;
    }
    for (const p of puffs) {
      if (p.left <= 0) continue;
      p.left -= dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.velocity.y -= 6 * dt;
      p.mesh.material.opacity = Math.max(0, p.left / 0.3) * 0.7;
      p.mesh.scale.setScalar(1 + (0.3 - p.left) * 2);
      if (p.left <= 0) p.mesh.visible = false;
    }
    if (boomLeft > 0) {
      boomLeft -= dt;
      const k = Math.max(0, boomLeft / 0.5);
      boomLight.intensity = 60 * k;
      boomSphere.scale.setScalar(1 + (1 - k) * 5);
      boomSphere.material.opacity = 0.55 * k;
      if (boomLeft <= 0) {
        boomSphere.visible = false;
        boomLight.intensity = 0;
      }
    }
  }

  return { tracer, impact, explosion, step };
}

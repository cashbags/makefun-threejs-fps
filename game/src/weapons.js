// The arsenal. One table owns every number, so the buy menu, the bots and the
// shooting code all read the same truth. Damage is per torso hit at close range;
// headshots multiply by 4; beyond 26 m damage falls to 70% at 60 m.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 300, damage: 26, headMult: 4, mag: 12, reserve: 36,
    fireGap: 0.14, reloadTime: 1.3, spreadStill: 0.004, spreadMove: 0.03, auto: false, kick: 0.006,
    barrel: 0.22, slot: 'sidearm',
  },
  stinger: {
    id: 'stinger', name: 'Stinger SMG', price: 1500, damage: 24, headMult: 4, mag: 30, reserve: 120,
    fireGap: 0.075, reloadTime: 1.7, spreadStill: 0.006, spreadMove: 0.038, auto: true, kick: 0.005,
    barrel: 0.3, slot: 'primary',
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Rifle', price: 2700, damage: 34, headMult: 4, mag: 30, reserve: 90,
    fireGap: 0.096, reloadTime: 1.9, spreadStill: 0.0022, spreadMove: 0.028, auto: true, kick: 0.009,
    barrel: 0.42, slot: 'primary',
  },
  longshot: {
    id: 'longshot', name: 'Longshot DMR', price: 3300, damage: 72, headMult: 4, mag: 10, reserve: 30,
    fireGap: 0.9, reloadTime: 2.6, spreadStill: 0.0008, spreadMove: 0.02, auto: false, kick: 0.02,
    barrel: 0.6, slot: 'primary', scoped: true,
  },
};

export const GEAR = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, max: 2 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, max: 2 },
  flash: { id: 'flash', name: 'Flash Grenade', price: 200, max: 2 },
  kevlar: { id: 'kevlar', name: 'Kevlar Vest', price: 650, max: 1 },
};

export function damageAt(def, distance, part) {
  const falloff = distance <= 26 ? 1 : Math.max(0.7, 1 - (distance - 26) * 0.0088);
  const base = def.damage * falloff;
  return part === 'head' ? base * def.headMult : base;
}

// One gun in the world: a view model on the camera, a magazine, a reload, and the
// spread that punishes moving. main.js owns the ray and the damage.
export function createWeapon(camera, def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const gunmetal = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x5a6068), roughness: 0.45, metalness: 0.5 });

  const model = new THREE.Group();
  // A radial-gradient flash drawn on a canvas: a solid square reads as a floating
  // diamond, a soft burst reads as a muzzle flash.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64;
  flashCanvas.height = 64;
  const flashCtx = flashCanvas.getContext('2d');
  const flashGrad = flashCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
  flashGrad.addColorStop(0, 'rgba(255,240,200,1)');
  flashGrad.addColorStop(0.4, 'rgba(240,168,48,0.85)');
  flashGrad.addColorStop(1, 'rgba(240,168,48,0)');
  flashCtx.fillStyle = flashGrad;
  flashCtx.fillRect(0, 0, 64, 64);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(flashCanvas), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  camera.add(model, flash, flashLight);

  const state = { def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };

  function buildModel() {
    while (model.children.length) model.remove(model.children[0]);
    // Gunmetal, kept small, low and out to the side so the sightline stays open.
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.3), gunmetal);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, state.def.barrel), body);
    barrel.position.set(0, 0.02, -0.15 - state.def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 0.16), grip);
    stock.position.set(0, -0.015, 0.22);
    model.add(receiver, barrel, stock);
    if (state.def.scoped) {
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.2), accent);
      scope.position.set(0, 0.07, -0.04);
      model.add(scope);
    }
    model.position.set(0.26, -0.27, -0.62);
    flash.position.set(0.26, -0.25, -0.78 - state.def.barrel);
    flashLight.position.set(0.26, -0.23, -0.78);
  }
  buildModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.62 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 8;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (state.def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = state.def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = state.def.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === state.def.mag || state.reserve === 0) return;
      state.reloadLeft = state.def.reloadTime;
    },
    spread(speed) {
      return state.def.spreadStill + Math.min(1, speed / 5.2) * state.def.spreadMove;
    },
    refill() {
      state.mag = state.def.mag;
      state.reserve = state.def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    setDef(def) {
      state.def = def;
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      buildModel();
    },
  };
}

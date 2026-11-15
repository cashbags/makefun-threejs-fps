// Depot 9: an original rail depot at dusk, 48 x 40 m. Three lanes run north-south —
// West (containers), Mid (the rail line with boxcars), East (crate yard) — joined by
// gaps in the divider walls. Site A, the fuel depot, sits north-west; Site B, the
// signal tower, sits north-east. Attackers spawn south, defenders north.
// Every solid is a box collider and a bullet surface; the waypoint graph is what the
// bots walk, so a node sits wherever a bot should be able to stand.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint nodes [x, z]. Indices are stable: bots and the shot scripts use them.
export const NODES = [
  [0, 17], [-8, 17], [8, 17], [-16, 17], [16, 17], // 0-4 attacker spawn
  [-19, 12], [-19, 4], [-19, -4], [-19, -10], [-17, -13], // 5-9 west lane, 9 = site A
  [0, 12], [0, 4], [0, -2], [0, -10], [0, -16], // 10-14 mid
  [19, 12], [19, 4], [19, -4], [19, -10], [17, -13], // 15-19 east lane, 19 = site B
  [-8, -8], [8, -8], [-8, 1], [8, 1], [-8, 9], [8, 9], // 20-25 divider gaps
  [-8, -17], [8, -17], [0, -17], // 26-28 defender spawn
  [-13, -16], [13, -16], // 29-30 site approach
  [-12, -13], [12, -13], // 31-32 site doors
  [-4, 14], [4, 14], // 33-34 south mid
];

const EDGES = [
  [0, 1], [0, 2], [1, 3], [2, 4], [1, 33], [2, 34], [3, 5], [4, 15], [0, 10], [33, 10], [34, 10],
  [5, 6], [6, 7], [7, 8], [8, 9], [5, 24], [6, 24], [6, 22], [7, 20], [8, 20], [9, 31], [8, 31],
  [10, 11], [11, 12], [12, 13], [13, 14], [10, 24], [10, 25], [11, 22], [11, 23],
  [12, 20], [12, 21], [13, 20], [13, 21], [14, 26], [14, 27], [14, 28], [13, 29], [13, 30],
  [15, 16], [16, 17], [17, 18], [18, 19], [15, 25], [16, 25], [16, 23], [17, 21], [18, 21],
  [19, 32], [18, 32], [26, 28], [27, 28], [26, 29], [27, 30], [29, 31], [30, 32],
  [29, 13], [30, 13], [26, 20], [27, 21], [31, 9], [32, 19],
  [20, 22], [22, 24], [21, 23], [23, 25],
];

export const SITES = [
  { id: 'A', name: 'Fuel Depot', center: new THREE.Vector3(-17, 0, -13), radius: 4.5 },
  { id: 'B', name: 'Signal Tower', center: new THREE.Vector3(17, 0, -13), radius: 4.5 },
];

export const SPAWNS = {
  attackers: [
    { x: -6, z: 17.5, yaw: 0 }, { x: -2, z: 18, yaw: 0 }, { x: 2, z: 18, yaw: 0 },
    { x: 6, z: 17.5, yaw: 0 }, { x: 0, z: 15.5, yaw: 0 },
  ],
  defenders: [
    { x: -8, z: -17.5, yaw: Math.PI }, { x: -3, z: -18, yaw: Math.PI }, { x: 3, z: -18, yaw: Math.PI },
    { x: 8, z: -17.5, yaw: Math.PI }, { x: 0, z: -15.5, yaw: Math.PI },
  ],
};

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' || name === 'rail' ? 0.5 : 0.92,
      metalness: name === 'steel' || name === 'rail' ? 0.35 : 0.03,
    });
  }
  const lampMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });

  const colliders = [];
  const shootables = [];
  const footprints = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      footprints.push({ x0: x - width / 2, z0: z - depth / 2, x1: x + width / 2, z1: z + depth / 2 });
    }
    shootables.push(mesh);
    return mesh;
  }

  function cylinder(radius, height, x, y, z, material, segments = 18) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    footprints.push({ x0: x - radius, z0: z - radius, x1: x + radius, z1: z + radius });
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter: 48 x 40 m, walls 5 m high.
  box(48.6, 0.4, 40.6, 0, -0.2, 0, 'ground');
  box(0.6, 5, 40.6, -24.3, 2.5, 0, 'surface');
  box(0.6, 5, 40.6, 24.3, 2.5, 0, 'surface');
  box(48.6, 5, 0.6, 0, 2.5, -20.3, 'surface');
  box(48.6, 5, 0.6, 0, 2.5, 20.3, 'surface');

  // Divider walls at x = +-8, gaps at z in [-11,-5], [-1,3], [7,11]: the choke points.
  for (const side of [-8, 8]) {
    box(0.4, 3.2, 9, side, 1.6, -15.5, 'surface');
    box(0.4, 3.2, 4, side, 1.6, -3, 'surface');
    box(0.4, 3.2, 4, side, 1.6, 5, 'surface');
    box(0.4, 3.2, 9, side, 1.6, 15.5, 'surface');
  }

  // Mid rail line: rails and sleepers down x = 0, two boxcars as the mid cover.
  box(0.18, 0.12, 36, -0.8, 0.06, 0, 'rail', false);
  box(0.18, 0.12, 36, 0.8, 0.06, 0, 'rail', false);
  for (let z = -17; z <= 17; z += 2) box(2.2, 0.08, 0.5, 0, 0.04, z, 'wood', false);
  box(3.2, 3, 8, 0, 1.5, -5, 'rust');
  box(3.2, 3, 8, 0, 1.5, 7, 'steel');
  box(6, 0.5, 4, 0, 0.25, 0, 'surface');

  // West lane: containers, one stacked pair.
  box(2.4, 2.4, 6, -19, 1.2, -8, 'steel');
  box(2.4, 2.4, 6, -19, 1.2, 2, 'rust');
  box(2.4, 2.4, 6, -19, 1.2, -2, 'steel');
  box(2.4, 2.4, 6, -19, 3.6, -2, 'rust');
  box(1.2, 1.2, 1.2, -15.5, 0.6, -6, 'wood');
  box(1.2, 1.2, 1.2, -15.5, 0.6, 6, 'wood');
  box(1.2, 1.2, 1.2, -15.5, 1.8, 6, 'wood');

  // East lane: crate yard.
  box(1.2, 1.2, 1.2, 19, 0.6, 4, 'wood');
  box(1.2, 1.2, 1.2, 19, 1.8, 4, 'wood');
  box(1.2, 1.2, 1.2, 19, 0.6, 6.5, 'wood');
  box(2.4, 1.2, 1.2, 16.5, 0.6, -6, 'wood');
  box(1.2, 1.2, 1.2, 15.5, 0.6, 6, 'wood');
  box(1.2, 1.2, 1.2, 15.5, 0.6, -16, 'wood');

  // Site A, fuel depot: two tanks and a pipe run.
  cylinder(1.6, 3, -19.5, 1.5, -15.5, 'steel');
  cylinder(1.6, 3, -14.5, 1.5, -15.5, 'rust');
  box(0.3, 0.3, 8, -17, 0.5, -11, 'rail');
  box(1.2, 1.2, 1.2, -20, 0.6, -9, 'wood');

  // Site B, signal tower: legs, cross beams, control hut.
  for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
    box(0.35, 7, 0.35, 17 + dx, 3.5, -15 + dz, 'rail');
  }
  box(3.4, 0.3, 3.4, 17, 6.8, -15, 'rail');
  box(0.5, 0.5, 0.5, 17, 7.2, -15, 'accent');
  box(4, 2.6, 3, 20.5, 1.3, -16.5, 'surface');

  // Gantry crane across mid, floodlight poles, skyline silhouettes outside the walls.
  box(0.8, 6, 0.8, -20, 3, 0, 'rail');
  box(0.8, 6, 0.8, 20, 3, 0, 'rail');
  box(40.8, 0.6, 0.8, 0, 6.2, 0, 'rail');
  for (const [x, z] of [[-22, -18], [22, -18], [-22, 18], [22, 18]]) {
    box(0.25, 5.5, 0.25, x, 2.75, z, 'rail');
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.7), lampMaterial);
    lamp.position.set(x, 5.6, z);
    group.add(lamp);
  }
  for (const [x, z, w, h, d] of [[-34, -8, 8, 12, 8], [34, 6, 10, 16, 8], [-30, 14, 6, 9, 6], [30, -14, 8, 11, 8], [0, -32, 14, 18, 8]]) {
    const sil = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials.canvas);
    sil.position.set(x, h / 2, z);
    group.add(sil);
  }

  // Light: a low amber sun from the west, a cool fill, and a dusk sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#3d4a5c'), new THREE.Color(PALETTE.ground), 1.6);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 3.2);
  sun.position.set(-26, 12, 10);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.defender), 1.0);
  fill.position.set(14, 10, -12);
  scene.add(fill);

  // Waypoint adjacency, built once from the edge list.
  const adjacency = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  return {
    colliders,
    shootables,
    footprints,
    adjacency,
    nodes: NODES,
    sites: SITES,
    spawns: SPAWNS,
    group,
    nearestNode(x, z) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < NODES.length; i += 1) {
        const dx = NODES[i][0] - x;
        const dz = NODES[i][1] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    inSite(position, site) {
      const dx = position.x - site.center.x;
      const dz = position.z - site.center.z;
      return dx * dx + dz * dz <= site.radius * site.radius;
    },
  };
}

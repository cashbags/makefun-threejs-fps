// The human player: one body in the shared mover, plus look and recoil.
// Keys are read in main.js and turned into a mover input each fixed step.
import { createBody, createMover } from './mover.js';

export function createPlayer(colliders, spawn) {
  const mover = createMover(colliders);
  const body = createBody(spawn.x, spawn.z, spawn.yaw);

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  return {
    state: body,
    look,
    recoil,
    step(dt, input) {
      mover.step(body, dt, input);
    },
    groundSpeed() {
      return mover.groundSpeed(body);
    },
    reset(spawnPoint) {
      body.position.set(spawnPoint.x, 0, spawnPoint.z);
      body.velocity.set(0, 0, 0);
      body.yaw = spawnPoint.yaw;
      body.pitch = 0;
      body.crouching = false;
      body.height = 1.72;
      body.eye = 1.6;
    },
  };
}

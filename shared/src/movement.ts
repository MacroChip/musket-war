import {
  CHARGE_SPEED,
  CHARGE_TURN_RATE,
  CRAWL_SPEED,
  FIELD_HALF_X,
  FIELD_HALF_Z,
  RETREAT_SPEED,
  WALK_SPEED,
} from './constants';
import { clamp, turnToward } from './math';

/**
 * How a body is allowed to move this instant. Both the server (from
 * authoritative state) and the client (from predicted state) compute the same
 * mode, so prediction stays honest.
 */
export type MoveMode =
  | 'walk'
  | 'crawl'
  | 'flee' // retreater during the retreat phase (slightly faster than walk)
  | 'charge' // pursuer after the whistle: auto-sprint, limited steering
  | 'frozen'; // reloading, reviving, trapped, fixing bayonets, between rounds

export interface MoveBody {
  x: number;
  z: number;
  yaw: number;
}

export interface MoveInput {
  mx: number; // strafe right +
  my: number; // forward +
  yaw: number; // desired facing from the mouse
}

/**
 * Advance a body by dt seconds. Movement is intentionally simple kinematics —
 * a flat field with boundary clamping. Facing is decoupled from velocity
 * except while charging, where the mouse only steers.
 */
export function stepBody(body: MoveBody, input: MoveInput, mode: MoveMode, dt: number): void {
  if (mode === 'frozen') {
    // You may still look around while frozen (except charging handles its own yaw).
    body.yaw = input.yaw;
    clampToField(body);
    return;
  }

  if (mode === 'charge') {
    body.yaw = turnToward(body.yaw, input.yaw, CHARGE_TURN_RATE * dt);
    body.x += Math.sin(body.yaw) * CHARGE_SPEED * dt;
    body.z += Math.cos(body.yaw) * CHARGE_SPEED * dt;
    clampToField(body);
    return;
  }

  const speed = mode === 'crawl' ? CRAWL_SPEED : mode === 'flee' ? RETREAT_SPEED : WALK_SPEED;
  body.yaw = input.yaw;

  let mx = clamp(input.mx, -1, 1);
  let my = clamp(input.my, -1, 1);
  const len = Math.hypot(mx, my);
  if (len > 1e-6) {
    mx /= Math.max(1, len);
    my /= Math.max(1, len);
    // Move relative to facing: my is "toward where I look".
    const sin = Math.sin(body.yaw);
    const cos = Math.cos(body.yaw);
    body.x += (my * sin + mx * cos) * speed * dt;
    body.z += (my * cos - mx * sin) * speed * dt;
  }
  clampToField(body);
}

export function clampToField(body: MoveBody): void {
  body.x = clamp(body.x, -FIELD_HALF_X, FIELD_HALF_X);
  body.z = clamp(body.z, -FIELD_HALF_Z, FIELD_HALF_Z);
}

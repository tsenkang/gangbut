import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { q4, v3 } from '../physics/Physics';

// ------------------------------------------------------------
// "Músculos": em vez de animações prontas, cada pedaço do corpo
// tenta girar até uma pose alvo. A força (0..1) decide o quanto ele
// consegue: força 1 = boneco firme, força ~0 = boneco mole (nocaute).
//
// Fazemos isso misturando a velocidade de giro atual com a
// velocidade que levaria até a pose. É simples e muito estável.
// ------------------------------------------------------------

const cq = new THREE.Quaternion();
const eq = new THREE.Quaternion();
const axis = new THREE.Vector3();
const cur = new THREE.Vector3();
const want = new THREE.Vector3();
const w = new THREE.Vector3();

function blendAngvel(body: RAPIER.RigidBody, target: THREE.Vector3, s: number, maxW: number) {
  if (target.lengthSq() > maxW * maxW) target.setLength(maxW);
  v3(body.angvel(), w);
  w.lerp(target, Math.min(1, Math.max(0, s)));
  body.setAngvel(w, true);
}

/** Gira o corpo até a orientação alvo (inclui o "para onde está virado"). */
export function muscleOrient(body: RAPIER.RigidBody, target: THREE.Quaternion, s: number, k = 14, maxW = 22) {
  if (s <= 0.0001) return;
  q4(body.rotation(), cq);
  eq.copy(target).multiply(cq.invert());
  if (eq.w < 0) eq.set(-eq.x, -eq.y, -eq.z, -eq.w);
  const angle = 2 * Math.acos(Math.min(1, eq.w));
  const sinHalf = Math.sqrt(Math.max(0, 1 - eq.w * eq.w));
  if (sinHalf < 1e-4) axis.set(0, 0, 0);
  else axis.set(eq.x / sinHalf, eq.y / sinHalf, eq.z / sinHalf).multiplyScalar(angle * k);
  blendAngvel(body, axis, s, maxW);
}

/**
 * Aponta um eixo do pedaço (ex.: "para baixo" de um braço) para uma
 * direção do mundo. Opcionalmente também acerta o giro em volta do
 * eixo (para os pés apontarem para a frente).
 */
export function muscleAim(
  body: RAPIER.RigidBody,
  localAxis: THREE.Vector3,
  dirWorld: THREE.Vector3,
  s: number,
  k = 16,
  maxW = 26,
  twistFwd?: THREE.Vector3,
) {
  if (s <= 0.0001) return;
  q4(body.rotation(), cq);
  cur.copy(localAxis).applyQuaternion(cq);
  want.copy(dirWorld).normalize();
  axis.crossVectors(cur, want);
  const sinA = axis.length();
  const cosA = cur.dot(want);
  const angle = Math.atan2(sinA, cosA);
  if (sinA > 1e-5) axis.multiplyScalar((angle * k) / sinA);
  else if (cosA < 0) axis.set(1, 0, 0).multiplyScalar(k); // virado ao contrário: escolhe um lado
  else axis.set(0, 0, 0);
  if (twistFwd) {
    // Frente local (z) projetada no plano perpendicular ao eixo.
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(cq);
    f.addScaledVector(cur, -f.dot(cur));
    const t = twistFwd.clone().addScaledVector(cur, -twistFwd.dot(cur));
    if (f.lengthSq() > 1e-4 && t.lengthSq() > 1e-4) {
      f.normalize();
      t.normalize();
      const s2 = new THREE.Vector3().crossVectors(f, t).dot(cur);
      const tw = Math.atan2(s2, f.dot(t));
      axis.addScaledVector(cur, tw * k * 0.5);
    }
  }
  blendAngvel(body, axis, s, maxW);
}

/** Quaternion de "virado para yaw, inclinado pitch/roll". */
export function yawPitchRoll(yaw: number, pitch: number, roll: number, out = new THREE.Quaternion()) {
  return out.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
}

/** Menor diferença entre dois ângulos. */
export function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

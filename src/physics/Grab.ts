import * as THREE from 'three';
import { RAPIER, Physics, type ColliderInfo, v3, q4 } from './Physics';
import { DIM } from '../characters/Ragdoll';

// ------------------------------------------------------------
// Agarrar: cada mão procura algo encostado nela (outro lutador,
// caixa, borda...) e cria uma junta entre a mão e aquele objeto.
// Soltou o botão? A junta some.
// ------------------------------------------------------------

const PRIORITY: Record<string, number> = { fighter: 3, prop: 2, static: 1, hazard: 1 };
const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

export class Hand {
  joint: RAPIER.ImpulseJoint | null = null;
  target: RAPIER.RigidBody | null = null;
  targetInfo: ColliderInfo | null = null;
  /** Ponto onde agarrou (no espaço do objeto agarrado). */
  localAnchor = new THREE.Vector3();
  cooldown = 0;

  constructor(
    public side: 'L' | 'R',
    public fore: RAPIER.RigidBody,
    private physics: Physics,
    private ignoreBit: number,
  ) {}

  /** Posição da mão no mundo. */
  position(out = new THREE.Vector3()) {
    v3(this.fore.translation(), out);
    q4(this.fore.rotation(), tmpQ);
    return out.add(tmpV.set(0, -DIM.handOffset, 0).applyQuaternion(tmpQ));
  }

  /** Ponto agarrado, no mundo. */
  anchorWorld(out = new THREE.Vector3()) {
    if (!this.target) return this.position(out);
    q4(this.target.rotation(), tmpQ);
    return out.copy(this.localAnchor).applyQuaternion(tmpQ).add(v3(this.target.translation(), tmpV));
  }

  holding() {
    return !!this.joint;
  }

  /** Está segurando em algo fixo (borda, parede, corrimão)? */
  holdingStatic() {
    return !!this.target && this.target.isValid() && !this.target.isDynamic();
  }

  tryGrab(): boolean {
    if (this.joint || this.cooldown > 0) return false;
    const p = this.position();
    let best: RAPIER.Collider | null = null;
    let bestScore = -1;
    this.physics.overlapBall(p, DIM.handR + 0.13, this.ignoreBit, (c) => {
      const info = this.physics.getInfo(c);
      if (!info || !info.grabbable || c.isSensor()) return;
      const s = PRIORITY[info.kind] ?? 0;
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    });
    if (!best) return false;
    const col = best as RAPIER.Collider;
    const body = col.parent();
    if (!body) return false;
    // Converte o ponto da mão para o espaço local do objeto.
    q4(body.rotation(), tmpQ).invert();
    this.localAnchor.copy(p).sub(v3(body.translation(), tmpV)).applyQuaternion(tmpQ);
    const data = RAPIER.JointData.spherical(
      { x: 0, y: -DIM.handOffset, z: 0 },
      { x: this.localAnchor.x, y: this.localAnchor.y, z: this.localAnchor.z },
    );
    this.joint = this.physics.world.createImpulseJoint(data, this.fore, body, true);
    this.joint.setContactsEnabled(false);
    this.target = body;
    this.targetInfo = this.physics.getInfo(col) ?? null;
    return true;
  }

  release(cooldown = 0.15) {
    if (this.joint && this.joint.isValid()) this.physics.world.removeImpulseJoint(this.joint, true);
    this.joint = null;
    this.target = null;
    this.targetInfo = null;
    this.cooldown = cooldown;
  }

  update(dt: number) {
    this.cooldown -= dt;
    if (!this.joint) return;
    if (!this.joint.isValid() || !this.target || !this.target.isValid()) {
      this.joint = null;
      this.target = null;
      this.targetInfo = null;
      return;
    }
    // Se esticar demais (puxão forte), a mão escorrega.
    const d = this.position(tmpA).distanceTo(this.anchorWorld(tmpB));
    if (d > 0.9) this.release(0.4);
  }
}

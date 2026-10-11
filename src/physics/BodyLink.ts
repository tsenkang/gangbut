import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

// ------------------------------------------------------------
// Liga um corpo de física a um objeto 3D. A física roda em passo
// fixo; o desenho pode rodar mais rápido, então misturamos a
// posição anterior e a atual (interpolação) para ficar liso.
// ------------------------------------------------------------

export class BodyLink {
  prevPos = new THREE.Vector3();
  prevQuat = new THREE.Quaternion();
  currPos = new THREE.Vector3();
  currQuat = new THREE.Quaternion();

  constructor(
    public body: RAPIER.RigidBody,
    public object: THREE.Object3D,
  ) {
    this.capture();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.apply(1);
  }

  /** Chamado depois de cada passo de física. */
  capture() {
    if (!this.body.isValid()) return;
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Chamado a cada desenho. alpha = quanto já andamos rumo ao próximo passo. */
  apply(alpha: number) {
    this.object.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.object.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }
}

export class LinkSet {
  links: BodyLink[] = [];
  add(body: RAPIER.RigidBody, object: THREE.Object3D) {
    const l = new BodyLink(body, object);
    this.links.push(l);
    return l;
  }
  remove(body: RAPIER.RigidBody) {
    this.links = this.links.filter((l) => l.body !== body);
  }
  capture() {
    for (const l of this.links) l.capture();
  }
  apply(alpha: number) {
    for (const l of this.links) l.apply(alpha);
  }
}

import * as THREE from 'three';
import { RAPIER, Physics, fighterBit, groups, G_ALL } from '../physics/Physics';

// ------------------------------------------------------------
// O corpo de "boneco de pano": 9 pedaços ligados por juntas.
//
//            (cabeça)
//   (braço)–(tronco)–(braço)
//  (antebraço) |   (antebraço)
//          (quadril)
//         (perna)(perna)
//
// As juntas são esféricas (giram para todo lado). Quem mantém o
// boneco em pé são os "músculos" do Fighter.ts, não as juntas.
// ------------------------------------------------------------

export type PartName = 'head' | 'chest' | 'pelvis' | 'armL' | 'armR' | 'foreL' | 'foreR' | 'legL' | 'legR';
export const PART_NAMES: PartName[] = ['pelvis', 'chest', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR'];

/**
 * Medidas do corpo (em metros). Formato de "feijão": pernas curtinhas,
 * cabeça grudada no tronco (sem pescoço) e bracinhos que saem do meio
 * do corpo. O boneco tem ~1,85 m com a cabeça.
 */
export const DIM = {
  hover: 0.58, // altura do quadril em relação ao chão quando em pé
  pelvisR: 0.3,
  pelvisY: 0.58,
  chestR: 0.36,
  chestHH: 0.12,
  chestY: 0.98,
  headR: 0.34,
  headY: 1.5,
  armR: 0.11,
  armHH: 0.12,
  armX: 0.5,
  armY: 1.06,
  foreHH: 0.11,
  foreY: 1.06 - 0.12 - 0.04 - 0.11 - 0.04, // logo abaixo do cotovelo
  handR: 0.14,
  handOffset: 0.2,
  legR: 0.14,
  legHH: 0.08,
  legX: 0.17,
  legY: 0.24,
  /** Juntas: quadril–tronco, tronco–cabeça e quadril–perna (altura). */
  waistJ: 0.76,
  neckJ: 1.26,
  hipJ: 0.24 + 0.08 + 0.12,
};

const MASS: Record<PartName, number> = {
  pelvis: 3,
  chest: 4,
  head: 1.5,
  armL: 0.5,
  armR: 0.5,
  foreL: 0.5,
  foreR: 0.5,
  legL: 1,
  legR: 1,
};

/** Massa total do boneco (as mãos têm 0,15 cada). */
export const BODY_MASS = Object.values(MASS).reduce((a, b) => a + b, 0) + 0.3;

export interface Part {
  name: PartName;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export class Ragdoll {
  parts = {} as Record<PartName, Part>;
  joints: RAPIER.ImpulseJoint[] = [];
  bit: number;

  constructor(
    private physics: Physics,
    public index: number,
    origin: THREE.Vector3,
    yaw: number,
    owner: unknown,
  ) {
    this.bit = fighterBit(index);
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const world = physics.world;
    const colGroups = groups(this.bit, G_ALL & ~this.bit);

    const make = (name: PartName, local: THREE.Vector3, shape: RAPIER.ColliderDesc, friction: number) => {
      const p = local.clone().applyQuaternion(rot).add(origin);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setRotation(rot)
          .setLinearDamping(0.15)
          .setAngularDamping(1.2)
          .setCanSleep(false)
          .setCcdEnabled(name === 'head' || name === 'chest' || name === 'pelvis'),
      );
      const collider = world.createCollider(
        shape.setMass(MASS[name]).setFriction(friction).setRestitution(0.1).setCollisionGroups(colGroups),
        body,
      );
      physics.register(collider, { kind: 'fighter', owner, part: name, grabbable: true });
      this.parts[name] = { name, body, collider };
      return body;
    };

    const D = DIM;
    make('pelvis', new THREE.Vector3(0, D.pelvisY, 0), RAPIER.ColliderDesc.ball(D.pelvisR), 0.5);
    make('chest', new THREE.Vector3(0, D.chestY, 0), RAPIER.ColliderDesc.capsule(D.chestHH, D.chestR), 0.6);
    make('head', new THREE.Vector3(0, D.headY, 0), RAPIER.ColliderDesc.ball(D.headR), 0.6);
    for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
      make(('arm' + s) as PartName, new THREE.Vector3(sx * D.armX, D.armY, 0), RAPIER.ColliderDesc.capsule(D.armHH, D.armR), 0.6);
      const fore = make(('fore' + s) as PartName, new THREE.Vector3(sx * D.armX, D.foreY, 0), RAPIER.ColliderDesc.capsule(D.foreHH, D.armR), 0.8);
      // A mão é uma bolinha extra na ponta do antebraço.
      const hand = world.createCollider(
        RAPIER.ColliderDesc.ball(D.handR)
          .setTranslation(0, -D.handOffset, 0)
          .setMass(0.15)
          .setFriction(1)
          .setCollisionGroups(colGroups),
        fore,
      );
      physics.register(hand, { kind: 'fighter', owner, part: 'fore' + s, grabbable: true });
      make(('leg' + s) as PartName, new THREE.Vector3(sx * D.legX, D.legY, 0), RAPIER.ColliderDesc.capsule(D.legHH, D.legR), 0.25);
    }

    // Juntas: ponto de ligação em coordenadas locais de cada pedaço.
    const P = this.parts;
    const joint = (a: PartName, b: PartName, worldAnchor: THREE.Vector3) => {
      const la = { x: worldAnchor.x - this.localPos(a).x, y: worldAnchor.y - this.localPos(a).y, z: worldAnchor.z - this.localPos(a).z };
      const lb = { x: worldAnchor.x - this.localPos(b).x, y: worldAnchor.y - this.localPos(b).y, z: worldAnchor.z - this.localPos(b).z };
      const j = world.createImpulseJoint(RAPIER.JointData.spherical(la, lb), P[a].body, P[b].body, true);
      j.setContactsEnabled(false);
      this.joints.push(j);
    };
    joint('pelvis', 'chest', new THREE.Vector3(0, D.waistJ, 0));
    joint('chest', 'head', new THREE.Vector3(0, D.neckJ, 0));
    for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
      joint('chest', ('arm' + s) as PartName, new THREE.Vector3(sx * (D.armX - 0.03), D.armY + D.armHH + 0.04, 0));
      joint(('arm' + s) as PartName, ('fore' + s) as PartName, new THREE.Vector3(sx * D.armX, D.armY - D.armHH - 0.04, 0));
      joint('pelvis', ('leg' + s) as PartName, new THREE.Vector3(sx * D.legX, D.hipJ, 0));
    }
  }

  /** Posição de cada pedaço na pose inicial (sem girar), para calcular as juntas. */
  private localPos(n: PartName): THREE.Vector3 {
    const D = DIM;
    const sx = n.endsWith('L') ? 1 : -1;
    switch (n) {
      case 'pelvis':
        return new THREE.Vector3(0, D.pelvisY, 0);
      case 'chest':
        return new THREE.Vector3(0, D.chestY, 0);
      case 'head':
        return new THREE.Vector3(0, D.headY, 0);
      case 'armL':
      case 'armR':
        return new THREE.Vector3(sx * D.armX, D.armY, 0);
      case 'foreL':
      case 'foreR':
        return new THREE.Vector3(sx * D.armX, D.foreY, 0);
      default:
        return new THREE.Vector3(sx * D.legX, D.legY, 0);
    }
  }

  bodies(): RAPIER.RigidBody[] {
    return PART_NAMES.map((n) => this.parts[n].body);
  }

  owns(body: RAPIER.RigidBody) {
    return PART_NAMES.some((n) => this.parts[n].body === body);
  }

  dispose() {
    for (const n of PART_NAMES) this.physics.removeBody(this.parts[n].body);
    this.joints = [];
  }
}

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

// ------------------------------------------------------------
// Mundo de física (Rapier) + um "cadastro" de quem é dono de cada
// colisor. Assim, quando uma mão encosta em algo, sabemos se é um
// lutador, uma caixa ou o cenário.
// ------------------------------------------------------------

export { RAPIER };

/** Passo fixo da física: 60 vezes por segundo. */
export const FIXED_DT = 1 / 60;
export const GRAVITY = -19;

// Grupos de colisão (cada bit é um grupo).
export const G_WORLD = 1 << 0;
export const G_PROP = 1 << 1;
/** Cada lutador tem o seu bit (2..5), para não colidir consigo mesmo. */
export const fighterBit = (i: number) => 1 << (2 + i);
export const G_ALL = 0xffff;

/** Junta "quem eu sou" e "com quem eu bato" no formato do Rapier. */
export function groups(membership: number, filter: number) {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export type OwnerKind = 'fighter' | 'prop' | 'static' | 'hazard';

export interface ColliderInfo {
  kind: OwnerKind;
  /** Dono do colisor (o lutador, a caixa...). */
  owner?: unknown;
  /** Nome da parte do corpo (para lutadores). */
  part?: string;
  /** Pode ser agarrado? */
  grabbable: boolean;
}

export class Physics {
  world: RAPIER.World;
  private info = new Map<number, ColliderInfo>();
  /** Funções avisadas quando um corpo vai sumir (para soltar as mãos). */
  private removeListeners: ((body: RAPIER.RigidBody) => void)[] = [];

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.world.numSolverIterations = 6;
  }

  step() {
    this.world.step();
  }

  register(collider: RAPIER.Collider, info: ColliderInfo) {
    this.info.set(collider.handle, info);
  }

  getInfo(collider: RAPIER.Collider): ColliderInfo | undefined {
    return this.info.get(collider.handle);
  }

  onBodyRemoved(fn: (body: RAPIER.RigidBody) => void) {
    this.removeListeners.push(fn);
  }

  /** Remove um corpo com segurança (avisando quem estava segurando ele). */
  removeBody(body: RAPIER.RigidBody) {
    if (!body.isValid()) return;
    for (const fn of this.removeListeners) fn(body);
    for (let i = 0; i < body.numColliders(); i++) this.info.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  /** Cria uma caixa fixa do cenário (chão, parede...). */
  addStaticBox(
    pos: THREE.Vector3Like,
    half: THREE.Vector3Like,
    opts: { rot?: THREE.Quaternion; friction?: number; restitution?: number; grabbable?: boolean; kind?: OwnerKind } = {},
  ) {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    if (opts.rot) desc.setRotation(opts.rot);
    const body = this.world.createRigidBody(desc);
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setFriction(opts.friction ?? 0.9)
        .setRestitution(opts.restitution ?? 0.05)
        .setCollisionGroups(groups(G_WORLD, G_ALL)),
      body,
    );
    this.register(col, { kind: opts.kind ?? 'static', grabbable: opts.grabbable ?? true });
    return { body, collider: col };
  }

  /** Raio para baixo, ignorando um grupo (o próprio lutador). Devolve a distância ou null. */
  rayDown(origin: THREE.Vector3Like, maxDist: number, ignoreBit: number): { dist: number; collider: RAPIER.Collider } | null {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(ignoreBit, G_ALL & ~ignoreBit));
    if (!hit) return null;
    return { dist: hit.timeOfImpact, collider: hit.collider };
  }

  /**
   * Lista colisores que tocam uma bolinha (usado para mão, punho, cabeça).
   * Atenção: primeiro juntamos a lista e só depois chamamos cb, porque
   * mexer em corpos DENTRO da consulta do Rapier dá erro silencioso.
   */
  overlapBall(center: THREE.Vector3Like, radius: number, ignoreBit: number, cb: (c: RAPIER.Collider) => void) {
    const shape = new RAPIER.Ball(radius);
    const found: RAPIER.Collider[] = [];
    this.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      (c) => {
        found.push(c);
        return true;
      },
      undefined,
      groups(ignoreBit, G_ALL & ~ignoreBit),
    );
    for (const c of found) cb(c);
  }

  dispose() {
    this.world.free();
    this.info.clear();
    this.removeListeners = [];
  }
}

// Pequenas ajudas para converter entre Rapier e Three.
export const v3 = (v: { x: number; y: number; z: number }, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);
export const q4 = (q: { x: number; y: number; z: number; w: number }, out = new THREE.Quaternion()) =>
  out.set(q.x, q.y, q.z, q.w);

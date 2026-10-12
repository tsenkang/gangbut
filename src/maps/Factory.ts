import * as THREE from 'three';
import { GameMap, canvasTexture, hazardStripes, type ArenaApi } from './MapBase';
import { grimeTexture } from './City';
import { RAPIER } from '../physics/Physics';
import type { Fighter } from '../characters/Fighter';

// ------------------------------------------------------------
// Mapa 2 — FÁBRICA
// Uma esteira rolante atravessa o galpão e despeja tudo num buraco.
// No meio dela, uma prensa desce de tempos em tempos. A máquina
// também cospe caixas na esteira.
// ------------------------------------------------------------

const BELT_Z = 1.4; // meia largura da esteira
const BELT_X0 = -9.5;
const BELT_X1 = 8.5;
const PRESS_X = 2.4;

export class Factory extends GameMap {
  id = 'fabrica';
  name = 'Fábrica';
  emoji = '🏭';
  description = 'Galpão de uma fábrica de... caixas. Muitas caixas.';
  hazard = 'A esteira leva todo mundo para o buraco e a prensa amassa quem estiver embaixo!';
  music = 'fabrica' as const;
  killY = -7;
  camera = {
    dir: new THREE.Vector3(0, 0.78, 1),
    minDist: 11,
    maxDist: 22,
    fov: 42,
    center: new THREE.Vector3(0, 0.6, 0.3),
    bounds: new THREE.Box3(new THREE.Vector3(-7, 0, -3), new THREE.Vector3(7, 3, 4)),
  };

  private belt!: RAPIER.Collider;
  private beltTex!: THREE.Texture;
  private beltSpeed = 2.2;
  private press!: RAPIER.RigidBody;
  private pressY = 4.6;
  private pressT = 0;
  private pressState: 'idle' | 'warn' | 'slam' | 'hold' | 'rise' = 'idle';
  private lamp!: THREE.MeshStandardMaterial;
  private boxTimer = 3;
  private turboT = 0;
  private turboTimer = 14;
  private gears: THREE.Object3D[] = [];

  build() {
    this.lights({
      skyTop: 0x15141a,
      skyBottom: 0x2e2722,
      fog: { color: 0x221d1c, near: 22, far: 60 },
      sunColor: 0xffd2a0,
      sunIntensity: 1.6,
      sunPos: new THREE.Vector3(6, 18, 10),
      hemiSky: 0x8f9bb5,
      hemiGround: 0x3a2a1e,
      hemiIntensity: 1.15,
      shadowExtent: 14,
    });
    const floorTex = canvasTexture(
      128,
      128,
      (g) => {
        g.fillStyle = '#7d8590';
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = '#6c737d';
        for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
        g.strokeStyle = '#5d636c';
        g.lineWidth = 3;
        g.strokeRect(0, 0, 128, 128);
      },
      [8, 3],
    );
    void floorTex;
    const floor = new THREE.MeshStandardMaterial({ map: grimeTexture('#6a6c70', [7, 3], { tiles: 2, cracks: true, dark: 'rgba(40,20,0,0.18)' }), roughness: 0.85, metalness: 0.2 });
    // Luminárias industriais penduradas (luz quente em cone)
    for (const x of [-5, 0, 5]) {
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.45, 16, 1, true), this.material(0x2f4a3a, { side: THREE.DoubleSide, metalness: 0.5 }));
      shade.position.set(x, 6.2, 0);
      this.deco(shade, false);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
      bulb.position.set(x, 5.95, 0);
      this.deco(bulb, false);
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4, 4), this.material(0x111111));
      wire.position.set(x, 8.4, 0);
      this.deco(wire, false);
      const l = new THREE.PointLight(0xffc27a, 55, 14, 1.6);
      l.position.set(x, 5.7, 0);
      this.ctx.root.add(l);
    }
    // Pisos dos dois lados da esteira (de -8 até 6 em x)
    this.box({ x: -1, y: -0.75, z: 3.5 }, { x: 14, y: 1.5, z: 4.2 }, floor);
    this.box({ x: -1, y: -0.75, z: -3.6 }, { x: 14, y: 1.5, z: 4.4 }, floor);
    // Esteira (um pouco acima do chão)
    this.beltTex = canvasTexture(
      128,
      64,
      (g) => {
        g.fillStyle = '#2b2b2f';
        g.fillRect(0, 0, 128, 64);
        g.fillStyle = '#44444a';
        for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 6, 64);
        g.fillStyle = '#ffcc00';
        g.beginPath();
        g.moveTo(40, 22);
        g.lineTo(70, 32);
        g.lineTo(40, 42);
        g.fill();
      },
      [9, 1],
    );
    const beltMat = new THREE.MeshStandardMaterial({ map: this.beltTex, roughness: 0.6 });
    const { body: beltBody } = this.box({ x: (BELT_X0 + BELT_X1) / 2, y: -0.25, z: 0 }, { x: BELT_X1 - BELT_X0, y: 0.6, z: BELT_Z * 2 }, beltMat, { friction: 0.6 });
    this.belt = beltBody!.collider(0);
    // Bordas amarelas da esteira (baixinhas, dá para tropeçar)
    const stripe = new THREE.MeshStandardMaterial({ map: hazardStripes([20, 1]) });
    for (const z of [-BELT_Z - 0.1, BELT_Z + 0.1]) this.box({ x: (BELT_X0 + BELT_X1) / 2 - 1, y: 0.12, z }, { x: 15, y: 0.25, z: 0.2 }, stripe);
    // Rolos nas pontas
    for (const x of [BELT_X0, BELT_X1]) {
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, BELT_Z * 2 + 0.2, 16), this.material(0x888888, { metalness: 0.8, roughness: 0.3 }));
      roll.rotation.x = Math.PI / 2;
      roll.position.set(x, -0.25, 0);
      this.deco(roll);
    }

    // Máquina que cospe caixas (lado esquerdo)
    const machine = this.material(0x3a7bd5, { metalness: 0.4, roughness: 0.5 });
    this.box({ x: -10.2, y: 1.6, z: 0 }, { x: 2, y: 4, z: 3.6 }, machine);
    this.box({ x: -9.2, y: 2.2, z: 0 }, { x: 0.2, y: 1.6, z: 2.2 }, 0x111111, { collide: false });
    // Parede do fundo com janelas
    const wallTex = canvasTexture(256, 128, (g) => {
      g.fillStyle = '#8a4b3a';
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#7a3f30';
      for (let y = 0; y < 128; y += 8) for (let x = (y / 8) % 2 ? 0 : 8; x < 256; x += 16) g.fillRect(x, y, 15, 7);
      g.fillStyle = '#ffe9b0';
      for (let x = 20; x < 256; x += 60) g.fillRect(x, 20, 36, 40);
    });
    wallTex.wrapS = THREE.RepeatWrapping;
    wallTex.repeat.set(3, 1);
    this.box({ x: 0, y: 4, z: -6.1 }, { x: 30, y: 10, z: 0.4 }, new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, emissive: 0x332211, emissiveMap: wallTex, emissiveIntensity: 0.4 }));
    // Canos e engrenagens (cenário)
    const pipe = this.material(0xb5651d, { metalness: 0.6, roughness: 0.4 });
    for (const y of [5.5, 6.4]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 30, 10), pipe);
      p.rotation.z = Math.PI / 2;
      p.position.set(0, y, -5.6);
      this.deco(p);
    }
    for (const [x, y, r] of [
      [-6, 3.2, 1.2],
      [-3.8, 3.8, 0.7],
      [6.5, 3.4, 1],
    ]) {
      const gear = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.25, 12), this.material(0xd4a017, { metalness: 0.7, roughness: 0.35 }));
      gear.rotation.x = Math.PI / 2;
      gear.position.set(x, y, -5.7);
      this.deco(gear);
      this.gears.push(gear);
    }
    // Pilha de paletes para subir (lado de trás)
    this.box({ x: -5.5, y: 0.45, z: -4.4 }, { x: 2.2, y: 0.9, z: 1.6 }, 0xa0522d);
    this.box({ x: -5.5, y: 1.25, z: -4.6 }, { x: 1.6, y: 0.7, z: 1.2 }, 0xa0522d);
    // Corrimão do fundo (dá para se pendurar na beira do buraco)
    const rail = this.material(0xffcc00, { metalness: 0.5 });
    this.box({ x: 6, y: 1.1, z: -5.6 }, { x: 0.12, y: 2.2, z: 0.12 }, rail);
    this.box({ x: 5.95, y: 0.6, z: 3.5 }, { x: 0.1, y: 0.1, z: 4 }, rail);
    for (const z of [1.7, 5.3]) this.box({ x: 5.95, y: 0.3, z }, { x: 0.1, y: 0.6, z: 0.1 }, rail);
    // Buraco escuro embaixo (cenário)
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshBasicMaterial({ color: 0x0b0710 }));
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = -9;
    this.deco(pit, false);

    // A prensa
    const pressGroup = new THREE.Group();
    const steel = this.material(0x9aa3ad, { metalness: 0.8, roughness: 0.3 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 2.6), steel);
    pressGroup.add(head);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 2.7), new THREE.MeshStandardMaterial({ map: hazardStripes([4, 1]) }));
    plate.position.y = -0.5;
    pressGroup.add(plate);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 8, 12), steel);
    rod.position.y = 4.5;
    pressGroup.add(rod);
    this.press = this.kinematic(new THREE.Vector3(PRESS_X, this.pressY, 0), RAPIER.ColliderDesc.cuboid(1.2, 0.5, 1.3), pressGroup, { grabbable: false });
    // Lâmpada de aviso
    this.lamp = new THREE.MeshStandardMaterial({ color: 0x22ff66, emissive: 0x22ff66, emissiveIntensity: 1 });
    const lampMesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), this.lamp);
    lampMesh.position.set(PRESS_X, 7.2, -1.6);
    this.deco(lampMesh, false);
    const frame = this.material(0x444a52, { metalness: 0.6 });
    for (const z of [-1.7]) this.box({ x: PRESS_X, y: 3.6, z: z * 1.05 }, { x: 0.4, y: 7.6, z: 0.3 }, frame, { collide: false });
    this.box({ x: PRESS_X, y: 7.5, z: -0.9 }, { x: 0.6, y: 0.4, z: 2 }, frame, { collide: false });

    // Caixas iniciais
    this.prop('caixa', new THREE.Vector3(-2, 0.5, 3.2));
    this.prop('barril', new THREE.Vector3(3, 0.5, -3.8), 0xd94a3a);
    this.prop('caixa', new THREE.Vector3(-1, 0.5, -3.2), 0x8fbf5a);

    this.spawns = [new THREE.Vector3(-4, 0.08, 3.2), new THREE.Vector3(1.5, 0.08, 3.6), new THREE.Vector3(-4, 0.08, -3.2), new THREE.Vector3(1.5, 0.08, -3.4)];
  }

  update(dt: number, time: number, arena: ArenaApi) {
    // ----- esteira (de vez em quando acelera)
    this.turboTimer -= dt;
    if (this.turboTimer <= 0 && this.turboT <= 0) {
      this.turboT = 4;
      this.turboTimer = 12 + Math.random() * 6;
      arena.announce('⚡ ESTEIRA ACELERANDO!', 'tip');
      arena.sound('alarm', 0.6);
    }
    this.turboT -= dt;
    const speed = this.turboT > 0 ? 4.2 : this.beltSpeed;
    this.beltTex.offset.x -= (speed * dt) / 2;
    const k = 0.14;
    for (const f of arena.fighters) {
      if (f.removed) continue;
      if (f.groundCollider && f.groundCollider.handle === this.belt.handle) pushFighter(f, speed * k);
    }
    for (const p of this.ctx.props) {
      if (!p.body.isValid()) continue;
      const t = p.body.translation();
      if (t.x > BELT_X0 && t.x < BELT_X1 + 0.3 && Math.abs(t.z) < BELT_Z && t.y < 1) {
        const v = p.body.linvel();
        p.body.setLinvel({ x: v.x + (speed - v.x) * 0.2, y: v.y, z: v.z }, true);
      }
    }
    for (const g of this.gears) g.rotation.y = time * (this.turboT > 0 ? 3 : 1.4);

    // ----- máquina cospe caixas
    this.boxTimer -= dt;
    if (this.boxTimer <= 0) {
      this.boxTimer = 4 + Math.random() * 3;
      if (this.ctx.props.length < 9) {
        const kind = Math.random() < 0.75 ? 'caixa' : 'barril';
        const p = this.prop(kind, new THREE.Vector3(-8.6, 1.2, (Math.random() - 0.5) * 1.2), kind === 'caixa' ? undefined : 0x2b7bb9);
        p.body.setLinvel({ x: 2.5, y: 0, z: 0 }, true);
        arena.sound('boing', 0.3, 0.6);
      }
    }

    // ----- prensa
    this.pressT += dt;
    const top = 4.6;
    const bottom = 1.05;
    switch (this.pressState) {
      case 'idle':
        this.lamp.color.setHex(0x22ff66);
        this.lamp.emissive.setHex(0x22ff66);
        if (this.pressT > 3.5) this.setPress('warn');
        break;
      case 'warn': {
        const on = Math.floor(this.pressT * 8) % 2 === 0;
        this.lamp.color.setHex(on ? 0xff2222 : 0x330000);
        this.lamp.emissive.setHex(on ? 0xff2222 : 0x000000);
        if (Math.floor(this.pressT * 4) !== Math.floor((this.pressT - dt) * 4)) arena.sound('alarm', 0.4);
        this.pressY = top + Math.sin(this.pressT * 50) * 0.03; // treme antes de cair
        if (this.pressT > 1.3) this.setPress('slam');
        break;
      }
      case 'slam':
        this.pressY = Math.max(bottom, this.pressY - dt * 22);
        if (this.pressY <= bottom) {
          this.setPress('hold');
          arena.sound('clank', 1);
          arena.shake(0.6);
          arena.effects.dust(new THREE.Vector3(PRESS_X, 0.2, 0), 2.5, 0xbbbbbb);
          this.crush(arena);
        }
        break;
      case 'hold':
        if (this.pressT > 0.7) this.setPress('rise');
        break;
      case 'rise':
        this.pressY = Math.min(top, this.pressY + dt * 2.6);
        if (this.pressY >= top) this.setPress('idle');
        break;
    }
    this.press.setNextKinematicTranslation({ x: PRESS_X, y: this.pressY, z: 0 });
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // Prensa avisando ou descendo: sai de baixo dela
    const danger = this.pressState === 'warn' || this.pressState === 'slam' || (this.pressState === 'idle' && this.pressT > 2.8);
    if (danger && Math.abs(p.x - PRESS_X) < 2.2 && Math.abs(p.z) < 2.4) {
      return new THREE.Vector3(p.x, 0, p.z >= 0 ? 3.4 : -3.4);
    }
    // Em cima da esteira perto do buraco: sai dela
    if (Math.abs(p.z) < BELT_Z + 0.2 && p.x > 2) return new THREE.Vector3(p.x - 1.5, 0, p.z >= 0 ? 3.2 : -3.2);
    return null;
  }

  private setPress(s: Factory['pressState']) {
    this.pressState = s;
    this.pressT = 0;
  }

  /** Quem estava embaixo da prensa leva um baita golpe. */
  private crush(arena: ArenaApi) {
    for (const f of arena.fighters) {
      if (!f.alive || f.removed) continue;
      const p = f.pos('chest');
      if (Math.abs(p.x - PRESS_X) < 1.5 && Math.abs(p.z) < 1.6 && p.y < 2.4) {
        const side = new THREE.Vector3(Math.sign(p.x - PRESS_X) || 1, 0.5, Math.sign(p.z) || 1).normalize();
        arena.hazardHit(f, 75, side, 6, 'AMASSADO!');
        f.knockOut();
      }
    }
  }
}

/** Empurra um lutador junto com a esteira. */
function pushFighter(f: Fighter, dv: number) {
  for (const b of f.ragdoll.bodies()) {
    const v = b.linvel();
    b.setLinvel({ x: v.x + dv, y: v.y, z: v.z }, true);
  }
}

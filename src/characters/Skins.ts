import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DIM, type PartName } from './Ragdoll';
import { applyCostume, COVERS_HAT, type CostumeId } from './Costumes';

// ------------------------------------------------------------
// Aparência dos lutadores: os 4 personagens, as cores e os chapéus.
// Tudo é feito com formas simples do Three.js (nada de arquivos).
// Cada parte do corpo vira um "grupo" 3D que segue o corpo físico.
// ------------------------------------------------------------

export type CharacterId = 'classico' | 'gominha' | 'pao' | 'ovo' | 'pimentao';
export type HatId = 'nenhum' | 'festa' | 'cartola' | 'gorro';

export interface CharacterDef {
  id: CharacterId;
  name: string;
  description: string;
  defaultColor: number;
  /** Tom da voz (para o grito). */
  voice: number;
}

export const CHARACTERS: CharacterDef[] = [
  { id: 'classico', name: 'Clássico', description: 'Feijãozinho de gelatina: o molenga raiz, liso e fofo.', defaultColor: 0x3a86ff, voice: 1.1 },
  { id: 'gominha', name: 'Gominha', description: 'Ursinho de goma, brilhante e pulador.', defaultColor: 0xff4d5e, voice: 1.25 },
  { id: 'pao', name: 'Pão de Forma', description: 'Quadradão e fofinho. Cheira a café da manhã.', defaultColor: 0xe9b872, voice: 0.85 },
  { id: 'ovo', name: 'Ovo', description: 'Liso, redondo e um pouco frágil.', defaultColor: 0xf4f1ea, voice: 1.05 },
  { id: 'pimentao', name: 'Pimentão', description: 'Cheio de gomos e de atitude.', defaultColor: 0x3ddc84, voice: 0.95 },
];

export const COLORS: { name: string; hex: number }[] = [
  { name: 'Vermelho', hex: 0xff4d5e },
  { name: 'Laranja', hex: 0xff9f1c },
  { name: 'Amarelo', hex: 0xffd23f },
  { name: 'Verde', hex: 0x3ddc84 },
  { name: 'Azul', hex: 0x3a86ff },
  { name: 'Roxo', hex: 0x9b5de5 },
  { name: 'Rosa', hex: 0xff70a6 },
  { name: 'Branco', hex: 0xf4f1ea },
  { name: 'Pão', hex: 0xe9b872 },
];

export const HATS: { id: HatId; name: string }[] = [
  { id: 'nenhum', name: 'Sem chapéu' },
  { id: 'festa', name: 'Chapéu de festa' },
  { id: 'cartola', name: 'Cartola' },
  { id: 'gorro', name: 'Gorro' },
];

export interface Appearance {
  character: CharacterId;
  color: number;
  hat: HatId;
  costume?: CostumeId;
}

/** Peças do rosto, para mudar a expressão (olhos em X no nocaute...). */
export interface Face {
  pupils: THREE.Object3D[];
  xEyes: THREE.Object3D[];
  eyes: THREE.Object3D[];
  mouth: THREE.Object3D;
  mouthO: THREE.Object3D;
}

export interface SkinResult {
  parts: Record<PartName, THREE.Group>;
  face: Face;
  materials: THREE.Material[];
}

// Geometrias compartilhadas (criadas uma vez só).
const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}
const sphere = (r: number) => cached('s' + r, () => new THREE.SphereGeometry(r, 24, 16));
const capsule = (r: number, len: number) => cached(`c${r}_${len}`, () => new THREE.CapsuleGeometry(r, len, 8, 16));

function bodyMaterial(char: CharacterId, color: number): THREE.MeshStandardMaterial {
  if (char === 'classico') {
    // Fosco e macio, com um brilho leve de borracha
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, sheen: 0.6, sheenRoughness: 0.5, clearcoat: 0.12, clearcoatRoughness: 0.6 });
  }
  if (char === 'gominha') {
    // Goma: brilhante, parece doce de gelatina.
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.15, sheen: 0.4 });
  }
  if (char === 'ovo') return new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
  if (char === 'pimentao') return new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 0.6 });
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const faceDark = new THREE.MeshStandardMaterial({ color: 0x1a1020, roughness: 0.4 });
const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });

function buildFace(head: THREE.Group, frontZ: number, eyeY: number, scale = 1, dots = false): Face {
  const eyes: THREE.Object3D[] = [];
  const pupils: THREE.Object3D[] = [];
  const xEyes: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * (dots ? 0.1 : 0.115) * scale, eyeY, frontZ - 0.03);
    if (!dots) {
      const white = mesh(sphere(0.085 * scale), eyeWhite);
      white.scale.set(1, 1.15, 0.6);
      eye.add(white);
    }
    // Pupila (no estilo "pontinho", o olho é só ela: oval preta)
    const pupil = mesh(sphere((dots ? 0.042 : 0.045) * scale), faceDark, 0, 0, (dots ? 0.02 : 0.045) * scale);
    if (dots) pupil.scale.set(0.85, 1.35, 0.5);
    else pupil.scale.z = 0.5;
    eye.add(pupil);
    pupils.push(pupil);
    // Olho em X (aparece no nocaute)
    const x = new THREE.Group();
    for (const a of [-1, 1]) {
      const bar = mesh(cached('xbar', () => new THREE.BoxGeometry(0.11, 0.025, 0.02)), faceDark);
      bar.rotation.z = a * Math.PI * 0.25;
      x.add(bar);
    }
    x.position.z = 0.055 * scale;
    x.visible = false;
    eye.add(x);
    xEyes.push(x);
    head.add(eye);
    eyes.push(eye);
  }
  // Boca: um sorrisinho (meio anel) e uma boca em "O" para gritos.
  const mouth = mesh(cached('smile', () => new THREE.TorusGeometry(0.06, 0.016, 6, 12, Math.PI)), faceDark);
  mouth.rotation.z = Math.PI;
  if (dots) mouth.scale.setScalar(0.55);
  mouth.position.set(0, eyeY - 0.13 * scale, frontZ - 0.02);
  head.add(mouth);
  const mouthO = mesh(sphere(0.045), faceDark, 0, eyeY - 0.14 * scale, frontZ - 0.025);
  mouthO.scale.set(1, 1.3, 0.4);
  mouthO.visible = false;
  head.add(mouthO);
  return { eyes, pupils, xEyes, mouth, mouthO };
}

function buildHat(hat: HatId, top: number): THREE.Group | null {
  if (hat === 'nenhum') return null;
  const g = new THREE.Group();
  g.position.y = top;
  if (hat === 'festa') {
    const cone = mesh(
      cached('cone', () => new THREE.ConeGeometry(0.15, 0.36, 16)),
      new THREE.MeshStandardMaterial({ color: 0x7b2ff7, roughness: 0.5, emissive: 0x220044 }),
      0,
      0.16,
      0,
    );
    g.add(cone);
    const pom = mesh(sphere(0.055), new THREE.MeshStandardMaterial({ color: 0xffe14d }), 0, 0.36, 0);
    g.add(pom);
    // Listrinhas
    for (let i = 0; i < 3; i++) {
      const ring = mesh(
        cached('hatring' + i, () => new THREE.TorusGeometry(0.13 - i * 0.04, 0.012, 6, 20)),
        new THREE.MeshStandardMaterial({ color: 0x5ef0ff }),
        0,
        0.04 + i * 0.1,
        0,
      );
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    g.rotation.z = 0.18;
  } else if (hat === 'cartola') {
    const black = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.35 });
    g.add(mesh(cached('brim', () => new THREE.CylinderGeometry(0.27, 0.27, 0.03, 24)), black, 0, 0.0, 0));
    g.add(mesh(cached('tophat', () => new THREE.CylinderGeometry(0.16, 0.17, 0.32, 24)), black, 0, 0.17, 0));
    g.add(
      mesh(cached('band', () => new THREE.CylinderGeometry(0.172, 0.172, 0.06, 24)), new THREE.MeshStandardMaterial({ color: 0xd62246 }), 0, 0.05, 0),
    );
    g.rotation.z = -0.12;
  } else if (hat === 'gorro') {
    const wool = new THREE.MeshStandardMaterial({ color: 0x2ec4b6, roughness: 1 });
    const dome = mesh(cached('beanie', () => new THREE.SphereGeometry(0.27, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)), wool, 0, -0.1, 0);
    g.add(dome);
    const fold = mesh(cached('fold', () => new THREE.TorusGeometry(0.255, 0.05, 8, 24)), new THREE.MeshStandardMaterial({ color: 0xff9f1c, roughness: 1 }), 0, -0.08, 0);
    fold.rotation.x = Math.PI / 2;
    g.add(fold);
    g.add(mesh(sphere(0.08), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 0, 0.2, 0));
  }
  return g;
}

/** Monta todas as peças visuais de um lutador. */
export function buildSkin(app: Appearance): SkinResult {
  const mat = bodyMaterial(app.character, app.color);
  const darker = new THREE.Color(app.color).multiplyScalar(0.72);
  const mat2 = (mat.clone() as THREE.MeshStandardMaterial);
  mat2.color = darker;
  const materials: THREE.Material[] = [mat, mat2];

  const parts = {} as Record<PartName, THREE.Group>;
  for (const n of ['head', 'chest', 'pelvis', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR'] as PartName[]) parts[n] = new THREE.Group();

  // Braços e pernas (bracinhos de luva). O Clássico tem membros mais
  // curtos e gordinhos, e pés da mesma cor do corpo.
  const fat = app.character === 'classico';
  for (const side of ['L', 'R'] as const) {
    parts[('arm' + side) as PartName].add(mesh(capsule(DIM.armR + (fat ? 0.045 : 0.015), DIM.armHH * 2), mat));
    const fore = parts[('fore' + side) as PartName];
    fore.add(mesh(capsule(DIM.armR + (fat ? 0.04 : 0.01), DIM.foreHH * 2), mat));
    const hand = mesh(sphere(fat ? 0.155 : 0.135), mat, 0, -DIM.handOffset, 0);
    hand.scale.set(1, 0.95, 1.1);
    fore.add(hand);
    const leg = parts[('leg' + side) as PartName];
    leg.add(mesh(capsule(DIM.legR + (fat ? 0.07 : 0.02), DIM.legHH * 2 - (fat ? 0.06 : 0)), mat));
    const foot = mesh(sphere(fat ? 0.18 : 0.15), fat ? mat : mat2, 0, -DIM.legHH - (fat ? 0.04 : 0.08), 0.05);
    foot.scale.set(1, fat ? 0.7 : 0.6, fat ? 1.2 : 1.35);
    leg.add(foot);
  }

  // Quadril: bolinha que fecha o "feijão" por baixo.
  const pelvis = mesh(sphere(0.33), mat);
  pelvis.scale.set(1.05, 0.9, 1);
  parts.pelvis.add(pelvis);

  const head = parts.head;
  const chest = parts.chest;
  let face: Face;
  let headTop = 0.32;
  let frontZ = 0.32;

  switch (app.character) {
    case 'classico': {
      // Um feijão só: tronco alto + cabeça redonda grudada (sem pescoço)
      const body = mesh(capsule(0.41, 0.5), mat);
      body.position.y = 0.06;
      chest.add(body);
      const top = mesh(sphere(0.39), mat, 0, -0.04, 0);
      top.scale.set(1.02, 1, 0.98);
      head.add(top);
      face = buildFace(head, 0.37, 0.03, 1, true);
      headTop = 0.35;
      frontZ = 0.37;
      break;
    }
    case 'gominha': {
      chest.add(mesh(capsule(0.37, 0.34), mat));
      head.add(mesh(sphere(0.34), mat));
      for (const sx of [-1, 1]) head.add(mesh(sphere(0.11), mat, sx * 0.24, 0.24, -0.02));
      const muzzle = mesh(sphere(0.13), mat2, 0, -0.1, 0.27);
      muzzle.scale.set(1.3, 0.8, 0.7);
      head.add(muzzle);
      // barriguinha mais clara
      const belly = mesh(sphere(0.24), mat2, 0, -0.02, 0.2);
      belly.scale.set(1, 1.2, 0.5);
      chest.add(belly);
      face = buildFace(head, 0.33, 0.06);
      frontZ = 0.33;
      headTop = 0.3;
      break;
    }
    case 'pao': {
      const crust = new THREE.MeshStandardMaterial({ color: darker.clone().multiplyScalar(0.85), roughness: 0.9 });
      const crumb = new THREE.MeshStandardMaterial({ color: 0xfff1d0, roughness: 1 });
      materials.push(crust, crumb);
      chest.add(mesh(cached('paoChest', () => new RoundedBoxGeometry(0.76, 0.78, 0.6, 4, 0.18)), mat));
      // Cabeça = fatia de pão: casca + miolo na frente
      const slice = mesh(cached('paoHead', () => new RoundedBoxGeometry(0.66, 0.6, 0.5, 4, 0.16)), crust);
      head.add(slice);
      const top1 = mesh(sphere(0.2), crust, -0.14, 0.2, 0);
      top1.scale.set(1, 0.7, 1.2);
      const top2 = top1.clone();
      top2.position.x = 0.14;
      head.add(top1, top2);
      const inner = mesh(cached('paoInner', () => new RoundedBoxGeometry(0.56, 0.5, 0.06, 2, 0.03)), crumb, 0, -0.01, 0.24);
      head.add(inner);
      face = buildFace(head, 0.3, 0.04);
      frontZ = 0.3;
      headTop = 0.33;
      break;
    }
    case 'ovo': {
      const c = mesh(sphere(0.4), mat);
      c.scale.set(0.95, 1.2, 0.9);
      chest.add(c);
      const h = mesh(sphere(0.33), mat);
      h.scale.set(0.95, 1.12, 0.95);
      head.add(h);
      // "gema" na barriga
      const yolk = mesh(sphere(0.16), new THREE.MeshStandardMaterial({ color: 0xffb703, roughness: 0.3 }), 0, -0.04, 0.3);
      yolk.scale.set(1, 1, 0.45);
      chest.add(yolk);
      face = buildFace(head, 0.32, 0.06);
      headTop = 0.36;
      break;
    }
    case 'pimentao': {
      // Gomos: várias bolinhas juntas
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const lobe = mesh(sphere(0.27), mat, Math.cos(a) * 0.14, 0, Math.sin(a) * 0.12);
        lobe.scale.set(1, 1.45, 1);
        chest.add(lobe);
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const lobe = mesh(sphere(0.22), mat, Math.cos(a) * 0.11, 0, Math.sin(a) * 0.1);
        lobe.scale.set(1, 1.2, 1);
        head.add(lobe);
      }
      const stemMat = new THREE.MeshStandardMaterial({ color: 0x2d6a2e, roughness: 0.6 });
      materials.push(stemMat);
      const stem = mesh(cached('stem', () => new THREE.CylinderGeometry(0.035, 0.06, 0.2, 8)), stemMat, 0.02, 0.32, 0);
      stem.rotation.z = -0.4;
      head.add(stem);
      const cap = mesh(sphere(0.12), stemMat, 0, 0.24, 0);
      cap.scale.set(1.3, 0.35, 1.3);
      head.add(cap);
      face = buildFace(head, 0.32, 0.05);
      headTop = 0.3;
      break;
    }
  }

  const costume = app.costume ?? 'nenhuma';
  const hat = COVERS_HAT.has(costume) ? null : buildHat(app.hat, headTop);
  if (hat) head.add(hat);
  // Fantasia por cima de tudo
  materials.push(...applyCostume(costume, parts, headTop, frontZ, app.character === 'classico' ? { r: 0.43, len: 0.48, y: 0.04 } : undefined));
  // tudo que a fantasia criou também faz sombra
  for (const n of Object.keys(parts) as PartName[]) parts[n].traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));

  return { parts, face: face!, materials };
}

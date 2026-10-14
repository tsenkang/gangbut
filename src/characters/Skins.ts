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
  { id: 'gominha', name: 'Gominha', description: 'Ursinho de goma: orelhinhas, focinho e cinturinha. Brilha que nem bala.', defaultColor: 0xff4d5e, voice: 1.25 },
  { id: 'pao', name: 'Pão de Forma', description: 'Quadradão e fofinho, com casca no topo. Cheira a café da manhã.', defaultColor: 0xe9b872, voice: 0.85 },
  { id: 'ovo', name: 'Ovo', description: 'Largo embaixo, fininho em cima e com a gema à mostra.', defaultColor: 0xf4f1ea, voice: 1.05 },
  { id: 'pimentao', name: 'Pimentão', description: 'Cheio de gomos, de cabinho e de atitude.', defaultColor: 0x3ddc84, voice: 0.95 },
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
  /** Mostra o sorrisinho quando calmo? (o feijão não tem boca) */
  smile: boolean;
}

/** Corpo inteiriço que se deforma seguindo quadril, tronco e cabeça. */
export interface SoftBody {
  mesh: THREE.SkinnedMesh;
  bones: Record<'pelvis' | 'chest' | 'head', THREE.Bone>;
  /** Roupas que também dobram com o corpo (camisa, calção). */
  extra: THREE.SkinnedMesh[];
}

export interface SkinResult {
  parts: Record<PartName, THREE.Group>;
  /** Só no feijão: a pele lisa do corpo (os "ossos" seguem as peças). */
  soft?: SoftBody;
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
    // Bala de goma: macio, com brilho suave e um leve "brilho por dentro"
    const c = new THREE.Color(color);
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.42,
      sheen: 1,
      sheenColor: c.clone().lerp(new THREE.Color(0xffffff), 0.55),
      sheenRoughness: 0.35,
      clearcoat: 0.3,
      clearcoatRoughness: 0.35,
      emissive: c.clone().multiplyScalar(0.1),
    });
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
    eye.position.set(sx * (dots ? 0.115 : 0.115) * scale, eyeY, frontZ - (dots ? 0.045 : 0.03));
    if (!dots) {
      const white = mesh(sphere(0.085 * scale), eyeWhite);
      white.scale.set(1, 1.15, 0.6);
      eye.add(white);
    }
    // Pupila (no estilo "pontinho", o olho é só ela: oval preta)
    const pupil = mesh(sphere((dots ? 0.042 : 0.045) * scale), faceDark, 0, 0, (dots ? 0.02 : 0.045) * scale);
    if (dots) pupil.scale.set(0.8, 1.3, 0.55);
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
  if (dots) mouth.visible = false; // estilo feijão: rosto só com os olhinhos
  mouth.position.set(0, eyeY - 0.13 * scale, frontZ - 0.02);
  head.add(mouth);
  const mouthO = mesh(sphere(0.045), faceDark, 0, eyeY - 0.14 * scale, frontZ - 0.025);
  mouthO.scale.set(1, 1.3, 0.4);
  mouthO.visible = false;
  head.add(mouthO);
  return { eyes, pupils, xEyes, mouth, mouthO, smile: !dots };
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

/**
 * Feijão inteiriço: uma malha lisa (sem emendas) com três "ossos" —
 * quadril, tronco e cabeça. Cada pedacinho da pele segue os ossos
 * mais perto dele, então o corpo dobra e amassa como gelatina.
 */
const BEAN_BOTTOM = 0.12;
const BEAN_TOP = 1.92;
/** Raio do feijão numa altura (superelipse: lados quase retos, pontas redondas). */
function beanRadius(y: number) {
  const t = THREE.MathUtils.clamp((y - BEAN_BOTTOM) / (BEAN_TOP - BEAN_BOTTOM), 0, 1);
  const u = (t - 0.5) * 2;
  const base = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.4)), 1 / 2.4);
  return Math.max(0.001, base * (0.5 - 0.055 * t)); // um tiquinho mais estreito em cima
}

/**
 * Formato de cada personagem em cima do feijão básico:
 * mul = engorda/afina por altura (t = 0 pé, 1 topo), square = quão
 * quadrado é (2 = redondo), lobes = gomos em volta (pimentão).
 */
interface BodyShape {
  mul: (t: number) => number;
  square: number;
  lobes: number;
  lobeN: number;
}
const bump = (t: number, c: number, w: number) => Math.exp(-((t - c) * (t - c)) / (w * w));
export const SHAPES: Record<CharacterId, BodyShape> = {
  classico: { mul: () => 1, square: 2, lobes: 0, lobeN: 0 },
  // ursinho de goma: cinturinha e cabeção
  gominha: { mul: (t) => 1 - 0.1 * bump(t, 0.6, 0.09) + 0.04 * bump(t, 0.82, 0.12), square: 2, lobes: 0, lobeN: 0 },
  // pão de forma: quadradão
  pao: { mul: () => 0.93, square: 4.5, lobes: 0, lobeN: 0 },
  // ovo: largo embaixo, fino em cima
  ovo: { mul: (t) => 1.1 - 0.26 * Math.pow(t, 1.6), square: 2, lobes: 0, lobeN: 0 },
  // pimentão: gomos e barriguinha
  pimentao: { mul: (t) => 1 + 0.05 * Math.sin(Math.PI * t), square: 2, lobes: 0.085, lobeN: 4 },
};

/** Raio do corpo numa altura e num ângulo (0 = frente). */
export function bodyRadius(char: CharacterId, y: number, theta = 0) {
  const sh = SHAPES[char];
  const t = THREE.MathUtils.clamp((y - BEAN_BOTTOM) / (BEAN_TOP - BEAN_BOTTOM), 0, 1);
  const c = Math.abs(Math.cos(theta));
  const sn = Math.abs(Math.sin(theta));
  const sq = sh.square === 2 ? 1 : 1 / Math.pow(Math.pow(c, sh.square) + Math.pow(sn, sh.square), 1 / sh.square);
  return beanRadius(y) * sh.mul(t) * sq * (1 + sh.lobes * Math.cos(sh.lobeN * theta));
}

/** Malha de revolução do feijão entre duas alturas, com pesos para os 3 ossos. */
function beanGeometry(y0: number, y1: number, inflate: number, segs: number, char: CharacterId = 'classico') {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= segs; i++) {
    const y = y0 + ((y1 - y0) * i) / segs;
    pts.push(new THREE.Vector2(beanRadius(y) * inflate, y));
  }
  const geo = new THREE.LatheGeometry(pts, 48);
  geo.rotateY(Math.PI); // o meio da textura fica de frente
  if (char !== 'classico') {
    // aplica o formato do personagem (quadrado, ovo, gomos...)
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 1e-5) continue;
      const th = Math.atan2(x, z);
      const k = bodyRadius(char, p.getY(i), th) / Math.max(1e-5, beanRadius(p.getY(i)));
      p.setXYZ(i, x * k, p.getY(i), z * k);
    }
    geo.computeVertexNormals();
  }
  // pesos de cada vértice para cada osso (0 = quadril, 1 = tronco, 2 = cabeça)
  const pos = geo.attributes.position;
  const idx: number[] = [];
  const wts: number[] = [];
  const ss = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const wp = 1 - ss(0.55, 0.95, y);
    const wh = ss(1.12, 1.42, y);
    idx.push(0, 1, 2, 0);
    wts.push(wp, Math.max(0, 1 - wp - wh), wh, 0);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  return geo;
}

function skinnedOn(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], skeleton: THREE.Skeleton) {
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.bind(skeleton, new THREE.Matrix4());
  return mesh;
}

/**
 * Feijão inteiriço: uma malha lisa (sem emendas) com três "ossos" —
 * quadril, tronco e cabeça. Cada pedacinho da pele segue os ossos
 * mais perto dele, então o corpo dobra e amassa como gelatina.
 */
function softBean(mat: THREE.Material, char: CharacterId = 'classico'): SoftBody {
  const mk = (y: number) => {
    const b = new THREE.Bone();
    b.position.set(0, y, 0);
    b.updateMatrixWorld(true);
    return b;
  };
  const bones = { pelvis: mk(DIM.pelvisY), chest: mk(DIM.chestY), head: mk(DIM.headY) };
  const skeleton = new THREE.Skeleton([bones.pelvis, bones.chest, bones.head]);
  const mesh = skinnedOn(beanGeometry(BEAN_BOTTOM, BEAN_TOP, 1, 48, char), mat, skeleton);
  return { mesh, bones, extra: [] };
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

  // Braços e pernas (bracinhos de luva). O Clássico tem membros
  // curtinhos e bem gordinhos, e pés da mesma cor do corpo.
  const fat = true; // bracinhos e perninhas gordinhos (estilo molenga) para todos
  for (const side of ['L', 'R'] as const) {
    parts[('arm' + side) as PartName].add(mesh(capsule(DIM.armR + (fat ? 0.03 : 0.015), DIM.armHH * 2 + 0.06), mat));
    const fore = parts[('fore' + side) as PartName];
    fore.add(mesh(capsule(DIM.armR + (fat ? 0.025 : 0.01), DIM.foreHH * 2 + 0.06), mat));
    const hand = mesh(sphere(fat ? 0.165 : 0.14), mat, 0, -DIM.handOffset, 0);
    hand.scale.set(1, 0.95, 1.1);
    fore.add(hand);
    const leg = parts[('leg' + side) as PartName];
    leg.add(mesh(capsule(DIM.legR + (fat ? 0.04 : 0.01), DIM.legHH * 2), mat));
    const foot = mesh(sphere(fat ? 0.19 : 0.15), fat ? mat : mat2, 0, -DIM.legHH - (fat ? 0.06 : 0.08), 0.06);
    foot.scale.set(1, fat ? 0.62 : 0.6, fat ? 1.25 : 1.35);
    leg.add(foot);
  }

  // Quadril: bolinha que fecha o "feijão" por baixo.
  // (no feijão, tudo tem o mesmo raio: as peças se fundem num corpo liso)
  if (!fat) {
    const pelvis = mesh(sphere(0.36), mat);
    pelvis.scale.set(1.04, 0.85, 1);
    parts.pelvis.add(pelvis);
  }

  const head = parts.head;
  const chest = parts.chest;
  let face: Face;
  let headTop = 0.32;
  let frontZ = 0.32;
  let soft: SoftBody | undefined;

  // Todos têm o corpo inteiriço de gelatina; cada um com seu formato e detalhes.
  soft = softBean(mat, app.character);
  const H = DIM.headY;
  const C = DIM.chestY;
  /** z da frente do corpo numa altura (para grudar rosto e detalhes na pele) */
  const front = (y: number) => bodyRadius(app.character, y, 0);
  headTop = BEAN_TOP - H;
  switch (app.character) {
    case 'classico': {
      face = buildFace(head, 0.4, 0.08, 1.3, true);
      frontZ = 0.42;
      break;
    }
    case 'gominha': {
      // orelhinhas, focinho e barriga mais clara
      for (const sx of [-1, 1]) {
        const ear = mesh(sphere(0.13), mat, sx * 0.27, 0.3, -0.02);
        ear.scale.set(1, 1, 0.75);
        head.add(ear);
        const inner = mesh(sphere(0.07), mat2, sx * 0.27, 0.31, 0.06);
        inner.scale.set(1, 1, 0.5);
        head.add(inner);
      }
      const fz = front(H - 0.05);
      const muzzle = mesh(sphere(0.13), mat2, 0, -0.06, fz - 0.03);
      muzzle.scale.set(1.25, 0.85, 0.55);
      head.add(muzzle);
      head.add(mesh(sphere(0.04), faceDark, 0, -0.01, fz + 0.04));
      const belly = mesh(sphere(0.25), mat2, 0, -0.1, front(C - 0.1) - 0.08);
      belly.scale.set(1, 1.25, 0.4);
      belly.userData.decal = true;
      chest.add(belly);
      face = buildFace(head, front(H + 0.1) + 0.02, 0.1, 1.15);
      face.mouth.visible = false;
      face.smile = false;
      frontZ = front(H + 0.1);
      break;
    }
    case 'pao': {
      // casca mais escura no topo + miolo clarinho na frente
      const crust = new THREE.MeshStandardMaterial({ color: darker.clone().multiplyScalar(0.8), roughness: 0.9 });
      const crumb = new THREE.MeshStandardMaterial({ color: 0xfff1d0, roughness: 1 });
      materials.push(crust, crumb);
      for (const sx of [-1, 1]) {
        const top = mesh(sphere(0.24), crust, sx * 0.17, 0.3, 0);
        top.scale.set(1.05, 0.55, 1.25);
        head.add(top);
      }
      const fz = front(H + 0.05);
      const inner = mesh(cached('paoInner2', () => new RoundedBoxGeometry(0.62, 0.5, 0.05, 2, 0.04)), crumb, 0, 0.04, fz - 0.005);
      head.add(inner);
      face = buildFace(head, fz + 0.06, 0.1, 1.15);
      frontZ = fz + 0.04;
      break;
    }
    case 'ovo': {
      const fz = front(C - 0.05);
      const yolk = mesh(sphere(0.2), new THREE.MeshStandardMaterial({ color: 0xffb703, roughness: 0.25 }), 0, -0.05, fz - 0.035);
      yolk.scale.set(1, 1, 0.38);
      yolk.userData.decal = true;
      chest.add(yolk);
      materials.push(yolk.material as THREE.Material);
      face = buildFace(head, front(H + 0.08) + 0.02, 0.08, 1.15);
      frontZ = front(H + 0.08);
      break;
    }
    case 'pimentao': {
      const stemMat = new THREE.MeshStandardMaterial({ color: 0x2d6a2e, roughness: 0.6 });
      materials.push(stemMat);
      const stem = mesh(cached('stem2', () => new THREE.CylinderGeometry(0.05, 0.08, 0.26, 8)), stemMat, 0.02, headTop + 0.1, 0);
      stem.rotation.z = -0.35;
      head.add(stem);
      const cap = mesh(sphere(0.16), stemMat, 0, headTop - 0.03, 0);
      cap.scale.set(1.4, 0.35, 1.4);
      head.add(cap);
      face = buildFace(head, front(H + 0.08) + 0.03, 0.08, 1.2);
      frontZ = front(H + 0.08);
      break;
    }
  }

  const costume = app.costume ?? 'nenhuma';
  // O feijão tem a cabeça maior: chapéus e fantasias da cabeça crescem junto.
  const hs = 1.15;
  const headBase = head.children.length;
  const hat = COVERS_HAT.has(costume) ? null : buildHat(app.hat, headTop / hs);
  if (hat) head.add(hat);
  // Fantasia por cima de tudo
  materials.push(
    ...applyCostume(costume, parts, headTop / hs, frontZ / hs, { r: 0.51, len: 0.32, y: -0.1 }),
  );
  // Roupa no tronco: esconde o que é "pintado" na barriga (gema, barriguinha)
  if (parts.chest.children.some((c) => c.userData.band)) for (const c of parts.chest.children) if (c.userData.decal) c.visible = false;
  if (soft) {
    for (const n of ['chest', 'pelvis'] as PartName[]) {
      for (const c of [...parts[n].children]) {
        const band = c.userData.band as [number, number] | undefined;
        if (!band) continue;
        parts[n].remove(c);
        const m = (c as THREE.Mesh).material;
        soft.extra.push(skinnedOn(beanGeometry(band[0], band[1], n === 'pelvis' ? 1.045 : 1.035, 24, app.character), m, soft.mesh.skeleton));
      }
    }
  }
  for (const c of head.children.slice(headBase)) {
    c.position.multiplyScalar(hs);
    c.scale.multiplyScalar(hs);
  }
  // tudo que a fantasia criou também faz sombra
  for (const n of Object.keys(parts) as PartName[]) parts[n].traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));

  return { parts, face: face!, materials, soft };
}

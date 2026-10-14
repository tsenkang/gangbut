import * as THREE from 'three';
import type { PartName } from './Ragdoll';
import { DIM } from './Ragdoll';

// ------------------------------------------------------------
// Fantasias de paródia: lembram o visual marcante de gente famosa
// (topete, cabelo maluco, camisa 10...), com nomes de brincadeira.
// São só acessórios por cima do boneco — dá para combinar com
// qualquer personagem e cor.
// ------------------------------------------------------------

export type CostumeId = 'nenhuma' | 'topete' | 'genio' | 'popstar' | 'craque' | 'rainha' | 'pintor';

export const COSTUMES: { id: CostumeId; name: string; hint: string }[] = [
  { id: 'nenhuma', name: 'Sem fantasia', hint: 'Só a gelatina mesmo.' },
  { id: 'topete', name: 'Rei do Topete', hint: 'Topetão, óculos dourados e golão branco.' },
  { id: 'genio', name: 'Gênio Descabelado', hint: 'Cabelo branco espetado e bigodão.' },
  { id: 'popstar', name: 'Astro do Pop', hint: 'Chapéu preto, jaqueta e uma luva brilhante.' },
  { id: 'craque', name: 'Craque Camisa 10', hint: 'Camisa amarela e verde. Dribla todo mundo.' },
  { id: 'rainha', name: 'Majestade', hint: 'Coroa, colar de pérolas e muita pose.' },
  { id: 'pintor', name: 'Bigode Artista', hint: 'Boina vermelha e bigode enrolado para cima.' },
];

/** Fantasias que já vêm com algo na cabeça (escondem o chapéu escolhido). */
export const COVERS_HAT = new Set<CostumeId>(['popstar', 'rainha', 'pintor']);

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Tamanho da roupa (muda conforme o formato do personagem). */
export interface BodyFit {
  r: number;
  len: number;
  y: number;
}
let FIT: BodyFit = { r: 0.385, len: 0.3, y: -0.03 };

/** Uma "roupa" que envolve o tronco (um pouco maior que o corpo). */
function shirt(m: THREE.Material) {
  const g = mesh(new THREE.CapsuleGeometry(FIT.r, FIT.len, 8, 18), m);
  g.scale.set(1.04, 0.92, 1.0);
  g.position.y = FIT.y;
  // No feijão inteiriço, a roupa vira uma "pele" que dobra junto (faixa de altura)
  g.userData.band = [0.42, 1.34];
  return g;
}

function numberTexture(text: string, bg: string, fg: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = fg;
  g.font = 'bold 120px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // número uma vez só, no meio da textura (cai na frente da camisa)
  g.font = 'bold 64px sans-serif';
  g.fillText(text, 128, 120);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Coloca os acessórios da fantasia nas peças do boneco.
 * headTop = altura do topo da cabeça; frontZ = frente do rosto.
 * Devolve os materiais criados (para liberar depois).
 */
export function applyCostume(id: CostumeId, parts: Record<PartName, THREE.Group>, headTop: number, frontZ: number, fit?: BodyFit): THREE.Material[] {
  FIT = fit ?? { r: 0.385, len: 0.3, y: -0.03 };
  const k = FIT.r / 0.385; // detalhes do peito acompanham o tamanho
  const head = parts.head;
  const chest = parts.chest;
  const made: THREE.Material[] = [];
  const M = (c: number, e: THREE.MeshStandardMaterialParameters = {}) => {
    const m = mat(c, e);
    made.push(m);
    return m;
  };

  switch (id) {
    case 'topete': {
      const hair = M(0x141018, { roughness: 0.25 });
      const top = mesh(new THREE.SphereGeometry(0.26, 18, 12), hair, 0, headTop - 0.02, 0.06);
      top.scale.set(1.15, 0.65, 1.35);
      head.add(top);
      const wave = mesh(new THREE.SphereGeometry(0.15, 14, 10), hair, 0, headTop + 0.06, frontZ - 0.05);
      wave.scale.set(1.3, 0.8, 1);
      head.add(wave);
      for (const sx of [-1, 1]) head.add(mesh(new THREE.BoxGeometry(0.06, 0.2, 0.12), hair, sx * 0.31, -0.02, 0.08)); // costeletas
      // óculos dourados
      const gold = M(0xd4a017, { metalness: 0.9, roughness: 0.2 });
      const lens = M(0x3a2a10, { roughness: 0.1, metalness: 0.3 });
      for (const sx of [-1, 1]) {
        const l = mesh(new THREE.BoxGeometry(0.17, 0.11, 0.03), lens, sx * 0.11, 0.06, frontZ + 0.02);
        head.add(l);
        const fr = mesh(new THREE.TorusGeometry(0.09, 0.013, 6, 16), gold, sx * 0.11, 0.06, frontZ + 0.03);
        fr.scale.set(1, 0.65, 1);
        head.add(fr);
      }
      // golão branco com detalhes dourados
      const white = M(0xfafafa);
      const collar = mesh(new THREE.CylinderGeometry(0.3 * k, 0.38 * k, 0.3, 20, 1, true, Math.PI * 0.6, Math.PI * 1.8), white, 0, 0.38 + (k - 1) * 0.5, 0);
      collar.rotation.y = Math.PI;
      (collar.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      chest.add(collar);
      chest.add(shirt(white));
      for (let i = 0; i < 5; i++) chest.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), gold, 0, 0.2 - i * 0.12, 0.4 * k));
      break;
    }
    case 'genio': {
      const white = M(0xf2f2f2, { roughness: 0.9 });
      // cabelo espetado para todo lado
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const up = 0.35 + (i % 3) * 0.2;
        const spike = mesh(new THREE.ConeGeometry(0.08, 0.42, 6), white);
        const dir = new THREE.Vector3(Math.cos(a), up, Math.sin(a) * 0.8 - 0.25).normalize();
        spike.position.copy(dir.clone().multiplyScalar(0.36)).add(new THREE.Vector3(0, 0.02, -0.04));
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        head.add(spike);
      }
      // bigodão
      const stache = mesh(new THREE.CapsuleGeometry(0.05, 0.2, 6, 10), white, 0, -0.05, frontZ - 0.01);
      stache.rotation.z = Math.PI / 2;
      head.add(stache);
      // suéter cinza
      chest.add(shirt(M(0x8a8f99, { roughness: 1 })));
      break;
    }
    case 'popstar': {
      const black = M(0x111114, { roughness: 0.4 });
      // chapéu preto com faixa branca
      head.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 24), black, 0, headTop - 0.02, 0));
      head.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.2, 24), black, 0, headTop + 0.09, 0));
      head.add(mesh(new THREE.CylinderGeometry(0.222, 0.222, 0.05, 24), M(0xffffff), 0, headTop + 0.02, 0));
      // jaqueta preta com fivelas prateadas
      chest.add(shirt(black));
      const silver = M(0xd0d4dc, { metalness: 0.9, roughness: 0.15 });
      for (let i = 0; i < 4; i++) chest.add(mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), silver, 0.12, 0.15 - i * 0.1, 0.39 * k));
      // uma luva branca brilhante (só na mão direita)
      const glove = mesh(new THREE.SphereGeometry(0.155, 14, 10), M(0xffffff, { emissive: 0x666666, metalness: 0.4, roughness: 0.15 }), 0, -DIM.handOffset, 0);
      parts.foreR.add(glove);
      break;
    }
    case 'craque': {
      const tex = numberTexture('10', '#ffd400', '#1f8a3a');
      const jersey = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
      made.push(jersey);
      const sh = shirt(jersey);
      sh.rotation.y = -Math.PI / 2; // número de frente
      chest.add(sh);
      const green = M(0x1f8a3a);
      const collar = mesh(new THREE.TorusGeometry(0.22 * k, 0.04, 8, 20), green, 0, 0.36 + (k - 1) * 0.6, 0);
      collar.rotation.x = Math.PI / 2;
      chest.add(collar);
      // calção azul
      const blue = M(0x1e4bd2);
      const shorts = mesh(new THREE.SphereGeometry(0.35 * Math.max(1, k * 0.97), 16, 12), blue, 0, 0, 0);
      shorts.scale.set(1.08, 0.85, 1.05);
      shorts.userData.band = [0.1, 0.62];
      parts.pelvis.add(shorts);
      // faixinha de cabelo
      const band = mesh(new THREE.TorusGeometry(0.31, 0.03, 6, 24), M(0xffffff), 0, 0.18, 0);
      band.rotation.x = Math.PI / 2;
      head.add(band);
      break;
    }
    case 'rainha': {
      const gold = M(0xf2c230, { metalness: 0.9, roughness: 0.2 });
      const crown = new THREE.Group();
      crown.position.y = headTop + 0.04;
      crown.scale.setScalar(1.35);
      crown.add(mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.1, 16, 1, true), gold));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        crown.add(mesh(new THREE.ConeGeometry(0.035, 0.1, 6), gold, Math.cos(a) * 0.17, 0.09, Math.sin(a) * 0.17));
      }
      crown.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), M(0xd61f3c, { roughness: 0.1 }), 0, 0.02, 0.18));
      head.add(crown);
      // colar de pérolas
      const pearl = M(0xfff8ee, { roughness: 0.15 });
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        chest.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), pearl, Math.sin(a) * 0.3 * k, 0.38 + (k - 1) * 0.4 - Math.max(0, Math.cos(a)) * 0.07, Math.cos(a) * 0.3 * k));
      }
      // vestido azul-claro
      chest.add(shirt(M(0x9ec9ff)));
      break;
    }
    case 'pintor': {
      // boina vermelha
      const red = M(0xc8102e, { roughness: 0.9 });
      const beret = mesh(new THREE.SphereGeometry(0.3, 18, 10), red, 0.04, headTop - 0.02, -0.02);
      beret.scale.set(1.15, 0.35, 1.15);
      beret.rotation.z = -0.25;
      head.add(beret);
      head.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.06, 6), red, 0.04, headTop + 0.08, -0.02));
      // bigode fininho enrolado para cima
      const black = M(0x111111);
      for (const sx of [-1, 1]) {
        const curl = mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 16, Math.PI * 1.2), black, sx * 0.08, -0.04, frontZ);
        curl.rotation.z = sx > 0 ? -0.2 : Math.PI + 0.2;
        head.add(curl);
      }
      // camisa listrada
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      for (let y = 0; y < 64; y += 16) {
        g.fillStyle = '#ffffff';
        g.fillRect(0, y, 64, 8);
        g.fillStyle = '#1b2a6b';
        g.fillRect(0, y + 8, 64, 8);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      const striped = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
      made.push(striped);
      chest.add(shirt(striped));
      break;
    }
  }
  return made;
}

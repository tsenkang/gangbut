import * as THREE from 'three';
import { canvasTexture } from './MapBase';

// ------------------------------------------------------------
// Peças de cenário de "cidade grande e encardida", usadas pelos
// mapas urbanos: prédios com janelas acesas, concreto sujo,
// letreiros de neon e vigas de aço.
// ------------------------------------------------------------

/** Fachada com janelas (algumas acesas). */
export function windowsTexture(cols: number, rows: number, lit = 0.35, wall = '#2a2440', on = '#ffd27a') {
  return canvasTexture(256, 512, (g) => {
    g.fillStyle = wall;
    g.fillRect(0, 0, 256, 512);
    const w = 256 / cols;
    const h = 512 / rows;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const r = Math.random();
        g.fillStyle = r < lit ? (r < lit * 0.25 ? '#9fd3ff' : on) : '#0f0d18';
        g.fillRect(x * w + w * 0.18, y * h + h * 0.2, w * 0.64, h * 0.55);
      }
  });
}

/** Superfície suja: cor base + manchas, rachaduras e marcas. */
export function grimeTexture(base: string, repeat: [number, number], opts: { tiles?: number; cracks?: boolean; dark?: string } = {}) {
  return canvasTexture(
    256,
    256,
    (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 256, 256);
      const dark = opts.dark ?? 'rgba(0,0,0,0.12)';
      // manchas
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const r = 8 + Math.random() * 40;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, dark);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // pontinhos
      for (let i = 0; i < 400; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
        g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      }
      if (opts.tiles) {
        g.strokeStyle = 'rgba(0,0,0,0.22)';
        g.lineWidth = 2;
        const s = 256 / opts.tiles;
        for (let i = 0; i <= 256; i += s) {
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i, 256);
          g.moveTo(0, i);
          g.lineTo(256, i);
          g.stroke();
        }
      }
      if (opts.cracks) {
        g.strokeStyle = 'rgba(0,0,0,0.3)';
        g.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) {
          let x = Math.random() * 256;
          let y = Math.random() * 256;
          g.beginPath();
          g.moveTo(x, y);
          for (let k = 0; k < 6; k++) {
            x += (Math.random() - 0.5) * 40;
            y += (Math.random() - 0.5) * 40;
            g.lineTo(x, y);
          }
          g.stroke();
        }
      }
    },
    repeat,
  );
}

/** Placa de neon (texto brilhando). */
export function neonTexture(text: string, color: string, bg = '#120a18', sub?: string) {
  return canvasTexture(512, 256, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 256);
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.shadowColor = color;
    g.shadowBlur = 24;
    g.strokeRect(14, 14, 484, 228);
    g.fillStyle = '#ffffff';
    g.font = `900 ${sub ? 92 : 110}px "Lilita One", "Arial Black", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, sub ? 108 : 132);
    g.fillStyle = color;
    g.fillText(text, 256, sub ? 108 : 132);
    if (sub) {
      g.font = '800 40px "Nunito", sans-serif';
      g.fillStyle = '#fff6c2';
      g.fillText(sub, 256, 196);
    }
  });
}

/** Viga de aço em "I" (cenário ou colisão por fora). */
export function iBeamGeometry(length: number, height = 0.5, width = 0.45, flange = 0.08, web = 0.08) {
  const shape = new THREE.Shape();
  const h = height / 2;
  const w = width / 2;
  const t = web / 2;
  shape.moveTo(-w, -h);
  shape.lineTo(w, -h);
  shape.lineTo(w, -h + flange);
  shape.lineTo(t, -h + flange);
  shape.lineTo(t, h - flange);
  shape.lineTo(w, h - flange);
  shape.lineTo(w, h);
  shape.lineTo(-w, h);
  shape.lineTo(-w, h - flange);
  shape.lineTo(-t, h - flange);
  shape.lineTo(-t, -h + flange);
  shape.lineTo(-w, -h + flange);
  shape.lineTo(-w, -h);
  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  g.translate(0, 0, -length / 2);
  return g;
}

/**
 * Horizonte de prédios ao redor (só desenho), com algumas placas
 * de neon e luzinhas vermelhas no topo. `below` = quanto o chão da
 * rua fica abaixo do mapa.
 */
export function cityBackdrop(root: THREE.Object3D, opts: { below: number; radius?: [number, number]; count?: number; keepClear?: (x: number, z: number) => boolean; walls?: string[] }) {
  const group = new THREE.Group();
  const [r0, r1] = opts.radius ?? [24, 70];
  const count = opts.count ?? 34;
  const walls = opts.walls ?? ['#232436', '#2b2a3a', '#1f2a3a', '#33303a'];
  const neonColors = ['#ff3d7f', '#36f1ff', '#ffd23f', '#7cff6b'];
  const neonWords = ['BAR', 'HOTEL', 'PIZZA', 'GELATINA', 'LANCHES', 'CINEMA'];
  const blink: THREE.Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.1;
    const r = r0 + Math.random() * (r1 - r0);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r - 8;
    if (opts.keepClear?.(x, z)) continue;
    const h = 18 + Math.random() * 50;
    const w = 6 + Math.random() * 7;
    const d = 6 + Math.random() * 7;
    const tex = windowsTexture(6, 14, 0.15 + Math.random() * 0.3, walls[i % walls.length]);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.round(w / 4), Math.round(h / 12));
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.95 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    const top = -opts.below + h;
    b.position.set(x, top - h / 2, z);
    b.lookAt(0, top - h / 2, -8);
    group.add(b);
    // telhado com caixa d'água / antena
    if (Math.random() < 0.5) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 5), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      ant.position.set(x, top + 2, z);
      group.add(ant);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
      light.position.set(x, top + 4.1, z);
      group.add(light);
      blink.push(light);
    }
    // placa de neon na fachada
    if (Math.random() < 0.3) {
      const c = neonColors[i % neonColors.length];
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 2.5),
        new THREE.MeshBasicMaterial({ map: neonTexture(neonWords[i % neonWords.length], c), toneMapped: false }),
      );
      const toCenter = new THREE.Vector3(-x, 0, -8 - z).normalize();
      sign.position.set(x + toCenter.x * (Math.max(w, d) / 2 + 0.1), top - 3 - Math.random() * 10, z + toCenter.z * (Math.max(w, d) / 2 + 0.1));
      sign.lookAt(sign.position.clone().add(toCenter));
      group.add(sign);
    }
  }
  // rua lá embaixo com brilho alaranjado dos postes
  const street = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshBasicMaterial({ color: 0x1a1512 }));
  street.rotation.x = -Math.PI / 2;
  street.position.y = -opts.below;
  group.add(street);
  for (let i = 0; i < 40; i++) {
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.5 + Math.random() * 2, 12), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.35, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.set((Math.random() - 0.5) * 140, -opts.below + 0.05, (Math.random() - 0.5) * 140 - 10);
    group.add(glow);
  }
  root.add(group);
  return { group, blink };
}

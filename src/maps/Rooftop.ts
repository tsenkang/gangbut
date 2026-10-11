import * as THREE from 'three';
import { GameMap, canvasTexture, hazardStripes } from './MapBase';

// ------------------------------------------------------------
// Mapa 1 — TELHADO
// Um terraço no alto de um prédio ao pôr do sol. Três lados têm
// mureta baixa (dá para jogar alguém por cima!) e a frente é aberta:
// quem cai, perde.
// ------------------------------------------------------------

export function windowsTexture(cols: number, rows: number, lit = 0.35, wall = '#2a2440', on = '#ffd27a') {
  return canvasTexture(256, 512, (g) => {
    g.fillStyle = wall;
    g.fillRect(0, 0, 256, 512);
    const w = 256 / cols;
    const h = 512 / rows;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        g.fillStyle = Math.random() < lit ? on : '#141024';
        g.fillRect(x * w + w * 0.2, y * h + h * 0.2, w * 0.6, h * 0.55);
      }
  });
}

export class Rooftop extends GameMap {
  id = 'telhado';
  name = 'Telhado';
  emoji = '🏙️';
  description = 'Terraço no alto do prédio, ao pôr do sol.';
  hazard = 'A frente não tem mureta: quem cai, perde!';
  music = 'telhado' as const;
  killY = -8;
  camera = {
    dir: new THREE.Vector3(0, 0.62, 1),
    minDist: 13,
    maxDist: 24,
    fov: 42,
    center: new THREE.Vector3(0, 0.8, 0.5),
    bounds: new THREE.Box3(new THREE.Vector3(-7, 0, -4), new THREE.Vector3(7, 4, 5)),
  };

  build() {
    this.lights({
      skyTop: 0x3b2a6b,
      skyBottom: 0xff9a62,
      fog: { color: 0xc77a7a, near: 40, far: 140 },
      sunColor: 0xffc29a,
      sunIntensity: 2.4,
      sunPos: new THREE.Vector3(-12, 20, 14),
      hemiSky: 0xffd1b0,
      hemiGround: 0x4a3a6a,
      hemiIntensity: 1.1,
      shadowExtent: 14,
    });

    const floorTex = canvasTexture(
      256,
      256,
      (g) => {
        g.fillStyle = '#8f8a99';
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = '#7b7686';
        g.lineWidth = 4;
        for (let i = 0; i <= 256; i += 64) {
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i, 256);
          g.moveTo(0, i);
          g.lineTo(256, i);
          g.stroke();
        }
      },
      [6, 4],
    );
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 });
    // Laje do terraço (topo em y = 0)
    this.box({ x: 0, y: -1, z: 0 }, { x: 18, y: 2, z: 12 }, floorMat, { grabbable: true });
    // Fachada do prédio (só desenho)
    const facade = new THREE.MeshStandardMaterial({ map: windowsTexture(8, 14, 0.4), roughness: 0.9 });
    facade.map!.wrapS = facade.map!.wrapT = THREE.RepeatWrapping;
    facade.map!.repeat.set(2, 3);
    this.box({ x: 0, y: -22, z: 0 }, { x: 18, y: 40, z: 12 }, facade, { collide: false, shadow: false });
    // Faixa de perigo na borda aberta
    const stripe = new THREE.MeshStandardMaterial({ map: hazardStripes([18, 1]) });
    this.box({ x: 0, y: 0.01, z: 5.85 }, { x: 18, y: 0.02, z: 0.3 }, stripe, { collide: false, shadow: false });

    // Muretas (baixinhas: dá para jogar alguém por cima)
    const wall = this.material(0xb9b3c4);
    this.box({ x: 0, y: 0.35, z: -5.8 }, { x: 18, y: 0.7, z: 0.4 }, wall);
    this.box({ x: -8.8, y: 0.35, z: 0 }, { x: 0.4, y: 0.7, z: 12 }, wall);
    this.box({ x: 8.8, y: 0.35, z: 0 }, { x: 0.4, y: 0.7, z: 12 }, wall);

    // Casinha da escada (dá para escalar)
    const hut = this.material(0xd96c6c);
    this.box({ x: -5.2, y: 1.3, z: -3.7 }, { x: 3, y: 2.6, z: 2.6 }, hut);
    this.box({ x: -5.2, y: 2.65, z: -3.7 }, { x: 3, y: 0.1, z: 2.6 }, 0x6b3a3a);
    this.box({ x: -5.2, y: 1, z: -2.39 }, { x: 0.9, y: 1.8, z: 0.05 }, 0x4a2f2f, { collide: false });

    // Ar-condicionados
    const metal = this.material(0xcfd6dd, { metalness: 0.4, roughness: 0.5 });
    this.box({ x: 3.6, y: 0.55, z: -3.8 }, { x: 2.2, y: 1.1, z: 1.4 }, metal);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 20), this.material(0x555c66));
    fan.position.set(3.6, 1.12, -3.8);
    this.deco(fan);
    this.box({ x: 6.8, y: 0.4, z: 0.6 }, { x: 1.2, y: 0.8, z: 1.6 }, metal);

    // Claraboia (um degrauzinho no meio)
    this.box({ x: -0.5, y: 0.2, z: -1.6 }, { x: 2.4, y: 0.4, z: 1.6 }, this.material(0x9fd8ff, { roughness: 0.1, metalness: 0.2, emissive: 0x1a3550 }));

    // Antena (dá para se pendurar)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 8), this.material(0x444444, { metalness: 0.8 }));
    pole.position.set(8.3, 2, -5.3);
    this.deco(pole);
    this.ctx.physics.addStaticBox({ x: 8.3, y: 2, z: -5.3 }, { x: 0.06, y: 2, z: 0.06 });
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.12), new THREE.MeshBasicMaterial({ color: 0xff3344 }));
    light.position.set(8.3, 4.05, -5.3);
    this.deco(light, false);

    // Caixa d'água no canto do fundo
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.8, 20), this.material(0x6aa0b8));
    tank.position.set(6.6, 3.4, -4.4);
    this.deco(tank);
    for (const [x, z] of [
      [5.8, -5],
      [7.4, -5],
      [5.8, -3.8],
      [7.4, -3.8],
    ]) {
      this.box({ x, y: 1.25, z }, { x: 0.15, y: 2.5, z: 0.15 }, 0x555555);
    }
    this.box({ x: 6.6, y: 2.45, z: -4.4 }, { x: 2.4, y: 0.1, z: 2.4 }, 0x555555);

    // Prédios vizinhos (cenário)
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = rnd(24, 60);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 10;
      if (z > 10 && Math.abs(x) < 20) continue; // não tapa a câmera
      const h = rnd(10, 45);
      const w = rnd(5, 10);
      const tex = windowsTexture(6, 12, rnd(0.2, 0.5), ['#2a2440', '#3b2f4f', '#26304a'][i % 3]);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, h / 15);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.9 }));
      b.position.set(x, h / 2 - 40 + rnd(10, 30), z);
      this.deco(b, false);
    }
    const street = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.material(0x1d1a2a));
    street.rotation.x = -Math.PI / 2;
    street.position.y = -42;
    this.deco(street, false);

    // Peças soltas
    this.prop('caixa', new THREE.Vector3(-2.5, 0.5, 2.8));
    this.prop('caixa', new THREE.Vector3(-2.5, 1.4, 2.8));
    this.prop('caixa', new THREE.Vector3(1.8, 0.5, -3.6));
    this.prop('barril', new THREE.Vector3(5, 0.5, 3), 0xd94a3a);
    this.prop('barril', new THREE.Vector3(-7, 0.5, 3.6));

    this.spawns = [new THREE.Vector3(-3, 0.08, 1), new THREE.Vector3(3, 0.08, 1), new THREE.Vector3(-1.2, 0.08, 3), new THREE.Vector3(1.2, 0.08, -0.5)];
  }
}

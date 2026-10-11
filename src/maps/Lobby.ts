import * as THREE from 'three';
import { GameMap, canvasTexture } from './MapBase';
import { RAPIER } from '../physics/Physics';

// ------------------------------------------------------------
// Palco do menu: um tablado redondo onde os lutadores ficam
// esperando (ou brigando de brincadeira na tela inicial).
// Não aparece na lista de mapas.
// ------------------------------------------------------------

export class Lobby extends GameMap {
  id = 'saguao';
  name = 'Saguão';
  emoji = '🎪';
  description = '';
  hazard = '';
  music = 'menu' as const;
  killY = -6;
  camera = {
    dir: new THREE.Vector3(0, 0.3, 1),
    minDist: 12.5,
    maxDist: 12.5,
    fov: 40,
    center: new THREE.Vector3(0, -0.4, 0),
    // câmera parada no meio do palco
    bounds: new THREE.Box3(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0, -0.4, 0)),
  };

  build() {
    this.lights({
      skyTop: 0x2b1b55,
      skyBottom: 0xff6fa3,
      sunColor: 0xfff0dd,
      sunIntensity: 2.2,
      sunPos: new THREE.Vector3(4, 12, 9),
      hemiSky: 0xd9c6ff,
      hemiGround: 0x4a2a5a,
      hemiIntensity: 1.2,
      shadowExtent: 8,
    });
    const top = canvasTexture(256, 256, (g) => {
      const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
      grd.addColorStop(0, '#ffd6e7');
      grd.addColorStop(1, '#ff8fbf');
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.lineWidth = 6;
      for (let r = 30; r < 128; r += 30) {
        g.beginPath();
        g.arc(128, 128, r, 0, Math.PI * 2);
        g.stroke();
      }
    });
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.3, 1, 48), [
      this.material(0xc0457f),
      new THREE.MeshStandardMaterial({ map: top, roughness: 0.6 }),
      this.material(0xc0457f),
    ]);
    stage.position.y = -0.5;
    this.deco(stage);
    this.ctx.physics.addStatic({ x: 0, y: -0.5, z: 0 }, RAPIER.ColliderDesc.cylinder(0.5, 6));
    // Paredes invisíveis para ninguém cair no menu
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.ctx.physics.addStaticBox(
        { x: Math.cos(a) * 6.2, y: 2, z: Math.sin(a) * 6.2 },
        { x: 0.3, y: 3, z: 1.8 },
        { rot: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a), grabbable: false },
      );
    }
    // Luzes de palco
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffe14d : 0x5ef0ff }));
      bulb.position.set(Math.cos(a) * 6.15, 0.05, Math.sin(a) * 6.15);
      this.deco(bulb, false);
    }
    // Confetes congelados no fundo
    const conf = new THREE.Group();
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.8, 0.6), side: THREE.DoubleSide }));
      m.position.set((Math.random() - 0.5) * 30, Math.random() * 12 - 2, -8 - Math.random() * 12);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      conf.add(m);
    }
    this.deco(conf, false);
    this.spawns = [new THREE.Vector3(-4.1, 0.05, 0.3), new THREE.Vector3(-1.4, 0.05, 0.9), new THREE.Vector3(1.4, 0.05, 0.9), new THREE.Vector3(4.1, 0.05, 0.3)];
  }

  update(_dt: number, time: number) {
    // confetes giram de leve
    const conf = this.ctx.root.children[this.ctx.root.children.length - 1];
    if (conf) conf.rotation.y = Math.sin(time * 0.1) * 0.05;
  }
}

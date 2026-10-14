import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi } from './MapBase';
import { cityBackdrop, grimeTexture, hazeBelow, neonTexture } from './City';

// ------------------------------------------------------------
// Mapa 1 — TELHADO
// Terraço encardido de um prédio, à noite, no meio da cidade.
// No fundo, um outdoor de neon gigante com passarela (dá para
// subir pela escadinha). Muretas baixas dos lados — dá para jogar
// alguém por cima — e a frente é aberta: quem cai, perde.
// ------------------------------------------------------------

export class Rooftop extends GameMap {
  id = 'telhado';
  name = 'Telhado';
  emoji = '🏙️';
  description = 'Terraço encardido no alto de um prédio, à noite, embaixo de um outdoor de neon.';
  hazard = 'A frente não tem mureta: quem cai, perde! Suba no outdoor pela escadinha.';
  music = 'telhado' as const;
  killY = -8;
  camera = {
    dir: new THREE.Vector3(0, 0.6, 1),
    minDist: 13,
    maxDist: 28,
    fov: 42,
    center: new THREE.Vector3(0, 1, 0.3),
    bounds: new THREE.Box3(new THREE.Vector3(-10, 0, -6), new THREE.Vector3(10, 4, 6.5)),
  };

  private neon!: THREE.MeshBasicMaterial;
  private neonLight!: THREE.PointLight;
  private blink: THREE.Mesh[] = [];
  private flickerT = 0;

  build() {
    this.lights({
      skyTop: 0x070a18,
      skyBottom: 0x3a2f4f,
      fog: { color: 0x2f2944, near: 24, far: 85 },
      sunColor: 0xa9b8ff, // luz da lua
      sunIntensity: 1.7,
      sunPos: new THREE.Vector3(-10, 22, 12),
      hemiSky: 0x7f8fc8,
      hemiGround: 0x2a1f1a,
      hemiIntensity: 1.25,
      shadowExtent: 19,
    });

    // ----- chão de manta asfáltica, com poças
    const floorMat = new THREE.MeshStandardMaterial({ map: grimeTexture('#4a4b52', [5, 4], { tiles: 2, cracks: true }), roughness: 0.92 });
    this.box({ x: 0, y: -1, z: 0 }, { x: 26, y: 2, z: 16 }, floorMat);
    const puddle = new THREE.MeshStandardMaterial({ color: 0x4a5272, roughness: 0.08, transparent: true, opacity: 0.55 });
    for (const [x, z, s] of [
      [-3.5, 2.6, 1.6],
      [4.9, -1.6, 1.1],
      [8.4, 4.6, 0.9],
      [-9, -2, 1.2],
    ]) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(s, 20), puddle);
      p.rotation.x = -Math.PI / 2;
      p.scale.set(1.4, 1, 1);
      p.position.set(x, 0.012, z);
      p.receiveShadow = true;
      this.ctx.root.add(p);
    }
    // fachada do prédio
    const facade = new THREE.MeshStandardMaterial({ map: grimeTexture('#57524e', [3, 6], { tiles: 4 }), roughness: 1 });
    this.box({ x: 0, y: -22, z: 0 }, { x: 26, y: 40, z: 16 }, facade, { collide: false, shadow: false });
    // faixa de perigo na borda aberta
    this.box({ x: 0, y: 0.012, z: 7.85 }, { x: 26, y: 0.02, z: 0.3 }, new THREE.MeshStandardMaterial({ map: hazardStripes([26, 1]) }), { collide: false, shadow: false });

    // ----- muretas de concreto (baixas)
    const concrete = new THREE.MeshStandardMaterial({ map: grimeTexture('#8a847c', [6, 1], { cracks: true }), roughness: 1 });
    this.box({ x: 0, y: 0.35, z: -7.8 }, { x: 26, y: 0.7, z: 0.4 }, concrete);
    this.box({ x: -12.8, y: 0.35, z: 0 }, { x: 0.4, y: 0.7, z: 16 }, concrete);
    this.box({ x: 12.8, y: 0.35, z: 0 }, { x: 0.4, y: 0.7, z: 16 }, concrete);
    // rufo metálico em cima das muretas
    const flash = this.material(0x9aa0a6, { metalness: 0.7, roughness: 0.4 });
    this.box({ x: 0, y: 0.73, z: -7.8 }, { x: 26.1, y: 0.06, z: 0.5 }, flash, { collide: false });
    this.box({ x: -12.8, y: 0.73, z: 0 }, { x: 0.5, y: 0.06, z: 16 }, flash, { collide: false });
    this.box({ x: 12.8, y: 0.73, z: 0 }, { x: 0.5, y: 0.06, z: 16 }, flash, { collide: false });

    // ----- OUTDOOR DE NEON com passarela
    const steel = this.material(0x3d4148, { metalness: 0.8, roughness: 0.45 });
    for (const x of [-4, 4]) this.box({ x, y: 3.6, z: -7.25 }, { x: 0.3, y: 7.2, z: 0.3 }, steel); // pernas (dá para agarrar)
    // passarela (piso de grade)
    const grate = new THREE.MeshStandardMaterial({ map: grimeTexture('#5b5f66', [6, 1], { tiles: 8 }), metalness: 0.6, roughness: 0.5 });
    this.box({ x: 0, y: 2.95, z: -6.85 }, { x: 10, y: 0.12, z: 1.1 }, grate);
    // corrimão da passarela
    for (let x = -5; x <= 5; x += 2.5) this.box({ x, y: 3.45, z: -6.35 }, { x: 0.06, y: 0.9, z: 0.06 }, steel);
    this.box({ x: 0, y: 3.9, z: -6.35 }, { x: 10, y: 0.07, z: 0.07 }, steel);
    // escadinha (degraus para agarrar e subir)
    for (let y = 0.45; y < 2.9; y += 0.42) this.box({ x: 4.55, y, z: -6.3 }, { x: 0.7, y: 0.06, z: 0.06 }, this.material(0xd9a300, { metalness: 0.5 }));
    for (const dx of [-0.35, 0.35]) this.box({ x: 4.55 + dx, y: 1.5, z: -6.3 }, { x: 0.06, y: 3, z: 0.06 }, this.material(0xd9a300, { metalness: 0.5 }), { collide: false });
    // painel
    const tex = neonTexture('MOLENGAS', '#ff3d7f', '#14081e', 'a gelatina mais brigona da cidade');
    this.neon = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 5.2), this.neon);
    panel.position.set(0, 6.1, -7.32);
    this.ctx.root.add(panel);
    this.box({ x: 0, y: 6.1, z: -7.5 }, { x: 10.8, y: 5.6, z: 0.3 }, steel, { collide: false });
    this.neonLight = new THREE.PointLight(0xff3d7f, 40, 16, 1.6);
    this.neonLight.position.set(0, 5, -5.5);
    this.ctx.root.add(this.neonLight);
    // holofotes do outdoor
    for (const x of [-3, 0, 3]) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.3, 10), steel);
      lamp.position.set(x, 3.35, -6.6);
      lamp.rotation.x = -0.6;
      this.deco(lamp);
    }

    // ----- casinha da escada (dá para escalar) com lâmpada na porta
    const brick = new THREE.MeshStandardMaterial({ map: grimeTexture('#7a3b32', [2, 2], { tiles: 6 }), roughness: 1 });
    this.box({ x: -9, y: 1.3, z: -2.6 }, { x: 2.6, y: 2.6, z: 2.6 }, brick);
    this.box({ x: -9, y: 2.65, z: -2.6 }, { x: 2.6, y: 0.1, z: 2.6 }, this.material(0x2a2a2a));
    this.box({ x: -7.69, y: 1, z: -2.6 }, { x: 0.05, y: 1.8, z: 0.9 }, this.material(0x3b2f2a), { collide: false });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a }));
    bulb.position.set(-7.6, 2.1, -2.6);
    this.deco(bulb, false);
    const doorLight = new THREE.PointLight(0xffb060, 18, 9, 1.8);
    doorLight.position.set(-7.1, 2.1, -2.6);
    this.ctx.root.add(doorLight);

    // ----- ar-condicionados, dutos e canos (dá para tropeçar)
    const metal = this.material(0xb4b9bf, { metalness: 0.5, roughness: 0.55 });
    this.box({ x: 4.6, y: 0.55, z: -3 }, { x: 2.2, y: 1.1, z: 1.4 }, metal);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 20), this.material(0x30343a));
    fan.position.set(4.6, 1.12, -3);
    this.deco(fan);
    this.box({ x: 10, y: 0.45, z: 1 }, { x: 1.2, y: 0.9, z: 1.8 }, metal);
    for (const [x, z] of [
      [-2, -4.8],
      [1.7, 5.4],
      [-5.5, 4.8],
    ]) {
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.9, 12), metal);
      vent.position.set(x, 0.45, z);
      this.deco(vent);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.3, 12), metal);
      cap.position.set(x, 1.05, z);
      this.deco(cap);
      this.ctx.physics.addStaticBox({ x, y: 0.5, z }, { x: 0.25, y: 0.5, z: 0.25 });
    }
    const pipeMat = this.material(0x6b4a3a, { metalness: 0.6, roughness: 0.5 });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 10), pipeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(-0.5, 0.18, -6.9);
    this.deco(pipe);
    this.ctx.physics.addStaticBox({ x: -0.5, y: 0.15, z: -6.9 }, { x: 4.5, y: 0.15, z: 0.12 });

    // ----- caixa d'água no canto
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.8, 20), this.material(0x5e6f78, { roughness: 0.8 }));
    tank.position.set(9.6, 3.3, -6.3);
    this.deco(tank);
    for (const [x, z] of [
      [8.9, -6.9],
      [10.3, -6.9],
      [8.9, -5.7],
      [10.3, -5.7],
    ])
      this.box({ x, y: 1.2, z }, { x: 0.15, y: 2.4, z: 0.15 }, steel);
    this.box({ x: 9.6, y: 2.35, z: -6.3 }, { x: 2.2, y: 0.1, z: 2.2 }, steel);

    // antena parabólica e antena com luz vermelha
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), this.material(0xdddddd, { side: THREE.DoubleSide }));
    dish.position.set(-11.4, 1.2, 6.4);
    dish.rotation.x = -1.1;
    this.deco(dish);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4, 6), steel);
    pole.position.set(12.2, 2, -7.3);
    this.deco(pole);
    this.ctx.physics.addStaticBox({ x: 12.2, y: 2, z: -7.3 }, { x: 0.06, y: 2, z: 0.06 });
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.12), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    red.position.set(12.2, 4.05, -7.3);
    this.deco(red, false);
    this.blink.push(red);

    // ----- cidade à noite
    const city = cityBackdrop(this.ctx.root, { below: 42, keepClear: (x, z) => z > 8 && Math.abs(x) < 26 });
    hazeBelow(this.ctx.root, 0x3a3352, [
      [-14, 0.35],
      [-26, 0.55],
    ]);
    this.blink.push(...city.blink);

    // ----- peças soltas
    this.prop('caixa', new THREE.Vector3(-3.5, 0.5, 3.6));
    this.prop('caixa', new THREE.Vector3(-3.5, 1.4, 3.6));
    this.prop('caixa', new THREE.Vector3(2.2, 0.5, -4.2), 0x8a7a5a);
    this.prop('barril', new THREE.Vector3(7, 0.5, 4), 0xb3392b);
    this.prop('barril', new THREE.Vector3(-10, 0.5, 5), 0x2b5e8a);
    this.prop('caixa', new THREE.Vector3(10.5, 0.5, -2.5));

    this.spawns = [new THREE.Vector3(-4.5, 0.08, 1.5), new THREE.Vector3(4.5, 0.08, 1.5), new THREE.Vector3(-1.5, 0.08, 4), new THREE.Vector3(1.5, 0.08, -1)];
  }

  update(dt: number, time: number, _arena: ArenaApi) {
    // O neon pisca de vez em quando, como letreiro velho
    this.flickerT -= dt;
    let on = true;
    if (this.flickerT < 0) {
      on = Math.random() < 0.5;
      if (this.flickerT < -0.25) this.flickerT = 2 + Math.random() * 5;
    }
    this.neon.color.setScalar(on ? 1 : 0.35);
    this.neonLight.intensity = on ? 40 : 10;
    const b = Math.sin(time * 3) > 0;
    for (const m of this.blink) m.visible = b;
  }
}

import * as THREE from 'three';
import { GameMap, canvasTexture, type ArenaApi, type DeathKind } from './MapBase';
import { grimeTexture, windowsTexture } from './City';

/** Roda de trem com raios, para dar para ver girando. */
function wheelTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = '#2a2b2e';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#8f949a';
    g.beginPath();
    g.arc(64, 64, 60, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a3c40';
    g.beginPath();
    g.arc(64, 64, 50, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#8f949a';
    g.lineWidth = 7;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.moveTo(64, 64);
      g.lineTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50);
      g.stroke();
    }
    g.fillStyle = '#8f949a';
    g.beginPath();
    g.arc(64, 64, 12, 0, Math.PI * 2);
    g.fill();
  });
}

// ------------------------------------------------------------
// Mapa 4 — TREM EM MOVIMENTO
// A briga é no teto de três vagões. Postes passam rente aos lados
// e, de vez em quando, um túnel varre o teto: quem estiver em pé
// leva uma pancada! Para se salvar: pendure-se na lateral ou
// desça no engate entre os vagões. Quem cai do trem fica para trás.
// ------------------------------------------------------------

const WAGON_LEN = 7;
const GAP = 1.4;
const HALF_W = 1.5;
const WAGONS = [-(WAGON_LEN + GAP), 0, WAGON_LEN + GAP];
const SPEED = 24; // velocidade do cenário passando
const FRONT = WAGONS[2] + WAGON_LEN / 2;
const BACK = WAGONS[0] - WAGON_LEN / 2;
const GAUGE = 1.44; // bitola: distância entre os trilhos
const TRACKS = [0, 5.2]; // nossa linha e uma linha ao lado
const SLEEPER_GAP = 1.0;
const SLEEPERS_PER_TRACK = 200;

interface Pole {
  obj: THREE.Object3D;
  x: number;
  side: number; // 1 = lado de cá (z+), -1 = lado de lá
  hit: Set<unknown>;
}

export class Train extends GameMap {
  id = 'trem';
  name = 'Trem em Movimento';
  emoji = '🚂';
  description = 'Briga em cima de um trem a toda velocidade pelo interior.';
  hazard = 'Postes passam rente e o túnel varre quem estiver em pé!';
  music = 'trem' as const;
  killY = -8;
  camera = {
    dir: new THREE.Vector3(0.05, 0.62, 1),
    minDist: 11,
    maxDist: 23,
    fov: 42,
    center: new THREE.Vector3(0, 0.6, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-9, 0, -1), new THREE.Vector3(9, 3, 1)),
  };

  private groundTex!: THREE.Texture;
  private ballastTex!: THREE.Texture;
  private sleepers!: THREE.InstancedMesh;
  private sleeperOffset = 0;
  private telePoles: THREE.Object3D[] = [];
  private wheelMat = new THREE.MeshStandardMaterial({ map: wheelTexture(), metalness: 0.7, roughness: 0.4 });
  private scenery: THREE.Object3D[] = [];
  private poles: Pole[] = [];
  private poleTimer = 5;
  private tunnel!: THREE.Group;
  private tunnelX = 999;
  private tunnelTimer = 22;
  private tunnelWarned = false;
  private tunnelHit = new Set<unknown>();
  private wheels: THREE.Object3D[] = [];
  private smokeT = 0;

  build() {
    this.lights({
      // fim de tarde enevoado na periferia da cidade
      skyTop: 0x3a4a6a,
      skyBottom: 0xd99a7e,
      fog: { color: 0x9c8f96, near: 26, far: 105 },
      sunColor: 0xffc08a,
      sunIntensity: 2.3,
      sunPos: new THREE.Vector3(-14, 12, 10),
      hemiSky: 0xb7b2c8,
      hemiGround: 0x4a4030,
      hemiIntensity: 1.15,
      shadowExtent: 16,
    });

    // ---------------- chão e via férrea ----------------
    // Terra batida com mato ralo (a textura corre para dar a velocidade)
    this.groundTex = canvasTexture(
      256,
      256,
      (g) => {
        // cascalho e terra cinzenta de pátio ferroviário
        g.fillStyle = '#5f5c58';
        g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 500; i++) {
          const r = Math.random();
          g.fillStyle = r < 0.35 ? '#504d4a' : r < 0.6 ? '#6d6a65' : r < 0.8 ? '#4c4f47' : '#5a5650';
          g.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 6, 2 + Math.random() * 3);
        }
      },
      [40, 8],
    );
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 80), new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -4.75;
    this.deco(ground, false);
    const farGround = new THREE.Mesh(new THREE.PlaneGeometry(700, 500), this.material(0x4f4c4a));
    farGround.rotation.x = -Math.PI / 2;
    farGround.position.y = -4.8;
    this.deco(farGround, false);

    // Leito de brita (pedrinhas cinzas) embaixo de cada linha
    this.ballastTex = canvasTexture(
      128,
      128,
      (g) => {
        g.fillStyle = '#77736c';
        g.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 700; i++) {
          const c = 90 + Math.floor(Math.random() * 90);
          g.fillStyle = `rgb(${c},${c - 4},${c - 10})`;
          g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 3, 2 + Math.random() * 2);
        }
      },
      [100, 1],
    );
    const ballastMat = new THREE.MeshStandardMaterial({ map: this.ballastTex, roughness: 1 });
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x9da3a8, metalness: 0.9, roughness: 0.32 });
    const railBase = new THREE.MeshStandardMaterial({ color: 0x5a3a28, metalness: 0.4, roughness: 0.8 }); // lateral enferrujada
    for (const tz of TRACKS) {
      // aterro de brita em forma de trapézio
      const bed = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 400, 4, 1), ballastMat);
      bed.rotation.z = Math.PI / 2;
      bed.rotation.x = Math.PI / 4;
      bed.scale.set(0.45, 1, 2.6);
      bed.position.set(0, -4.72, tz);
      this.deco(bed, false);
      // dois trilhos (perfil: boleto brilhante + alma enferrujada)
      for (const rz of [-GAUGE / 2, GAUGE / 2]) {
        const head = new THREE.Mesh(new THREE.BoxGeometry(400, 0.07, 0.09), railMat);
        head.position.set(0, -4.16, tz + rz);
        const web = new THREE.Mesh(new THREE.BoxGeometry(400, 0.1, 0.04), railBase);
        web.position.set(0, -4.24, tz + rz);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(400, 0.03, 0.16), railBase);
        foot.position.set(0, -4.3, tz + rz);
        this.deco(head, false);
        this.deco(web, false);
        this.deco(foot, false);
      }
    }
    // Dormentes de madeira (muitos, num só desenho) que passam correndo
    this.sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.13, 2.6), sleeperMat, SLEEPERS_PER_TRACK * TRACKS.length);
    this.sleepers.receiveShadow = true;
    this.ctx.root.add(this.sleepers);
    this.placeSleepers(0);

    // Postes da rede elétrica do lado de lá, com fios contínuos
    const wood = this.material(0x5a4632, { roughness: 1 });
    for (let i = 0; i < 9; i++) {
      const pole = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 9, 8), wood);
      post.position.y = 4.5;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 2.4), wood);
      arm.position.y = 8.4;
      pole.add(post, arm);
      for (const z of [-1, 0, 1]) {
        const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 6), this.material(0x3b6e8f, { roughness: 0.2 }));
        ins.position.set(0, 8.56, z);
        pole.add(ins);
      }
      pole.position.set(-90 + i * 25, -4.75, -9);
      this.deco(pole, false);
      this.telePoles.push(pole);
    }
    for (const z of [-1, 0, 1]) {
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 400, 4), this.material(0x111111));
      wire.rotation.z = Math.PI / 2;
      wire.position.set(0, 3.7, -9 + z);
      this.deco(wire, false);
    }

    // ---------------- vagões ----------------
    // O teto é onde a briga acontece (topo em y = 0)
    const colors = [0x8c2f24, 0x2f5d73, 0x7a6a2a];
    const roofTex = canvasTexture(
      128,
      64,
      (g) => {
        g.fillStyle = '#5e6064';
        g.fillRect(0, 0, 128, 64);
        // nervuras da chapa e sujeira
        g.fillStyle = '#4d4f53';
        for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 3, 64);
        for (let i = 0; i < 40; i++) {
          g.fillStyle = 'rgba(40,25,10,0.15)';
          g.fillRect(Math.random() * 128, Math.random() * 64, 8, 4);
        }
      },
      [4, 1],
    );
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.75, metalness: 0.35 });
    const dark = this.material(0x1d1e21, { metalness: 0.6, roughness: 0.6 });
    const steelMat = this.material(0x45484d, { metalness: 0.7, roughness: 0.45 });
    WAGONS.forEach((x, i) => {
      const body = new THREE.MeshStandardMaterial({ map: grimeTexture('#' + new THREE.Color(colors[i]).getHexString(), [2, 1], { dark: 'rgba(30,20,10,0.25)' }), roughness: 0.6, metalness: 0.2 });
      this.box({ x, y: -1.75, z: 0 }, { x: WAGON_LEN, y: 3.1, z: HALF_W * 2 }, body);
      this.box({ x, y: -0.05, z: 0 }, { x: WAGON_LEN + 0.1, y: 0.1, z: HALF_W * 2 + 0.1 }, roofMat);
      // faixa amarela e janelas com cortininha
      for (const z of [HALF_W + 0.01, -HALF_W - 0.01]) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(WAGON_LEN, 0.12), this.material(0xe0b030));
        stripe.position.set(x, -1.75, z);
        if (z < 0) stripe.rotation.y = Math.PI;
        this.deco(stripe, false);
        for (let k = -2; k <= 2; k++) {
          const w = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.75), new THREE.MeshStandardMaterial({ color: 0x9cb8c8, emissive: 0x3a4a55, roughness: 0.08, metalness: 0.3 }));
          w.position.set(x + k * 1.2, -1.1, z * 1.001);
          if (z < 0) w.rotation.y = Math.PI;
          this.deco(w, false);
        }
        // portas nas pontas
        for (const dx of [-WAGON_LEN / 2 + 0.55, WAGON_LEN / 2 - 0.55]) {
          const door = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 2.2), this.material(0x2a2a2e));
          door.position.set(x + dx, -1.95, z * 1.002);
          if (z < 0) door.rotation.y = Math.PI;
          this.deco(door, false);
        }
      }
      // Corrimão na lateral do teto (para se pendurar)
      for (const z of [HALF_W + 0.12, -HALF_W - 0.12]) this.box({ x, y: -0.45, z }, { x: WAGON_LEN - 0.6, y: 0.08, z: 0.08 }, this.material(0xcfd2d6, { metalness: 0.8 }));
      // chassi por baixo
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(WAGON_LEN - 0.4, 0.3, 2.2), dark);
      chassis.position.set(x, -3.42, 0);
      this.deco(chassis, false);
      // dois truques (conjuntos de rodas) apoiados nos trilhos
      for (const dx of [-2.4, 2.4]) {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.3, 1.85), steelMat);
        frame.position.set(x + dx, -3.68, 0);
        this.deco(frame, false);
        for (const ax of [-0.75, 0.75]) {
          const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, GAUGE + 0.3, 6), steelMat);
          axle.rotation.x = Math.PI / 2;
          axle.position.set(x + dx + ax, -3.7, 0);
          this.deco(axle, false);
          for (const z of [-GAUGE / 2, GAUGE / 2]) {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.11, 18), this.wheelMat);
            wheel.rotation.x = Math.PI / 2;
            wheel.position.set(x + dx + ax, -3.7, z);
            this.deco(wheel, false);
            this.wheels.push(wheel);
          }
        }
      }
    });
    // Engates entre vagões (lugar seguro mais baixo!) com para-choques e sanfona
    for (let i = 0; i < 2; i++) {
      const gx = (WAGONS[i] + WAGONS[i + 1]) / 2;
      this.box({ x: gx, y: -1.5, z: 0 }, { x: GAP + 0.4, y: 0.25, z: 1.2 }, this.material(0x3a3c40, { metalness: 0.6 }));
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(GAP + 0.1, 1.9, 1.5), this.material(0x1c1c1c, { roughness: 1 }));
      bellows.position.set(gx, -2.65, 0);
      this.deco(bellows, false);
      for (const z of [-0.8, 0.8])
        for (const s of [-1, 1]) {
          const buf = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.45, 10), steelMat);
          buf.rotation.z = Math.PI / 2;
          buf.position.set(gx + s * 0.45, -3.25, z);
          this.deco(buf, false);
        }
    }
    // Locomotiva diesel (na frente): capô comprido, cabine e farol
    const loco = new THREE.MeshStandardMaterial({ map: grimeTexture('#b8322a', [2, 1], { dark: 'rgba(20,10,5,0.3)' }), roughness: 0.55, metalness: 0.25 });
    this.box({ x: FRONT + 3.2, y: -2.1, z: 0 }, { x: 6, y: 2.4, z: 2.6 }, loco);
    this.box({ x: FRONT + 1.2, y: -0.1, z: 0 }, { x: 2, y: 1.6, z: 2.8 }, loco); // cabine (dá para subir)
    this.box({ x: FRONT + 1.2, y: 0.75, z: 0 }, { x: 2.2, y: 0.1, z: 3 }, dark, { collide: false });
    for (const z of [-1.41, 1.41]) {
      const cabWin = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0x111a22, roughness: 0.05 }));
      cabWin.position.set(FRONT + 1.2, 0.1, z);
      if (z < 0) cabWin.rotation.y = Math.PI;
      this.deco(cabWin, false);
    }
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2, 2.4), this.material(0xe8e3d8));
    nose.position.set(FRONT + 6.4, -2.2, 0);
    this.deco(nose);
    const headlight = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    headlight.position.set(FRONT + 6.71, -1.6, 0);
    headlight.rotation.y = Math.PI / 2;
    this.deco(headlight, false);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.6, 10), dark);
    chimney.position.set(FRONT + 4.4, -0.6, 0);
    this.deco(chimney);
    for (const dx of [2, 4.6]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.3, 1.85), steelMat);
      frame.position.set(FRONT + dx, -3.68, 0);
      this.deco(frame, false);
      for (const ax of [-0.75, 0.75])
        for (const z of [-GAUGE / 2, GAUGE / 2]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.11, 18), this.wheelMat);
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(FRONT + dx + ax, -3.7, z);
          this.deco(wheel, false);
          this.wheels.push(wheel);
        }
    }

    // Cenário que passa: galpões, muros pichados e prédios da periferia
    const walls = ['#5a5560', '#6a5f58', '#4f5866', '#625a5e', '#6b6a70'];
    const shedRoof = this.material(0x3b3a3e, { roughness: 0.9 });
    for (let i = 0; i < 30; i++) {
      const side = i % 2 ? 1 : -1;
      const tall = Math.random() < 0.45;
      const w = 6 + Math.random() * 8;
      const h = tall ? 10 + Math.random() * 16 : 3 + Math.random() * 4;
      const d = 5 + Math.random() * 6;
      const tex = windowsTexture(tall ? 5 : 8, tall ? 10 : 3, tall ? 0.3 : 0.15, walls[i % walls.length]);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(1, Math.round(w / 5)), tall ? Math.max(1, Math.round(h / 10)) : 1);
      const bld = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.95 }));
      body.position.y = h / 2;
      bld.add(body);
      // galpão baixo ganha telhado de duas águas
      if (!tall) {
        for (const k of [-1, 1]) {
          const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.2, d * 0.58), shedRoof);
          roof.rotation.x = k * 0.42;
          roof.position.set(0, h + d * 0.11, k * d * 0.26);
          bld.add(roof);
        }
      }
      bld.position.set(-110 + i * 7.5 + Math.random() * 3, -4.75, side * (12 + d / 2 + Math.random() * 14));
      this.deco(bld, false);
      this.scenery.push(bld);
    }
    // Muro baixo de concreto acompanhando a linha (passa rapidinho)
    const wallTex = grimeTexture('#7a766f', [1, 1], { tiles: 2, dark: 'rgba(0,0,0,0.25)' });
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(17, 2.2, 0.4), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 1 }));
      m.position.set(-110 + i * 18.5, -3.65, 9.5);
      this.deco(m, false);
      this.scenery.push(m);
    }
    // Horizonte da cidade lá longe (parado, sumindo na neblina)
    for (let i = 0; i < 22; i++) {
      const h = 20 + Math.random() * 45;
      const w = 8 + Math.random() * 10;
      const tex = windowsTexture(6, 14, 0.25, walls[i % walls.length]);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, Math.round(h / 12));
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 1 }));
      b.position.set(-160 + i * 15 + Math.random() * 6, -4.75 + h / 2, -55 - Math.random() * 30);
      this.deco(b, false);
    }

    // Túnel (fica longe até a hora de passar)
    this.tunnel = new THREE.Group();
    const rock = this.material(0x6d6458, { roughness: 1 });
    const len = 30;
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 6, 10), rock);
    top.position.set(len / 2, 1.3 + 3, 0);
    const l = new THREE.Mesh(new THREE.BoxGeometry(len, 8, 2), rock);
    l.position.set(len / 2, -1, 3.2);
    const r = l.clone();
    r.position.z = -3.2;
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 6.4), new THREE.MeshStandardMaterial({ color: 0xffcc00 }));
    mouth.position.set(0, 1.45, 0);
    this.tunnel.add(top, l, r, mouth);
    this.tunnel.position.x = 999;
    this.deco(this.tunnel);

    this.prop('caixa', new THREE.Vector3(-8, 0.5, 0.4));
    this.prop('caixa', new THREE.Vector3(8.5, 0.5, -0.4), 0x8fbf5a);
    this.prop('barril', new THREE.Vector3(2.5, 0.5, 0.6));

    this.spawns = [new THREE.Vector3(-2.2, 0.08, 0.3), new THREE.Vector3(2.2, 0.08, -0.3), new THREE.Vector3(-8.6, 0.08, 0), new THREE.Vector3(8.6, 0.08, 0)];
  }

  /** Coloca os dormentes (deslocados pelo movimento do trem). */
  private placeSleepers(offset: number) {
    const m = new THREE.Matrix4();
    let n = 0;
    for (const tz of TRACKS)
      for (let i = 0; i < SLEEPERS_PER_TRACK; i++) {
        let x = -100 + i * SLEEPER_GAP - offset;
        if (x < -100) x += SLEEPERS_PER_TRACK * SLEEPER_GAP;
        m.makeTranslation(x, -4.37, tz);
        this.sleepers.setMatrixAt(n++, m);
      }
    this.sleepers.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, time: number, arena: ArenaApi) {
    // Cenário passando (chão, brita, dormentes, postes)
    this.groundTex.offset.x += (SPEED * dt) / (400 / 40);
    this.ballastTex.offset.x += (SPEED * dt) / (400 / 100);
    this.sleeperOffset = (this.sleeperOffset + SPEED * dt) % SLEEPER_GAP;
    this.placeSleepers(this.sleeperOffset);
    for (const p of this.telePoles) {
      p.position.x -= SPEED * dt;
      if (p.position.x < -110) p.position.x += 225;
    }
    for (const s of this.scenery) {
      s.position.x -= SPEED * dt;
      if (s.position.x < -110) s.position.x += 220;
    }
    for (const w of this.wheels) w.rotation.y = time * 20;
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.12;
      arena.effects.dust(new THREE.Vector3(FRONT + 4.4, 1.4, 0), 0.2, 0x999999);
    }

    // Vento: quem está no ar é empurrado para trás
    for (const f of arena.fighters) {
      if (f.removed || f.grounded) continue;
      for (const b of f.ragdoll.bodies()) {
        const v = b.linvel();
        b.setLinvel({ x: v.x - 2.2 * dt, y: v.y, z: v.z }, true);
      }
    }

    // ----- postes
    this.poleTimer -= dt;
    if (this.poleTimer <= 0) {
      this.poleTimer = 5 + Math.random() * 4;
      const side = Math.random() < 0.5 ? 1 : -1;
      this.spawnPole(side);
      arena.announce(side > 0 ? '⚠ Poste vindo do lado de CÁ!' : '⚠ Poste vindo do lado de LÁ!', 'tip');
      arena.sound('horn', 0.5);
    }
    for (const p of this.poles) {
      const before = p.x;
      p.x -= SPEED * 1.1 * dt;
      p.obj.position.x = p.x;
      // O braço do poste cobre a faixa da beirada do teto.
      for (const f of arena.fighters) {
        if (!f.alive || f.removed || p.hit.has(f)) continue;
        const c = f.pos('head');
        const inZone = c.z * p.side > HALF_W - 0.75 && c.z * p.side < HALF_W + 1.2 && c.y > 0.6 && c.y < 2.8;
        if (inZone && before >= c.x && p.x < c.x) {
          p.hit.add(f);
          arena.hazardHit(f, 45, new THREE.Vector3(-1, 0.45, p.side * 0.6).normalize(), 9, 'POSTE!');
        }
      }
    }
    this.poles = this.poles.filter((p) => {
      if (p.x < -40) {
        p.obj.parent?.remove(p.obj);
        return false;
      }
      return true;
    });

    // ----- túnel
    this.tunnelTimer -= dt;
    if (this.tunnelTimer < 3.5 && !this.tunnelWarned) {
      this.tunnelWarned = true;
      arena.announce('🚇 TÚNEL! Abaixe-se: pendure-se na lateral ou desça no engate!', 'tip');
      arena.sound('horn', 1);
    }
    if (this.tunnelTimer <= 0 && this.tunnelX > 900) {
      this.tunnelX = FRONT + 22;
      this.tunnelHit.clear();
    }
    if (this.tunnelX < 900) {
      const before = this.tunnelX;
      this.tunnelX -= SPEED * dt;
      this.tunnel.position.x = this.tunnelX;
      for (const f of arena.fighters) {
        if (!f.alive || f.removed || this.tunnelHit.has(f)) continue;
        const h = f.pos('head');
        if (h.y > 1.0 && before >= h.x && this.tunnelX < h.x) {
          this.tunnelHit.add(f);
          arena.hazardHit(f, 60, new THREE.Vector3(-1, 0.25, 0).normalize(), 11, 'TÚNEL!');
        }
      }
      if (this.tunnelX + 30 < BACK - 10) {
        this.tunnelX = 999;
        this.tunnel.position.x = 999;
        this.tunnelTimer = 20 + Math.random() * 8;
        this.tunnelWarned = false;
      }
    }
  }

  private spawnPole(side: number) {
    const g = new THREE.Group();
    const m = this.material(0x6b4a2a);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 7.5, 8), m);
    post.position.set(0, -0.6, side * (HALF_W + 1.9));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 2.2), m);
    arm.position.set(0, 1.5, side * (HALF_W + 0.9));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4444 }));
    lamp.position.set(0, 1.3, side * (HALF_W + 0.1));
    g.add(post, arm, lamp);
    g.position.x = FRONT + 30;
    this.deco(g);
    this.poles.push({ obj: g, x: g.position.x, side, hit: new Set() });
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // Túnel vindo: desce para o engate mais perto (lugar baixo e seguro)
    if (this.tunnelTimer < 3.5 || this.tunnelX < 900) {
      if (p.y < -0.6) return null; // já está lá embaixo
      const gaps = [(WAGONS[0] + WAGONS[1]) / 2, (WAGONS[1] + WAGONS[2]) / 2];
      const gx = Math.abs(p.x - gaps[0]) < Math.abs(p.x - gaps[1]) ? gaps[0] : gaps[1];
      return new THREE.Vector3(gx, 0, 0);
    }
    // Poste vindo do meu lado: vai para o meio do teto
    for (const pole of this.poles) {
      const ahead = pole.x - p.x;
      if (ahead > -1 && ahead < 22 && p.z * pole.side > HALF_W - 0.95) return new THREE.Vector3(p.x, 0, 0);
    }
    return null;
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < -4.2) return 'left';
    const offTrain = Math.abs(p.z) > HALF_W + 0.4 || p.x < BACK - 0.4 || p.x > FRONT + 5.6;
    if (offTrain && p.y < -2.3) return 'left';
    return 'none';
  }
}

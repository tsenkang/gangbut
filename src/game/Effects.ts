import * as THREE from 'three';

// ------------------------------------------------------------
// Efeitos: partículas (poeira, gotas de gelatina, faíscas, fogo),
// estrelinhas girando na cabeça de quem está tonto e textos
// engraçados que pulam na tela ("NOCAUTE!", "QUE QUEDA!").
// Usamos InstancedMesh: centenas de partículas num só desenho.
// ------------------------------------------------------------

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  grow: number;
  gravity: number;
  drag: number;
  color: THREE.Color;
}

class ParticlePool {
  mesh: THREE.InstancedMesh;
  items: Particle[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    public capacity: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // força a criação do buffer de cores
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  }

  spawn(p: Omit<Particle, 'maxLife'>) {
    if (this.items.length >= this.capacity) this.items.shift();
    this.items.push({ ...p, maxLife: p.life });
  }

  update(dt: number) {
    let n = 0;
    const alive: Particle[] = [];
    for (const p of this.items) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.pow(p.drag, dt));
      p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.maxLife;
      const size = Math.max(0.001, p.size * (p.grow > 0 ? 1 + (1 - k) * p.grow : k));
      this.s.setScalar(size);
      this.m.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, p.color);
      n++;
      alive.push(p);
    }
    this.items = alive;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.items = [];
    this.mesh.count = 0;
  }
}

function starGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.45;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
  g.center();
  return g;
}

interface PopText {
  el: HTMLDivElement;
  world: THREE.Vector3;
  life: number;
}

export class Effects {
  group = new THREE.Group();
  blobs: ParticlePool;
  glow: ParticlePool;
  private stars: THREE.InstancedMesh;
  private starCount = 0;
  private texts: PopText[] = [];
  private layer: HTMLDivElement;
  private tmpM = new THREE.Matrix4();

  constructor(private camera: THREE.Camera) {
    this.blobs = new ParticlePool(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.4 }),
      500,
    );
    this.glow = new ParticlePool(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      300,
    );
    this.stars = new THREE.InstancedMesh(starGeometry(), new THREE.MeshBasicMaterial({ color: 0xffe14d }), 64);
    this.stars.frustumCulled = false;
    this.stars.count = 0;
    this.group.add(this.blobs.mesh, this.glow.mesh, this.stars);
    this.layer = document.createElement('div');
    this.layer.className = 'fx-layer';
    document.getElementById('app')!.appendChild(this.layer);
  }

  private rnd(s: number) {
    return (Math.random() * 2 - 1) * s;
  }

  /** Poeira ao cair no chão. */
  dust(p: THREE.Vector3, amount = 1, color = 0xd8cfc0) {
    const c = new THREE.Color(color);
    const n = Math.round(6 + amount * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2.5 * amount;
      this.blobs.spawn({
        pos: p.clone().add(new THREE.Vector3(this.rnd(0.3), 0.05, this.rnd(0.3))),
        vel: new THREE.Vector3(Math.cos(a) * sp, 0.6 + Math.random() * 1.2, Math.sin(a) * sp),
        life: 0.5 + Math.random() * 0.4,
        size: 0.09 + Math.random() * 0.08,
        grow: 1.8,
        gravity: 1,
        drag: 0.08,
        color: c,
      });
    }
  }

  /** Gotas de gelatina ao levar soco (da cor do lutador). */
  drops(p: THREE.Vector3, color: number, dir: THREE.Vector3, amount = 1) {
    const c = new THREE.Color(color);
    const n = Math.round(5 + amount * 8);
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(2 + Math.random() * 4).add(new THREE.Vector3(this.rnd(2.5), 1 + Math.random() * 3, this.rnd(2.5)));
      this.blobs.spawn({ pos: p.clone(), vel: v, life: 0.6 + Math.random() * 0.4, size: 0.05 + Math.random() * 0.06, grow: 0, gravity: 16, drag: 0.6, color: c });
    }
  }

  /** Faíscas / brilho de impacto. */
  sparks(p: THREE.Vector3, color = 0xfff1a8, n = 10, speed = 6) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(this.rnd(1), this.rnd(1), this.rnd(1)).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.glow.spawn({ pos: p.clone(), vel: v, life: 0.18 + Math.random() * 0.15, size: 0.06 + Math.random() * 0.05, grow: 0, gravity: 0, drag: 0.02, color: c });
    }
  }

  /** Fogo / brasas (lava). */
  fire(p: THREE.Vector3, n = 14) {
    for (let i = 0; i < n; i++) {
      const c = new THREE.Color().setHSL(0.02 + Math.random() * 0.1, 1, 0.5 + Math.random() * 0.2);
      this.glow.spawn({
        pos: p.clone().add(new THREE.Vector3(this.rnd(0.6), 0, this.rnd(0.6))),
        vel: new THREE.Vector3(this.rnd(1.5), 3 + Math.random() * 5, this.rnd(1.5)),
        life: 0.5 + Math.random() * 0.7,
        size: 0.12 + Math.random() * 0.12,
        grow: 0,
        gravity: -2,
        drag: 0.3,
        color: c,
      });
    }
  }

  /** Respingo (água/gelatina do ringue). */
  splash(p: THREE.Vector3, color: number, n = 24) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3;
      this.blobs.spawn({
        pos: p.clone(),
        vel: new THREE.Vector3(Math.cos(a) * sp, 4 + Math.random() * 6, Math.sin(a) * sp),
        life: 0.8 + Math.random() * 0.5,
        size: 0.08 + Math.random() * 0.1,
        grow: 0,
        gravity: 16,
        drag: 0.5,
        color: c,
      });
    }
  }

  /** Estrelinhas girando na cabeça (chamar a cada quadro para quem está tonto). */
  halo(head: THREE.Vector3, time: number, n = 3) {
    for (let i = 0; i < n && this.starCount < 64; i++) {
      const a = time * 4 + (i / n) * Math.PI * 2;
      const p = new THREE.Vector3(head.x + Math.cos(a) * 0.45, head.y + 0.45 + Math.sin(time * 6 + i) * 0.05, head.z + Math.sin(a) * 0.45);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a * 2);
      this.tmpM.compose(p, q, new THREE.Vector3(0.1, 0.1, 0.1));
      this.stars.setMatrixAt(this.starCount++, this.tmpM);
    }
  }

  /** Texto que pula na tela. */
  text(world: THREE.Vector3, msg: string, cls = '') {
    const el = document.createElement('div');
    el.className = 'pop ' + cls;
    el.textContent = msg;
    el.style.setProperty('--rot', `${(Math.random() * 2 - 1) * 10}deg`);
    this.layer.appendChild(el);
    this.texts.push({ el, world: world.clone(), life: 1.3 });
  }

  /** Começo do quadro: zera as estrelinhas. */
  beginFrame() {
    this.starCount = 0;
  }

  update(dt: number) {
    this.blobs.update(dt);
    this.glow.update(dt);
    this.stars.count = this.starCount;
    this.stars.instanceMatrix.needsUpdate = true;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.texts = this.texts.filter((t) => {
      t.life -= dt;
      if (t.life <= 0) {
        t.el.remove();
        return false;
      }
      t.world.y += dt * 0.8;
      const p = t.world.clone().project(this.camera);
      t.el.style.left = `${((p.x + 1) / 2) * w}px`;
      t.el.style.top = `${((1 - p.y) / 2) * h}px`;
      t.el.style.opacity = String(Math.min(1, t.life * 3));
      return true;
    });
  }

  clear() {
    this.blobs.clear();
    this.glow.clear();
    this.texts.forEach((t) => t.el.remove());
    this.texts = [];
  }
}

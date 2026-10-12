import * as THREE from 'three';

// ------------------------------------------------------------
// Câmera que acompanha todos os lutadores: mira no meio do grupo,
// se afasta quando eles se espalham e treme nas pancadas.
// ------------------------------------------------------------

export interface CameraSetup {
  /** Direção do alvo até a câmera (será normalizada). */
  dir: THREE.Vector3;
  minDist: number;
  maxDist: number;
  fov: number;
  /** Ponto padrão quando não há ninguém para seguir. */
  center: THREE.Vector3;
  /** Limites para o alvo não sair do mapa. */
  bounds?: THREE.Box3;
}

export class CameraRig {
  setup: CameraSetup = {
    dir: new THREE.Vector3(0, 0.6, 1),
    minDist: 12,
    maxDist: 26,
    fov: 45,
    center: new THREE.Vector3(),
  };
  target = new THREE.Vector3();
  dist = 15;
  trauma = 0;
  /** Zoom de perto (no vencedor da rodada). */
  closeUp = false;
  private time = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  configure(s: CameraSetup) {
    this.setup = { ...s, dir: s.dir.clone().normalize() };
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.target.copy(s.center);
    this.dist = (s.minDist + s.maxDist) / 2;
    this.place(0);
  }

  /** Treme a tela (0..1). */
  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number, points: THREE.Vector3[]) {
    this.time += dt;
    const s = this.setup;
    const want = new THREE.Vector3();
    let spread = 0;
    if (points.length) {
      const box = new THREE.Box3();
      for (const p of points) box.expandByPoint(p);
      box.getCenter(want);
      const size = box.getSize(new THREE.Vector3());
      spread = Math.max(size.x, size.z * 1.3, size.y * 1.6);
      want.y = Math.max(want.y, s.center.y - 2);
      if (s.bounds && !this.closeUp) want.clamp(s.bounds.min, s.bounds.max);
    } else want.copy(s.center);

    const fovRad = THREE.MathUtils.degToRad(s.fov);
    const needed = (spread * 0.5 + 2.5) / Math.tan(fovRad / 2) / Math.max(1, this.camera.aspect * 0.75);
    const wantDist = this.closeUp ? s.minDist * 0.62 : THREE.MathUtils.clamp(needed, s.minDist, s.maxDist);
    const k = 1 - Math.pow(0.04, dt);
    this.target.lerp(want, k);
    this.dist += (wantDist - this.dist) * (1 - Math.pow(0.15, dt));
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.place(dt);
  }

  private place(_dt: number) {
    const pos = this.target.clone().addScaledVector(this.setup.dir, this.dist);
    const look = this.target.clone();
    if (this.trauma > 0) {
      const t = this.time * 40;
      const a = this.trauma * this.trauma * 0.6;
      pos.x += Math.sin(t * 1.1) * a;
      pos.y += Math.sin(t * 1.7 + 1) * a;
      look.x += Math.sin(t * 1.3 + 2) * a * 0.4;
      look.y += Math.sin(t * 0.9 + 3) * a * 0.4;
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
  }

  /** Frente e direita "no chão" vistas pela câmera (para o controle). */
  groundBasis(fwd: THREE.Vector3, right: THREE.Vector3) {
    fwd.copy(this.setup.dir).negate();
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    right.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  }
}

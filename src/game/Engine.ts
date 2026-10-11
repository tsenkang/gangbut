import * as THREE from 'three';
import { FIXED_DT } from '../physics/Physics';

// ------------------------------------------------------------
// O "motor": cria o renderizador e roda o laço do jogo.
// Física em passo fixo (60x por segundo) e desenho separado.
// Também baixa a qualidade sozinho se o computador estiver sofrendo.
// ------------------------------------------------------------

export type Quality = 'alta' | 'media' | 'baixa';

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  /** Congela a física por um instante (pausa de impacto). */
  hitstop = 0;
  paused = false;
  timeScale = 1;
  quality: Quality = 'alta';
  autoQuality = true;
  fps = 60;

  onFixed: (dt: number) => void = () => {};
  onFrame: (dt: number, alpha: number) => void = () => {};
  onQualityChange: (q: Quality) => void = () => {};

  private acc = 0;
  private last = 0;
  private slowTime = 0;
  private fastTime = 0;
  private avgFrame = 1 / 60;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
    };
    requestAnimationFrame(loop);
  }

  /** Um quadro. (Separado para os testes automáticos poderem chamar.) */
  tick(dt: number) {
    if (!this.paused) {
      if (this.hitstop > 0) {
        this.hitstop -= dt;
      } else {
        this.acc += dt * this.timeScale;
        let steps = 0;
        while (this.acc >= FIXED_DT && steps < 5) {
          this.onFixed(FIXED_DT);
          this.acc -= FIXED_DT;
          steps++;
        }
        if (steps >= 5) this.acc = 0; // muito atrasado: desiste de alcançar
      }
    }
    this.onFrame(dt, this.paused ? 1 : Math.min(1, this.acc / FIXED_DT));
    this.renderer.render(this.scene, this.camera);
    this.watchPerformance(dt);
  }

  private watchPerformance(dt: number) {
    this.avgFrame += (dt - this.avgFrame) * 0.05;
    this.fps = 1 / this.avgFrame;
    if (!this.autoQuality) return;
    if (this.avgFrame > 1 / 48) {
      this.slowTime += dt;
      this.fastTime = 0;
    } else {
      this.slowTime = 0;
      if (this.avgFrame < 1 / 58) this.fastTime += dt;
    }
    // Pesado por 3 segundos seguidos: reduz as sombras.
    if (this.slowTime > 3) {
      this.slowTime = 0;
      if (this.quality === 'alta') this.setQuality('media');
      else if (this.quality === 'media') this.setQuality('baixa');
    }
  }

  setQuality(q: Quality) {
    this.quality = q;
    const r = this.renderer;
    if (q === 'alta') {
      r.shadowMap.enabled = true;
      r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } else if (q === 'media') {
      r.shadowMap.enabled = true;
      r.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    } else {
      r.shadowMap.enabled = false;
      r.setPixelRatio(1);
    }
    this.resize();
    // Avisa os materiais que as sombras mudaram.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    this.onQualityChange(q);
  }

  /** Tamanho do mapa de sombras conforme a qualidade. */
  shadowSize() {
    return this.quality === 'alta' ? 2048 : 1024;
  }
}

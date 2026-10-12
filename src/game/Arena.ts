import * as THREE from 'three';
import { Physics, type RAPIER } from '../physics/Physics';
import { LinkSet } from '../physics/BodyLink';
import { Fighter, type FighterEnv, type FighterEvent, type HitKind } from '../characters/Fighter';
import type { Appearance } from '../characters/Skins';
import { CHARACTERS } from '../characters/Skins';
import type { PartName } from '../characters/Ragdoll';
import type { GameMap, ArenaApi, Prop, DeathKind } from '../maps/MapBase';
import type { InputSource } from '../input/types';
import { Bot, type Difficulty } from '../ai/Bot';
import type { Engine } from './Engine';
import type { CameraRig } from './CameraRig';
import type { Effects } from './Effects';
import { audio, type SoundName } from '../audio/Audio';

// ------------------------------------------------------------
// A Arena é "uma rodada viva": mundo de física + mapa + lutadores.
// Ela recebe os golpes, toca sons, solta partículas e decide quem
// foi eliminado. Cada rodada nova cria uma Arena nova.
// ------------------------------------------------------------

export interface ArenaPlayer {
  slot: number;
  name: string;
  appearance: Appearance;
  source?: InputSource;
  bot?: Difficulty;
}

const POW = ['POF!', 'TUM!', 'PAH!', 'BAM!', 'PLOC!', 'TOIN!'];
const OUT_LINES: Record<string, string[]> = {
  fall: ['QUE QUEDA!', 'TCHAU!', 'LÁ SE VAI!', 'VOOOU!'],
  lava: ['TOSTADO!', 'QUE CALOR!', 'VIROU CHURRASCO!'],
  water: ['TCHIBUM!', 'AFUNDOU!', 'GELATINA NA ÁGUA!'],
  left: ['FICOU PRA TRÁS!', 'PERDEU O TREM!'],
  ko: ['DORMIU DE VEZ!', 'APAGOU!'],
};
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export class Arena implements ArenaApi {
  physics = new Physics();
  root = new THREE.Group();
  links = new LinkSet();
  props: Prop[] = [];
  fighters: Fighter[] = [];
  time = 0;
  camFwd = new THREE.Vector3();
  camRight = new THREE.Vector3();
  env: FighterEnv;
  /** Ordem de eliminação (primeiro que saiu primeiro). */
  outOrder: Fighter[] = [];
  onEliminated: (f: Fighter, kind: DeathKind | 'ko') => void = () => {};
  onAnnounce: (text: string, cls?: string) => void = () => {};
  /** Liga/desliga perigos (desligado na contagem regressiva). */
  hazardsOn = false;
  /** Multiplicador de dano (morte súbita = 2). */
  damageMult = 1;
  private lastPopAt = -9;

  constructor(
    private engine: Engine,
    public effects: Effects,
    private rig: CameraRig,
    public map: GameMap,
    players: ArenaPlayer[],
  ) {
    engine.scene.add(this.root);
    map.init({ root: this.root, physics: this.physics, links: this.links, props: this.props, shadowSize: engine.shadowSize() });
    engine.scene.fog = (this.root.userData.fog as THREE.Fog) ?? null;
    rig.configure(map.camera);
    rig.groundBasis(this.camFwd, this.camRight);

    // Cria os lutadores nos pontos de partida.
    players.forEach((p) => {
      const spawn = map.spawns[p.slot % map.spawns.length];
      let source = p.source;
      let bot: Bot | null = null;
      if (p.bot) {
        bot = new Bot(p.bot, this, 'bot' + p.slot);
        source = bot;
      }
      const yaw = Math.atan2(map.camera.center.x - spawn.x, map.camera.center.z - spawn.z);
      const f = new Fighter(p.slot, p.name, p.appearance, source!, this.physics, spawn, yaw, engine.scene);
      bot?.attach(f);
      this.fighters.push(f);
    });

    this.env = {
      physics: this.physics,
      time: 0,
      fighters: this.fighters,
      camFwd: this.camFwd,
      camRight: this.camRight,
      onHit: (a, v, power, point, dir, kind) => this.onHit(a, v, power, point, dir, kind),
      onPropHit: (_a, body, point, dir, power) => {
        const v = body.linvel();
        const k = power * 0.5;
        body.setLinvel({ x: v.x + dir.x * k, y: v.y + 2 + dir.y * k, z: v.z + dir.z * k }, true);
        this.sound('punch', 0.6, 1.4);
        this.effects.sparks(point, 0xffffff, 6, 4);
      },
      onEvent: (f, ev, amount) => this.onEvent(f, ev, amount),
    };

    this.physics.onBodyRemoved((b) => this.links.remove(b));
  }

  get alive() {
    return this.fighters.filter((f) => f.alive);
  }

  // ------------------------------------------------ ArenaApi
  shake(a: number) {
    this.rig.shake(a);
  }
  hitstop(s: number) {
    this.engine.hitstop = Math.max(this.engine.hitstop, s);
  }
  sound(name: string, vol = 1, pitch = 1) {
    audio.play(name as SoundName, vol, pitch);
  }
  announce(text: string, cls?: string) {
    this.onAnnounce(text, cls);
  }
  removeBody(body: RAPIER.RigidBody) {
    this.physics.removeBody(body);
  }
  hazardHit(victim: Fighter, power: number, dir: THREE.Vector3, knockSpeed: number, label?: string) {
    if (!victim.alive) return;
    victim.receiveHit(power * this.damageMult, dir, 'chest', knockSpeed);
    const p = victim.pos('chest');
    this.effects.drops(p, victim.appearance.color, dir, 1.4);
    this.effects.sparks(p, 0xffffff, 12, 7);
    this.sound('heavy', 1);
    this.shake(0.45);
    this.hitstop(0.05);
    victim.source.rumble?.(1, 0.8, 300);
    if (label) this.effects.text(p.add(new THREE.Vector3(0, 1, 0)), label, 'big');
  }

  // ------------------------------------------------ golpes
  private onHit(attacker: Fighter | null, victim: Fighter, power: number, point: THREE.Vector3, dir: THREE.Vector3, kind: HitKind) {
    if (!victim.alive) return;
    if (kind === 'fall') {
      if (power < 5) return;
      victim.addDizzy(power);
      const p = victim.pos('chest');
      this.effects.dust(p.clone().setY(p.y - 0.6), Math.min(2, power / 25));
      this.sound(power > 25 ? 'heavy' : 'land', Math.min(1, power / 30));
      if (power > 30) {
        this.effects.text(p.add(new THREE.Vector3(0, 1.2, 0)), pick(['QUE QUEDA!', 'PLAFT!', 'AI!']), 'big');
        this.shake(0.3);
      }
      return;
    }
    power *= this.damageMult;
    const knock = kind === 'punch' ? 2.1 : kind === 'headbutt' ? 3.8 : kind === 'kick' ? 4.6 : 3;
    const wasKo = victim.ko;
    victim.receiveHit(power, dir, partAt(victim, point), knock);
    if (attacker) {
      victim.lastAttacker = attacker;
      victim.lastAttackerAt = this.time;
      if (kind === 'headbutt') attacker.addDizzy(4); // ai, minha cabeça
    }
    const strong = power >= 18 || (!wasKo && victim.ko);
    this.effects.drops(point, victim.appearance.color, dir, strong ? 1.5 : 0.8);
    this.effects.sparks(point, 0xfff6c2, strong ? 14 : 8, strong ? 8 : 5);
    this.sound(strong ? 'heavy' : 'punch', 1, kind === 'headbutt' ? 0.8 : 1);
    this.shake(strong ? 0.4 : 0.16);
    if (strong) this.hitstop(0.05);
    victim.source.rumble?.(strong ? 1 : 0.5, strong ? 0.9 : 0.6, strong ? 280 : 120);
    attacker?.source.rumble?.(0.2, 0.4, 70);
    const label = kind === 'headbutt' ? 'CABEÇADA!' : kind === 'kick' ? 'VOADORA!' : pick(POW);
    // Um texto por vez (senão a tela vira sopa de letrinhas)
    if ((kind !== 'punch' || Math.random() < 0.45) && this.time - this.lastPopAt > 0.35 && (this.lastPopAt = this.time) >= 0) this.effects.text(point.clone().add(new THREE.Vector3(0, 0.5, 0)), label, strong ? 'big' : '');
  }

  private onEvent(f: Fighter, ev: FighterEvent, amount = 1) {
    const voice = CHARACTERS.find((c) => c.id === f.appearance.character)?.voice ?? 1;
    switch (ev) {
      case 'jump':
        this.sound('jump', 0.7, voice);
        break;
      case 'land':
        this.effects.dust(f.pos('pelvis').setY(f.pos('pelvis').y - 0.7), amount);
        this.sound('land', 0.4 * amount);
        break;
      case 'ko': {
        const p = f.pos('head').add(new THREE.Vector3(0, 0.8, 0));
        this.effects.text(p, 'NOCAUTE!', 'ko');
        this.sound('ko', 1, voice);
        this.shake(0.35);
        this.hitstop(0.06);
        f.source.rumble?.(1, 1, 450);
        break;
      }
      case 'wake':
        this.sound('boing', 0.6, voice);
        break;
      case 'grab':
        this.sound('grab', 0.5);
        break;
      case 'throw':
        this.sound('throw', 0.8);
        break;
      case 'bigthrow':
        this.sound('throw', 1, 0.7);
        this.sound('cheer', 0.5);
        this.shake(0.3);
        this.effects.text(f.pos('head').add(new THREE.Vector3(0, 1.4, 0)), pick(['LÁ VAI!', 'ARREMESSO!', 'VOA!']), 'big');
        break;
      case 'punch':
      case 'kick':
        this.sound('whoosh', 0.5, ev === 'kick' ? 0.7 : 1);
        break;
      case 'headbutt':
        this.sound('whoosh', 0.5, 0.6);
        break;
      case 'climb':
        this.sound('jump', 0.5, 0.7 * voice);
        break;
      case 'scream':
        this.sound('scream', 0.8, voice);
        break;
      case 'escape': {
        // Solta todo mundo que estava me segurando, com um empurrão.
        for (const o of this.fighters) {
          for (const h of [o.hands.L, o.hands.R]) {
            if (h.targetInfo?.owner === f) {
              h.release(0.8);
              const d = o.pos('chest').sub(f.pos('chest')).setY(0.3).normalize();
              o.knock(d, 4);
            }
          }
        }
        this.sound('escape', 0.8);
        this.effects.text(f.pos('head').add(new THREE.Vector3(0, 0.8, 0)), 'ESCAPOU!');
        break;
      }
    }
  }

  // ------------------------------------------------ laço
  fixedStep(dt: number) {
    this.time += dt;
    this.env.time = this.time;
    if (this.hazardsOn) this.map.update(dt, this.time, this);

    // Quem está sendo segurado por quantas mãos?
    for (const f of this.fighters) f.grabbedBy = 0;
    for (const f of this.fighters) {
      for (const h of [f.hands.L, f.hands.R]) {
        const o = h.targetInfo?.owner as Fighter | undefined;
        if (h.holding() && h.targetInfo?.kind === 'fighter' && o && o !== f) o.grabbedBy++;
      }
    }

    for (const f of this.fighters) f.step(this.env, dt);
    this.physics.step();
    this.links.capture();
    for (const f of this.fighters) f.afterPhysics();
    this.checkDeaths();
  }

  private checkDeaths() {
    for (const f of this.fighters) {
      if (f.removed) continue;
      if (f.alive) {
        let kind: DeathKind | 'ko' = this.map.deathAt(f.pos('chest'));
        if (kind === 'none') kind = this.map.deathAt(f.pos('pelvis'));
        if (kind === 'none' && f.koTotal > 22) kind = 'ko';
        if (kind !== 'none') this.eliminate(f, kind);
      } else {
        // Some do mundo depois de um tempinho (ou se cair muito).
        const gone = this.time - f.eliminatedAt > 2.5 || f.pos('chest').y < this.map.killY - 12;
        if (gone) {
          if (f.pos('chest').y > this.map.killY) this.effects.dust(f.pos('chest'), 2, 0xffffff);
          f.removeFromWorld();
        }
      }
    }
    for (const p of [...this.props]) {
      if (!p.body.isValid()) continue;
      const y = p.body.translation().y;
      if (y < this.map.killY - 10 || this.map.deathAt(new THREE.Vector3(0, y, 0)) === 'lava') {
        this.physics.removeBody(p.body);
        p.mesh.parent?.remove(p.mesh);
        this.props.splice(this.props.indexOf(p), 1);
      }
    }
  }

  private eliminate(f: Fighter, kind: DeathKind | 'ko') {
    f.eliminate(this.time);
    this.outOrder.push(f);
    const p = f.pos('chest');
    const k = kind === 'none' ? 'fall' : kind;
    if (k === 'lava') {
      this.effects.fire(p, 30);
      this.sound('sizzle', 1);
      // Afunda devagar na lava
      for (const b of f.ragdoll.bodies()) {
        b.setLinearDamping(6);
        b.setGravityScale(0.15, true);
      }
    } else if (k === 'water') {
      this.effects.splash(p, 0xff7eb6);
      this.sound('splash', 1);
    }
    this.sound('elim', 0.8);
    this.sound('cheer', 0.6);
    f.source.rumble?.(0.8, 0.8, 500);
    const by = f.lastAttacker && this.time - f.lastAttackerAt < 6 && f.lastAttacker !== f ? f.lastAttacker : null;
    const line = pick(OUT_LINES[k] ?? OUT_LINES.fall);
    this.onAnnounce(by ? `${by.name} derrubou ${f.name}! ${line}` : `${f.name}: ${line}`, 'out');
    this.onEliminated(f, kind);
  }

  /** Desenho (a cada quadro). */
  frame(dt: number, alpha: number) {
    this.links.apply(alpha);
    for (const f of this.fighters) f.render(alpha);
    const pts: THREE.Vector3[] = [];
    for (const f of this.fighters) {
      if (f.removed) continue;
      if (f.alive) pts.push(f.pos('chest'));
      if (f.alive && (f.ko || f.dizzy > 70)) this.effects.halo(f.skin.parts.head.position, this.time, f.ko ? 3 : 2);
    }
    this.rig.update(dt, pts);
  }

  dispose() {
    for (const f of this.fighters) f.dispose();
    this.map.dispose();
    this.engine.scene.remove(this.root);
    this.engine.scene.fog = null;
    this.physics.dispose();
    this.effects.clear();
  }
}

/** Qual parte do corpo está mais perto do ponto atingido? */
function partAt(f: Fighter, p: THREE.Vector3): PartName {
  let best: PartName = 'chest';
  let bd = Infinity;
  for (const n of ['head', 'chest', 'pelvis'] as PartName[]) {
    const d = f.pos(n).distanceToSquared(p);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

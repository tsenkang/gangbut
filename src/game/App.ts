import * as THREE from 'three';
import { Engine } from './Engine';
import { CameraRig } from './CameraRig';
import { Effects } from './Effects';
import { Arena, type ArenaPlayer } from './Arena';
import { Match } from './Match';
import type { MatchConfig, PlayerSetup } from './config';
import { InputManager } from '../input/InputManager';
import { Lobby } from '../maps/Lobby';
import { CHARACTERS, COLORS, HATS } from '../characters/Skins';
import { MainMenu } from '../ui/MainMenu';
import { CharacterSelect, defaultAppearance, type SlotState } from '../ui/CharacterSelect';
import { MatchSetup, type SetupState } from '../ui/MatchSetup';
import { ControlsScreen } from '../ui/ControlsScreen';
import { toast, type Screen } from '../ui/UI';
import { audio } from '../audio/Audio';
import { music } from '../audio/Music';
import { DIFFICULTY_NAMES } from '../ai/Bot';

// ------------------------------------------------------------
// O App controla em qual tela estamos: menu → escolha de
// personagem → regras → partida → (de novo / menu).
// No fundo dos menus fica um "palco" 3D com os bonecos.
// ------------------------------------------------------------

export class App {
  engine: Engine;
  rig: CameraRig;
  effects: Effects;
  input = new InputManager();
  screen: Screen | null = null;
  showcase: Arena | null = null;
  match: Match | null = null;
  slots: SlotState[] = [0, 1, 2, 3].map((i) => ({ deviceId: null, appearance: defaultAppearance(i), row: 0, ready: false }));
  vsBots = false;
  setup: SetupState = { mapId: 'telhado', bestOf: 3, bots: 0, difficulty: 'medio' };
  lastConfig: MatchConfig | null = null;
  private showcaseKey = '';
  private showcaseMode: 'brawl' | 'lineup' = 'brawl';

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas);
    this.rig = new CameraRig(this.engine.camera);
    this.effects = new Effects(this.engine.camera);
    this.engine.scene.add(this.effects.group);

    this.engine.onFixed = (dt) => {
      if (this.match) this.match.fixed(dt);
      else this.showcase?.fixedStep(dt);
    };
    this.engine.onFrame = (dt, alpha) => {
      this.input.update(dt);
      if (this.input.anyEdges().length) audio.unlock();
      this.effects.beginFrame();
      this.screen?.update(dt);
      if (this.match) this.match.frame(dt, alpha);
      else if (this.showcase) {
        this.showcase.frame(dt, alpha);
        if (this.showcaseMode === 'brawl' && (this.showcase.alive.length < 2 || this.showcase.time > 45)) this.buildShowcase(true);
      }
      this.effects.update(dt);
      this.input.endFrame();
    };

    // Avisos de controle ligado/desligado (em qualquer momento).
    this.input.onConnect((p) => {
      toast(`🎮 ${p.label} conectado (controle ${p.index + 1})`, 'ok');
      audio.play('join');
      if (this.screen instanceof CharacterSelect) this.screen.padConnected(p);
    });
    this.input.onDisconnect((p) => {
      const slot = this.slots.findIndex((s) => s.deviceId === p.id);
      const who = slot >= 0 ? ` — Jogador ${slot + 1}` : '';
      toast(`⚠ ${p.label} desconectado${who}`, 'warn', 5000);
      audio.play('uiBack');
      const inMatch = this.match?.config.players.find((x) => x.deviceId === p.id);
      if (this.match && inMatch) this.match.pause(`O controle de ${inMatch.name} desligou. Reconecte e aperte Continuar.`);
    });
    for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, () => audio.unlock());
  }

  start() {
    this.goMenu();
    this.engine.start();
  }

  private setScreen(s: Screen | null) {
    this.screen?.destroy();
    this.screen = s;
    this.input.swallow();
  }

  // ------------------------------------------------ palco do fundo
  private buildShowcase(force = false) {
    const brawl = this.showcaseMode === 'brawl';
    const key = brawl ? 'brawl' : this.slots.map((s) => (s.deviceId ? 'x' : '-')).join('');
    if (!force && key === this.showcaseKey && this.showcase) {
      // Mesmos jogadores: só troca a aparência.
      if (!brawl)
        for (const f of this.showcase.fighters) {
          const s = this.slots[f.index];
          if (s && JSON.stringify(s.appearance) !== JSON.stringify(f.appearance)) f.setAppearance(s.appearance);
        }
      return;
    }
    this.showcaseKey = key;
    this.showcase?.dispose();
    let players: ArenaPlayer[];
    if (brawl) {
      players = [0, 1, 2, 3].map((i) => ({
        slot: i,
        name: CHARACTERS[i].name,
        appearance: { character: CHARACTERS[i].id, color: COLORS[(i * 2 + Math.floor(Math.random() * 3)) % COLORS.length].hex, hat: HATS[Math.floor(Math.random() * HATS.length)].id },
        bot: 'facil',
      }));
    } else {
      players = this.slots
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.deviceId)
        .map(({ s, i }) => ({ slot: i, name: 'J' + (i + 1), appearance: s.appearance, source: this.input.keyboardA }));
    }
    const arena = new Arena(this.engine, this.effects, this.rig, new Lobby(), players);
    arena.hazardsOn = true;
    if (!brawl)
      arena.fighters.forEach((f) => {
        f.frozen = true;
        f.facing = 0;
      });
    this.showcase = arena;
  }

  private dropShowcase() {
    this.showcase?.dispose();
    this.showcase = null;
    this.showcaseKey = '';
  }

  // ------------------------------------------------ telas
  goMenu() {
    this.endMatch();
    music.play('menu');
    this.showcaseMode = 'brawl';
    this.buildShowcase();
    this.setScreen(
      new MainMenu(this.input, this.engine, {
        local: () => this.goSelect(false),
        bots: () => this.goSelect(true),
        controls: () => this.goControls(),
      }),
    );
  }

  goSelect(vsBots: boolean, keepSlots = false) {
    this.endMatch();
    this.vsBots = vsBots;
    music.play('menu');
    if (!keepSlots) this.slots.forEach((s) => (s.ready = false));
    else this.slots.forEach((s) => (s.ready = false));
    this.showcaseMode = 'lineup';
    const sel = new CharacterSelect(
      this.input,
      this.slots,
      vsBots,
      {
        changed: () => this.buildShowcase(),
        done: () => this.goSetup(),
        back: () => {
          this.slots.forEach((s) => {
            s.deviceId = null;
            s.ready = false;
          });
          this.goMenu();
        },
      },
      true,
    );
    this.setScreen(sel);
    this.buildShowcase(true);
  }

  goSetup() {
    this.endMatch();
    music.play('menu');
    const humans = this.slots.filter((s) => s.deviceId).length;
    if (this.vsBots) this.setup.bots = 4 - humans;
    else if (humans < 2 && this.setup.bots === 0) this.setup.bots = 1;
    if (!this.showcase) {
      this.showcaseMode = 'lineup';
      this.buildShowcase(true);
    }
    this.setScreen(
      new MatchSetup(this.input, this.setup, humans, {
        start: () => this.startMatch(this.buildConfig()),
        back: () => this.goSelect(this.vsBots, true),
      }),
    );
  }

  goControls() {
    this.setScreen(
      new ControlsScreen(
        this.input,
        () => {
          const m = new Map<string, number>();
          this.slots.forEach((s, i) => s.deviceId && m.set(s.deviceId, i));
          return m;
        },
        {
          back: () => this.goMenu(),
          reset: () => {
            this.slots.forEach((s) => (s.deviceId = null));
            this.goSelect(this.vsBots);
          },
        },
      ),
    );
  }

  private buildConfig(): MatchConfig {
    const players: PlayerSetup[] = [];
    this.slots.forEach((s, i) => {
      if (s.deviceId) players.push({ slot: i, name: 'J' + (i + 1), appearance: s.appearance, deviceId: s.deviceId });
    });
    // Robôs ocupam as vagas livres, com personagens diferentes.
    let bots = this.setup.bots;
    let n = 1;
    for (let i = 0; i < 4 && bots > 0; i++) {
      if (this.slots[i].deviceId) continue;
      const used = new Set(players.map((p) => p.appearance.character));
      const c = CHARACTERS.find((x) => !used.has(x.id)) ?? CHARACTERS[i];
      players.push({
        slot: i,
        name: `CPU ${n++}`,
        appearance: { character: c.id, color: c.defaultColor, hat: HATS[(i + 2) % HATS.length].id },
        bot: this.setup.difficulty,
      });
      bots--;
    }
    players.sort((a, b) => a.slot - b.slot);
    return { players, mapId: this.setup.mapId, bestOf: this.setup.bestOf };
  }

  startMatch(cfg: MatchConfig) {
    this.endMatch();
    this.setScreen(null);
    this.dropShowcase();
    this.lastConfig = cfg;
    const bots = cfg.players.filter((p) => p.bot);
    if (bots.length) toast(`🤖 ${bots.length} robô(s) — ${DIFFICULTY_NAMES[bots[0].bot!]}`, 'info');
    const m = new Match({ engine: this.engine, rig: this.rig, effects: this.effects, input: this.input }, cfg);
    m.onExit = (choice) => {
      if (choice === 'again') this.startMatch(cfg);
      else if (choice === 'setup') {
        this.endMatch();
        this.goSetup();
      } else this.goMenu();
    };
    this.match = m;
    m.start();
  }

  private endMatch() {
    if (!this.match) return;
    this.match.dispose();
    this.match = null;
  }

  /** Para testes automáticos: roda a física sem desenhar. */
  simulate(seconds: number) {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      this.engine.onFixed(1 / 60);
      if (i % 6 === 0) this.engine.onFrame(0.1, 1);
    }
  }
}

export { THREE };

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import './ui/style.css';
import { Engine } from './game/Engine';
import { CameraRig } from './game/CameraRig';
import { Effects } from './game/Effects';
import { Arena } from './game/Arena';
import { InputManager } from './input/InputManager';
import { makeMap } from './maps/index';
import { audio } from './audio/Audio';

// Ponto de partida: carrega a física e liga o jogo.
async function boot() {
  await RAPIER.init();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const engine = new Engine(canvas);
  const rig = new CameraRig(engine.camera);
  const effects = new Effects(engine.camera);
  engine.scene.add(effects.group);
  const input = new InputManager();
  const arena = new Arena(engine, effects, rig, makeMap('telhado'), [
    { slot: 0, name: 'J1', appearance: { character: 'gominha', color: 0xff4d5e, hat: 'festa' }, source: input.keyboardA },
    { slot: 1, name: 'J2', appearance: { character: 'pao', color: 0xe9b872, hat: 'cartola' }, source: input.keyboardB },
    { slot: 2, name: 'CPU', appearance: { character: 'ovo', color: 0xf4f1ea, hat: 'gorro' }, bot: 'medio' },
    { slot: 3, name: 'CPU2', appearance: { character: 'pimentao', color: 0x3ddc84, hat: 'nenhum' }, bot: 'dificil' },
  ]);
  arena.hazardsOn = true;
  arena.onAnnounce = (t) => console.log('[anuncio]', t);
  engine.onFixed = (dt) => arena.fixedStep(dt);
  engine.onFrame = (dt, a) => {
    input.update(dt);
    effects.beginFrame();
    arena.frame(dt, a);
    effects.update(dt);
  };
  window.addEventListener('keydown', () => audio.unlock());
  const V3 = THREE.Vector3;
  const sim = (sec: number) => {
    for (let i = 0; i < sec * 60; i++) arena.fixedStep(1 / 60);
  };
  (window as unknown as Record<string, unknown>).__game = { engine, arena, input, sim, V3 };
  engine.start();
}
boot();

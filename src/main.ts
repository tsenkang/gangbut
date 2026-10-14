import RAPIER from '@dimforge/rapier3d-compat';
import './ui/style.css';
import { App } from './game/App';
import type { MatchConfig } from './game/config';

// ------------------------------------------------------------
// Ponto de partida: carrega a física (WebAssembly) e liga o jogo.
//
// Atalho: abra com ?demo=telhado (ou fabrica, rodagigante, trem, incinerador, vigas, demolicao, elevadores, farol, caminhoes, teleferico, ventiladores,
// rodizio) para ver uma partida só de robôs.
// ------------------------------------------------------------

async function boot() {
  await RAPIER.init();
  const app = new App(document.getElementById('game') as HTMLCanvasElement);
  app.start();

  const demo = new URLSearchParams(location.search).get('demo');
  if (demo) {
    const cfg: MatchConfig = {
      mapId: demo,
      bestOf: 3,
      players: [0, 1, 2, 3].map((i) => ({
        slot: i,
        name: `CPU ${i + 1}`,
        appearance: { character: 'classico', color: [0xff4d5e, 0x3a86ff, 0x3ddc84, 0xffd23f][i], hat: 'nenhum', costume: (['nenhuma', 'topete', 'nenhuma', 'craque'] as const)[i] },
        bot: (['facil', 'medio', 'dificil', 'medio'] as const)[i],
      })),
    };
    app.startMatch(cfg);
  }
  // Gancho para testes automáticos (inofensivo no jogo normal).
  (window as unknown as { __app: App }).__app = app;
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#fff;padding:20px">Erro ao iniciar: ${e}</pre>`);
});

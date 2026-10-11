import RAPIER from '@dimforge/rapier3d-compat';
import './ui/style.css';
import { App } from './game/App';
import { CHARACTERS } from './characters/Skins';
import type { MatchConfig } from './game/config';

// ------------------------------------------------------------
// Ponto de partida: carrega a física (WebAssembly) e liga o jogo.
//
// Atalho: abra com ?demo=telhado (ou fabrica, gelatina, trem, lava,
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
      players: CHARACTERS.map((c, i) => ({
        slot: i,
        name: `CPU ${i + 1}`,
        appearance: { character: c.id, color: c.defaultColor, hat: (['festa', 'cartola', 'gorro', 'nenhum'] as const)[i] },
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

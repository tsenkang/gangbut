# MOLENGAS — briga bagunçada de gelatina

Jogo de luta 3D para o navegador, com bonecos moles de gelatina que se
socam, se agarram e tentam jogar uns aos outros para fora do mapa.
Original, inspirado no estilo "party brawler".

Feito com **Vite + TypeScript**, **Three.js** (3D), **Rapier** (física),
**Web Audio API** (sons e músicas gerados por código) e **Gamepad API**.

## Como rodar

```bash
npm install
npm run dev
```

Abra o endereço que aparecer (normalmente http://localhost:5173).
Recomendado: Chrome ou Edge (melhor suporte a controles e vibração).

- `npm run build` gera a versão final em `dist/`.
- Atalho para ver uma partida só de robôs: `http://localhost:5173/?demo=telhado`
  (também `fabrica`, `rodagigante`, `trem`, `incinerador`, `vigas`, `demolicao`, `elevadores`, `farol`, `caminhoes`, `teleferico`, `ventiladores` ou `rodizio`).

## Como jogar

1. **Jogar (local)** ou **Contra robôs**.
2. Na escolha de personagem, cada jogador aperta **pular** no seu controle/teclado
   para entrar. Controles já ligados entram sozinhos.
3. Escolha personagem, cor e chapéu e marque **Pronto**.
4. Escolha mapa, rodadas (melhor de 3 ou de 5), robôs e dificuldade → **BRIGAR!**

Quem cair do mapa (ou ficar desmaiado tempo demais) está fora da rodada.
O último em pé vence a rodada.

## Controles

No menu há a tela **Como jogar** (ela também aparece antes da primeira partida). Durante a luta, cada jogador vê a legenda dos seus botões no canto de baixo e dicas em cima do próprio boneco ("Segure L para agarrar", "Espaço: subir!"...).

| Ação | Teclado A (J1) | Teclado B (J2) | Xbox | PS5 (DualSense) |
|---|---|---|---|---|
| Andar | W A S D | Setas | Analógico esquerdo | Analógico esquerdo |
| Pular / escalar | Espaço | 0 (num.) ou Enter | A | ✕ |
| Soco esquerdo | J | 1 (num.) ou , | X | □ |
| Soco direito | K | 2 (num.) ou . | B | ○ |
| Agarrar (segurar) | L | 3 (num.) ou Shift direito | LT / RT (mão esq. / dir.) | L2 / R2 |
| Cabeçada | U | 5 (num.) | Y | △ |
| Erguer os braços | I | 6 (num.) | Analógico direito | Analógico direito |
| Pausar | Esc | Enter do numérico | Start | Options |

Os botões de ombro (LB/RB, L1/R1) também agarram. O direcional também anda.

**Manhas**
- Segurando alguém (ou uma caixa), aperte **soco** para arremessar. Quem está
  desmaiado voa bem mais longe.
- Pendurado numa borda, aperte **pular** para subir (dá para ir "mão por mão").
- **Segure** o soco e solte: o boneco puxa o braço lá atrás e solta um **socão** (bate e empurra bem mais).
- No ar, **soco** vira **voadora** com as duas pernas: forte, mas você cai de costas depois.
- Segurando alguém com as duas mãos, **erga os braços** (I / analógico direito) para levantá-lo acima da cabeça; o arremesso de lá de cima (ou correndo) vai muito mais longe.
- Para pegar alguém caído, segure **agarrar** perto dele: o boneco se abaixa e mira sozinho.
- Erguendo alguém acima da cabeça, **soltar o agarrar** também arremessa.
- Golpe forte (socão, voadora, cabeçada ou soco em quem está tonto) dá um **tombo**: o boneco cai,
  larga o que estava segurando e levanta cambaleando.
- Soque a **mão** de quem está pendurado numa borda: ele solta!
- Correndo, você dá um **tranco** em quem estiver na frente (quem está tonto vai ao chão).
- Desmaiado? Aperte botões rápido para acordar antes.
- Alguém te segurando? Aperte botões sem parar para **escapar**.
- Quanto mais você apanha, mais a barra de **tontura** enche; cheia = nocaute.
  Cada nocaute dura mais que o anterior.

Controles ligados ou desligados no meio do jogo aparecem num aviso no canto da
tela. Se o controle de alguém desligar durante a luta, o jogo pausa sozinho.

## Personagens

O padrão é o **Clássico**: um feijão de gelatina inteiriço (uma pele lisa só, que dobra e amassa seguindo quadril, tronco e cabeça), sem pescoço, com dois olhinhos ovais, braços compridos e molengas com mãozinhas redondas e perninhas curtas (estilo "party brawler"). As roupas das fantasias também dobram junto com o corpo. Também há Gominha, Pão de Forma, Ovo e Pimentão.

## Fantasias

Na escolha de personagem, a linha **Fantasia** veste o boneco com visuais de paródia
que lembram gente famosa (sem nomes reais): Rei do Topete, Gênio Descabelado,
Astro do Pop, Craque Camisa 10, Majestade e Bigode Artista. Combinam com qualquer
personagem e cor. Para criar uma nova, veja `src/characters/Costumes.ts`.

## Mapas

| Mapa | Perigo |
|---|---|
| 🏙️ Telhado | Noite, outdoor de neon com passarela; a frente não tem mureta |
| 🏭 Fábrica | Esteira que leva todo mundo para o buraco + prensa que desce de tempos em tempos |
| 🎡 Roda-Gigante | Plataformas de embarque e cabines que sobem e descem; de vez em quando a roda dispara |
| 🚂 Trem em Movimento | Atravessa a periferia da cidade; postes rentes aos lados e túnel que varre quem estiver em pé |
| 🔥 Incinerador | Passarela de grades sobre a fornalha: as grades caem uma a uma e às vezes sobe uma labareda |
| 🏗️ Vigas | Vigas estreitas de prédio em obras, guindaste que varre e ventania |
| 💥 Demolição | Último andar de um prédio sendo derrubado: a bola de demolição balança e muda de faixa |
| 🛗 Elevadores | Três elevadores de obra subindo e descendo; lá no alto a viga raspa a cabeça |
| 🌊 Farol | Varanda redonda num farol, na tempestade: guarda-corpo com buracos e rajadas de vento |
| 🚚 Caminhões | Briga em cima de dois caminhões de baú que se afastam e encostam; placas passam por cima |
| 🚡 Teleférico | Duas cabines vão e voltam entre estações nas montanhas e se cruzam no meio |
| 🌀 Ventiladores | Terraço com ventiladores gigantes no chão: a grade pisca e joga quem está em cima lá no alto |

## Como adicionar um mapa novo

1. Crie `src/maps/MeuMapa.ts` com uma classe que estende `GameMap`
   (veja `Rooftop.ts`, o mais simples):

   ```ts
   import * as THREE from 'three';
   import { GameMap, type ArenaApi } from './MapBase';

   export class MeuMapa extends GameMap {
     id = 'meumapa';
     name = 'Meu Mapa';
     emoji = '🏝️';
     description = 'Uma ilha pequena.';
     hazard = 'A maré sobe!';
     music = 'gelatina' as const;          // tema de música
     killY = -8;                            // abaixo disso = fora
     camera = {
       dir: new THREE.Vector3(0, 0.7, 1),   // de onde a câmera olha
       minDist: 11, maxDist: 22, fov: 42,
       center: new THREE.Vector3(0, 0.5, 0),
     };

     build() {
       this.lights({ skyTop: 0x4fa3ff, skyBottom: 0xd8f0ff, sunColor: 0xffffff, sunIntensity: 2.4,
         sunPos: new THREE.Vector3(8, 20, 10), hemiSky: 0xffffff, hemiGround: 0x557755, hemiIntensity: 1.2 });
       this.box({ x: 0, y: -0.5, z: 0 }, { x: 12, y: 1, z: 8 }, 0x88cc66); // chão (topo em y = 0)
       this.prop('caixa', new THREE.Vector3(2, 0.5, 0));                  // peça solta
       this.spawns = [ /* 4 pontos de partida */ ];
     }

     update(dt: number, time: number, arena: ArenaApi) {
       // perigos: mova objetos, use arena.hazardHit(...), arena.announce(...)
     }
   }
   ```

2. Registre em `src/maps/index.ts`:
   `{ id: 'meumapa', make: () => new MeuMapa() },`

Se o meio do mapa for um buraco (ou o chão se mexer), sobrescreva `safeSpot(p)`
para dizer aos robôs onde fica o chão firme mais perto.

Pronto: ele aparece na tela de regras e no rodízio. Para algo que mata na hora
(lava, água), sobrescreva `deathAt(p)`.

## Organização do código

```
src/
  main.ts            inicia tudo (e o modo ?demo=)
  game/              App (telas), Match (rodadas/placar), Arena (uma rodada viva),
                     Engine (laço com física em passo fixo), câmera, efeitos
  physics/           mundo Rapier, grupos de colisão, agarrar, interpolação
  characters/        boneco (Ragdoll), lutador (Fighter), músculos/animação, visual (Skins)
  maps/              um arquivo por mapa + Lobby (palco do menu)
  input/             teclado, controles, gerenciador (liga/desliga)
  ai/                robôs (fácil, médio, difícil)
  ui/                menus, escolha de personagem, HUD, estilos
  audio/             efeitos sonoros e música gerados por código
```

Ajustes rápidos de sensação (velocidade, pulo, força dos golpes, duração do
nocaute) ficam em `TUNING`, no topo de `src/characters/Fighter.ts`.

## Desempenho

- Física a 60 passos por segundo, desenho separado e interpolado.
- Cerca de 1 ms por passo de física com 4 lutadores + peças.
- Se o jogo ficar abaixo de ~48 FPS por alguns segundos, a qualidade cai
  sozinha (menos resolução, depois sem sombras). Dá para fixar a qualidade
  no menu principal.

## Publicar na web (GitHub Pages)

O repositório já tem o workflow `.github/workflows/pages.yml`, que compila e
publica o jogo a cada push.

1. No GitHub, abra o repositório → **Settings** → **Pages**.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.
3. Vá em **Actions** → **Publicar no GitHub Pages** → **Run workflow**
   (ou refaça a última execução com **Re-run jobs**).
4. O endereço aparece em Settings → Pages, algo como
   `https://<seu-usuario>.github.io/gangbut/`.

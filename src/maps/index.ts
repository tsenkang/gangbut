import type { GameMap } from './MapBase';
import { Rooftop } from './Rooftop';
import { Factory } from './Factory';
import { JellyRing } from './JellyRing';
import { Train } from './Train';
import { LavaBridge } from './LavaBridge';

// ------------------------------------------------------------
// Lista de mapas. Para adicionar um mapa novo, importe a classe
// e coloque uma linha aqui (o id precisa ser o mesmo da classe).
// ------------------------------------------------------------

export const MAPS: { id: string; make: () => GameMap }[] = [
  { id: 'telhado', make: () => new Rooftop() },
  { id: 'fabrica', make: () => new Factory() },
  { id: 'gelatina', make: () => new JellyRing() },
  { id: 'trem', make: () => new Train() },
  { id: 'lava', make: () => new LavaBridge() },
];

export const makeMap = (id: string) => (MAPS.find((m) => m.id === id) ?? MAPS[0]).make();

import type { GameMap } from './MapBase';
import { Rooftop } from './Rooftop';

// ------------------------------------------------------------
// Lista de mapas. Para adicionar um mapa novo, importe a classe
// e coloque uma linha aqui.
// ------------------------------------------------------------

export const MAPS: { id: string; make: () => GameMap }[] = [
  { id: 'telhado', make: () => new Rooftop() },
];

export const makeMap = (id: string) => (MAPS.find((m) => m.id === id) ?? MAPS[0]).make();

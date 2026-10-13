import type { GameMap } from './MapBase';
import { Rooftop } from './Rooftop';
import { Factory } from './Factory';
import { FerrisWheel } from './FerrisWheel';
import { Train } from './Train';
import { Incinerator } from './Incinerator';
import { Girders } from './Girders';

// ------------------------------------------------------------
// Lista de mapas. Para adicionar um mapa novo, importe a classe
// e coloque uma linha aqui (o id precisa ser o mesmo da classe).
// ------------------------------------------------------------

export const MAPS: { id: string; make: () => GameMap }[] = [
  { id: 'telhado', make: () => new Rooftop() },
  { id: 'fabrica', make: () => new Factory() },
  { id: 'rodagigante', make: () => new FerrisWheel() },
  { id: 'trem', make: () => new Train() },
  { id: 'incinerador', make: () => new Incinerator() },
  { id: 'vigas', make: () => new Girders() },
];

export const makeMap = (id: string) => (MAPS.find((m) => m.id === id) ?? MAPS[0]).make();

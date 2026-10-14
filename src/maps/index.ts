import type { GameMap } from './MapBase';
import { Rooftop } from './Rooftop';
import { Factory } from './Factory';
import { FerrisWheel } from './FerrisWheel';
import { Train } from './Train';
import { Incinerator } from './Incinerator';
import { Girders } from './Girders';
import { Demolition } from './Demolition';
import { Elevators } from './Elevators';
import { Lighthouse } from './Lighthouse';
import { Trucks } from './Trucks';
import { CableCars } from './CableCars';
import { Vents } from './Vents';
import { Boat } from './Boat';
import { Aquarium } from './Aquarium';
import { Drawbridge } from './Drawbridge';
import { Subway } from './Subway';
import { Grinder } from './Grinder';
import { Scaffold } from './Scaffold';

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
  { id: 'demolicao', make: () => new Demolition() },
  { id: 'elevadores', make: () => new Elevators() },
  { id: 'farol', make: () => new Lighthouse() },
  { id: 'caminhoes', make: () => new Trucks() },
  { id: 'teleferico', make: () => new CableCars() },
  { id: 'ventiladores', make: () => new Vents() },
  { id: 'barco', make: () => new Boat() },
  { id: 'aquario', make: () => new Aquarium() },
  { id: 'ponte', make: () => new Drawbridge() },
  { id: 'metro', make: () => new Subway() },
  { id: 'moedor', make: () => new Grinder() },
  { id: 'andaime', make: () => new Scaffold() },
];

export const makeMap = (id: string) => (MAPS.find((m) => m.id === id) ?? MAPS[0]).make();

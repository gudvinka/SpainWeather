import type { Camera } from './camera.ts';
import type { Lang } from './i18n.ts';
import type { Coords } from './openmeteo.ts';
import { meteobuenavista } from './stations/meteobuenavista.ts';
import type { Station } from './stations/station.ts';
import { ugr } from './stations/ugr.ts';

export type City = {
  id: string; // имя папки в site/
  names: Record<Lang, string>; // название города на каждом языке сайта
  coords: Coords; // для Open-Meteo
  camera: Camera;
  station: Station;
  showHeat?: boolean; // плитка «пекло (35°+)» в шапке месяца — для жаркого города
};

export const CITIES: City[] = [
  {
    id: 'oviedo',
    names: { ru: 'Овьедо', es: 'Oviedo' },
    coords: { lat: 43.36, lon: -5.85 },
    // iframe-плеер со страницы https://www.hispacams.com/webcams/oviedo-buenavista/
    camera: { kind: 'rtspEmbed', name: 'buenavista', url: 'https://rtsp.me/embed/G2RB77AE/' },
    station: meteobuenavista,
  },
  {
    id: 'granada',
    names: { ru: 'Гранада', es: 'Granada' },
    coords: { lat: 37.18, lon: -3.59 },
    // https://meteo365.es/livecams/granada-alhambra.php — вид на Альгамбру, кадр обновляется каждую минуту
    camera: { kind: 'image', name: 'alhambra', url: 'https://webcam.meteo365.es/livecams/granada/current.webp' },
    station: ugr,
    showHeat: true,
  },
];

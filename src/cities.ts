import type { Camera } from './camera.ts';
import type { Lang } from './i18n.ts';
import type { Coords } from './openmeteo.ts';
import { aemet } from './stations/aemet.ts';
import { meteobuenavista } from './stations/meteobuenavista.ts';
import type { Station } from './stations/station.ts';
import { ugr } from './stations/ugr.ts';

export type City = {
  id: string; // имя папки в site/
  names: Record<Lang, string>; // название города на каждом языке сайта
  coords: Coords; // для Open-Meteo
  cameras: Camera[]; // первая — основная (её таймлапс открывается по кнопке); снимаются все, в одно время
  station: Station;
  backup?: Station; // запасная станция — если основная не ответила
  showHeat?: boolean; // плитка «пекло (35°+)» в шапке месяца — для жаркого города
};

export const CITIES: City[] = [
  {
    id: 'oviedo',
    names: { ru: 'Овьедо', es: 'Oviedo' },
    coords: { lat: 43.36, lon: -5.85 },
    // iframe-плеер со страницы https://www.hispacams.com/webcams/oviedo-buenavista/
    cameras: [{ kind: 'rtspEmbed', name: 'buenavista', url: 'https://rtsp.me/embed/G2RB77AE/' }],
    station: meteobuenavista,
    backup: aemet('1249X', 'AEMET Oviedo'), // официальная станция AEMET, El Cristo, 334 м
  },
  {
    id: 'granada',
    names: { ru: 'Гранада', es: 'Granada' },
    coords: { lat: 37.18, lon: -3.59 },
    cameras: [
      // https://meteo365.es/livecams/granada-alhambra.php — вид на Альгамбру, кадр обновляется каждую минуту
      {
        kind: 'image',
        name: 'alhambra',
        url: 'https://webcam.meteo365.es/livecams/granada/current.webp',
        label: { ru: 'Альгамбра · meteo365', es: 'La Alhambra · meteo365' },
      },
      // https://www.ibericam.com/en/granada/webcam-granada-alhambra-en-vivo — Альгамбра с Мирадора Сан-Николас,
      // за ней Сьерра-Невада. Берём заставку плеера (1080×608, обновляется ~раз в 10 мин). С 10.11.2026.
      // Камера может ходить между ракурсами — смотрим по таймлапсу, насколько это мешает.
      {
        kind: 'image',
        name: 'sannicolas',
        url: 'https://image-4.ibericam.com/poster/webcam-granada.webp',
        label: { ru: 'Мирадор Сан-Николас · Ibericam', es: 'Mirador de San Nicolás · Ibericam' },
      },
    ],
    station: ugr,
    showHeat: true,
  },
];

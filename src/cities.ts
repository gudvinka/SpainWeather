import type { Camera } from './camera.ts';
import type { Lang } from './i18n.ts';
import type { Coords } from './openmeteo.ts';
import { aemet } from './stations/aemet.ts';
import { meteobuenavista } from './stations/meteobuenavista.ts';
import type { Station } from './stations/station.ts';
import { ugr } from './stations/ugr.ts';

// Место с камерами: кадры для таймлапса и погода по модели Open-Meteo (небо, температура по часам).
export type Place = {
  id: string; // имя папки в site/
  names: Record<Lang, string>; // название на каждом языке сайта
  coords: Coords; // для Open-Meteo
  cameras: Camera[]; // снимаются все, в одно время; у города первая — основная (на неё ведёт значок таймлапса)
};

// Город сравнения: место + метеостанция; у него свои страницы (City overview, Month details).
export type City = Place & {
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
    cameras: [{ kind: 'rtspEmbed', name: 'buenavista', url: 'https://rtsp.me/embed/G2RB77AE/', source: 'hispacams' }],
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
        source: 'meteo365',
        title: { ru: 'Альгамбра', es: 'La Alhambra' },
      },
      // https://www.ibericam.com/en/granada/webcam-granada-alhambra-en-vivo — Альгамбра с Мирадора Сан-Николас,
      // за ней Сьерра-Невада. Берём заставку плеера (1080×608, обновляется ~раз в 10 мин). С 10.11.2026.
      // Камера может ходить между ракурсами — смотрим по таймлапсу, насколько это мешает.
      {
        kind: 'image',
        name: 'sannicolas',
        url: 'https://image-4.ibericam.com/poster/webcam-granada.webp',
        source: 'Ibericam',
        title: { ru: 'Мирадор Сан-Николас', es: 'Mirador de San Nicolás' },
      },
    ],
    station: ugr,
    showHeat: true,
  },
];

// Другие места — только кадры для таймлапса, без станции и без страниц погоды. Погода под кадром — модель Open-Meteo.
// Сбои здесь — предупреждения, а не ошибки: места необязательные, запуск из-за них не краснеет.
// Камеры meteo365 (https://meteo365.es/livecams/) — прямая картинка, обновляется каждую минуту.
export const PLACES: Place[] = [
  {
    id: 'malaga',
    names: { ru: 'Малага · порт', es: 'Málaga · puerto' },
    coords: { lat: 36.71, lon: -4.42 },
    // https://meteo365.es/livecams/puerto-malaga.php — порт близко: паромы, мегаяхты, город за ними. С 10.11.2026.
    cameras: [{ kind: 'image', name: 'malagaport', url: 'https://webcam.meteo365.es/livecams/puerto_zwei/current.webp', source: 'meteo365' }],
  },
  {
    id: 'fuengirola',
    names: { ru: 'Фуэнхирола · пляж', es: 'Fuengirola · playa' },
    coords: { lat: 36.54, lon: -4.62 },
    // https://meteo365.es/livecams/fuengirola-puerto.php — большой пляж с набережной, 1920×1080. С 10.11.2026.
    cameras: [{ kind: 'image', name: 'fuengirola', url: 'https://webcam.meteo365.es/livecams/fglpuerto/current.webp', source: 'meteo365' }],
  },
];

// Все камеры сайта (имена уникальны — проверяет тест).
export const ALL_PLACES: Place[] = [...CITIES, ...PLACES];

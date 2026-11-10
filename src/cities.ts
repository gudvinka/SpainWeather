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
    names: { ru: 'Малага', es: 'Málaga' },
    coords: { lat: 36.71, lon: -4.42 },
    cameras: [
      // https://meteo365.es/livecams/malaga-muelle.php — причал с яхтами и лайнерами, набережная, горы за городом. С 10.11.2026.
      {
        kind: 'image',
        name: 'malagaport',
        url: 'https://webcam.meteo365.es/livecams/puerto_drei/current.webp',
        source: 'meteo365',
        title: { ru: 'порт', es: 'puerto' },
      },
      // https://meteo365.es/livecams/malaga-alameda.php — площадь в центре, цветные дома XIX века. С 10.11.2026.
      {
        kind: 'image',
        name: 'malagaalameda',
        url: 'https://webcam2.meteo365.es/livecams/alameda/current.webp',
        source: 'meteo365',
        title: { ru: 'Аламеда', es: 'Alameda' },
      },
    ],
  },
  {
    id: 'fuengirola',
    names: { ru: 'Фуэнхирола', es: 'Fuengirola' },
    coords: { lat: 36.54, lon: -4.62 },
    cameras: [
      // https://meteo365.es/livecams/fuengirola-puerto.php — пляж с набережной до порта, 1920×1080. С 10.11.2026.
      {
        kind: 'image',
        name: 'fuengirola',
        url: 'https://webcam.meteo365.es/livecams/fglpuerto/current.webp',
        source: 'meteo365',
        title: { ru: 'пляж у порта', es: 'playa del puerto' },
      },
      // https://meteo365.es/livecams/fuengirola-bahia.php — длинный пляж Лас-Гавиотас сверху, 1920×1080. С 10.11.2026.
      {
        kind: 'image',
        name: 'fuengirolabahia',
        url: 'https://webcam2.meteo365.es/livecams/fglgaviotas/current.webp',
        source: 'meteo365',
        title: { ru: 'бухта', es: 'bahía' },
      },
    ],
  },
  {
    id: 'benalmadena',
    names: { ru: 'Бенальмадена', es: 'Benalmádena' },
    coords: { lat: 36.6, lon: -4.52 },
    // https://meteo365.es/livecams/benalmadena-club.php — море и белые дома вдоль берега. С 10.11.2026.
    cameras: [{ kind: 'image', name: 'benalmadena', url: 'https://webcam2.meteo365.es/livecams/benclub/current.webp', source: 'meteo365' }],
  },
  {
    id: 'nerja',
    names: { ru: 'Нерха · Балкон Европы', es: 'Nerja · Balcón de Europa' },
    coords: { lat: 36.75, lon: -3.88 },
    // https://meteo365.es/livecams/nerja-balcon-europa.php — смотровая над морем, пальмы, скалы, 1920×1080. С 10.11.2026.
    cameras: [{ kind: 'image', name: 'nerja', url: 'https://webcam2.meteo365.es/livecams/nerjabalcon/current.webp', source: 'meteo365' }],
  },
  {
    id: 'sierranevada',
    names: { ru: 'Сьерра-Невада', es: 'Sierra Nevada' },
    coords: { lat: 37.18, lon: -3.59 }, // камера в Гранаде, смотрит на горы — погода по Гранаде
    // https://meteo365.es/livecams/granada-sierra-nevada.php — хребет издалека, сады на переднем плане. С 10.11.2026.
    cameras: [{ kind: 'image', name: 'sierranevada', url: 'https://webcam.meteo365.es/livecams/granadasierra/current.webp', source: 'meteo365' }],
  },
  {
    id: 'valencia',
    names: { ru: 'Валенсия · пляж', es: 'Valencia · playa' },
    coords: { lat: 39.47, lon: -0.32 },
    // https://meteo365.es/livecams/valencia.php — пляж и море; кадр 1024×768 (4:3), без часов на картинке. С 10.11.2026.
    cameras: [{ kind: 'image', name: 'valencia', url: 'https://webcam2.meteo365.es/livecams/playavlc/current.webp', source: 'meteo365' }],
  },
  // Пляжи Астурии — камеры Tablas Surf Shop (https://www.tablassurfshop.com/en/webcam_xago и соседние страницы).
  // Плеер rtsp.me с «замком»: показ только на сайтах владельца — снимаем со страницы магазина (rtspPage). С 10.11.2026.
  {
    id: 'gijon',
    names: { ru: 'Хихон · Сан-Лоренсо', es: 'Gijón · San Lorenzo' },
    coords: { lat: 43.54, lon: -5.65 },
    // набережная и бухта Сан-Лоренсо до мыса; поток 1920×1080
    cameras: [{ kind: 'rtspPage', name: 'gijon', url: 'https://www.tablassurfshop.com/en/webcam_bahia', source: 'Tablas Surf Shop' }],
  },
  {
    id: 'xago',
    names: { ru: 'Хаго', es: 'Xagó' },
    coords: { lat: 43.6, lon: -5.92 },
    // дикий пляж в Госоне: песок, прибой, скалистый мыс; поток 1920×1080
    cameras: [{ kind: 'rtspPage', name: 'xago', url: 'https://www.tablassurfshop.com/en/webcam_xago', source: 'Tablas Surf Shop' }],
  },
  {
    id: 'rodiles',
    names: { ru: 'Родилес', es: 'Rodiles' },
    coords: { lat: 43.53, lon: -5.38 },
    // широкий пляж у устья в Вильявисьосе, лесистая скала; поток 1280×720
    cameras: [{ kind: 'rtspPage', name: 'rodiles', url: 'https://www.tablassurfshop.com/en/webcam_rodiles', source: 'Tablas Surf Shop' }],
  },
  {
    id: 'nora',
    names: { ru: 'Ла-Ньора', es: 'La Ñora' },
    coords: { lat: 43.55, lon: -5.57 },
    // пляж у скалы между Хихоном и Вильявисьосой; поток 2560×1440
    cameras: [{ kind: 'rtspPage', name: 'nora', url: 'https://www.tablassurfshop.com/en/webcam_nora', source: 'Tablas Surf Shop' }],
  },
  {
    id: 'enol',
    names: { ru: 'Озеро Эноль', es: 'Lago Enol' },
    coords: { lat: 43.27, lon: -4.99 }, // Лагос-де-Ковадонга, Пикос-де-Эуропа, ~1070 м
    // https://www.hispacams.com/cam_embedded.php?id=000239 — камера ресторана у озера на солнечной батарее: снимок
    // раз в 15 минут (видео — только когда ресторан открыт), 640×480 (4:3). По прямой ссылке снимок не отдают —
    // берём со страницы hispacams (pageImage). С 10.11.2026.
    cameras: [{ kind: 'pageImage', name: 'enol', url: 'https://www.hispacams.com/cam_embedded.php?id=000239', source: 'hispacams' }],
  },
];

// Все камеры сайта (имена уникальны — проверяет тест).
export const ALL_PLACES: Place[] = [...CITIES, ...PLACES];

import type { AirKind, DayKind, FeelKind, HeatingKind, Precip, Sky } from './days.ts';

// Тексты сайта на двух языках. Правила погоды (src/days.ts) возвращают коды — слова подставляются здесь.
// Испанский перевод черновой: стоит показать носителю спорные слова (chispeó, bochorno, húmedo y frío…).
export type Lang = 'ru' | 'es';
export const LANGS: Lang[] = ['ru', 'es'];
export const DEFAULT_LANG: Lang = 'ru';

export type Dict = {
  months: string[]; // «октябрь» — в заголовках «октябрь 2026»
  monthsPlural: string[]; // «среднее за октябри 2022–2025»
  weekdays: string[]; // с воскресенья, как Date.getDay()
  kind: Record<DayKind, string>;
  precip: (p: Precip) => string;
  sky: (s: Sky) => string;
  feel: Record<FeelKind, string>;
  heating: Record<HeatingKind, string>;
  air: string;
  airTitle: Record<AirKind, string>;
  fogMorning: string;
  dubious: string;
  inProgress: string;
  noShots: string;
  showShots: string; // подсказка на телефоне: нажми, чтобы увидеть кадры дня
  hideShots: string;
  toToday: string; // ссылка в шапке месяца к сегодняшнему дню
  toTop: string; // подсказка круглой кнопки «↑»
  noData: string;
  noMonths: string;
  min: string;
  max: string;
  // SpainWeather
  siteTitle: string;
  siteSub: string;
  today: (sky: string) => string;
  feelsNow: (feel: string) => string;
  updated: (time: string) => string;
  noDataToday: string;
  // City overview
  cityTitle: (city: string) => string;
  dataDays: (n: number, total: number) => string;
  average: string;
  counts: Record<'clear' | 'partly' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'downpour', string>;
  totals: (rainMm: number, heatingDays: number) => string;
  credits: (cameras: string[], station: string) => string;
  // Timelapse
  timelapse: string; // раздел «Таймлапс»: карточка на главной, каталог, «хлебные крошки»
  tlCatalogSub: string;
  tlOurCities: string;
  tlOtherPlaces: string;
  tlNoteStations: string; // откуда погода у городов
  tlNoteModel: string; // и у других мест
  tlCardCount: (cameras: number) => string; // «5 камер · новые кадры 3 раза в день»
  tlInfo: (source: string, d: number, m: number, frames: number) => string; // «meteo365 · с 12 октября · 91 кадр»
  tlSource: (camera: string, station?: string) => string; // подпись под таймлапсом: чья камера и откуда погода
  timelapseTitle: (city: string) => string;
  timelapseSub: string;
  longDate: (d: number, m: number, y: number, wd: string) => string; // «24 октября 2026, сб»
  speed: string;
  frameOf: (n: string, total: string) => string; // «кадр 41 из 91» (в странице — шаблон, числа подставляет скрипт)
  prevFrame: string;
  nextFrame: string;
  playPause: string;
  // Month details: шапка
  fewData: (n: number) => string;
  soFar: (month: string) => string;
  tempNormal: string;
  warmer: (deg: number) => string;
  colder: (deg: number) => string;
  rainNormal: string;
  wetter: string;
  drier: string;
  tiles: { tMax: string; rainy: string; grey: string; heat: string; badAir: string; light: string };
  of: (n: number, total: number) => [string, string]; // «6», «из 12»
  usual: (text: string) => string;
  source: (monthsPlural: string, years: string, credits: string) => string;
  noArchive: (credits: string) => string;
};

// Родительный падеж месяцев: «24 октября», «с 12 октября».
const RU_MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
// 1 кадр, 2 кадра, 5 кадров, 11 кадров, 21 кадр.
const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

const ru: Dict = {
  months: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
  monthsPlural: ['январи', 'феврали', 'марты', 'апрели', 'маи', 'июни', 'июли', 'августы', 'сентябри', 'октябри', 'ноябри', 'декабри'],
  weekdays: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  kind: {
    clear: 'солнечно',
    partly: 'переменная облачность',
    cloudy: 'облачно',
    overcast: 'пасмурно',
    fog: 'туман',
    drizzle: 'морось',
    rain: 'дождь',
    downpour: 'ливень',
    none: 'нет данных',
  },
  precip: ({ amount, when }) => {
    const a = { none: 'без осадков', sprinkle: 'покапало', light: 'морось', rain: 'дождь', heavy: 'ливень', drizzleAllDay: 'моросит весь день' }[amount];
    const w = when && { allDay: 'весь день', day: 'днём', night: 'ночью' }[when];
    return w ? `${a} ${w}` : a;
  },
  sky: ({ kind, sunHours }) =>
    ({ clear: `ясно, ${Math.round(sunHours)} ч`, partly: `переменная облачность, ${Math.round(sunHours)} ч`, cloudy: 'облачно', overcast: 'пасмурно' })[kind],
  feel: { dry: 'сухо', comfortable: 'комфортно', normal: 'нормально', humid: 'влажно', muggy: 'душно', oppressive: 'гнетуще', damp: 'сыро', dampCold: 'сыро и зябко' },
  heating: { evening: 'отопление: вечером', needed: 'отопление: нужно' },
  air: 'воздух',
  airTitle: { good: 'качество воздуха: хороший', fair: 'качество воздуха: на грани', poor: 'качество воздуха: плохой' },
  fogMorning: 'утром туман',
  dubious: 'данные под вопросом',
  inProgress: 'день идёт',
  noShots: 'кадров нет',
  showShots: 'кадры ▾',
  hideShots: 'скрыть ▴',
  toToday: 'сегодня ↓',
  toTop: 'наверх',
  noData: 'Данных пока нет.',
  noMonths: 'Месяцев пока нет.',
  min: 'мин',
  max: 'макс',
  siteTitle: 'SpainWeather · погода в Испании',
  siteSub: 'Погода в Испании: камеры, метеостанции и итоги по дням',
  today: (sky) => `сегодня, ${sky}`,
  feelsNow: (f) => `ощущается: ${f}`,
  updated: (t) => `обновлено ${t}`,
  noDataToday: 'сегодня данных ещё нет',
  cityTitle: (c) => `${c} · погода`,
  dataDays: (n, total) => `данные за ${n} из ${total} дн.`,
  average: 'в среднем',
  counts: { clear: 'солнечных', partly: 'переменная', cloudy: 'облачно', overcast: 'пасмурно', fog: 'туман', drizzle: 'морось', rain: 'дождь', downpour: 'ливень' },
  totals: (mm, h) => `осадков <b>${mm} мм</b> · отопление <b>${h} дн.</b>`,
  credits: (cams, st) => `${cams.length > 1 ? 'Камеры' : 'Камера'} ${cams.join(', ')} · станция ${st} · небо и воздух Open-Meteo`,
  timelapse: 'Таймлапс',
  tlCatalogSub: 'Кадры камер подряд, до трёх в день. Выберите камеру.',
  tlOurCities: 'Наши города',
  tlOtherPlaces: 'Другие места',
  tlNoteStations: 'погода — метеостанции',
  tlNoteModel: 'погода — модель Open-Meteo',
  tlCardCount: (n) => `${n} ${plural(n, 'камера', 'камеры', 'камер')} · новые кадры 3 раза в день`,
  tlInfo: (src, d, m, n) => `${src} · с ${d} ${RU_MONTHS_GEN[m - 1]} · ${n} ${plural(n, 'кадр', 'кадра', 'кадров')}`,
  tlSource: (cam, st) =>
    `Камера ${cam}. ${st ? `Температура — станция ${st} в момент кадра (если замера нет — модель Open-Meteo)` : 'Погода — модель Open-Meteo по координатам камеры, не станция'}.`,
  timelapseTitle: (c) => `${c} · таймлапс`,
  timelapseSub: 'Все кадры камеры подряд, до трёх в день. Крутите ползунок или запустите показ.',
  longDate: (d, m, y, wd) => `${d} ${RU_MONTHS_GEN[m - 1]} ${y}, ${wd}`,
  speed: 'скорость',
  frameOf: (n, total) => `кадр ${n} из ${total}`,
  prevFrame: 'кадр назад',
  nextFrame: 'кадр вперёд',
  playPause: 'показ / пауза',
  fewData: (n) => `Пока мало данных для вывода — ${n} дн.`,
  soFar: (m) => `${m.replace(/^./, (c) => c.toUpperCase())} пока: `,
  tempNormal: 'по температуре как обычно',
  warmer: (d) => `теплее обычного на ${d}°`,
  colder: (d) => `холоднее обычного на ${d}°`,
  rainNormal: 'дождей как обычно',
  wetter: 'дождливее обычного',
  drier: 'суше обычного',
  tiles: { tMax: 'днём в среднем', rainy: 'дождливые дни', grey: 'серые дни (без солнца)', heat: 'пекло (35°+)', badAir: 'плохой воздух', light: 'световой день' },
  of: (n, total) => [String(n), `из ${total}`],
  usual: (t) => `обычно ${t}`,
  source: (mp, y, c) => `«Обычно» — среднее за ${mp} ${y} годов, модель Open-Meteo. Этот месяц: ${c.replace(/^./, (ch) => ch.toLowerCase())}.`,
  noArchive: (c) => `${c}. Архив прошлых лет для «обычно» ещё не загружен.`,
};

const es: Dict = {
  months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  monthsPlural: ['eneros', 'febreros', 'marzos', 'abriles', 'mayos', 'junios', 'julios', 'agostos', 'septiembres', 'octubres', 'noviembres', 'diciembres'],
  weekdays: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  kind: {
    clear: 'soleado',
    partly: 'parcialmente nublado',
    cloudy: 'nublado',
    overcast: 'cubierto',
    fog: 'niebla',
    drizzle: 'llovizna',
    rain: 'lluvia',
    downpour: 'aguacero',
    none: 'sin datos',
  },
  precip: ({ amount, when }) => {
    const a = { none: 'sin precipitación', sprinkle: 'chispeó', light: 'llovizna', rain: 'lluvia', heavy: 'aguacero', drizzleAllDay: 'llovizna todo el día' }[amount];
    const w = when && { allDay: 'todo el día', day: 'de día', night: 'de noche' }[when];
    return w ? `${a} ${w}` : a;
  },
  sky: ({ kind, sunHours }) =>
    ({ clear: `despejado, ${Math.round(sunHours)} h`, partly: `parcialmente nublado, ${Math.round(sunHours)} h`, cloudy: 'nublado', overcast: 'cubierto' })[kind],
  feel: { dry: 'seco', comfortable: 'agradable', normal: 'normal', humid: 'algo húmedo', muggy: 'bochorno', oppressive: 'agobiante', damp: 'húmedo', dampCold: 'húmedo y frío' },
  heating: { evening: 'calefacción: por la tarde', needed: 'calefacción: necesaria' },
  air: 'aire',
  airTitle: { good: 'calidad del aire: buena', fair: 'calidad del aire: regular', poor: 'calidad del aire: mala' },
  fogMorning: 'niebla por la mañana',
  dubious: 'datos dudosos',
  inProgress: 'en curso',
  noShots: 'sin fotos',
  showShots: 'fotos ▾',
  hideShots: 'ocultar ▴',
  toToday: 'hoy ↓',
  toTop: 'arriba',
  noData: 'Aún no hay datos.',
  noMonths: 'Aún no hay meses.',
  min: 'mín',
  max: 'máx',
  siteTitle: 'SpainWeather · el tiempo en España',
  siteSub: 'El tiempo en España: cámaras, estaciones meteorológicas y resumen diario',
  today: (sky) => `hoy, ${sky}`,
  feelsNow: (f) => `sensación: ${f}`,
  updated: (t) => `actualizado ${t}`,
  noDataToday: 'hoy aún no hay datos',
  cityTitle: (c) => `${c} · el tiempo`,
  dataDays: (n, total) => `datos de ${n} de ${total} días`,
  average: 'de media',
  counts: { clear: 'soleados', partly: 'parcialmente', cloudy: 'nublados', overcast: 'cubiertos', fog: 'niebla', drizzle: 'llovizna', rain: 'lluvia', downpour: 'aguacero' },
  totals: (mm, h) => `precipitación <b>${mm} mm</b> · calefacción <b>${h} días</b>`,
  credits: (cams, st) => `${cams.length > 1 ? 'Cámaras' : 'Cámara'} ${cams.join(', ')} · estación ${st} · cielo y aire Open-Meteo`,
  timelapse: 'Timelapse',
  tlCatalogSub: 'Fotos de las cámaras seguidas, hasta tres al día. Elige una cámara.',
  tlOurCities: 'Nuestras ciudades',
  tlOtherPlaces: 'Otros lugares',
  tlNoteStations: 'tiempo — estaciones meteorológicas',
  tlNoteModel: 'tiempo — modelo Open-Meteo',
  tlCardCount: (n) => `${n} ${n === 1 ? 'cámara' : 'cámaras'} · fotos nuevas 3 veces al día`,
  tlInfo: (src, d, m, n) => `${src} · desde el ${d} de ${es.months[m - 1]} · ${n} ${n === 1 ? 'foto' : 'fotos'}`,
  tlSource: (cam, st) =>
    `Cámara ${cam}. ${st ? `Temperatura — estación ${st} en el momento de la foto (si no hay dato — modelo Open-Meteo)` : 'Tiempo — modelo Open-Meteo según las coordenadas de la cámara, no una estación'}.`,
  timelapseTitle: (c) => `${c} · timelapse`,
  timelapseSub: 'Todas las fotos de la cámara seguidas, hasta tres al día. Mueve el control o dale a reproducir.',
  longDate: (d, m, y, wd) => `${d} de ${es.months[m - 1]} de ${y}, ${wd}`,
  speed: 'velocidad',
  frameOf: (n, total) => `foto ${n} de ${total}`,
  prevFrame: 'foto anterior',
  nextFrame: 'foto siguiente',
  playPause: 'reproducir / pausa',
  fewData: (n) => `Aún pocos datos para conclusiones: ${n} días.`,
  soFar: (m) => `${m.replace(/^./, (c) => c.toUpperCase())} por ahora: `,
  tempNormal: 'temperatura normal',
  warmer: (d) => `${d}° más cálido de lo normal`,
  colder: (d) => `${d}° más frío de lo normal`,
  rainNormal: 'lluvias normales',
  wetter: 'más lluvioso de lo normal',
  drier: 'más seco de lo normal',
  tiles: { tMax: 'máxima media', rainy: 'días de lluvia', grey: 'días grises (sin sol)', heat: 'calor extremo (35°+)', badAir: 'aire malo', light: 'luz del día' },
  of: (n, total) => [String(n), `de ${total}`],
  usual: (t) => `lo normal: ${t}`,
  source: (mp, y, c) => `«Lo normal»: media de los ${mp} ${y}, modelo Open-Meteo. Este mes: ${c.replace(/^./, (ch) => ch.toLowerCase())}.`,
  noArchive: (c) => `${c}. El archivo de años anteriores aún no está cargado.`,
};

export const T: Record<Lang, Dict> = { ru, es };

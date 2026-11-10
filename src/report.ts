import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Camera } from './camera.ts';
import { CITIES, PLACES, type City, type Place } from './cities.ts';
import { pastMonths } from './history.ts';
import { feel, KIND_STYLE, monthBreakdown, monthStats, summarizeDay, type AirKind, type DayKind, type DaySummary, type SkyKind } from './days.ts';
import { DEFAULT_LANG, LANGS, T, type Dict, type Lang } from './i18n.ts';
import { hasErrors } from './quality.ts';
import { readDaily, readHistory, readLog, readReadings, readSky, type DayTotals, type MonthClimate, type Reading, type SkyDay } from './store.ts';
import { dateOf, monthOf } from './time.ts';

// Сайт — три уровня страниц, каждая на двух языках (названия используем везде: в коде, README, разговоре):
//   SpainWeather    site/<язык>/index.html                   — главная: карточки городов
//   City overview   site/<язык>/<город>/index.html           — обзор города: карточки месяцев по годам
//   Month details   site/<язык>/<город>/<ГГГГ-ММ>/index.html — детали месяца: шапка «этот месяц / обычно» + строки дней
//   Timelapse       site/<язык>/<город>/timelapse/index.html — все кадры города подряд с ползунком (кнопка на City overview)
// Языки: ru (по умолчанию) и es. Переключатель RU | ES ведёт на ту же страницу другого языка.
// Данные и кадры общие для обоих языков и лежат отдельно: site/<город>/<ГГГГ-ММ>/{screenshots, *.json, *.jsonl}.
// Наверху каждой страницы — «хлебные крошки» SpainWeather › Город › месяц.
export const SITE = path.join(import.meta.dirname, '..', 'site');
export const cityDir = (place: Place) => path.join(SITE, place.id);
const pagesDir = (lang: Lang) => path.join(SITE, lang);

// Страница, которая сразу перекидывает на другую (корень проекта, site/index.html, старые адреса страниц).
const redirect = (to: string) => `<!doctype html>
<meta charset="utf-8">
<title>SpainWeather</title>
<meta http-equiv="refresh" content="0; url=${to}">
<a href="${to}">SpainWeather</a>
`;
const ROOT_INDEX = path.join(import.meta.dirname, '..', 'index.html');

type Shot = { file: string; day: string; time: string; camera: string };

// 2026-10-12_14-40_buenavista.jpg
const NAME_RE = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})_(.+)\.(jpe?g|png|webp)$/i;
const MONTH_DIR_RE = /^\d{4}-\d{2}$/;

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const fmt = (n: number) => String(Math.round(n));
const pad = (n: number) => String(n).padStart(2, '0');

// «Хлебные крошки»: [название, ссылка] по уровням; последний уровень — текущая страница, без ссылки.
const crumbs = (items: [string, string?][]) =>
  `<nav class="crumbs">${items
    .map(([name, href]) => (href ? `<a href="${href}">${esc(name)}</a>` : `<b>${esc(name)}</b>`))
    .join('<i>›</i>')}</nav>`;

// Переключатель языка: toSite — путь от страницы до site/, rest — путь страницы внутри языка.
const langSwitch = (lang: Lang, toSite: string, rest: string) =>
  `<nav class="lang">${LANGS.map((l) =>
    l === lang ? `<b>${l.toUpperCase()}</b>` : `<a href="${toSite}${l}/${rest}" hreflang="${l}">${l.toUpperCase()}</a>`,
  ).join('')}</nav>`;

async function readShots(dir: string): Promise<Shot[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const shots: Shot[] = [];
  for (const file of files) {
    const m = NAME_RE.exec(file);
    if (m) shots.push({ file, day: m[1], time: `${m[2]}:${m[3]}`, camera: m[4] });
  }
  return shots.sort((a, b) => a.file.localeCompare(b.file));
}

const monthTitle = (month: string, t: Dict) => {
  const [y, m] = month.split('-').map(Number);
  return `${t.months[m - 1]} ${y}`;
};
const weekday = (date: string, t: Dict) => {
  const [y, m, d] = date.split('-').map(Number);
  return t.weekdays[new Date(y, m - 1, d).getDay()];
};

// Одноцветные линейные иконки в стиле Lucide (ISC), цвет берут из currentColor.
const ICON_PATHS = {
  noRain:
    '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/><path d="m3 3 18 18"/>',
  drizzle:
    '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M8 19v1"/><path d="M8 14v1"/><path d="M16 19v1"/><path d="M16 14v1"/><path d="M12 21v1"/><path d="M12 16v1"/>',
  rain: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>',
  droplets:
    '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  fog: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 17H7"/><path d="M17 21H9"/>',
  flame:
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  cloudSun:
    '<path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  cloudy:
    '<path d="M17.5 21H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="M22 10a3 3 0 0 0-3-3h-2.207a5.502 5.502 0 0 0-10.702.5"/>',
  smile:
    '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  meh: '<circle cx="12" cy="12" r="10"/><path d="M8 15h8"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  frown:
    '<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  // кнопки таймлапса (▶ символом на iPhone превращается в цветной эмодзи — поэтому рисунком)
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
};

// Знаковое место города — крупный тонкий рисунок фоном карточки на главной (холст 120×90).
const LANDMARKS: Record<string, { title: Record<Lang, string>; paths: string[] }> = {
  // Собор Сан-Сальвадор: готическая башня со шпилем, звонница, портик с тремя арками, боковые нефы.
  oviedo: {
    title: { ru: 'Собор Сан-Сальвадор', es: 'Catedral de San Salvador' },
    paths: [
      'M4 86H116',
      'M60 2V9', 'M57 4.5H63',
      'M52 30 60 9 68 30', 'M55 22H65',
      'M50 30V22M70 30V22', 'M49 23 50 20 51 23M69 23 70 20 71 23',
      'M48 30H72', 'M50 30V66M70 30V66', 'M50 56H70',
      'M54 50V40A4 4 0 0 1 56 36.52A4 4 0 0 1 58 40V50', 'M62 50V40A4 4 0 0 1 64 36.52A4 4 0 0 1 66 40V50',
      'M34 86V66H86V86', 'M34 66 40 61H80L86 66',
      'M38 86V74A8 8 0 0 1 42 67.04A8 8 0 0 1 46 74V86',
      'M56 86V73A8 8 0 0 1 60 66.04A8 8 0 0 1 64 73V86',
      'M74 86V74A8 8 0 0 1 78 67.04A8 8 0 0 1 82 74V86',
      'M10 86V58L22 50 34 58V66', 'M16 72V64A4 4 0 0 1 18 60.52A4 4 0 0 1 20 64V72', 'M24 72V64A4 4 0 0 1 26 60.52A4 4 0 0 1 28 64V72',
      'M86 66V60L98 52 110 60V86', 'M92 74V66A4 4 0 0 1 94 62.52A4 4 0 0 1 96 66V74', 'M100 74V66A4 4 0 0 1 102 62.52A4 4 0 0 1 104 66V74',
      'M14 86V58.6M30 86V58.6M90 86V62M106 86V62',
    ],
  },
  // Альгамбра на холме: башня Вела, стена с зубцами, башня Комарес, дворцы с аркадой, кипарисы, Сьерра-Невада.
  // Низы башен и кипарисов посчитаны по кривой холма, чтобы стояли на нём.
  granada: {
    title: { ru: 'Альгамбра', es: 'La Alhambra' },
    paths: [
      'M74 30 80 24 86 27 96 13 104 22 110 19 120 30', 'M92 17.5 96 13 99.5 17.5',
      'M0 84C22 70 46 63 70 62C92 61 108 64 120 70',
      'M10 78.2V33.5H13V36H16V33.5H19V36H22V33.5H24V71.7', 'M15 52V46A4 4 0 0 1 17 42.52A4 4 0 0 1 19 46V52',
      'M24 54.5V52H27', 'M27 70.6V41.5H30V44H33V41.5H35V67.9',
      'M35 52.5V50H38V52.5H41V50H44V52.5H47V50H50V52.5H53V50H56V52.5H58',
      'M58 63V25.5H61V28H64V25.5H67V28H70V25.5H73V28H74V61.9', 'M58 48H74',
      'M62 42V36A3 3 0 0 1 63.5 33.39A3 3 0 0 1 65 36V42', 'M67 42V36A3 3 0 0 1 68.5 33.39A3 3 0 0 1 70 36V42',
      'M74 50 80 46H98L104 50',
      'M78 61.9V55A3 3 0 0 1 79.5 52.39A3 3 0 0 1 81 55V61.9', 'M84 62.1V55A3 3 0 0 1 85.5 52.39A3 3 0 0 1 87 55V62.1',
      'M90 62.6V55A3 3 0 0 1 91.5 52.39A3 3 0 0 1 93 55V62.6', 'M96 63.3V55A3 3 0 0 1 97.5 52.39A3 3 0 0 1 99 55V63.3',
      'M104 64.4V39.5H107V42H110V39.5H112V66.7',
      'M3.25 82C3.25 69 4.7 63 5 61C5.3 63 6.75 69 6.75 80',
      'M114.25 67.5C114.25 54 115.7 48 116 46C116.3 48 117.75 54 117.75 68.9',
    ],
  },
};


const landmarkArt = (cityId: string, lang: Lang) => {
  const l = LANDMARKS[cityId];
  if (!l) return '';
  const title = esc(l.title[lang]);
  return `<svg class="landmark" viewBox="0 0 120 90" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${title}"><title>${title}</title>${l.paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
};

const WARN_COLOR = '#c2410c';

const SKY_ICON: Record<SkyKind, keyof typeof ICON_PATHS> = {
  clear: 'sun',
  partly: 'cloudSun',
  cloudy: 'cloud',
  overcast: 'cloudy',
};
const AIR_ICON: Record<AirKind, keyof typeof ICON_PATHS> = { good: 'smile', fair: 'meh', poor: 'frown' };
const AIR_COLOR: Record<AirKind, string> = { good: '#1f9d55', fair: '#d4a106', poor: '#e5484d' };

const icon = (name: keyof typeof ICON_PATHS) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

const precipIcon = (s: DaySummary) => {
  if (s.precip?.amount === 'none') return icon('noRain');
  return s.rain !== undefined && s.rain >= 5 ? icon('rain') : icon('drizzle');
};

// Полоска-легенда цветов дня, как в палитре: от тёплого к холодному.
const LEGEND_KINDS: DayKind[] = ['clear', 'partly', 'cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'downpour'];
const legend = (t: Dict) =>
  `<div class="legend">${LEGEND_KINDS.map(
    (k) => `<span style="background: ${KIND_STYLE[k].bg}; color: ${KIND_STYLE[k].fg}">${t.kind[k]}</span>`,
  ).join('')}</div>`;

function page(lang: Lang, title: string, body: string) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --page: #f6f5f2;
    --text: #1d2433;
    --muted: #6b7280;
    --line: #e5e2dc;
    --icon: #4b5563;
    --empty: #dcd8cf;
  }
  * { box-sizing: border-box; }
  html { min-height: 100%; background: var(--page); }
  body {
    position: relative;
    margin: 0; padding: 32px 40px 48px;
    color: var(--text); font: 15px/1.45 Inter, system-ui, sans-serif;
  }
  a { color: inherit; }
  h1 { margin: 0 0 6px; font-size: 32px; font-weight: 700; line-height: 1.15; letter-spacing: -0.01em; }
  .sub { margin: 0 0 16px; color: var(--muted); }
  .crumbs { margin-bottom: 14px; color: var(--muted); font-size: 14px; }
  .crumbs a { color: var(--muted); text-decoration: none; }
  .crumbs a:hover { color: var(--text); text-decoration: underline; }
  .crumbs b { color: var(--text); font-weight: 600; }
  .crumbs i { margin: 0 6px; font-style: normal; opacity: 0.6; }

  /* Шапка страницы месяца: вывод и одна строка плиток на всю ширину. */
  .mhdr { margin-bottom: 16px; padding: 18px 22px; border-radius: 16px; background: #fff; border: 1px solid var(--line); }
  .mtitle { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .mtitle h1 { margin: 0; }
  .mtitle span { color: var(--muted); font-size: 13px; white-space: nowrap; }
  .verdict { margin: 4px 0 14px; font-size: 18px; }
  .verdict.muted { color: var(--muted); font-size: 15px; }
  .tiles { display: flex; gap: 10px; }
  .tile { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; padding: 9px 12px; border-radius: 10px; background: var(--page); }
  .tile span { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; white-space: nowrap; }
  .tile span svg { flex: none; width: 16px; height: 16px; color: var(--icon); }
  .tile b { font-size: 20px; line-height: 1.3; }
  .tile b em { font-style: normal; font-weight: 400; font-size: 15px; color: var(--muted); }
  .tile small { color: var(--muted); font-size: 13px; }
  .mhdr .src { margin: 12px 0 0; color: #9aa0a8; font-size: 12px; }

  .legend { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 24px; }
  .legend span { padding: 4px 10px; border-radius: 99px; font-size: 13px; font-weight: 600; }

  /* Строка дня целиком окрашена в цвет типа дня, белая карточка погоды выделяется на ней. */
  .day { display: flex; gap: 16px; margin-bottom: 12px; padding: 14px; border-radius: 16px; }
  .card {
    flex: 0 0 296px; align-self: stretch; /* по высоте блока «время + кадр» */ padding: 14px 16px; border-radius: 12px;
    background: #fff; color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 6px 16px rgba(0, 0, 0, 0.08);
  }
  .card header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
  .date { font-size: 22px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
  .wd, .temps i { color: var(--muted); font-style: normal; }
  .badge { margin-left: auto; padding: 2px 8px; border-radius: 99px; font-size: 12px; font-weight: 600; color: #fff; background: var(--text); }
  .temps { display: flex; gap: 14px; margin-bottom: 10px; }
  .temps b { font-size: 20px; font-weight: 600; }
  .card ul { list-style: none; margin: 0; padding: 0; }
  .card li { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
  .card li svg { flex: none; color: var(--icon); }

  .shots { display: flex; flex-wrap: wrap; gap: 12px; align-content: flex-start; }
  figure { margin: 0; }
  figcaption { margin-bottom: 4px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .shots img { display: block; width: 400px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; background: rgba(0, 0, 0, 0.12); }
  .noshots { align-self: center; font-weight: 600; opacity: 0.75; }
  /* Кадры нескольких камер: строка на камеру, над ней подпись белой плашкой — видно, что это другое место. */
  .shots.many { flex-direction: column; flex-wrap: nowrap; }
  .shots .cam { display: flex; flex-wrap: wrap; gap: 6px 12px; }
  .shots .camname { flex: 0 0 100%; margin: 0; }
  .shots .camname b { display: inline-block; padding: 2px 10px; border-radius: 99px; background: rgba(255, 255, 255, 0.8);
    color: var(--text); font-size: 13px; font-weight: 600; }

  h2 { margin: 28px 0 12px; font-size: 22px; font-weight: 700; }
  .months { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
  .month { display: block; width: 520px; padding: 18px 20px; border-radius: 14px; background: #fff; border: 1px solid var(--line); text-decoration: none; }
  .month:hover { border-color: var(--text); }
  .month .head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
  .month .head b { font-size: 20px; font-weight: 700; }
  .month .head span { color: var(--muted); font-size: 13px; }
  .strip { display: grid; grid-template-columns: repeat(31, 1fr); gap: 2px; margin-bottom: 16px; }
  .seg i { display: block; height: 22px; border-radius: 3px; }
  .seg i.empty { box-shadow: inset 0 0 0 1.5px var(--empty); } /* дня нет — только рамка, чтобы не спутать с серым днём */
  .seg small { display: block; margin-top: 2px; text-align: center; font-size: 9px; color: var(--muted); }
  .avg { margin-bottom: 10px; }
  .avg span { color: var(--muted); }
  .avg b { font-size: 18px; }
  .counts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 10px; margin-bottom: 6px; font-size: 14px; }
  .counts span { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .counts i { flex: none; width: 10px; height: 10px; border-radius: 50%; }
  .counts .zero { opacity: 0.35; }
  .totals { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
  .empty { color: var(--muted); }
  .card li.warn { color: var(--icon); font-weight: 600; cursor: help; }

  .cities { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 24px; }
  .city {
    display: block; width: 380px; padding: 20px 22px; border-radius: 16px; text-decoration: none;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 6px 16px rgba(0, 0, 0, 0.08);
  }
  .city:hover { outline: 2px solid var(--text); }
  .city h2 { margin: 0 0 4px; font-size: 26px; }
  /* Рисунок знакового места — крупно, тонко, едва заметно, выходит за край карточки; текст поверх. */
  .city { position: relative; overflow: hidden; }
  .city > :not(.landmark) { position: relative; }
  .city .landmark { position: absolute; right: -40px; bottom: -18px; width: 320px; height: auto; opacity: 0.18; pointer-events: none; }
  .city .now { display: flex; align-items: baseline; gap: 12px; margin: 10px 0 4px; }
  .city .now b { font-size: 44px; font-weight: 700; line-height: 1; }
  .city .line { opacity: 0.85; }
  .city ul { list-style: none; margin: 10px 0; padding: 0; }
  .city li { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-weight: 600; }
  .city li svg { flex: none; }
  .city .warn { margin-top: 8px; font-weight: 600; }
  /* Переключатель языка RU | ES — в правом верхнем углу каждой страницы. */
  .lang { position: absolute; top: 28px; right: 40px; z-index: 10; display: flex; padding: 3px; border-radius: 99px;
    background: #fff; border: 1px solid var(--line); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); font-size: 13px; font-weight: 600; }
  .lang a, .lang b { padding: 5px 12px; border-radius: 99px; text-decoration: none; }
  .lang a { color: var(--muted); }
  .lang a:hover { color: var(--text); }
  .lang b { background: var(--text); color: #fff; }

  /* Month details: над днями — легенда слева, ссылка «сегодня ↓» справа; круглая кнопка «↑ наверх» после прокрутки.
     Обе кнопки белые, как карточки. */
  html { scroll-behavior: smooth; }
  .bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 24px; }
  .bar .legend { margin: 0; }
  .today { flex: none; padding: 5px 14px; border-radius: 99px; background: #fff; border: 1px solid var(--line);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); color: var(--text); font-size: 13px; font-weight: 600; text-decoration: none; }
  .today:hover { border-color: var(--text); }
  .day { scroll-margin-top: 12px; }
  .totop { position: fixed; right: 20px; bottom: 20px; z-index: 20; width: 48px; height: 48px; display: grid; place-items: center;
    border-radius: 50%; background: #fff; border: 1px solid var(--line); color: var(--icon); font-size: 22px; text-decoration: none;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18); opacity: 0; pointer-events: none; transition: opacity 0.2s;
    -webkit-tap-highlight-color: transparent; }
  .totop.show { opacity: 1; pointer-events: auto; }

  /* City overview: круглый значок ▶ рядом с заголовком — таймлапс основной камеры города. */
  .htitle { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 6px; }
  .htitle h1 { margin: 0; }
  .tl-round { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: #fff;
    border: 1px solid var(--line); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); color: var(--text); }
  .tl-round:hover { border-color: var(--text); }
  .tl-round svg { width: 16px; height: 16px; margin-left: 3px; }

  /* SpainWeather: карточка «Таймлапс» — фон из свежего кадра, белый текст поверх затемнения. */
  .city.tl-card { color: #fff; background: #222 center / cover; min-height: 250px; display: flex; flex-direction: column; justify-content: flex-end; }
  .city.tl-card::before { content: ''; position: absolute; inset: 0; background: linear-gradient(rgba(0, 0, 0, 0.05) 30%, rgba(0, 0, 0, 0.65)); }
  .tl-card .play { position: absolute; top: 20px; right: 22px; width: 44px; height: 44px; border-radius: 50%;
    background: rgba(255, 255, 255, 0.92); color: var(--text); display: grid; place-items: center; }
  .tl-card .play svg { margin-left: 3px; }

  /* Каталог таймлапсов: группы «Наши города» / «Другие места», карточка камеры — кадр, ▶, температура, подпись. */
  .tl-group { margin: 26px 0 12px; font-size: 20px; }
  .tl-group small { margin-left: 8px; color: var(--muted); font-size: 14px; font-weight: 400; }
  .tl-list { display: flex; flex-wrap: wrap; gap: 18px; }
  .tl-item { width: 340px; border-radius: 14px; overflow: hidden; background: #fff; border: 1px solid var(--line); color: var(--text); text-decoration: none; }
  .tl-item:hover { border-color: var(--text); }
  .tl-item .pic { position: relative; aspect-ratio: 16 / 9; background: #222 center / cover; }
  .tl-item .pic i { position: absolute; left: 10px; bottom: 10px; width: 34px; height: 34px; border-radius: 50%;
    background: rgba(255, 255, 255, 0.92); display: grid; place-items: center; }
  .tl-item .pic i svg { width: 14px; height: 14px; margin-left: 2px; }
  .tl-item .pic em { position: absolute; right: 10px; bottom: 10px; padding: 3px 9px; border-radius: 99px;
    background: rgba(0, 0, 0, 0.55); color: #fff; font-style: normal; font-size: 13px; font-weight: 600; }
  .tl-item .txt { padding: 10px 14px 12px; }
  .tl-item b { display: block; font-size: 17px; }
  .tl-item span { color: var(--muted); font-size: 13px; }

  /* Timelapse: кадр, подпись, ползунок поверх цветной полоски (кусочек на кадр, цвет дня), отметки месяцев, кнопки. */
  .tl { max-width: 1000px; padding: 18px; border-radius: 16px; background: #fff; border: 1px solid var(--line); }
  /* Рамка — по пропорциям кадра (у большинства 16:9, у Валенсии 4:3); у камеры-плеера (Овьедо) на старых кадрах
     внизу панель плеера — рамка ниже, низ прячется у всех кадров этой камеры. */
  .tl-shot { position: relative; overflow: hidden; border-radius: 10px; background: #222; }
  .tl-shot img { display: block; width: 100%; height: auto; }
  .tl-shot.crop { aspect-ratio: 960 / 500; }
  .tl-shot.crop img { position: absolute; top: 0; left: 0; }
  .tl-cap { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 12px 0 6px; }
  .tl-cap b { font-size: 20px; }
  .tl-temp { font-size: 18px; font-weight: 700; }
  .tl-src { margin: 12px 0 0; color: #9aa0a8; font-size: 12px; }
  .tl-kind { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); }
  .tl-kind i { width: 12px; height: 12px; border-radius: 3px; }
  .tl-track { position: relative; height: 44px; }
  .tl-bar { position: absolute; left: 0; right: 0; top: 12px; height: 20px; border-radius: 6px; }
  .tl-month { position: absolute; top: 4px; bottom: 4px; width: 2px; background: var(--text); pointer-events: none; }
  .tl-track input { position: absolute; inset: 0; width: 100%; height: 44px; margin: 0; background: none; -webkit-appearance: none; appearance: none; cursor: pointer; }
  .tl-track input::-webkit-slider-runnable-track { height: 44px; background: none; }
  .tl-track input::-webkit-slider-thumb { -webkit-appearance: none; width: 8px; height: 44px; border-radius: 4px; background: var(--text); box-shadow: 0 0 0 2px #fff; }
  .tl-track input::-moz-range-track { height: 44px; background: none; }
  .tl-track input::-moz-range-thumb { width: 8px; height: 44px; border: 0; border-radius: 4px; background: var(--text); box-shadow: 0 0 0 2px #fff; }
  .tl-ticks { position: relative; height: 18px; font-size: 12px; color: var(--muted); }
  .tl-ticks span { position: absolute; top: 0; padding-left: 4px; border-left: 1.5px solid var(--text); line-height: 14px; white-space: nowrap; }
  .tl-row { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; margin-top: 12px; }
  .tl-btns { display: flex; gap: 8px; }
  .tl-btns button { display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border-radius: 99px; border: 1px solid var(--line);
    background: #fff; color: var(--text); cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .tl-btns button:hover { border-color: var(--text); }
  .tl-btns .play { width: 52px; background: var(--text); border-color: var(--text); color: #fff; }
  .tl-btns .play span { display: grid; place-items: center; }
  .tl-btns .play .pause, .tl-btns .play.on .go { display: none; }
  .tl-btns .play.on .pause { display: grid; }
  .tl-spd { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
  .tl-speeds { display: inline-flex; gap: 2px; padding: 3px; border-radius: 99px; background: var(--page); border: 1px solid var(--line); }
  .tl-speeds button { height: 32px; min-width: 44px; border: 0; border-radius: 99px; background: none; color: var(--muted);
    font: 600 13px Inter, system-ui, sans-serif; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .tl-speeds button.on { background: var(--text); color: #fff; }
  .tl-count { margin-left: auto; color: var(--muted); font-size: 13px; }

  /* Телефон (iPhone 17 Pro Max — 440 точек): поля уже, карточки на всю ширину. */
  @media (max-width: 600px) {
    body { padding: 20px 16px 80px; } /* снизу место под кнопку «↑» */
    .lang { top: 16px; right: 16px; }
    .totop { right: 16px; bottom: 16px; }
    h1 { font-size: 28px; }
    .crumbs { margin-right: 110px; }
    .city { width: 100%; }
    /* City overview: без полоски дней — месяц, средние и счётчики в две колонки. */
    .months { gap: 14px; }
    .month { width: 100%; padding: 16px; }
    .month .head { margin-bottom: 10px; }
    .strip { display: none; }
    .counts { grid-template-columns: repeat(2, 1fr); gap: 6px 10px; }
    /* Month details: заголовок в строку, «данные за» под ним, плитки по две в ряд
       (нечётная последняя — на всю ширину); легенду цветов не показываем. */
    .mhdr { padding: 16px; }
    .mtitle { flex-direction: column; gap: 2px; }
    .mtitle h1 { font-size: 24px; }
    .verdict { font-size: 16px; }
    .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tile:last-child:nth-child(odd) { grid-column: span 2; }
    .tile span { white-space: normal; }
    .legend { display: none; }
    .bar { margin-bottom: 12px; }
    .mhdr .src { display: none; }
    /* Month details, дни: белая карточка в рамке цвета дня, кадры скрыты — раскрываются нажатием на день. */
    .day { flex-direction: column; gap: 0; padding: 10px; margin-bottom: 10px; -webkit-tap-highlight-color: transparent; }
    .day.has-shots { cursor: pointer; }
    .card { position: relative; flex: none; align-self: stretch; display: grid; grid-template-columns: 1fr auto;
      align-items: baseline; padding: 10px 12px; border-radius: 8px; box-shadow: none; }
    .card header { margin: 0; }
    .date { font-size: 20px; }
    .temps { margin: 0; gap: 10px; }
    .temps b { font-size: 18px; }
    .card ul { grid-column: span 2; display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; margin-top: 6px; font-size: 14px; }
    .card li { padding: 2px 0; }
    .card li svg { width: 16px; height: 16px; }
    .card li.sky { grid-column: span 2; order: 99; }
    .has-shots .card::after { grid-column: span 2; justify-self: end; margin-top: 4px; content: attr(data-more); font-size: 12px; color: var(--muted); }
    .open .card::after { content: attr(data-less); }
    .has-shots .badge { position: absolute; left: 12px; bottom: 9px; margin: 0; }
    .shots { display: none; flex-direction: column; gap: 10px; padding-top: 10px; }
    .day.open .shots { display: flex; }
    .shots figure { width: 100%; }
    .shots img { width: 100%; }
    /* Timelapse: панель уже, номер кадра — отдельной строкой. */
    .tl { padding: 12px; }
    .tl-cap b { font-size: 18px; }
    .tl-count { width: 100%; margin-left: 0; }
    .tl-item { width: 100%; }
    .city.tl-card { min-height: 220px; }
  }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

// withShots — у дня есть кадры: на телефоне в карточке подсказка «кадры ▾ / скрыть ▴».
function renderCard(s: DaySummary, t: Dict, withShots = false) {
  const [, m, d] = s.date.split('-').map(Number);

  const temps =
    s.tMin !== undefined && s.tMax !== undefined
      ? `<div class="temps"><span><i>${t.min}</i> <b>${fmt(s.tMin)}</b></span><span><i>${t.max}</i> <b>${fmt(s.tMax)}</b></span></div>`
      : '';

  const lines = [
    s.precip && `<li>${precipIcon(s)}${t.precip(s.precip)}</li>`,
    s.sky && `<li class="sky">${icon(SKY_ICON[s.sky.kind])}${t.sky(s.sky)}</li>`,
    s.feel && `<li>${icon('droplets')}${t.feel[s.feel]}</li>`,
    s.fog && `<li>${icon('fog')}${t.fogMorning}</li>`,
    s.air && `<li title="${t.airTitle[s.air]}" style="--icon: ${AIR_COLOR[s.air]}">${icon(AIR_ICON[s.air])}${t.air}</li>`,
    s.heating && `<li>${icon('flame')}${t.heating[s.heating]}</li>`,
    s.issues.length &&
      `<li class="warn" style="--icon: ${WARN_COLOR}" title="${esc(s.issues.join('\n'))}">${icon('alert')}${t.dubious}</li>`,
  ].filter(Boolean);

  return `
    <article class="card"${withShots ? ` data-more="${t.showShots}" data-less="${t.hideShots}"` : ''}>
      <header>
        <span class="date">${pad(d)}.${pad(m)}</span>
        <span class="wd">${weekday(s.date, t)}</span>
        ${s.partial ? `<span class="badge">${t.inProgress}</span>` : ''}
      </header>
      ${temps}
      ${lines.length ? `<ul>${lines.join('')}</ul>` : ''}
    </article>`;
}

// Подпись камеры: «что видно · чья камера», иначе имя из файла.
const cameraLabel = (city: City, name: string, lang: Lang) => {
  const cam = city.cameras.find((c) => c.name === name);
  return cam ? [cam.title?.[lang], cam.source].filter(Boolean).join(' · ') : name;
};

// shotsUrl — путь от страницы до папки с кадрами этого месяца.
// Если в дне кадры нескольких камер — каждая камера отдельной строкой с подписью-плашкой (порядок — как в city.cameras).
function renderShots(city: City, shots: Shot[], shotsUrl: string, t: Dict, lang: Lang) {
  if (!shots.length) return `<div class="shots"><span class="noshots">${t.noShots}</span></div>`;
  const figure = (s: Shot) => {
    const src = `${shotsUrl}${encodeURIComponent(s.file)}`;
    return `
      <figure>
        <figcaption>${s.time}</figcaption>
        <a href="${src}" target="_blank"><img src="${src}" loading="lazy" alt="${esc(s.file)}"></a>
      </figure>`;
  };
  const groups = [...Map.groupBy(shots, (s) => s.camera)];
  if (groups.length === 1) return `<div class="shots">${shots.map(figure).join('')}\n    </div>`;
  const order = (name: string) => {
    const i = city.cameras.findIndex((c) => c.name === name);
    return i < 0 ? city.cameras.length : i;
  };
  groups.sort(([a], [b]) => order(a) - order(b));
  const rows = groups.map(
    ([name, list]) => `
     <div class="cam"><p class="camname"><b>${esc(cameraLabel(city, name, lang))}</b></p>${list.map(figure).join('')}
     </div>`,
  );
  return `<div class="shots many">${rows.join('')}\n    </div>`;
}

// Всё о месяце: кадры и итоги каждого дня, у которого есть кадры, данные станции или замечания в журнале.
// Дни, где есть только небо из Open-Meteo (31 день назад), не показываем — без станции и кадров там пусто.
// model — у места нет станции: итоги дня (мин/макс, осадки) берутся из модели Open-Meteo.
async function loadMonth(monthDir: string, now: Date, model = false) {
  const [shots, daily, readings, sky, log] = await Promise.all([
    readShots(path.join(monthDir, 'screenshots')),
    readDaily(monthDir),
    readReadings(monthDir),
    readSky(monthDir),
    readLog(monthDir),
  ]);

  const shotsByDay = Map.groupBy(shots, (s) => s.day);
  const readingsByDay = Map.groupBy(readings, (r) => r.time.slice(0, 10));
  const logByDay = Map.groupBy(log, (e) => e.time.slice(0, 10));
  const days = [
    ...new Set([...shotsByDay.keys(), ...Object.keys(daily), ...readingsByDay.keys(), ...logByDay.keys()]),
  ].sort();
  const today = dateOf(now);
  const summaries = days.map((date) =>
    summarizeDay({
      date,
      totals: model ? modelTotals(sky[date]) : daily[date],
      readings: readingsByDay.get(date) ?? [],
      isToday: date === today,
      sky: sky[date],
      log: logByDay.get(date),
    }),
  );
  return { shots, shotsByDay, summaries, readings, sky };
}

// Итоги дня по модели — для мест без станции: мин/макс из температур по часам, осадки за сутки.
function modelTotals(sky?: SkyDay): DayTotals | undefined {
  const temps = (sky?.temps ?? []).filter((v): v is number => typeof v === 'number');
  if (!sky || !temps.length) return undefined;
  return { tMin: Math.min(...temps), tMax: Math.max(...temps), rain: sky.rain ?? 0 };
}

const credits = (city: City, t: Dict) => t.credits(city.cameras.map((c) => esc(c.name)), esc(city.station.label));

async function write(file: string, lang: Lang, title: string, body: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, page(lang, title, body), 'utf8');
  return file;
}

// Month details: шапка месяца + строка на день — карточка погоды слева, кадры справа.
// Месяц без дней (только небо из Open-Meteo) страницы не получает.
export async function buildMonthDetails(city: City, month: string, now: Date, lang: Lang) {
  const t = T[lang];
  const { shotsByDay, summaries } = await loadMonth(path.join(cityDir(city), month), now);
  if (!summaries.length) return undefined;
  const toSite = '../../../'; // site/<язык>/<город>/<месяц>/ → site/
  const shotsUrl = `${toSite}${city.id}/${month}/screenshots/`;

  // На телефоне кадры дня скрыты и раскрываются нажатием на день (класс open, см. DAY_TOGGLE).
  // Якорь сегодняшнего дня, если он есть на странице (только у текущего месяца) — для ссылки «сегодня ↓».
  const todayId = summaries.some((s) => s.date === dateOf(now)) ? `d${dateOf(now).slice(8)}` : undefined;
  const rows = summaries.map((summary) => {
    const { bg, fg } = KIND_STYLE[summary.kind];
    const dayShots = shotsByDay.get(summary.date) ?? [];
    const has = dayShots.length > 0;
    return `
  <section id="d${summary.date.slice(8)}" class="day${has ? ' has-shots' : ''}" style="background: ${bg}; color: ${fg}" title="${t.kind[summary.kind]}">${renderCard(summary, t, has)}
    ${renderShots(city, dayShots, shotsUrl, t, lang)}
  </section>`;
  });

  const name = city.names[lang];
  const title = `${name} · ${monthTitle(month, t)}`;
  const history = await readHistory(cityDir(city));
  return write(
    path.join(pagesDir(lang), city.id, month, 'index.html'),
    lang,
    title,
    `
${langSwitch(lang, toSite, `${city.id}/${month}/index.html`)}
${crumbs([['SpainWeather', '../../index.html'], [name, '../index.html'], [monthTitle(month, t)]])}
${renderMonthHeader(city, month, title, summaries, history, t)}
<div class="bar">${legend(t)}${todayId ? `<a class="today" href="#${todayId}">${t.toToday}</a>` : ''}</div>
${rows.length ? rows.join('') : `<p class="empty">${t.noData}</p>`}
<a class="totop" href="#" title="${t.toTop}" aria-label="${t.toTop}">↑</a>
${DAY_TOGGLE}`,
  );
}

// Нажатие на день раскрывает/скрывает его кадры (действует только на телефоне — правила .open в @media).
// Нажатие по самому кадру открывает картинку и день не сворачивает.
// Кнопка «↑» (.totop) появляется, когда страницу пролистали вниз.
const DAY_TOGGLE = `<script>
document.querySelectorAll('.day.has-shots').forEach((d) =>
  d.addEventListener('click', (e) => { if (!e.target.closest('.shots')) d.classList.toggle('open'); }));
const totop = document.querySelector('.totop');
addEventListener('scroll', () => totop.classList.toggle('show', scrollY > 400), { passive: true });
</script>`;

const MIN_DAYS_FOR_VERDICT = 7;

// Шапка страницы месяца: вывод одной фразой и строка плиток «этот месяц / обычно».
// «Обычно» — среднее за тот же месяц прошлых лет из архива (history.json); если архива нет — плитки без «обычно».
function renderMonthHeader(
  city: City,
  month: string,
  title: string,
  summaries: DaySummary[],
  history: Record<string, MonthClimate>,
  t: Dict,
) {
  const [y, m] = month.split('-').map(Number);
  const total = new Date(y, m, 0).getDate();
  const b = monthBreakdown(summaries);
  const past = pastMonths(month).map((k) => history[k]).filter((v): v is MonthClimate => !!v);
  const avg = (k: 'tMax' | 'rainy' | 'grey' | 'heat' | 'badAir') =>
    past.length ? past.reduce((a, p) => a + p[k], 0) / past.length : undefined;
  const usual = { tMax: avg('tMax'), rainy: avg('rainy'), grey: avg('grey'), heat: avg('heat'), badAir: avg('badAir') };
  const r0 = (v: number) => Math.round(v);

  let verdict = '';
  if (b.days < MIN_DAYS_FOR_VERDICT) {
    verdict = `<p class="verdict muted">${t.fewData(b.days)}</p>`;
  } else if (usual.tMax !== undefined && b.tMax !== undefined && usual.rainy !== undefined) {
    const dT = b.tMax - usual.tMax;
    const temp = Math.abs(dT) < 1 ? t.tempNormal : dT > 0 ? t.warmer(r0(Math.abs(dT))) : t.colder(r0(Math.abs(dT)));
    const wet = b.rainy / b.days - usual.rainy / total;
    const rain = Math.abs(wet) < 0.1 ? t.rainNormal : wet > 0 ? t.wetter : t.drier;
    verdict = `<p class="verdict">${t.soFar(t.months[m - 1])}<b>${temp}, ${rain}</b></p>`;
  }

  const tile = (ic: keyof typeof ICON_PATHS, label: string, big: string, usualText?: string) =>
    `<div class="tile"><span>${icon(ic)}${label}</span><b>${big}</b><small>${usualText ? t.usual(usualText) : '&nbsp;'}</small></div>`;
  const of = (n: number) => {
    const [num, rest] = t.of(n, b.days);
    return `${num} <em>${rest}</em>`;
  };
  const uof = (v?: number) => (v === undefined ? undefined : t.of(r0(v), total).join(' '));
  const light = past.at(-1);

  const tiles = [
    tile('thermometer', t.tiles.tMax, b.tMax === undefined ? '—' : `${r0(b.tMax)}°`, usual.tMax === undefined ? undefined : `${r0(usual.tMax)}°`),
    tile('rain', t.tiles.rainy, of(b.rainy), uof(usual.rainy)),
    tile('cloud', t.tiles.grey, of(b.grey), uof(usual.grey)),
    city.showHeat ? tile('flame', t.tiles.heat, of(b.heat), uof(usual.heat)) : '',
    tile('frown', t.tiles.badAir, of(b.badAir), uof(usual.badAir)),
    light ? tile('sun', t.tiles.light, `${light.sunrise}–${light.sunset}`) : '',
  ].join('');

  const years = past.length ? `${pastMonths(month)[0].slice(0, 4)}–${pastMonths(month).at(-1)!.slice(0, 4)}` : '';
  const source = past.length ? t.source(t.monthsPlural[m - 1], years, credits(city, t)) : t.noArchive(credits(city, t));

  return `
<section class="mhdr">
  <div class="mtitle"><h1>${esc(title)}</h1><span>${t.dataDays(b.days, total)}</span></div>
  ${verdict}
  <div class="tiles">${tiles}</div>
  <p class="src">${source}</p>
</section>`;
}

export async function listMonths(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && MONTH_DIR_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

// Счётчики дней на карточке месяца: две строки по четыре, в порядке легенды.
const COUNT_ROWS: (keyof Dict['counts'])[][] = [
  ['clear', 'partly', 'cloudy', 'overcast'],
  ['fog', 'drizzle', 'rain', 'downpour'],
];

// Карточка месяца на странице города: полоска дней по цветам и итоги месяца.
function renderMonthCard(month: string, summaries: DaySummary[], t: Dict) {
  const [y, m] = month.split('-').map(Number);
  const byDate = new Map(summaries.map((s) => [s.date, s]));
  const total = new Date(y, m, 0).getDate();
  const st = monthStats(summaries);

  const strip = Array.from({ length: total }, (_, i) => {
    const date = `${month}-${pad(i + 1)}`;
    const s = byDate.get(date);
    const title = s
      ? `${pad(i + 1)}.${pad(m)} ${weekday(date, t)} — ${t.kind[s.kind]}${s.partial ? ` (${t.inProgress})` : ''}`
      : `${pad(i + 1)}.${pad(m)} — ${t.kind.none}`;
    const day = s ? `<i style="background: ${KIND_STYLE[s.kind].bg}"></i>` : '<i class="empty"></i>';
    return `<div class="seg" title="${title}">${day}<small>${i + 1}</small></div>`;
  }).join('');

  const counts = COUNT_ROWS.map(
    (row) =>
      `<div class="counts">${row
        .map((kind) => {
          const n = st.counts[kind] ?? 0;
          return `<span${n ? '' : ' class="zero"'}><i style="background: ${KIND_STYLE[kind].bg}"></i>${t.counts[kind]} <b>${n}</b></span>`;
        })
        .join('')}</div>`,
  ).join('');

  const temp = (v?: number) => (v === undefined ? '—' : String(v));

  return `
  <a class="month" href="${month}/index.html">
    <div class="head"><b>${monthTitle(month, t)}</b><span>${t.dataDays(st.days, total)}</span></div>
    <div class="strip">${strip}</div>
    <div class="avg">${t.average}&nbsp;&nbsp;<span>${t.min}</span> <b>${temp(st.avgMin)}</b> · <span>${t.max}</span> <b>${temp(st.avgMax)}</b></div>
    ${counts}
    <div class="totals">${t.totals(st.rain, st.heatingDays)}</div>
  </a>`;
}

// Все месяцы города или места: кадры, итоги дней, замеры и небо — для City overview и таймлапса.
type CityMonth = { month: string; shots: Shot[]; summaries: DaySummary[]; readings: Reading[]; sky: Record<string, SkyDay> };
async function loadCity(place: Place, now: Date, model = false): Promise<CityMonth[]> {
  const out: CityMonth[] = [];
  for (const month of await listMonths(cityDir(place))) {
    const { shots, summaries, readings, sky } = await loadMonth(path.join(cityDir(place), month), now, model);
    out.push({ month, shots, summaries, readings, sky });
  }
  return out;
}

// City overview: карточки месяцев по порядку (январь → декабрь), сгруппированы по годам.
// Рядом с заголовком — круглый значок ▶: таймлапс основной камеры города (раздел «Таймлапс»), если есть кадры.
export async function buildCityOverview(city: City, months: CityMonth[], lang: Lang) {
  const t = T[lang];
  const cards: { year: string; html: string }[] = [];
  for (const { month, summaries } of months) {
    // Месяц, где есть только небо из Open-Meteo (без станции и кадров), не показываем.
    if (summaries.length) cards.push({ year: month.slice(0, 4), html: renderMonthCard(month, summaries, t) });
  }
  const tlLink = months.some((m) => m.shots.length)
    ? `<a class="tl-round" href="../timelapse/${city.cameras[0].name}/index.html" title="${t.timelapse}" aria-label="${t.timelapse}">${icon('play')}</a>`
    : '';

  const years = [...Map.groupBy(cards, (c) => c.year)].map(
    ([year, list]) => `
<h2>${year}</h2>
<div class="months">${list.map((c) => c.html).join('')}
</div>`,
  );

  const name = city.names[lang];
  const title = t.cityTitle(name);
  return write(
    path.join(pagesDir(lang), city.id, 'index.html'),
    lang,
    title,
    `
${langSwitch(lang, '../../', `${city.id}/index.html`)}
${crumbs([['SpainWeather', '../index.html'], [name]])}
<div class="htitle"><h1>${esc(title)}</h1>${tlLink}</div>
<p class="sub">${credits(city, t)}</p>
${years.length ? years.join('') : `<p class="empty">${t.noMonths}</p>`}`,
  );
}

// Таймлапс — отдельный раздел сайта (карточка на главной):
//   site/<язык>/timelapse/index.html         — каталог: «Наши города» и «Другие места», у камеры последний кадр и температура
//   site/<язык>/timelapse/<камера>/index.html — таймлапс камеры: все её кадры подряд (до трёх в день), ползунок поверх
//     полоски, где у каждого кадра кусочек цвета его дня; отметки начала месяцев; кнопки «кадр назад / показ / кадр вперёд»,
//     скорость 2× / 5× / 10× (кадров в секунду); под кадром дата, время, температура в момент кадра и тип дня.
// Температура: у города — замер станции этого же сбора, если его нет — модель Open-Meteo за этот час; у других мест — модель.
// Открывается на последнем кадре, новые кадры попадают сюда при каждой сборке. Скрипт — TIMELAPSE_JS.
type TlCamera = { place: Place; cam: Camera; city?: City; months: CityMonth[] };
type TlFrame = Shot & { month: string; temp?: number; kind: DayKind };

const tlTitle = (e: TlCamera, lang: Lang) =>
  e.place.cameras.length > 1 && e.cam.title ? `${e.place.names[lang]} · ${e.cam.title[lang]}` : e.place.names[lang];
const frameSrc = (e: TlCamera, f: TlFrame, toSite: string) => `${toSite}${e.place.id}/${f.month}/screenshots/${encodeURIComponent(f.file)}`;
const tempText = (v?: number) => (v === undefined ? '' : `${Math.round(v)}°`);

// Кадры камеры по порядку, с температурой в момент кадра и типом его дня.
function tlFrames(e: TlCamera): TlFrame[] {
  return e.months.flatMap((m) => {
    const kindOf = new Map(m.summaries.map((s) => [s.date, s.kind]));
    const good = m.readings.filter((r) => !r.stale && !hasErrors(r.issues));
    return m.shots
      .filter((s) => s.camera === e.cam.name)
      .map((s) => {
        // Кадр и замер делаются в один сбор — время совпадает; допускаем расхождение до 15 минут.
        const at = Date.parse(`${s.day}T${s.time}`);
        const reading = good.find((r) => r.time.startsWith(s.day) && Math.abs(Date.parse(r.time) - at) <= 15 * 60_000);
        const model = m.sky[s.day]?.temps?.[Number(s.time.slice(0, 2))];
        return { ...s, month: m.month, temp: reading?.temp ?? model ?? undefined, kind: kindOf.get(s.day) ?? 'none' };
      });
  });
}

// Каталог таймлапсов: карточка на камеру — последний кадр, температура, источник, с какого дня и сколько кадров.
async function buildTimelapseCatalog(entries: TlCamera[], lang: Lang) {
  const t = T[lang];
  const toSite = '../../'; // site/<язык>/timelapse/ → site/
  const card = (e: TlCamera) => {
    const frames = tlFrames(e);
    const last = frames.at(-1);
    if (!last) return '';
    const [, m, d] = frames[0].day.split('-').map(Number);
    return `
  <a class="tl-item" href="${e.cam.name}/index.html"><div class="pic" style="background-image: url('${frameSrc(e, last, toSite)}')"><i>${icon('play')}</i>${last.temp === undefined ? '' : `<em>${tempText(last.temp)}</em>`}</div>
    <div class="txt"><b>${esc(tlTitle(e, lang))}</b><span>${esc(t.tlInfo(e.cam.source, d, m, frames.length))}</span></div></a>`;
  };
  const group = (title: string, note: string, list: TlCamera[]) => {
    const cards = list.map(card).filter(Boolean);
    return cards.length ? `\n<h2 class="tl-group">${title}<small>${note}</small></h2>\n<div class="tl-list">${cards.join('')}\n</div>` : '';
  };
  return write(
    path.join(pagesDir(lang), 'timelapse', 'index.html'),
    lang,
    t.timelapse,
    `
${langSwitch(lang, toSite, 'timelapse/index.html')}
${crumbs([['SpainWeather', '../index.html'], [t.timelapse]])}
<h1>${t.timelapse}</h1>
<p class="sub">${t.tlCatalogSub}</p>${group(t.tlOurCities, t.tlNoteStations, entries.filter((e) => e.city))}${group(t.tlOtherPlaces, t.tlNoteModel, entries.filter((e) => !e.city))}`,
  );
}

async function buildCameraTimelapse(e: TlCamera, lang: Lang) {
  const t = T[lang];
  const toSite = '../../../'; // site/<язык>/timelapse/<камера>/ → site/
  const frames = tlFrames(e);
  const name = tlTitle(e, lang);
  const title = t.timelapseTitle(name);
  const top = `
${langSwitch(lang, toSite, `timelapse/${e.cam.name}/index.html`)}
${crumbs([['SpainWeather', '../../index.html'], [t.timelapse, '../index.html'], [name]])}
<h1>${esc(name)}</h1>`;
  const file = path.join(pagesDir(lang), 'timelapse', e.cam.name, 'index.html');
  if (!frames.length) return write(file, lang, title, `${top}\n<p class="empty">${t.noData}</p>`);

  // Дни — подпись, цвет и тип; кадр ссылается на свой день, чтобы не повторять подписи.
  const dates = [...new Set(frames.map((f) => f.day))];
  const dayIdx = new Map(dates.map((d, i) => [d, i]));
  const days = dates.map((date) => {
    const [y, m, d] = date.split('-').map(Number);
    const kind = frames.find((f) => f.day === date)!.kind;
    return { l: t.longDate(d, m, y, weekday(date, t)), c: KIND_STYLE[kind].bg, k: t.kind[kind] };
  });
  const data = frames.map((f) => [dayIdx.get(f.day)!, f.time, frameSrc(e, f, toSite), tempText(f.temp)]);

  const n = frames.length;
  const pct = (i: number) => `${((i / n) * 100).toFixed(3)}%`;
  const grad = frames.map((f, i) => { const c = days[dayIdx.get(f.day)!].c; return `${c} ${pct(i)},${c} ${pct(i + 1)}`; }).join(',');
  const starts = frames.flatMap((f, i) => (i === 0 || f.day.slice(0, 7) !== frames[i - 1].day.slice(0, 7) ? [i] : []));
  const ticks = starts.map((i) => {
    const month = frames[i].day.slice(0, 7);
    const label = i === 0 || month.endsWith('-01') ? monthTitle(month, t) : t.months[Number(month.slice(5)) - 1];
    return `<span style="left: ${pct(i)}">${label}</span>`;
  });
  const lines = starts.filter((i) => i > 0).map((i) => `<div class="tl-month" style="left: ${pct(i)}"></div>`);

  const last = frames[n - 1];
  const lastDay = days[dayIdx.get(last.day)!];
  const json = JSON.stringify({ days, frames: data, count: t.frameOf('%n', '%t') }).replace(/</g, '\\u003c');
  return write(
    file,
    lang,
    title,
    `${top}
<p class="sub">${t.timelapseSub}</p>
<section class="tl">
  <div class="tl-shot${e.cam.kind === 'rtspEmbed' ? ' crop' : ''}"><img id="tl-img" src="${frameSrc(e, last, toSite)}" alt=""></div>
  <div class="tl-cap"><b id="tl-date">${lastDay.l}</b><span id="tl-time">${last.time}</span><span class="tl-temp" id="tl-temp">${tempText(last.temp)}</span><span class="tl-kind" id="tl-kind"><i style="background: ${lastDay.c}"></i>${lastDay.k}</span></div>
  <div class="tl-track"><div class="tl-bar" style="background: linear-gradient(90deg,${grad})"></div>${lines.join('')}<input type="range" id="tl-range" min="0" max="${n - 1}" value="${n - 1}" step="1" aria-label="${t.timelapse}"></div>
  <div class="tl-ticks">${ticks.join('')}</div>
  <div class="tl-row">
    <div class="tl-btns"><button id="tl-prev" title="${t.prevFrame}" aria-label="${t.prevFrame}">${icon('back')}</button><button id="tl-play" class="play" title="${t.playPause}" aria-label="${t.playPause}"><span class="go">${icon('play')}</span><span class="pause">${icon('pause')}</span></button><button id="tl-next" title="${t.nextFrame}" aria-label="${t.nextFrame}">${icon('forward')}</button></div>
    <div class="tl-spd">${t.speed}<span class="tl-speeds"><button data-fps="2">2×</button><button data-fps="5" class="on">5×</button><button data-fps="10">10×</button></span></div>
    <span class="tl-count" id="tl-count">${t.frameOf(String(n), String(n))}</span>
  </div>
  <p class="tl-src">${esc(t.tlSource(e.cam.source, e.city?.station.label))}</p>
</section>
<script>const TL = ${json};</script>
${TIMELAPSE_JS}`,
  );
}

// Весь раздел на одном языке: каталог и страница каждой камеры.
export async function buildTimelapse(entries: TlCamera[], lang: Lang) {
  const files = [await buildTimelapseCatalog(entries, lang)];
  for (const e of entries) files.push(await buildCameraTimelapse(e, lang));
  return files;
}

// Карточка «Таймлапс» на главной: фон — последний кадр (сначала камеры других мест — они красивее), сверху значок ▶.
function renderTimelapseCard(entries: TlCamera[], lang: Lang) {
  const t = T[lang];
  const withFrames = entries.map((e) => ({ e, last: tlFrames(e).at(-1) })).filter((x) => x.last);
  if (!withFrames.length) return '';
  const cover = withFrames.find((x) => !x.e.city) ?? withFrames[0];
  const names = [...new Set(withFrames.map((x) => x.e.place.names[lang].split(' · ')[0]))];
  return `
  <a class="city tl-card" href="timelapse/index.html" style="background-image: url('${frameSrc(cover.e, cover.last!, '../')}')">
    <span class="play">${icon('play')}</span>
    <h2>${t.timelapse}</h2>
    <div class="line">${esc(names.join(', '))}</div>
    <div class="line">${t.tlCardCount(withFrames.length)}</div>
  </a>`;
}

// Ползунок, показ с выбранной скоростью, стрелки ← → и пробел на клавиатуре; следующие кадры подгружаются заранее.
const TIMELAPSE_JS = `<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const img = $('tl-img'), range = $('tl-range'), playBtn = $('tl-play');
  const last = TL.frames.length - 1;
  let i = last, fps = 5, timer = null;
  const cache = {};
  const preload = (k) => { const f = TL.frames[k]; if (f && !cache[k]) { cache[k] = new Image(); cache[k].src = f[2]; } };
  function show(k) {
    i = Math.max(0, Math.min(last, k));
    const [d, time, src, temp] = TL.frames[i], day = TL.days[d];
    img.src = src; range.value = i;
    $('tl-date').textContent = day.l; $('tl-time').textContent = time; $('tl-temp').textContent = temp;
    $('tl-kind').innerHTML = '<i style="background: ' + day.c + '"></i>';
    $('tl-kind').append(day.k);
    $('tl-count').textContent = TL.count.replace('%n', i + 1).replace('%t', last + 1);
    for (let n = 1; n <= 10; n++) preload(i + n);
  }
  function play(on) {
    clearInterval(timer); timer = null;
    if (on) {
      if (i >= last) show(0);
      timer = setInterval(() => (i >= last ? play(false) : show(i + 1)), 1000 / fps);
    }
    playBtn.classList.toggle('on', !!timer);
  }
  range.addEventListener('input', () => { play(false); show(+range.value); });
  playBtn.onclick = () => play(!timer);
  $('tl-prev').onclick = () => { play(false); show(i - 1); };
  $('tl-next').onclick = () => { play(false); show(i + 1); };
  document.querySelectorAll('.tl-speeds button').forEach((b) => b.onclick = () => {
    fps = +b.dataset.fps;
    document.querySelectorAll('.tl-speeds button').forEach((x) => x.classList.toggle('on', x === b));
    if (timer) play(true);
  });
  addEventListener('keydown', (e) => {
    if (e.target.closest('button, input')) return; // у кнопок и ползунка свои клавиши
    if (e.key === 'ArrowLeft') $('tl-prev').click();
    else if (e.key === 'ArrowRight') $('tl-next').click();
    else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  });
  show(last);
})();
</script>`;

// Карточка города на главной: цвет и итоги сегодняшнего дня, последний замер станции.
async function renderCityCard(city: City, now: Date, lang: Lang) {
  const t = T[lang];
  const { summaries, readings } = await loadMonth(path.join(cityDir(city), monthOf(now)), now);
  const today = summaries.find((s) => s.date === dateOf(now));
  // Текущую температуру показываем только из нормального замера: без ошибок и не устаревшего.
  const last = readings.filter((r) => r.time.startsWith(dateOf(now)) && !r.stale && !hasErrors(r.issues)).at(-1);
  const kind = today?.kind ?? 'none';
  const { bg, fg } = KIND_STYLE[kind];

  const temps =
    today?.tMin !== undefined && today.tMax !== undefined ? `${t.min} ${fmt(today.tMin)} · ${t.max} ${fmt(today.tMax)}` : '';
  const warn = today?.issues.length
    ? `<div class="warn" title="${esc(today.issues.join('\n'))}">⚠ ${t.dubious}</div>`
    : '';

  // На главной — как ощущается сейчас (по последнему замеру), а не «лицо дня» в 14:00, как в карточке дня.
  const details = [
    today?.precip && `<li>${precipIcon(today)}${t.precip(today.precip)}</li>`,
    last && `<li>${icon('droplets')}${t.feelsNow(t.feel[feel(last.temp, last.dew)])}</li>`,
  ].filter(Boolean);

  return `
  <a class="city" href="${city.id}/index.html" style="background: ${bg}; color: ${fg}">
    ${landmarkArt(city.id, lang)}
    <h2>${esc(city.names[lang])}</h2>
    <div class="line">${t.today(today?.sky ? t.sky(today.sky) : t.kind[kind])}</div>
    <div class="now"><b>${last ? `${fmt(last.temp)}°` : '—'}</b><span>${temps}</span></div>
    ${details.length ? `<ul>${details.join('')}</ul>` : ''}
    <div class="line">${last ? t.updated(last.time.slice(11)) : t.noDataToday}</div>
    ${warn}
  </a>`;
}

// SpainWeather (главная): карточки городов и карточка раздела «Таймлапс».
export async function buildSpainWeather(now: Date, lang: Lang, timelapse: TlCamera[] = []) {
  const t = T[lang];
  const cards = await Promise.all(CITIES.map((city) => renderCityCard(city, now, lang)));
  cards.push(renderTimelapseCard(timelapse, lang));
  return write(
    path.join(pagesDir(lang), 'index.html'),
    lang,
    t.siteTitle,
    `
${langSwitch(lang, '../', 'index.html')}
<h1>SpainWeather</h1>
<p class="sub">${t.siteSub}</p>
<div class="cities">${cards.join('')}
</div>`,
  );
}

// Перенаправления: корень проекта и site/index.html → главная на языке по умолчанию;
// старые адреса страниц (до появления языков) → те же страницы на языке по умолчанию;
// старые адреса таймлапса (site/<язык>/<город>/timelapse/…, до раздела «Таймлапс») → страницы камер в разделе.
async function writeRedirects(cityMonths: Map<City, string[]>) {
  for (const lang of LANGS) {
    for (const city of CITIES) {
      for (const [i, cam] of city.cameras.entries()) {
        const file = path.join(pagesDir(lang), city.id, 'timelapse', i === 0 ? 'index.html' : `${cam.name}.html`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, redirect(`../../timelapse/${cam.name}/index.html`), 'utf8');
      }
    }
  }
  await writeFile(ROOT_INDEX, redirect(`site/${DEFAULT_LANG}/index.html`), 'utf8');
  await writeFile(path.join(SITE, 'index.html'), redirect(`${DEFAULT_LANG}/index.html`), 'utf8');
  for (const [city, months] of cityMonths) {
    await writeFile(path.join(cityDir(city), 'index.html'), redirect(`../${DEFAULT_LANG}/${city.id}/index.html`), 'utf8');
    for (const month of months) {
      const file = path.join(cityDir(city), month, 'index.html');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, redirect(`../../${DEFAULT_LANG}/${city.id}/${month}/index.html`), 'utf8');
    }
  }
}

// Пересобирает весь сайт (или указанные месяцы города) на всех языках из сохранённых данных.
// now — один момент на весь запуск, чтобы «сегодня» везде было одним и тем же днём.
export async function buildSite(now: Date, only?: Map<string, Set<string>>) {
  const written: string[] = [];
  const cityMonths = new Map<City, string[]>();
  const timelapse: TlCamera[] = [];
  for (const city of CITIES) {
    const months = only ? [...(only.get(city.id) ?? [])] : await listMonths(cityDir(city));
    const built: string[] = [];
    for (const month of months.sort()) {
      let has = false;
      for (const lang of LANGS) {
        const file = await buildMonthDetails(city, month, now, lang);
        if (file) {
          written.push(file);
          has = true;
        }
      }
      if (has) built.push(month);
    }
    cityMonths.set(city, built);
    const all = await loadCity(city, now);
    for (const lang of LANGS) written.push(await buildCityOverview(city, all, lang));
    timelapse.push(...city.cameras.map((cam) => ({ place: city, cam, city, months: all })));
  }
  for (const place of PLACES) {
    const all = await loadCity(place, now, true);
    timelapse.push(...place.cameras.map((cam) => ({ place, cam, months: all })));
  }
  for (const lang of LANGS) {
    written.push(...(await buildTimelapse(timelapse, lang)));
    written.push(await buildSpainWeather(now, lang, timelapse));
  }
  await writeRedirects(cityMonths);
  return written;
}

// Запуск отдельно, без съёмки: node src/report.ts — пересобрать весь сайт.
if (process.argv[1] === import.meta.filename) {
  for (const file of await buildSite(new Date())) console.log(`PAGE  ${path.relative(SITE, file)}`);
}

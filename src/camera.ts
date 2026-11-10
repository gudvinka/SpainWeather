import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Frame as PwFrame, Page } from 'playwright';
import sharp from 'sharp';
import type { Lang } from './i18n.ts';
import { checkFrame, type Issue } from './quality.ts';

// Три вида камер:
// rtspEmbed — видеоплеер rtsp.me по прямой ссылке (url — адрес плеера): открываем браузером, запускаем видео, берём кадр;
// rtspPage  — тот же плеер, но владелец разрешил показывать его только на своих сайтах (прямая ссылка пишет «доступен
//             только на указанных сайтах»): url — страница такого сайта, открываем её как посетитель, кадр — из плеера
//             во фрейме страницы. Замок не обходим (адрес не подделываем) — смотрим там, где показ разрешён;
// image     — прямая ссылка на текущий кадр: просто скачиваем.
// name   — уникальное имя камеры на весь сайт: в имени файла кадра (<stamp>_<name>.jpg) и в адресе таймлапса
//          (site/<язык>/timelapse/<name>/); по нему кадры разных камер не смешиваются;
// title  — что видно, коротко («Альгамбра»), если у города несколько камер; без него камеру зовут по городу/месту;
// source — чья камера («meteo365»), для подписей.
export type Camera = { kind: 'rtspEmbed' | 'rtspPage' | 'image'; name: string; url: string; source: string; title?: Record<Lang, string> };

export type Frame = { file: string; bytes: number; issues: Issue[] };
type Raw = { image: Uint8Array; issues: Issue[] };

// На сайте кадр показывается шириной 400px (день) и ~960px (таймлапс) — полный размер не нужен.
// 1080px — ширина вертикального ролика (Reels), чтобы из кадров можно было собрать видео без растяжения;
// меньшие кадры не растягиваются. До 10.11.2026 кадры сохранялись шириной 960px. JPEG 75 — облака различимы, файл легче.
const FRAME_WIDTH = 1080;
const FRAME_QUALITY = 75;

export const shrink = (image: Uint8Array) =>
  sharp(image).resize({ width: FRAME_WIDTH, withoutEnlargement: true }).jpeg({ quality: FRAME_QUALITY, mozjpeg: true }).toBuffer();

const PLAY_TIMEOUT = 30_000;

// Страница плеера или фрейм с ним на чужой странице — у обоих одни и те же методы.
type Player = Page | PwFrame;

// Ждём, пока видео реально пойдёт: есть кадр и время двигается.
async function waitForPlaying(page: Player, timeout: number) {
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video');
      return !!v && v.readyState >= 2 && v.currentTime > 0;
    },
    null,
    { timeout },
  );
}

// rtsp.me сам не стартует, а клик по #bigPlay до готовности плеера теряется.
// Поэтому жмём play и проверяем по 3 секунды, пока видео не пойдёт или не выйдет общий таймаут.
async function startVideo(page: Player) {
  const bigPlay = page.locator('#bigPlay');
  const deadline = Date.now() + PLAY_TIMEOUT;
  while (true) {
    if (await bigPlay.isVisible()) await bigPlay.click({ timeout: 2000 }).catch(() => {});
    try {
      return await waitForPlaying(page, 3000);
    } catch (e) {
      if (Date.now() > deadline) throw e;
    }
  }
}

// Кадр берём прямо из видео (canvas): полный размер потока и без кнопок плеера поверх картинки.
// Обрезаем по центру до 16:9 — так же, как плеер показывает видео в окне 16:9 (у Овьедо поток 2304×1536, 3:2),
// чтобы новые кадры совпадали по рамке со старыми (до 10.11.2026 — скриншот плеера с его кнопками).
async function grabVideoFrame(page: Player): Promise<Uint8Array> {
  const dataUrl = await page.evaluate(() => {
    const v = document.querySelector('video')!;
    const w = v.videoWidth, h = v.videoHeight;
    const [cw, ch] = w / h > 16 / 9 ? [Math.round((h * 16) / 9), h] : [w, Math.round((w * 9) / 16)];
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    c.getContext('2d')!.drawImage(v, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
    return c.toDataURL('image/jpeg', 0.95);
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

// onPage — url это страница сайта, а плеер rtsp.me — во фрейме на ней (rtspPage).
async function captureEmbed(context: BrowserContext, url: string, onPage = false): Promise<Raw> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    let player: Player = page;
    if (onPage) {
      const iframe = await page.waitForSelector('iframe[src*="rtsp.me/embed"]', { timeout: PLAY_TIMEOUT });
      const frame = await iframe.contentFrame();
      if (!frame) throw new Error('плеер rtsp.me на странице не загрузился');
      player = frame;
    }
    const video = player.locator('video').first();
    await video.waitFor({ state: 'visible', timeout: PLAY_TIMEOUT });
    await startVideo(player);
    // Если видео не даётся в canvas (например, поток с другого сайта без разрешения) — скриншот плеера, как раньше.
    const image = await grabVideoFrame(player).catch(() => video.screenshot({ type: 'png' }));
    return { image, issues: checkFrame({ bytes: image.length }) };
  } finally {
    await page.close();
  }
}

async function downloadImage(url: string, now: Date): Promise<Raw> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`ответ не картинка: ${type || 'без типа'}`);
  const image = new Uint8Array(await res.arrayBuffer());
  const modified = Date.parse(res.headers.get('last-modified') ?? '');
  return { image, issues: checkFrame({ bytes: image.length, ageMs: Number.isNaN(modified) ? undefined : now.getTime() - modified }) };
}

// Сохраняет уменьшенный кадр в dir/<stamp>_<name>.jpg. context (браузер) нужен камерам-плеерам (rtspEmbed, rtspPage).
export async function capture(
  cam: Camera,
  dir: string,
  stamp: string,
  now: Date,
  context?: BrowserContext,
): Promise<Frame> {
  let raw: Raw;
  if (cam.kind === 'image') raw = await downloadImage(cam.url, now);
  else if (!context) throw new Error('для видеокамеры нужен браузер');
  else raw = await captureEmbed(context, cam.url, cam.kind === 'rtspPage');

  const jpeg = await shrink(raw.image); // проверки качества — по исходной картинке, сохраняем уменьшенную
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${stamp}_${cam.name}.jpg`);
  await writeFile(file, jpeg);
  return { file, bytes: jpeg.length, issues: raw.issues };
}

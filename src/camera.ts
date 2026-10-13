import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import sharp from 'sharp';
import { checkFrame, type Issue } from './quality.ts';

// Два вида камер:
// rtspEmbed — видеоплеер rtsp.me на странице: открываем браузером, запускаем видео, скриним кадр;
// image     — прямая ссылка на текущий кадр: просто скачиваем.
export type Camera = { kind: 'rtspEmbed' | 'image'; name: string; url: string };

export type Frame = { file: string; bytes: number; issues: Issue[] };
type Raw = { image: Uint8Array; issues: Issue[] };

// Кадр нужен, чтобы видеть небо, а показывается шириной 400px — полный размер не нужен.
// 960px оставляет запас для чётких экранов и просмотра крупно; JPEG 75 — облака различимы, файл втрое легче.
const FRAME_WIDTH = 960;
const FRAME_QUALITY = 75;

export const shrink = (image: Uint8Array) =>
  sharp(image).resize({ width: FRAME_WIDTH, withoutEnlargement: true }).jpeg({ quality: FRAME_QUALITY, mozjpeg: true }).toBuffer();

const PLAY_TIMEOUT = 30_000;

// Ждём, пока видео реально пойдёт: есть кадр и время двигается.
async function waitForPlaying(page: Page, timeout: number) {
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
async function startVideo(page: Page) {
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

async function captureEmbed(context: BrowserContext, url: string): Promise<Raw> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const video = page.locator('video').first();
    await video.waitFor({ state: 'visible', timeout: PLAY_TIMEOUT });
    await startVideo(page);
    const image = await video.screenshot({ type: 'png' });
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

// Сохраняет уменьшенный кадр в dir/<stamp>_<name>.jpg. context нужен только для rtspEmbed.
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
  else raw = await captureEmbed(context, cam.url);

  const jpeg = await shrink(raw.image); // проверки качества — по исходной картинке, сохраняем уменьшенную
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${stamp}_${cam.name}.jpg`);
  await writeFile(file, jpeg);
  return { file, bytes: jpeg.length, issues: raw.issues };
}

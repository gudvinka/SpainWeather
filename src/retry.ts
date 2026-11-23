// Повторные попытки для запросов к сервисам (AEMET, Open-Meteo). Сервисы иногда отвечают «слишком много запросов»
// (HTTP 429) или падают на минуту — тогда ждём и пробуем снова. Ошибки, которые повтором не исправить (неверный ключ,
// нет такой станции — прочие 4xx), отдаём сразу.

export class HttpError extends Error {
  status: number;
  constructor(service: string, status: number) {
    super(`${service}: HTTP ${status}`);
    this.status = status;
  }
}

const worthRetry = (e: unknown) => !(e instanceof HttpError) || e.status === 429 || e.status >= 500;

// delays — паузы перед каждой следующей попыткой, мс: [20_000, 60_000] — всего три попытки.
export async function withRetry<T>(fn: () => Promise<T>, delays: number[]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= delays.length || !worthRetry(e)) throw e;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

// Текст ошибки для журнала. У fetch настоящая причина спрятана в `cause`: «fetch failed» без неё ничего не говорит —
// а это может быть обрыв связи (ECONNRESET), отказ в соединении (ECONNREFUSED), не найден адрес (ENOTFOUND) и т. п.
export function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  if (e.name === 'TimeoutError') return 'нет ответа (тайм-аут)';
  const text = e.message.split('\n')[0];
  const reason = causeOf(e.cause);
  return reason && !text.includes(reason) ? `${text} (${reason})` : text;
}

function causeOf(c: unknown): string | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const { code, message, errors } = c as { code?: unknown; message?: unknown; errors?: unknown };
  // Несколько адресов у сервера — несколько ошибок соединения в одной (AggregateError): хватит первой.
  if (Array.isArray(errors) && errors.length) return causeOf(errors[0]);
  const msg = typeof message === 'string' ? message.split('\n')[0] : '';
  if (typeof code === 'string') return msg.includes(code) ? msg : msg ? `${code}: ${msg}` : code;
  return msg || undefined;
}

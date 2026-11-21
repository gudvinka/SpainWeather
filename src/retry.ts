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

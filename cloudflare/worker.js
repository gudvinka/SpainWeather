// Будильник SpainWeather на Cloudflare Workers: запускает workflow snap.yml на GitHub (как кнопка «Run workflow»).
// Расписание GitHub Actions опаздывает на часы и иногда пропускает запуски, поэтому время держит Cloudflare.
//
// Настройка в панели Cloudflare (Worker `spainweather-cron`):
// - Settings → Variables and Secrets: секрет GITHUB_TOKEN — fine-grained токен gudvinka,
//   только репозиторий SpainWeather, право Actions: Read and write (срок — год, потом выпустить новый);
// - Settings → Trigger Events → Cron Triggers: `0 9,13,16 * * *`.
//
// Cron в Cloudflare — по UTC: зимой (UTC+1) это 10:00 / 14:00 / 17:00 по Мадриду, летом (UTC+2) — 11:00 / 15:00 / 18:00.
// Вечерний запуск светлый круглый год: в декабре солнце в Овьедо садится около 17:55.
export default {
  async scheduled(event, env, ctx) {
    const res = await fetch(
      'https://api.github.com/repos/gudvinka/SpainWeather/actions/workflows/snap.yml/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'spainweather-cron', // GitHub отклоняет запросы без User-Agent
        },
        body: JSON.stringify({ ref: 'main' }),
      },
    );
    // Успех — 204; иначе ошибка попадёт в логи Worker'а
    if (res.status !== 204) throw new Error(`GitHub ответил ${res.status}: ${await res.text()}`);
    // Объект Cloudflare разбирает на поля — в Observability фильтр `action = snap-dispatched`
    console.log({ action: 'snap-dispatched', status: res.status });
  },
};

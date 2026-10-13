const pad = (n: number) => String(n).padStart(2, '0');

// Местное время без зоны: 2026-10-12T14:40. Все даты в данных хранятся в этом виде.
export const localIso = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const dateOf = (d: Date) => localIso(d).slice(0, 10);
export const monthOf = (d: Date) => localIso(d).slice(0, 7);

// Штамп для имени кадра: 2026-10-12_14-40
export const fileStamp = (d: Date) => localIso(d).replace('T', '_').replace(':', '-');

export { pad };

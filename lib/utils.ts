export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
export const asNumber = (value: string | undefined, fallback: number) => Number(value ?? fallback);
export const unique = <T,>(items: T[]) => [...new Set(items)];
export const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export function formatDate(value: string | null | undefined) {
  if (!value) return '';
  return value.slice(0, 10);
}
export function formatDateTime(value: string | null | undefined) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value)).replace(',', '');
}
export function toIsoFromDhakaLocal(value: string) {
  return value ? new Date(`${value}:00+06:00`).toISOString() : '';
}
export function dhakaLocalInput(value: string | null) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

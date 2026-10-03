/** ISO timestamp -> `YYYY-MM-DD`, or an em dash when missing/invalid. */
export function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().slice(0, 10);
}

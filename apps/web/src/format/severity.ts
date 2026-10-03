/** 'CRITICAL' -> 'Critical' — readable label, same information as the raw value. */
export function formatSeverity(severity: string): string {
  if (severity.length === 0) return severity;
  return severity.charAt(0) + severity.slice(1).toLowerCase();
}

/** RFC 4180-ish: quote a field only when it contains a comma, quote, or newline; double up internal quotes. */
export function csvField(value: string): string {
  if (/["\n,]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(','));
  return lines.join('\n') + '\n';
}

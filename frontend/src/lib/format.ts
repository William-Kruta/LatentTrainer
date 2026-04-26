export function formatBytes(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)} GB`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} MB`;
  }
  return `${value} B`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

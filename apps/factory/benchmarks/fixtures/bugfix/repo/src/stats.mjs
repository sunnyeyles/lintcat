export function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values) {
  const sorted = values.sort();
  return sorted[Math.floor(sorted.length / 2)];
}

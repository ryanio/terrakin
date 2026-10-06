export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function plotKey(px: number, py: number): string {
  return `${px},${py}`;
}

export function parseKey(key: string): [number, number] {
  const [a, b] = key.split(",");
  return [Number(a), Number(b)];
}

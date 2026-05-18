export function padHeading(deg: number): string {
  return String(Math.round(deg)).padStart(3, "0");
}

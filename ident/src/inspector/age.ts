export function formatAgeSecondsAgo(seconds: number | undefined): string {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? `${seconds.toFixed(1)} s ago`
    : "—";
}

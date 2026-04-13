function startOfLocalDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** Kalendertage zwischen zwei Zeitpunkten (lokale Zeitzone), `then` vor `now`. */
function calendarDaysBetween(now: Date, then: Date): number {
  return Math.round(
    (startOfLocalDay(now) - startOfLocalDay(then)) / 86_400_000,
  );
}

/**
 * Relative Zeit auf Deutsch, z. B. "vor 5 Minuten", "gestern".
 */
export function relativeTime(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) {
    return "";
  }
  const now = Date.now();
  const diffMs = now - then;
  if (diffMs < 0) {
    return "eben";
  }

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 45) {
    return "vor wenigen Sekunden";
  }
  if (diffSec < 60) {
    return `vor ${diffSec} Sekunden`;
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `vor ${diffMin} ${diffMin === 1 ? "Minute" : "Minuten"}`;
  }

  const thenDate = new Date(then);
  const nowDate = new Date(now);
  const dayDiff = calendarDaysBetween(nowDate, thenDate);

  if (dayDiff === 0) {
    const diffH = Math.floor(diffMin / 60);
    return `vor ${diffH} ${diffH === 1 ? "Stunde" : "Stunden"}`;
  }

  if (dayDiff === 1) {
    return "gestern";
  }

  if (dayDiff >= 2 && dayDiff <= 6) {
    return `vor ${dayDiff} Tagen`;
  }

  if (dayDiff < 14) {
    const w = Math.floor(dayDiff / 7);
    return w <= 1 ? "vor einer Woche" : `vor ${w} Wochen`;
  }

  return thenDate.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

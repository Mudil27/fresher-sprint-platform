/** Every wall-clock time participants see is shown in India Standard Time. */
export const EVENT_TIME_ZONE = "Asia/Kolkata";
export const EVENT_TIME_LABEL = "IST";

const date = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: EVENT_TIME_ZONE,
});
const hm = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: EVENT_TIME_ZONE,
});
const hms = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: EVENT_TIME_ZONE,
});
const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: EVENT_TIME_ZONE,
});

type When = Date | string | number;
const toDate = (when: When) => (when instanceof Date ? when : new Date(when));

export function istDate(when: When): string {
  return date.format(toDate(when));
}

export function istTime(when: When, seconds = false): string {
  return (seconds ? hms : hm).format(toDate(when));
}

/** Price-chart axis labels (lightweight-charts passes UTC seconds). */
export function istTickMark(time: unknown, tickMarkType: number): string | null {
  if (typeof time !== "number") return null;
  const d = new Date(time * 1000);
  // TickMarkType: 0 year, 1 month, 2 day, 3 time, 4 time with seconds.
  if (tickMarkType <= 2) return dayMonth.format(d);
  return istTime(d, tickMarkType === 4);
}

/** Crosshair label on the price chart. */
export function istChartTime(time: unknown): string {
  return typeof time === "number" ? istTime(new Date(time * 1000), true) : "";
}

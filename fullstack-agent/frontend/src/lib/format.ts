export const NEW_CONVERSATION = "New conversation";

const DAY_MS = 86_400_000;

function daysBefore(date: Date, now: Date): number {
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  return Math.round((day(now) - day(date)) / DAY_MS);
}

export type DayGroup = "Today" | "Yesterday" | "Earlier";

export function dayGroup(time: string | null | undefined, now: Date): DayGroup {
  const days = time ? daysBefore(new Date(time), now) : Number.POSITIVE_INFINITY;
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : "Earlier";
}

export function shortDate(time: string, now: Date): string {
  const date = new Date(time);
  const year = date.getFullYear() === now.getFullYear() ? undefined : "numeric";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year });
}

export function dayLabel(time: string, now: Date): string {
  const group = dayGroup(time, now);
  if (group !== "Earlier") return group;
  const date = new Date(time);
  if (date.getFullYear() !== now.getFullYear()) return shortDate(time, now);
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatMoney(currency: string, amount: string | number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(amount));
}

export function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

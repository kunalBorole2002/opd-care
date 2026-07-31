export type OpdSession = "morning" | "afternoon" | "evening";

export type GeneratedOpdSlot = {
  id: string;
  startsAt: Date;
  session: OpdSession;
};

export const SLOT_INTERVAL_MINUTES = 15;
export const OPD_TIME_ZONE = "Asia/Kolkata";
const OPD_UTC_OFFSET_MINUTES = 5 * 60 + 30;
const OPD_UTC_OFFSET_MILLISECONDS = OPD_UTC_OFFSET_MINUTES * 60 * 1000;
const SCHEDULE_DAYS = 30;

export const opdSessions: Record<
  OpdSession,
  { label: string; startHour: number; startMinute: number; endHour: number; endMinute: number }
> = {
  morning: { label: "Morning", startHour: 9, startMinute: 0, endHour: 11, endMinute: 30 },
  afternoon: { label: "Afternoon", startHour: 12, startMinute: 0, endHour: 14, endMinute: 0 },
  evening: { label: "Evening", startHour: 19, startMinute: 0, endHour: 21, endMinute: 0 },
};

export function getScheduleWindow(now = new Date()) {
  const startClock = toOpdClock(now);
  startClock.setUTCHours(0, 0, 0, 0);
  const endClock = new Date(startClock);
  endClock.setUTCDate(endClock.getUTCDate() + SCHEDULE_DAYS);

  return { start: fromOpdClock(startClock), end: fromOpdClock(endClock) };
}

export function generateOpdSlots(doctorId: string, now = new Date()) {
  const { start } = getScheduleWindow(now);
  const startClock = toOpdClock(start);
  const slots: GeneratedOpdSlot[] = [];

  for (let dayOffset = 0; dayOffset < SCHEDULE_DAYS; dayOffset += 1) {
    const dayClock = new Date(startClock);
    dayClock.setUTCDate(startClock.getUTCDate() + dayOffset);

    if (dayClock.getUTCDay() === 0) {
      continue;
    }

    for (const [session, range] of Object.entries(opdSessions) as [
      OpdSession,
      (typeof opdSessions)[OpdSession],
    ][]) {
      const sessionStart = minutesFromMidnight(range.startHour, range.startMinute);
      const sessionEnd = minutesFromMidnight(range.endHour, range.endMinute);

      for (let minuteOfDay = sessionStart; minuteOfDay < sessionEnd; minuteOfDay += SLOT_INTERVAL_MINUTES) {
        const startsAt = createOpdDate(
          dayClock.getUTCFullYear(),
          dayClock.getUTCMonth() + 1,
          dayClock.getUTCDate(),
          Math.floor(minuteOfDay / 60),
          minuteOfDay % 60,
        );

        if (startsAt <= now) {
          continue;
        }

        slots.push({
          id: `${doctorId}-${startsAt.toISOString()}`,
          startsAt,
          session,
        });
      }
    }
  }

  return slots;
}

export function getOpdSession(value: Date): OpdSession | null {
  const clock = toOpdClock(value);

  if (
    clock.getUTCSeconds() !== 0 ||
    clock.getUTCMilliseconds() !== 0 ||
    clock.getUTCMinutes() % SLOT_INTERVAL_MINUTES !== 0
  ) {
    return null;
  }

  const minuteOfDay = minutesFromMidnight(clock.getUTCHours(), clock.getUTCMinutes());

  for (const [session, range] of Object.entries(opdSessions) as [
    OpdSession,
    (typeof opdSessions)[OpdSession],
  ][]) {
    const sessionStart = minutesFromMidnight(range.startHour, range.startMinute);
    const sessionEnd = minutesFromMidnight(range.endHour, range.endMinute);

    if (minuteOfDay >= sessionStart && minuteOfDay < sessionEnd) {
      return session;
    }
  }

  return null;
}

export function getOpdHourCandidates(dateKey: string, session: OpdSession, hour: number) {
  const range = opdSessions[session];

  if (!range || !dateKey.match(/^\d{4}-\d{2}-\d{2}$/) || !Number.isInteger(hour)) {
    return [];
  }

  const sessionStart = minutesFromMidnight(range.startHour, range.startMinute);
  const sessionEnd = minutesFromMidnight(range.endHour, range.endMinute);
  const hourStart = minutesFromMidnight(hour, 0);
  const hourEnd = hourStart + 60;
  const candidateStart = Math.max(sessionStart, hourStart);
  const candidateEnd = Math.min(sessionEnd, hourEnd);

  if (candidateStart >= candidateEnd) {
    return [];
  }

  const [year, month, day] = dateKey.split("-").map(Number);

  return Array.from(
    { length: Math.ceil((candidateEnd - candidateStart) / SLOT_INTERVAL_MINUTES) },
    (_, index) => {
      const minuteOfDay = candidateStart + index * SLOT_INTERVAL_MINUTES;
      return createOpdDate(year, month, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
    },
  );
}

export function getOpdSessionHours(session: OpdSession) {
  const range = opdSessions[session];
  const startHour = range.startHour;
  const endHour = range.endMinute > 0 ? range.endHour : range.endHour - 1;

  return Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
}

export function isValidOpdSlot(value: Date, now = new Date()) {
  if (
    Number.isNaN(value.getTime()) ||
    value <= now ||
    toOpdClock(value).getUTCDay() === 0 ||
    !getOpdSession(value)
  ) {
    return false;
  }

  const { start, end } = getScheduleWindow(now);
  return value >= start && value < end;
}

function minutesFromMidnight(hour: number, minute: number) {
  return hour * 60 + minute;
}

export function getOpdDateKey(value: Date | string) {
  const clock = toOpdClock(value);
  const year = clock.getUTCFullYear();
  const month = String(clock.getUTCMonth() + 1).padStart(2, "0");
  const day = String(clock.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getOpdHour(value: Date | string) {
  return toOpdClock(value).getUTCHours();
}

function createOpdDate(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - OPD_UTC_OFFSET_MILLISECONDS);
}

function toOpdClock(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + OPD_UTC_OFFSET_MILLISECONDS);
}

function fromOpdClock(value: Date) {
  return new Date(value.getTime() - OPD_UTC_OFFSET_MILLISECONDS);
}

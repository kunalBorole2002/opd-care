export type OpdSession = "morning" | "afternoon" | "evening";

export type GeneratedOpdSlot = {
  id: string;
  startsAt: Date;
  session: OpdSession;
};

export const SLOT_INTERVAL_MINUTES = 15;
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
  const start = startOfDay(now);
  const end = startOfDay(now);
  end.setDate(end.getDate() + SCHEDULE_DAYS);

  return { start, end };
}

export function generateOpdSlots(doctorId: string, now = new Date()) {
  const { start } = getScheduleWindow(now);
  const slots: GeneratedOpdSlot[] = [];

  for (let dayOffset = 0; dayOffset < SCHEDULE_DAYS; dayOffset += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + dayOffset);

    if (day.getDay() === 0) {
      continue;
    }

    for (const [session, range] of Object.entries(opdSessions) as [
      OpdSession,
      (typeof opdSessions)[OpdSession],
    ][]) {
      const sessionStart = minutesFromMidnight(range.startHour, range.startMinute);
      const sessionEnd = minutesFromMidnight(range.endHour, range.endMinute);

      for (let minuteOfDay = sessionStart; minuteOfDay < sessionEnd; minuteOfDay += SLOT_INTERVAL_MINUTES) {
        const startsAt = new Date(day);
        startsAt.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);

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
  if (value.getSeconds() !== 0 || value.getMilliseconds() !== 0 || value.getMinutes() % SLOT_INTERVAL_MINUTES !== 0) {
    return null;
  }

  const minuteOfDay = minutesFromMidnight(value.getHours(), value.getMinutes());

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
      const startsAt = new Date(year, month - 1, day);
      startsAt.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
      return startsAt;
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
  if (Number.isNaN(value.getTime()) || value <= now || value.getDay() === 0 || !getOpdSession(value)) {
    return false;
  }

  const { start, end } = getScheduleWindow(now);
  return value >= start && value < end;
}

function minutesFromMidnight(hour: number, minute: number) {
  return hour * 60 + minute;
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

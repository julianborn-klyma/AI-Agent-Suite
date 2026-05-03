import { requireGmailOAuthForTool } from "../../config/env.ts";
import type { DatabaseClient } from "../../db/databaseClient.ts";
import { getCredential } from "./credentialHelper.ts";
import { googleApiFetch } from "./googleApiClient.ts";
import type { Tool, ToolResult } from "./types.ts";

const CAL_API = "https://www.googleapis.com/calendar/v3";

const NOT_CONNECTED = "Google Calendar nicht verbunden.";

export type CalendarAction =
  | { action: "get_today_events" }
  | { action: "get_week_events" }
  | { action: "get_events"; date_from: string; date_to: string }
  | {
    action: "find_free_slots";
    date: string;
    duration_minutes: number;
  };

export type CalendarEventOut = {
  summary: string;
  start: string;
  end: string;
  duration_minutes: number;
  attendees: string[];
  location?: string;
};

async function assertGoogleCalendar(
  db: DatabaseClient,
  userId: string,
): Promise<ToolResult | null> {
  const flag = await getCredential(db, userId, "google_connected");
  if (flag !== "true") {
    return { success: false, error: NOT_CONNECTED };
  }
  const tok = await getCredential(db, userId, "gmail_access_token");
  if (!tok) {
    return { success: false, error: NOT_CONNECTED };
  }
  return null;
}

function instantRangeBerlinDay(
  plainDateStr: string,
): { timeMin: string; timeMax: string } {
  const d = Temporal.PlainDate.from(plainDateStr);
  const z0 = d.toZonedDateTime({
    timeZone: "Europe/Berlin",
    plainTime: Temporal.PlainTime.from("00:00:00"),
  });
  const z1 = d.toZonedDateTime({
    timeZone: "Europe/Berlin",
    plainTime: Temporal.PlainTime.from("23:59:59"),
  });
  return {
    timeMin: z0.toInstant().toString(),
    timeMax: z1.toInstant().toString(),
  };
}

function todayPlainBerlin(now: Date): string {
  return Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO("Europe/Berlin")
    .toPlainDate()
    .toString();
}

function weekMonFriBoundsBerlin(now: Date): { timeMin: string; timeMax: string } {
  const z = Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO("Europe/Berlin");
  let pd = z.toPlainDate();
  const dow = pd.dayOfWeek;
  const monOffset = dow === 1 ? 0 : dow === 7 ? -6 : 1 - dow;
  pd = pd.add({ days: monOffset });
  const fri = pd.add({ days: 4 });
  const start = pd.toZonedDateTime({
    timeZone: "Europe/Berlin",
    plainTime: Temporal.PlainTime.from("00:00:00"),
  });
  const end = fri.toZonedDateTime({
    timeZone: "Europe/Berlin",
    plainTime: Temporal.PlainTime.from("23:59:59"),
  });
  return {
    timeMin: start.toInstant().toString(),
    timeMax: end.toInstant().toString(),
  };
}

function formatInBerlin(isoInstant: string): string {
  const inst = Temporal.Instant.from(isoInstant);
  const z = inst.toZonedDateTimeISO("Europe/Berlin");
  return z.toString({ calendarName: "never", timeZoneName: "never" });
}

/** Robustere Event-Zeiten ohne striktes Temporal-Parsing der Google-Zeichenkette. */
function slimEvent(e: Record<string, unknown>): CalendarEventOut {
  const summary = String(e.summary ?? "(ohne Titel)");
  const startObj = e.start as Record<string, unknown> | undefined;
  const endObj = e.end as Record<string, unknown> | undefined;
  const loc = typeof e.location === "string" ? e.location : undefined;
  const attendeesRaw = Array.isArray(e.attendees) ? e.attendees as Record<string, unknown>[] : [];
  const attendees = attendeesRaw.map((a) =>
    String(a.displayName ?? a.email ?? "").trim()
  ).filter(Boolean);

  const startRaw = startObj?.dateTime ?? startObj?.date;
  const endRaw = endObj?.dateTime ?? endObj?.date;
  const startStr = startRaw != null ? String(startRaw) : "";
  const endStr = endRaw != null ? String(endRaw) : "";

  let duration_minutes = 0;
  if (startStr && endStr) {
    const s = Date.parse(startStr);
    const en = Date.parse(endStr);
    if (!Number.isNaN(s) && !Number.isNaN(en)) {
      duration_minutes = Math.max(0, Math.round((en - s) / 60_000));
    }
  }

  let startOut = startStr;
  let endOut = endStr;
  try {
    if (startStr.includes("T")) {
      const inst = Temporal.ZonedDateTime.from(startStr).toInstant();
      startOut = formatInBerlin(inst.toString());
    } else if (startStr) {
      startOut = `${startStr} (ganztägig, Europe/Berlin)`;
    }
  } catch {
    /* Rohwert beibehalten */
  }
  try {
    if (endStr.includes("T")) {
      const inst = Temporal.ZonedDateTime.from(endStr).toInstant();
      endOut = formatInBerlin(inst.toString());
    } else if (endStr) {
      endOut = `${endStr} (ganztägig, Europe/Berlin)`;
    }
  } catch {
    /* Rohwert beibehalten */
  }

  return {
    summary,
    start: startOut,
    end: endOut,
    duration_minutes,
    attendees,
    location: loc,
  };
}

function parseParams(raw: unknown): CalendarAction | { error: string } {
  let p = raw;
  if (typeof p === "string") {
    try {
      p = JSON.parse(p);
    } catch {
      return { error: "Ungültiges JSON." };
    }
  }
  if (p === null || typeof p !== "object") {
    return { error: "Parameter müssen ein Objekt sein." };
  }
  const o = p as Record<string, unknown>;
  const action = o.action;
  if (action === "get_today_events") {
    return { action: "get_today_events" };
  }
  if (action === "get_week_events") {
    return { action: "get_week_events" };
  }
  if (action === "get_events") {
    if (typeof o.date_from !== "string" || !o.date_from) {
      return { error: "date_from fehlt." };
    }
    if (typeof o.date_to !== "string" || !o.date_to) {
      return { error: "date_to fehlt." };
    }
    return {
      action: "get_events",
      date_from: o.date_from,
      date_to: o.date_to,
    };
  }
  if (action === "find_free_slots") {
    if (typeof o.date !== "string" || !o.date) {
      return { error: "date fehlt." };
    }
    const d = Number(o.duration_minutes);
    if (!Number.isInteger(d) || d < 5 || d > 24 * 60) {
      return { error: "duration_minutes ungültig (5–1440)." };
    }
    return {
      action: "find_free_slots",
      date: o.date,
      duration_minutes: d,
    };
  }
  return { error: `Unbekannte action: ${String(action)}` };
}

async function listEvents(
  db: DatabaseClient,
  userId: string,
  oauth: { clientId: string; clientSecret: string },
  timeMin: string,
  timeMax: string,
): Promise<ToolResult> {
  const q = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    timeZone: "Europe/Berlin",
    maxResults: "100",
  });
  const path = `calendars/primary/events?${q.toString()}`;
  const r = await googleApiFetch(db, userId, CAL_API, path, { method: "GET" }, oauth);
  if (!r.ok) {
    if (r.status === 401) {
      return { success: false, error: NOT_CONNECTED };
    }
    return { success: false, error: `Calendar API Fehler: ${r.status}` };
  }
  const items = ((r.data as { items?: Record<string, unknown>[] })?.items ??
    []) as Record<string, unknown>[];
  const events: CalendarEventOut[] = items.map((e) => slimEvent(e));
  return { success: true, data: { events } };
}

function mergeBusy(
  busy: { start?: string; end?: string }[],
): { start: number; end: number }[] {
  const iv = busy
    .map((b) => ({
      start: b.start ? Date.parse(b.start) : NaN,
      end: b.end ? Date.parse(b.end) : NaN,
    }))
    .filter((x) => !Number.isNaN(x.start) && !Number.isNaN(x.end))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const x of iv) {
    const last = merged[merged.length - 1];
    if (!last || x.start > last.end) {
      merged.push({ ...x });
    } else {
      last.end = Math.max(last.end, x.end);
    }
  }
  return merged;
}

async function runFindFreeSlots(
  db: DatabaseClient,
  userId: string,
  oauth: { clientId: string; clientSecret: string },
  dateStr: string,
  durationMinutes: number,
): Promise<ToolResult> {
  const dayStart = Temporal.PlainDate.from(dateStr).toZonedDateTime({
    timeZone: "Europe/Berlin",
    plainTime: Temporal.PlainTime.from("08:00:00"),
  });
  const dayEnd = Temporal.PlainDate.from(dateStr).toZonedDateTime({
    timeZone: "Europe/Berlin",
    plainTime: Temporal.PlainTime.from("20:00:00"),
  });
  const timeMin = dayStart.toInstant().toString();
  const timeMax = dayEnd.toInstant().toString();

  const body = {
    timeMin,
    timeMax,
    items: [{ id: "primary" }],
  };
  const r = await googleApiFetch(
    db,
    userId,
    CAL_API,
    "freeBusy",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    oauth,
  );
  if (!r.ok) {
    if (r.status === 401) {
      return { success: false, error: NOT_CONNECTED };
    }
    return { success: false, error: `Calendar freeBusy Fehler: ${r.status}` };
  }
  const cal = (r.data as {
    calendars?: { primary?: { busy?: { start: string; end: string }[] } };
  })?.calendars?.primary;
  const busy = mergeBusy(cal?.busy ?? []);

  const windowStart = dayStart.toInstant().epochMilliseconds;
  const windowEnd = dayEnd.toInstant().epochMilliseconds;
  const needMs = durationMinutes * 60_000;
  const slots: { start: string; end: string; duration_minutes: number }[] = [];

  let cursor = windowStart;
  for (const b of busy) {
    if (b.start - cursor >= needMs) {
      const slotStart = Temporal.Instant.fromEpochMilliseconds(cursor)
        .toZonedDateTimeISO("Europe/Berlin");
      const slotEnd = Temporal.Instant.fromEpochMilliseconds(cursor + needMs)
        .toZonedDateTimeISO("Europe/Berlin");
      slots.push({
        start: slotStart.toString(),
        end: slotEnd.toString(),
        duration_minutes: durationMinutes,
      });
    }
    cursor = Math.max(cursor, b.end);
  }
  if (windowEnd - cursor >= needMs) {
    const slotStart = Temporal.Instant.fromEpochMilliseconds(cursor)
      .toZonedDateTimeISO("Europe/Berlin");
    const slotEnd = Temporal.Instant.fromEpochMilliseconds(cursor + needMs)
      .toZonedDateTimeISO("Europe/Berlin");
    slots.push({
      start: slotStart.toString(),
      end: slotEnd.toString(),
      duration_minutes: durationMinutes,
    });
  }

  return { success: true, data: { free_slots: slots } };
}

export const calendarTool: Tool = {
  definition: {
    name: "calendar",
    description:
      "Google Kalender: heute, Woche Mo–Fr, Zeitraum, freie Slots (freeBusy).",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "get_today_events",
            "get_week_events",
            "get_events",
            "find_free_slots",
          ],
        },
        date_from: { type: "string" },
        date_to: { type: "string" },
        date: { type: "string" },
        duration_minutes: { type: "number" },
      },
      required: ["action"],
    },
  },

  async execute(
    params: unknown,
    userId: string,
    db: DatabaseClient,
    _ctx?: unknown,
  ): Promise<ToolResult> {
    const gate = await assertGoogleCalendar(db, userId);
    if (gate) return gate;

    let oauth: { clientId: string; clientSecret: string };
    try {
      oauth = requireGmailOAuthForTool();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }

    const parsed = parseParams(params);
    if ("error" in parsed) {
      return { success: false, error: parsed.error };
    }

    const now = new Date();

    try {
      switch (parsed.action) {
        case "get_today_events": {
          const day = todayPlainBerlin(now);
          const { timeMin, timeMax } = instantRangeBerlinDay(day);
          return await listEvents(db, userId, oauth, timeMin, timeMax);
        }
        case "get_week_events": {
          const { timeMin, timeMax } = weekMonFriBoundsBerlin(now);
          return await listEvents(db, userId, oauth, timeMin, timeMax);
        }
        case "get_events": {
          const { timeMin } = instantRangeBerlinDay(parsed.date_from);
          const { timeMax } = instantRangeBerlinDay(parsed.date_to);
          return await listEvents(db, userId, oauth, timeMin, timeMax);
        }
        case "find_free_slots":
          return await runFindFreeSlots(
            db,
            userId,
            oauth,
            parsed.date,
            parsed.duration_minutes,
          );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "refresh_failed" || msg.includes("decrypt")) {
        return { success: false, error: NOT_CONNECTED };
      }
      return { success: false, error: msg };
    }
  },
};

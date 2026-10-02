// READ-ONLY audit: every Zoho FSM appointment in a date range, how the
// scheduling board would treat it, and what the portal actually holds.
//
// It only SELECTs from the database and GETs from FSM. It writes nothing to
// either, and never prints credentials. Run from Portal/:
//
//   bun scripts/fsm-schedule-audit.cjs 2026-08-01 2026-09-30 [out.csv] [AP-3869 ...] [--cache=file.json]
//
// It reports two things side by side:
//   BEFORE  the board's rules up to 28 Sep 2026: an entry belongs to ONE shift
//           (by its start time) and is drawn only in that shift's grid, clipped
//           to the window; a technician's row appears only in the grid for
//           their own shift.
//   NOW     the rules in lib/scheduling/board-layout.ts, by running that module
//           itself. This needs bun (it loads TypeScript); under node the NOW
//           columns are left empty.
//
// --cache=file.json keeps the FSM records it read, so a second run on the same
// range asks FSM nothing.
const fs = require("fs");
const path = require("path");

const ARGS = process.argv.slice(2);
const CACHE = (ARGS.find((a) => a.startsWith("--cache=")) || "").slice("--cache=".length) || null;
const [FROM, TO, OUT, ...FOCUS] = ARGS.filter((a) => !a.startsWith("--"));

let layout = null;
try {
  layout = require(path.join(process.cwd(), "lib/scheduling/board-layout.ts"));
} catch {
  console.error("note: run with bun to evaluate the board's current rules (node cannot load the TypeScript module)");
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM || "") || !/^\d{4}-\d{2}-\d{2}$/.test(TO || "")) {
  console.error("usage: node scripts/fsm-schedule-audit.cjs FROM TO [out.csv] [AP-name ...]");
  process.exit(1);
}

// .env.local the way Next/dotenv reads it: the LAST value for a key wins.
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (!m || line.trim().startsWith("#")) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const { createClient } = require(require.resolve("@supabase/supabase-js", { paths: [process.cwd()] }));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const FSM = "https://fsm.zoho.com/fsm/v1";
const GULF_MIN = 240; // Asia/Dubai is UTC+4 with no daylight saving

const stamp = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const gulfMidnight = (date) => new Date(Date.parse(`${date}T00:00:00Z`) - GULF_MIN * 60000);
const toGulf = (iso) => new Date(new Date(iso).getTime() + GULF_MIN * 60000);
const gulfDate = (iso) => toGulf(iso).toISOString().slice(0, 10);
const gulfTime = (iso) => toGulf(iso).toISOString().slice(11, 16);
const gulfMinutes = (iso) => toGulf(iso).getUTCHours() * 60 + toGulf(iso).getUTCMinutes();
const hhmm = (s) => { const [h, m] = String(s).split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const crewOf = (a) => [
  ...new Set(
    [a.Lead && a.Lead.id, ...(a.$Service_Resources || []).map((r) => r.id), ...(a.Service_Resources || []).map((r) => r.id)].filter(Boolean),
  ),
];

async function main() {
  const { data: settings, error: sErr } = await db
    .from("settings")
    .select("oauth_access_token, org_timezone, night_shift_start, night_shift_end, day_shift_start, day_shift_end")
    .eq("id", 1)
    .single();
  if (sErr) throw new Error(`settings: ${sErr.message}`);
  const headers = { Authorization: `Zoho-oauthtoken ${settings.oauth_access_token}` };
  const night = { start: hhmm(settings.night_shift_start), end: hhmm(settings.night_shift_end) };
  const day = { start: hhmm(settings.day_shift_start), end: hhmm(settings.day_shift_end) };

  let calls = 0;
  const fsmGet = async (p) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      calls += 1;
      let res;
      try {
        res = await fetch(`${FSM}${p}`, { headers, signal: AbortSignal.timeout(45000) });
      } catch {
        // Timed out or dropped: wait and ask again.
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (res.status === 204) return { ok: true, status: 204, json: {} };
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
      return { ok: res.ok, status: res.status, json };
    }
    return { ok: false, status: 429, json: { message: "rate limited" } };
  };

  // ---- portal: roster, versions, entries
  const { data: roster } = await db.from("technician_reference").select("fsm_resource_id, display_name, is_active, shift");
  const tech = new Map((roster || []).map((t) => [t.fsm_resource_id, t]));
  const nameOf = (id) => (tech.get(id) ? tech.get(id).display_name : `unknown(${id})`);

  const { data: versions } = await db
    .from("schedule_versions")
    .select("id, schedule_date, status, version_number, fsm_imported_at")
    .eq("is_current", true)
    .gte("schedule_date", FROM)
    .lte("schedule_date", TO);
  const versionByDate = new Map((versions || []).map((v) => [v.schedule_date, v]));
  const nextDay = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 3600000).toISOString().slice(0, 10);
  // The versions just outside the range too: an afternoon appointment on the
  // last day was filed under the day after.
  {
    const { data: after } = await db
      .from("schedule_versions")
      .select("id, schedule_date, status, version_number, fsm_imported_at")
      .eq("is_current", true)
      .eq("schedule_date", nextDay(TO));
    (after || []).forEach((v) => (versions || []).push(v) && versionByDate.set(v.schedule_date, v));
  }
  const entryByAppt = new Map(); // `${date}|${apptId}` -> entry
  for (const v of versions || []) {
    const { data: rows } = await db
      .from("schedule_entries")
      .select("id, shift, start_at, end_at, fsm_appointment_id, fsm_schedule_type, origin, needs_sync, schedule_entry_assignments(technician_fsm_id)")
      .eq("schedule_version_id", v.id)
      .not("fsm_appointment_id", "is", null);
    (rows || []).forEach((e) => entryByAppt.set(`${v.schedule_date}|${e.fsm_appointment_id}`, e));
  }

  // ---- FSM: every appointment starting in the range, then its full record
  // FSM reads the timestamps of a date search in its own timezone (US Pacific
  // on this account, 11 hours behind the Gulf), so the window is padded and
  // the range is cut out by each appointment's own start time.
  const PAD = 36 * 3600000;
  const rangeStart = gulfMidnight(FROM).getTime();
  const rangeEnd = gulfMidnight(TO).getTime() + 24 * 3600000;
  const from = new Date(rangeStart - PAD);
  const to = new Date(rangeEnd + PAD);
  const inRange = (a) => {
    const t = Date.parse(a.Scheduled_Start_Date_Time || "");
    return Number.isFinite(t) && t >= rangeStart && t < rangeEnd;
  };
  let full = [];
  let readFailures = 0;
  const cached = CACHE && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : null;
  if (cached && cached.from === FROM && cached.to === TO) {
    full = cached.records;
    console.log(`using ${full.length} FSM records read ${cached.readAt} (${CACHE})`);
  } else {
    const found = [];
    for (let page = 1; page <= 40; page += 1) {
      const r = await fsmGet(`/Service_Appointments/search?api_name=Scheduled_Start_Date_Time&value=${stamp(from)},${stamp(to)}&comparator=between&per_page=200&page=${page}`);
      if (r.status === 204) break;
      if (!r.ok) throw new Error(`FSM search failed (${r.status}): ${r.json.message || JSON.stringify(r.json).slice(0, 200)}`);
      found.push(...(r.json.data || []).filter(inRange));
      if (!(r.json.info && r.json.info.more_records)) break;
    }
    console.error(`FSM has ${found.length} appointments in range; reading each one...`);
    for (let i = 0; i < found.length; i += 6) {
      if (i > 0 && i % 120 === 0) console.error(`  ${i} of ${found.length}`);
      const batch = await Promise.all(found.slice(i, i + 6).map((a) => fsmGet(`/Service_Appointments/${a.id}`)));
      batch.forEach((r, k) => {
        if (r.ok && r.json.data && r.json.data[0]) full.push(r.json.data[0]);
        else { readFailures += 1; full.push({ ...found[i + k], _searchOnly: true }); }
      });
    }
    if (CACHE) {
      // Only the fields the audit uses: no customer details are kept on disk.
      const slim = full.map((a) => ({
        id: a.id, Name: a.Name, Status: a.Status, Schedule_Type: a.Schedule_Type,
        Scheduled_Start_Date_Time: a.Scheduled_Start_Date_Time, Scheduled_End_Date_Time: a.Scheduled_End_Date_Time,
        Work_Order: a.Work_Order ? { id: a.Work_Order.id, name: a.Work_Order.name } : null,
        Lead: a.Lead ? { id: a.Lead.id, name: a.Lead.name } : null,
        $Service_Resources: (a.$Service_Resources || []).map((r) => ({ id: r.id, name: r.name })),
        Service_Resources: (a.Service_Resources || []).map((r) => ({ id: r.id, name: r.name })),
        _searchOnly: a._searchOnly,
      }));
      fs.writeFileSync(CACHE, JSON.stringify({ from: FROM, to: TO, readAt: new Date().toISOString(), records: slim }));
      full = slim;
    }
  }

  // ---- classify
  const rows = full.map((a) => {
    const start = a.Scheduled_Start_Date_Time;
    const end = a.Scheduled_End_Date_Time;
    const flags = [];
    const out = {
      name: a.Name || a.id, id: a.id, wo: (a.Work_Order && a.Work_Order.name) || "", status: a.Status || "",
      scheduleType: a.Schedule_Type || "", lead: a.Lead ? a.Lead.name || nameOf(a.Lead.id) : "",
      date: start ? gulfDate(start) : "", start: start ? gulfTime(start) : "", end: end ? gulfTime(end) : "",
      endDate: end ? gulfDate(end) : "", hours: 0, crew: crewOf(a), entryShift: "", flags,
      hiddenFrom: [], clippedMinutes: 0, portal: "", portalCrew: 0,
      startIso: start, endIso: end,
      // Filled in below, by the board's current rules.
      now: { grid: "", gridHours: "", drawn: "", visibleTo: "", note: "" },
    };
    if (!start || !end) { flags.push("no scheduled time"); return out; }

    const s = gulfMinutes(start);
    const minutes = Math.round((new Date(end) - new Date(start)) / 60000);
    const e = s + minutes; // minutes from the START day's midnight; may exceed 1440
    out.hours = Math.round((minutes / 60) * 100) / 100;

    const inDay = s >= day.start && s < day.end;
    const inNight = s >= night.start && s < night.end;
    out.entryShift = inDay ? "day" : inNight ? "night" : "day";
    const win = out.entryShift === "day" ? day : night;
    const shown = overlap(s, e, win.start, win.end);
    out.clippedMinutes = Math.max(0, minutes - shown);

    const cancelled = /cancel/i.test(out.status);
    if (cancelled) flags.push("cancelled (not imported)");
    if (a.Schedule_Type === "All Day") flags.push("all-day");
    if (minutes <= 0) flags.push("zero or negative duration");
    if (minutes >= 8 * 60) flags.push(`long (${out.hours}h)`);
    if (!inDay && !inNight) flags.push("starts outside both shift windows");
    if (s >= day.start && s < night.end) flags.push("starts in the hour both shifts share");
    if (overlap(s, e, night.start, night.end) > 0 && overlap(s, e, Math.max(day.start, night.end), day.end) > 0) flags.push("runs across both shifts");
    if (e > Math.max(day.end, night.end) && inDay) flags.push("runs past the end of the morning shift");
    if (out.clippedMinutes > 0 && a.Schedule_Type !== "All Day") flags.push(`${Math.round(out.clippedMinutes / 6) / 10}h not drawn (outside its grid)`);
    if (out.endDate !== out.date) flags.push(minutes >= 24 * 60 ? "multi-day" : "crosses midnight");

    if (out.crew.length === 0) flags.push("no technician at all");
    const unknown = out.crew.filter((id) => !tech.has(id));
    const inactive = out.crew.filter((id) => tech.has(id) && !tech.get(id).is_active);
    if (unknown.length) flags.push(`${unknown.length} crew not in portal roster`);
    if (inactive.length) flags.push(`${inactive.length} crew inactive in portal`);
    if (out.crew.length > 0 && out.crew.every((id) => !tech.has(id) || !tech.get(id).is_active)) flags.push("whole crew unplaceable (not imported)");

    // A technician's row exists only in the grid(s) for their own shift.
    const wanted = out.entryShift === "day" ? "morning" : "night";
    out.hiddenFrom = out.crew.filter((id) => {
      const t = tech.get(id);
      return t && t.is_active && t.shift && t.shift !== wanted;
    });
    if (out.hiddenFrom.length && !cancelled) {
      flags.push(out.hiddenFrom.length === out.crew.length ? "INVISIBLE: no technician has a row in its grid" : `hidden from ${out.hiddenFrom.length} of ${out.crew.length} technicians`);
    }

    // What the portal actually holds.
    const version = versionByDate.get(out.date);
    const entry = entryByAppt.get(`${out.date}|${a.id}`);
    const underNextDay = entryByAppt.get(`${nextDay(out.date)}|${a.id}`);
    if (underNextDay && !entry) {
      out.portal = `FILED UNDER THE NEXT DAY (${nextDay(out.date)})${version ? "" : "; its own day never opened"}`;
      flags.push("filed under the next day by the import");
    } else if (!version) out.portal = "day never opened";
    else if (!entry) out.portal = cancelled ? "not on board (cancelled)" : `NOT on board (day is ${version.status})`;
    else {
      out.portalCrew = (entry.schedule_entry_assignments || []).length;
      const stale = out.portalCrew !== out.crew.filter((id) => tech.has(id) && tech.get(id).is_active).length;
      out.portal = `on board${stale ? `, crew ${out.portalCrew}/${out.crew.length}` : ""}${entry.shift !== out.entryShift ? `, stored in ${entry.shift} grid` : ""}`;
    }
    return out;
  });

  // ---- the board's CURRENT rules, run from the module the board itself uses
  const clock = (m) => {
    if (m === 1440) return "24:00";
    const d = Math.floor(m / 1440);
    const of = m - d * 1440;
    return `${String(Math.floor(of / 60)).padStart(2, "0")}:${String(of % 60).padStart(2, "0")}${d === 0 ? "" : d > 0 ? `(+${d}d)` : `(${d}d)`}`;
  };
  const nowStats = { placeable: 0, whole: 0, pastMidnight: 0, noRow: 0, stretchedDays: new Map(), maxHours: { day: 0, night: 0 } };
  if (layout) {
    const tz = settings.org_timezone || "Asia/Dubai";
    const windows = layout.configuredWindows(settings);
    const placeable = (r) =>
      r.startIso && r.endIso && !/cancel/i.test(r.status) && r.crew.some((id) => tech.has(id) && tech.get(id).is_active);
    const byDate = new Map();
    rows.forEach((r) => {
      if (!r.date) return;
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date).push(r);
    });
    byDate.forEach((list, date) => {
      const jobs = list.filter(placeable).map((r) => {
        const range = layout.entryRange({ start_at: r.startIso, end_at: r.endIso }, date, tz);
        return { r, range, home: layout.homeShift(range, windows) };
      });
      const fitted = layout.fitWindows(windows, jobs);
      ["day", "night"].forEach((key) => {
        nowStats.maxHours[key] = Math.max(nowStats.maxHours[key], (fitted[key].end - fitted[key].start) / 60);
        if (fitted[key].stretched) {
          const label = `${key === "day" ? "Morning" : "Night"} ${clock(fitted[key].start)}-${clock(fitted[key].end)}`;
          nowStats.stretchedDays.set(label, (nowStats.stretchedDays.get(label) || 0) + 1);
        }
      });
      jobs.forEach(({ r, range, home }) => {
        const placed = layout.placeRange(range, fitted[home]);
        const crewWithRow = r.crew.filter((id) => tech.has(id) && tech.get(id).is_active);
        nowStats.placeable += 1;
        r.now.grid = home === "day" ? "Morning" : "Night";
        r.now.gridHours = `${clock(fitted[home].start)}-${clock(fitted[home].end)}`;
        r.now.visibleTo = `${crewWithRow.length} of ${r.crew.length}`;
        if (!placed) {
          r.now.drawn = "NOT DRAWN";
          nowStats.noRow += 1;
        } else if (placed.clippedStart || placed.clippedEnd) {
          r.now.drawn = `${clock(placed.visibleStart)}-${clock(placed.visibleEnd)} of ${clock(range.startMin)}-${clock(range.endMin)}`;
          r.now.note = "runs past midnight: the rest is drawn on the next day's board";
          nowStats.pastMidnight += 1;
        } else {
          r.now.drawn = "whole";
          nowStats.whole += 1;
        }
        // Where else it shows: the other grid draws the part that overlaps its hours.
        const other = home === "day" ? "night" : "day";
        const inOther = layout.placeRange(range, fitted[other]);
        if (inOther) {
          r.now.note = [r.now.note, `also drawn ${clock(inOther.visibleStart)}-${clock(inOther.visibleEnd)} in the ${other === "day" ? "Morning" : "Night"} grid, on rows that are shown there`].filter(Boolean).join("; ");
        }
      });
      list.filter((r) => !placeable(r)).forEach((r) => {
        if (/cancel/i.test(r.status)) r.now.drawn = "not shown (cancelled)";
        else if (!r.startIso || !r.endIso) r.now.drawn = "not shown (no scheduled time)";
        else {
          r.now.drawn = "listed above the board";
          r.now.note = r.crew.length === 0 ? "no technician assigned in FSM" : "nobody on it is in the technician list";
        }
      });
    });
  }

  // ---- the portal's own entries: is each one still on the day it is listed under?
  const movedAway = [];
  for (const v of versions || []) {
    const { data: own } = await db
      .from("schedule_entries")
      .select("id, entry_type, start_at, end_at, fsm_appointment_name, fsm_work_order_name, title, origin, needs_sync")
      .eq("schedule_version_id", v.id);
    (own || []).forEach((e) => {
      if (gulfDate(e.start_at) !== v.schedule_date && gulfDate(new Date(new Date(e.end_at).getTime() - 60000).toISOString()) !== v.schedule_date) {
        movedAway.push({ listed: v.schedule_date, status: v.status, name: e.fsm_appointment_name || e.title || e.id, wo: e.fsm_work_order_name || "", start: `${gulfDate(e.start_at)} ${gulfTime(e.start_at)}`, end: `${gulfDate(e.end_at)} ${gulfTime(e.end_at)}`, pending: e.needs_sync });
      }
    });
  }

  // ---- report
  const live = rows.filter((r) => !/cancel/i.test(r.status));
  console.log(`\n=========== FSM appointments ${FROM} .. ${TO} (Gulf time) ===========`);
  console.log(`shift windows: night ${settings.night_shift_start}-${settings.night_shift_end}, morning ${settings.day_shift_start}-${settings.day_shift_end}`);
  console.log(`FSM calls made: ${calls}; full records that could not be read: ${readFailures}`);
  console.log(`appointments: ${rows.length} (${live.length} live, ${rows.length - live.length} cancelled)`);
  console.log(`portal roster: ${(roster || []).length} technicians; shift set: morning ${(roster || []).filter((t) => t.shift === "morning").length}, night ${(roster || []).filter((t) => t.shift === "night").length}, unset ${(roster || []).filter((t) => !t.shift).length}`);

  const tally = (list, keyOf) => {
    const m = new Map();
    list.forEach((r) => [].concat(keyOf(r)).forEach((k) => m.set(k, (m.get(k) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const generic = (f) => f.replace(/\(\d+(\.\d+)?h\)/, "(8h or more)").replace(/^[\d.]+h not drawn/, "part of it not drawn").replace(/^\d+ crew/, "some crew").replace(/^hidden from \d+ of \d+ technicians/, "hidden from some of its technicians");

  console.log(`\n--- by status`);
  tally(rows, (r) => r.status || "(none)").forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));
  console.log(`\n--- by schedule type`);
  tally(rows, (r) => r.scheduleType || "(none)").forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));
  console.log(`\n--- by start hour (live)`);
  const hours = tally(live, (r) => (r.start ? r.start.slice(0, 2) : "--")).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`  ${hours.map(([k, n]) => `${k}h:${n}`).join("  ")}`);
  console.log(`\n--- by duration (live)`);
  const bucket = (h) => (h <= 0 ? "0 or less" : h <= 1 ? "up to 1h" : h <= 2 ? "1-2h" : h <= 4 ? "2-4h" : h < 8 ? "4-8h" : h <= 9 ? "8-9h" : h <= 12 ? "9-12h" : h < 24 ? "12-24h" : "24h or more");
  tally(live, (r) => bucket(r.hours)).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));
  console.log(`\n--- by crew size (live)`);
  const sizes = (n) => (n === 0 ? "0" : n === 1 ? "1" : n <= 3 ? "2-3" : n <= 8 ? "4-8" : n <= 15 ? "9-15" : "16 or more");
  tally(live, (r) => sizes(r.crew.length)).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  crew of ${k}`));

  console.log(`\n--- EDGE CASES (live appointments)`);
  tally(live, (r) => r.flags.map(generic)).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));

  console.log(`\n--- on the portal (live)`);
  tally(live, (r) => r.portal.replace(/, crew \d+\/\d+/, ", crew incomplete")).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));

  const show = (title, list, n = 12) => {
    console.log(`\n--- ${title}: ${list.length}${list.length > n ? ` (first ${n})` : ""}`);
    list.slice(0, n).forEach((r) => console.log(`  ${r.name.padEnd(8)} ${r.date} ${r.start}-${r.end}${r.endDate !== r.date ? `(+${r.endDate.slice(5)})` : ""} ${String(r.hours).padStart(5)}h  crew ${String(r.crew.length).padStart(2)}  [${r.status}]  ${r.portal}  | ${r.flags.join("; ")}`));
  };
  show("INVISIBLE on the board (no crew member has a row in its grid)", live.filter((r) => r.flags.some((f) => f.startsWith("INVISIBLE"))));
  show("hidden from part of the crew", live.filter((r) => r.flags.some((f) => f.startsWith("hidden from"))));
  show("runs across both shifts", live.filter((r) => r.flags.includes("runs across both shifts")));
  show("starts outside both shift windows", live.filter((r) => r.flags.includes("starts outside both shift windows")));
  show("runs past the end of the morning shift", live.filter((r) => r.flags.includes("runs past the end of the morning shift")));
  show("crosses midnight or multi-day", live.filter((r) => r.flags.some((f) => f === "crosses midnight" || f === "multi-day")));
  show("all-day", live.filter((r) => r.flags.includes("all-day")));
  show("crew problems (none / not in roster / inactive)", live.filter((r) => r.flags.some((f) => /no technician|not in portal roster|inactive|unplaceable/.test(f))));
  show("NOT on the board although the day was opened", live.filter((r) => r.portal.startsWith("NOT on board")));
  show("filed under the next day by the import", live.filter((r) => r.portal.startsWith("FILED UNDER")));
  {
    const opened = live.filter((r) => versionByDate.has(r.date));
    const missing = opened.filter((r) => r.portal.startsWith("NOT on board") || r.portal.startsWith("FILED UNDER"));
    const afternoon = missing.filter((r) => r.start >= "13:00");
    console.log(`\n--- on days that were opened: ${opened.length} live appointments, ${missing.length} not on their own day's list; ${afternoon.length} of those start at 13:00 or later (the search-window fault), ${missing.length - afternoon.length} earlier in the day`);
    const early = missing.filter((r) => r.start < "13:00");
    const byReason = new Map();
    early.forEach((r) => {
      const v = versionByDate.get(r.date);
      const why = r.crew.length === 0 ? "no technician" : r.crew.every((id) => !tech.has(id) || !tech.get(id).is_active) ? "crew not in the technician list" : v && v.status !== "draft" && v.status !== "draft_revision" ? `day is ${v.status} (takes no new bookings)` : "day not re-read since it was booked";
      byReason.set(why, (byReason.get(why) || 0) + 1);
    });
    [...byReason.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`  ${String(c).padStart(5)}  before 13:00: ${k}`));
  }

  if (layout) {
    console.log(`\n=========== WITH THE BOARD'S CURRENT RULES ===========`);
    console.log(`  ${String(nowStats.placeable).padStart(5)}  live appointments with at least one technician the portal knows`);
    console.log(`  ${String(nowStats.whole).padStart(5)}  drawn whole, in one grid, on a row for every such technician`);
    console.log(`  ${String(nowStats.pastMidnight).padStart(5)}  drawn up to midnight; the rest on the next day's board`);
    console.log(`  ${String(nowStats.noRow).padStart(5)}  NOT drawn (must be 0)`);
    console.log(`  ${String(live.filter((r) => r.now.drawn === "listed above the board").length).padStart(5)}  listed above the board instead (nobody to draw them on)`);
    console.log(`  widest grid: Morning ${nowStats.maxHours.day}h, Night ${nowStats.maxHours.night}h`);
    console.log(`\n--- days on which a grid is stretched beyond its usual hours`);
    [...nowStats.stretchedDays.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, c]) => console.log(`  ${String(c).padStart(5)} days  ${k}`));
  }

  console.log(`\n--- portal entries no longer on the day they are listed under: ${movedAway.length}`);
  movedAway.slice(0, 20).forEach((m) => console.log(`  ${String(m.name).padEnd(10)} ${m.wo.padEnd(8)} listed ${m.listed} (${m.status})  now ${m.start} -> ${m.end}${m.pending ? "  [edit pending approval]" : ""}`));

  for (const name of FOCUS) {
    const r = rows.find((x) => x.name === name);
    console.log(`\n=========== ${name} ===========`);
    if (!r) { console.log("not in this range"); continue; }
    console.log(`${r.wo}  [${r.status}]  ${r.scheduleType}`);
    console.log(`when (Gulf): ${r.date} ${r.start} -> ${r.endDate} ${r.end}   ${r.hours}h`);
    console.log(`board puts it in: ${r.entryShift === "day" ? "Morning" : "Night"} grid; ${Math.round(r.clippedMinutes / 6) / 10}h of it falls outside that grid`);
    console.log(`lead: ${r.lead}; crew ${r.crew.length}`);
    const by = { morning: [], night: [], unset: [], missing: [] };
    r.crew.forEach((id) => { const t = tech.get(id); if (!t) by.missing.push(id); else by[t.shift || "unset"].push(t.display_name); });
    console.log(`  crew on MORNING shift (${by.morning.length}): ${by.morning.join(", ")}`);
    console.log(`  crew on NIGHT shift   (${by.night.length}): ${by.night.join(", ")}`);
    console.log(`  crew with no shift    (${by.unset.length}): ${by.unset.join(", ")}`);
    if (by.missing.length) console.log(`  not in roster: ${by.missing.join(", ")}`);
    console.log(`hidden from ${r.hiddenFrom.length} of ${r.crew.length}: ${r.hiddenFrom.map(nameOf).join(", ")}`);
    console.log(`portal: ${r.portal}`);
    console.log(`flags: ${r.flags.join("; ")}`);
    if (layout) {
      console.log(`NOW: ${r.now.grid} grid (showing ${r.now.gridHours} that day); drawn: ${r.now.drawn}; on the rows of ${r.now.visibleTo} technicians${r.now.note ? `; ${r.now.note}` : ""}`);
    }
  }

  if (OUT) {
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const head = ["Appointment", "Work order", "Status", "Schedule type", "Date (Gulf)", "Start", "End", "End date", "Hours", "Lead", "Crew size", "BEFORE: grid", "BEFORE: hours not drawn", "BEFORE: hidden from (technicians)", "On the portal (database)", "Portal crew size", "Edge cases", "Crew", "NOW: grid", "NOW: grid shows", "NOW: drawn", "NOW: on the rows of", "NOW: note"];
    const lines = rows
      .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
      .map((r) => [r.name, r.wo, r.status, r.scheduleType, r.date, r.start, r.end, r.endDate, r.hours, r.lead, r.crew.length, r.entryShift === "day" ? "Morning" : r.entryShift === "night" ? "Night" : "", Math.round(r.clippedMinutes / 6) / 10, r.hiddenFrom.map(nameOf).join("; "), r.portal, r.portalCrew, r.flags.join("; "), r.crew.map(nameOf).join("; "), r.now.grid, r.now.gridHours, r.now.drawn, r.now.visibleTo, r.now.note].map(esc).join(","));
    fs.writeFileSync(OUT, `﻿${head.map(esc).join(",")}\r\n${lines.join("\r\n")}\r\n`);
    console.log(`\nwrote ${rows.length} rows to ${OUT}`);
  }
}

main().catch((e) => {
  console.error("AUDIT FAILED:", e.message);
  process.exit(1);
});

import { useMemo, useState } from "react";
import { MonthNav } from "@/components/MonthNav";
import { monthHours, workedMinutes } from "@/lib/calc";
import { hours, newId, todayISO } from "@/lib/format";
import { holidayName, regionLabel } from "@/lib/holidays";
import type { Shift } from "@/lib/model";
import { daysInMonth, isoDate, parseHHMM, weekday } from "@/lib/time";
import { SHIFT_PRESETS, SHIFT_PRESETS_NOTE, type PresetKey } from "@/rules/defaults";
import { useData } from "@/state/DataContext";

const WD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const LONG_DATE = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function ShiftsPage({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const { data, upsertShift, removeShift } = useData();
  const st = data.settings;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const today = todayISO();
  const [selected, setSelected] = useState<string>(() => (today.startsWith(month) ? today : `${month}-01`));
  const sel = selected.startsWith(month) ? selected : `${month}-01`;

  const byDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of data.shifts) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    return map;
  }, [data.shifts]);
  const mh = useMemo(() => monthHours(data.shifts, month, st), [data.shifts, month, st]);

  const first = (weekday(`${month}-01`) + 6) % 7; // Monday-based
  const cells: (string | null)[] = [...Array(first).fill(null)];
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(isoDate(y, m, d));
  while (cells.length % 7) cells.push(null);

  const addPreset = (k: PresetKey) => {
    const p = SHIFT_PRESETS[k];
    upsertShift({ id: newId(), date: sel, start: p.start, end: p.end, breaks: [{ start: p.breakStart, minutes: p.breakMinutes }], kind: k });
  };
  const dayShifts = byDate.get(sel) ?? [];

  return (
    <>
      <MonthNav month={month} onChange={onMonth} />
      <div className="kpis">
        <span className="kpi">
          <span className="small">Worked</span>
          <strong>{hours(mh.worked)} h</strong>
        </span>
        <span className="kpi kpi--blue">
          <span className="small">Night</span>
          <strong>{hours(mh.night)} h</strong>
        </span>
        <span className="kpi kpi--green">
          <span className="small">Sun/holiday</span>
          <strong>{hours(mh.sunday + mh.holiday)} h</strong>
        </span>
      </div>

      <section className="card" aria-label="Calendar">
        <div className="calendar" role="grid" aria-label={`Shifts in ${month}`}>
          {WD.map((d, i) => (
            <div key={d} className={`cal-head${i === 6 ? " cal-sun" : ""}`} role="columnheader">
              {d}
            </div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={`e${i}`} className="cal-empty" aria-hidden="true" />;
            const hol = holidayName(d, st.region);
            const shifts = byDate.get(d) ?? [];
            const isSun = weekday(d) === 0;
            return (
              <button
                key={d}
                type="button"
                className={`cal-day${d === sel ? " cal-day--sel" : ""}${isSun ? " cal-sun" : ""}${hol ? " cal-hol" : ""}${d === today ? " cal-today" : ""}`}
                aria-pressed={d === sel}
                aria-label={`${LONG_DATE(d)}${hol ? `, ${hol}` : ""}${shifts.length ? `, ${shifts.length} shift(s)` : ""}`}
                onClick={() => setSelected(d)}
              >
                <span className="cal-num">{Number(d.slice(8))}</span>
                {hol && <span className="cal-holname" title={hol}>{hol}</span>}
                <span className="cal-chips">
                  {shifts.map((s) => (
                    <span key={s.id} className={`chip chip--${s.kind}`}>
                      {s.kind === "custom" ? s.start : SHIFT_PRESETS[s.kind].label[0]}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Holidays: {regionLabel(st.region)} (work location decides; change in Settings).
        </p>
      </section>

      <section className="card stack" aria-label="Selected day">
        <div>
          <p className="eyebrow">Selected day</p>
          <h3>
            {LONG_DATE(sel)}
            {holidayName(sel, st.region) && <span className="badge badge--green" style={{ marginLeft: 8 }}>{holidayName(sel, st.region)}</span>}
          </h3>
        </div>
        <div className="row">
          {(Object.keys(SHIFT_PRESETS) as PresetKey[]).map((k) => (
            <button key={k} type="button" className={`btn preset preset--${k}`} onClick={() => addPreset(k)}>
              + {SHIFT_PRESETS[k].label} <span className="small">{SHIFT_PRESETS[k].start}-{SHIFT_PRESETS[k].end}</span>
            </button>
          ))}
          <button
            type="button"
            className="btn"
            onClick={() => upsertShift({ id: newId(), date: sel, start: "08:00", end: "16:00", breaks: [{ start: "12:00", minutes: 30 }], kind: "custom" })}
          >
            + Custom
          </button>
        </div>
        <p className="small muted">{SHIFT_PRESETS_NOTE}</p>
        {dayShifts.length === 0 && <p className="muted">No shift on this day.</p>}
        {dayShifts.map((s) => (
          <ShiftEditor key={s.id} shift={s} onChange={upsertShift} onRemove={() => removeShift(s.id)} minutes={[...workedMinutes(s, st)].length} />
        ))}
      </section>
    </>
  );
}

function ShiftEditor({ shift, onChange, onRemove, minutes }: { shift: Shift; onChange: (s: Shift) => void; onRemove: () => void; minutes: number }) {
  const overnight = parseHHMM(shift.end) <= parseHHMM(shift.start);
  const b = shift.breaks[0] ?? { start: shift.start, minutes: 0 };
  const set = (patch: Partial<Shift>) => {
    const next = { ...shift, ...patch };
    if (next.start === next.end) return; // invalid: keep previous
    onChange(next);
  };
  const id = shift.id;
  return (
    <div className="shift-edit">
      <div className="row">
        <span className={`chip chip--${shift.kind}`}>{shift.kind === "custom" ? "Custom" : SHIFT_PRESETS[shift.kind].label}</span>
        <strong>{hours(minutes)} h worked</strong>
        {overnight && <span className="badge badge--blue">ends next day</span>}
        <span className="spacer" />
        <button type="button" className="btn btn--danger" onClick={onRemove} aria-label="Delete this shift">
          Delete
        </button>
      </div>
      <div className="field-grid">
        <label htmlFor={`${id}-s`}>
          Start
          <input id={`${id}-s`} type="time" value={shift.start} required onChange={(e) => e.target.value && set({ start: e.target.value })} />
        </label>
        <label htmlFor={`${id}-e`}>
          End
          <input id={`${id}-e`} type="time" value={shift.end} required onChange={(e) => e.target.value && set({ end: e.target.value })} />
        </label>
        <label htmlFor={`${id}-bs`}>
          Break from
          <input
            id={`${id}-bs`}
            type="time"
            value={b.start}
            onChange={(e) => e.target.value && set({ breaks: [{ start: e.target.value, minutes: b.minutes }] })}
          />
        </label>
        <label htmlFor={`${id}-bm`}>
          Break (min)
          <input
            id={`${id}-bm`}
            type="number"
            inputMode="numeric"
            min={0}
            max={240}
            step={5}
            value={b.minutes}
            onChange={(e) => {
              const v = Math.max(0, Math.min(240, Math.round(Number(e.target.value) || 0)));
              set({ breaks: [{ start: b.start, minutes: v }] });
            }}
          />
        </label>
      </div>
    </div>
  );
}

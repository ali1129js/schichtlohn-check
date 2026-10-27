import { OCR_CONFIG } from "@/ocr/config";
import type { ReactNode } from "react";
import { RuleBadge } from "@/components/RuleBadge";
import { rates } from "@/lib/calc";
import { num2, todayISO } from "@/lib/format";
import { REGIONS } from "@/lib/holidays";
import { defaultSettings, SettingsSchema, type Settings } from "@/lib/model";
import {
  BASE_HOURS_MODE,
  BZ_CHEMIE_RULE,
  bzPercentFor,
  AZK_PAYOUT_BASE,
  BZ_HOURS,
  COMBINE_RULE,
  SURCHARGE_ROUNDING,
  ENTGELTGRUPPEN,
  ETV_RULE,
  etvRate,
  HOLIDAY_PCT,
  NIGHT_PCT,
  NIGHT_WINDOW,
  OVERTIME_BASE,
  OVERTIME_PCT,
  OVERTIME_THRESHOLD_PCT,
  SUNDAY_PCT,
  SURCHARGE_BASE,
  WEEKLY_HOURS,
  type Entgeltgruppe,
  type RuleValue,
} from "@/rules/defaults";
import { useData } from "@/state/DataContext";

function Field({ label, htmlFor, rule, children, hint }: { label: string; htmlFor: string; rule?: RuleValue<unknown>; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <div className="field__label">
        <label htmlFor={htmlFor}>{label}</label>
        {rule && <RuleBadge rule={rule} />}
      </div>
      {children}
      {hint && <p className="small muted">{hint}</p>}
    </div>
  );
}

export function SettingsPage() {
  const { data, setSettings } = useData();
  const st = data.settings;
  const today = todayISO();
  const update = (patch: Partial<Settings>) => {
    let next = { ...st, ...patch };
    if (next.bzAuto && next.eg !== "custom") next = { ...next, bzPct: bzPercentFor(next.eg, next.bzMonths) };
    const ok = SettingsSchema.safeParse(next);
    if (ok.success) setSettings(ok.data);
  };
  const num = (v: string) => (v === "" ? NaN : Number(v));
  const rt = rates(st);
  const tableRate = st.eg === "custom" ? null : etvRate(st.eg, today);

  return (
    <>
      <h2>Settings</h2>
      <div className="alert alert--info" role="note">
        <strong>Tariff rates are nationwide.</strong> The DGB/GVP tables apply in all of Germany; the old Ost/West difference is gone. Only public holidays
        depend on the state, and for those the <em>work location</em> counts.
      </div>

      <section className="card stack">
        <h3>Pay</h3>
        <Field label="Entgeltgruppe (EG)" htmlFor="eg" rule={ETV_RULE}>
          <select
            id="eg"
            value={st.eg}
            onChange={(e) => {
              const eg = e.target.value as Entgeltgruppe | "custom";
              const rate = eg === "custom" ? null : etvRate(eg, today);
              update({ eg, ...(rate !== null ? { baseRate: rate } : {}) });
            }}
          >
            {ENTGELTGRUPPEN.map((g) => (
              <option key={g} value={g}>
                EG {g}
                {etvRate(g, today) !== null ? ` · ${num2(etvRate(g, today)!)} €` : ""}
              </option>
            ))}
            <option value="custom">Custom rate</option>
          </select>
        </Field>
        <Field
          label="Base hourly rate (€)"
          htmlFor="base"
          hint={
            tableRate !== null && tableRate !== st.baseRate ? (
              <>
                Table rate today: {num2(tableRate)} €.{" "}
                <button type="button" className="linklike" onClick={() => update({ baseRate: tableRate })}>
                  Use it
                </button>{" "}
                (Add an Erfahrungszuschlag here if you get one.)
              </>
            ) : (
              "From the table for today's date. Add an Erfahrungszuschlag here if you get one."
            )
          }
        >
          <input id="base" type="number" step="0.01" min="0" inputMode="decimal" value={st.baseRate} onChange={(e) => update({ baseRate: num(e.target.value) })} />
        </Field>
        <Field
          label="Months at the customer (Einsatzmonate)"
          htmlFor="bzm"
          rule={BZ_CHEMIE_RULE}
          hint="Used to pick the Branchenzuschlag step (Chemie): from 3, 5, 7, 9 and 15 months."
        >
          <input id="bzm" type="number" min="0" max="240" step="1" value={st.bzMonths} onChange={(e) => update({ bzMonths: Math.round(num(e.target.value)) })} />
        </Field>
        <Field label="Branchenzuschlag entered as" htmlFor="bzmode" hint="Enter the % or the €/h exactly as on your payslip (Satz of the Branchenzuschlag line).">
          <select id="bzmode" value={st.bzMode} onChange={(e) => update({ bzMode: e.target.value as Settings["bzMode"], bzEur: st.bzEur || rt.bz })}>
            <option value="pct">percent of the base rate</option>
            <option value="eur">€ per hour</option>
          </select>
        </Field>
        {st.bzMode === "pct" ? (
          <Field label="Branchenzuschlag (%)" htmlFor="bzp" hint={`= ${num2(rt.bz)} €/h → ${num2(rt.withBz)} €/h with base.`}>
            <div className="row">
              <input
                id="bzp"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={st.bzPct}
                disabled={st.bzAuto && st.eg !== "custom"}
                onChange={(e) => update({ bzPct: num(e.target.value) })}
              />
              <label className="inline-label">
                <input type="checkbox" checked={st.bzAuto} onChange={(e) => update({ bzAuto: e.target.checked })} /> from table
              </label>
            </div>
          </Field>
        ) : (
          <Field label="Branchenzuschlag (€/h)" htmlFor="bze" hint={`= ${num2(rt.bzPct)} % of the base rate → ${num2(rt.withBz)} €/h with base.`}>
            <input id="bze" type="number" min="0" max="100" step="0.01" inputMode="decimal" value={st.bzEur} onChange={(e) => update({ bzEur: num(e.target.value) })} />
          </Field>
        )}
        <Field label="Branchenzuschlag is paid on" htmlFor="bzh" rule={BZ_HOURS}>
          <select id="bzh" value={st.bzHours} onChange={(e) => update({ bzHours: e.target.value as Settings["bzHours"] })}>
            <option value="paid">all paid hours (worked + Urlaub + AZK payout)</option>
            <option value="base">base hours only</option>
          </select>
        </Field>
        <Field label="Freizeitauszahlung (AZK payout) is paid at" htmlFor="azp" rule={AZK_PAYOUT_BASE}>
          <select id="azp" value={st.azkPayoutBase} onChange={(e) => update({ azkPayoutBase: e.target.value as Settings["azkPayoutBase"] })}>
            <option value="base">the base rate (BZ in the BZ line)</option>
            <option value="base+bz">base + Branchenzuschlag</option>
          </select>
        </Field>
        <Field label="Weekly hours (contract)" htmlFor="wh" rule={WEEKLY_HOURS}>
          <input id="wh" type="number" min="1" max="60" step="0.5" value={st.weeklyHours} onChange={(e) => update({ weeklyHours: num(e.target.value) })} />
        </Field>
        <Field label="Base pay counts" htmlFor="bhm" rule={BASE_HOURS_MODE}>
          <select id="bhm" value={st.baseHoursMode} onChange={(e) => update({ baseHoursMode: e.target.value as Settings["baseHoursMode"] })}>
            <option value="worked">worked hours</option>
            <option value="contract">contract hours (rest goes to the AZK)</option>
          </select>
        </Field>
      </section>

      <section className="card stack">
        <h3>Work location</h3>
        <Field label="State of the workplace (Bundesland)" htmlFor="region" hint="Work location decides holidays, not your home address. Example: you live in Brandenburg but work in Berlin → choose Berlin.">
          <select id="region" value={st.region} onChange={(e) => update({ region: e.target.value as Settings["region"] })}>
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="card stack">
        <h3>Surcharges (Zuschläge)</h3>
        <p className="small muted">Tariff values are maximums or minimums from the MTV DGB/GVP; your contract or the customer's rules can differ. Enter what applies to you.</p>
        <Field label="Night window" htmlFor="ns" rule={NIGHT_WINDOW}>
          <div className="row">
            <input id="ns" type="time" value={st.nightStart} onChange={(e) => e.target.value && update({ nightStart: e.target.value })} />
            <span>to</span>
            <input id="ne" type="time" aria-label="Night window end" value={st.nightEnd} onChange={(e) => e.target.value && update({ nightEnd: e.target.value })} />
          </div>
        </Field>
        <Field label="Night surcharge (%)" htmlFor="np" rule={NIGHT_PCT} hint={`= ${num2(rt.surcharge.night)} €/h`}>
          <input id="np" type="number" min="0" max="300" step="1" value={st.nightPct} onChange={(e) => update({ nightPct: num(e.target.value) })} />
        </Field>
        <Field label="Sunday surcharge (%)" htmlFor="sp" rule={SUNDAY_PCT} hint={`= ${num2(rt.surcharge.sunday)} €/h`}>
          <input id="sp" type="number" min="0" max="300" step="1" value={st.sundayPct} onChange={(e) => update({ sundayPct: num(e.target.value) })} />
        </Field>
        <Field label="Holiday surcharge (%)" htmlFor="hp" rule={HOLIDAY_PCT} hint={`= ${num2(rt.surcharge.holiday)} €/h`}>
          <input id="hp" type="number" min="0" max="300" step="1" value={st.holidayPct} onChange={(e) => update({ holidayPct: num(e.target.value) })} />
        </Field>
        <label className="inline-label">
          <input type="checkbox" checked={st.eveAsHoliday} onChange={(e) => update({ eveAsHoliday: e.target.checked })} /> 24.12. and 31.12. from 14:00 count as
          holiday (MTV § 3.6)
        </label>
        <Field label="When several surcharges apply" htmlFor="comb" rule={COMBINE_RULE}>
          <select id="comb" value={st.combine} onChange={(e) => update({ combine: e.target.value as Settings["combine"] })}>
            <option value="highest">pay only the highest</option>
            <option value="sum">add them up</option>
          </select>
        </Field>
        <Field label="Surcharges are calculated on" htmlFor="sb" rule={SURCHARGE_BASE}>
          <select id="sb" value={st.surchargeBase} onChange={(e) => update({ surchargeBase: e.target.value as Settings["surchargeBase"] })}>
            <option value="base">base rate only</option>
            <option value="base+bz">base + Branchenzuschlag</option>
          </select>
        </Field>
        <Field label="Rounding" htmlFor="sr" rule={SURCHARGE_ROUNDING}>
          <select id="sr" value={st.surchargeRounding} onChange={(e) => update({ surchargeRounding: e.target.value as Settings["surchargeRounding"] })}>
            <option value="amount">round the amount only (hours × % × rate)</option>
            <option value="rate">round the €/h first, then × hours</option>
          </select>
        </Field>
      </section>

      <section className="card stack">
        <h3>Overtime (Mehrarbeit)</h3>
        <Field label="Overtime surcharge (%)" htmlFor="op" rule={OVERTIME_PCT} hint={`= ${num2(rt.overtime)} €/h`}>
          <input id="op" type="number" min="0" max="300" step="1" value={st.overtimePct} onChange={(e) => update({ overtimePct: num(e.target.value) })} />
        </Field>
        <Field label="Overtime starts above contract hours + (%)" htmlFor="ot" rule={OVERTIME_THRESHOLD_PCT}>
          <input id="ot" type="number" min="0" max="100" step="1" value={st.overtimeThresholdPct} onChange={(e) => update({ overtimeThresholdPct: num(e.target.value) })} />
        </Field>
        <Field label="Overtime surcharge is calculated on" htmlFor="ob" rule={OVERTIME_BASE}>
          <select id="ob" value={st.overtimeBase} onChange={(e) => update({ overtimeBase: e.target.value as Settings["overtimeBase"] })}>
            <option value="base">base rate only</option>
            <option value="base+bz">base + Branchenzuschlag</option>
          </select>
        </Field>
      </section>

      <section className="card stack">
        <h3>Payslip compare</h3>
        <Field label="Tolerance (€)" htmlFor="tol" hint="Differences up to this amount are not highlighted.">
          <input id="tol" type="number" min="0" max="100" step="0.01" value={st.tolerance} onChange={(e) => update({ tolerance: num(e.target.value) })} />
        </Field>
        <div>
          <button type="button" className="btn btn--danger" onClick={() => confirm("Reset all settings to the defaults?") && setSettings(defaultSettings(today))}>
            Reset settings to defaults
          </button>
        </div>
      </section>
      <section className="card stack" aria-label="Text recognition">
        <h3>Scans and photos (text recognition)</h3>
        <p className="small muted">
          PDFs with a text layer are read directly. Scans and photos are read on this device with {OCR_CONFIG.engines.tesseract.name} (about{" "}
          {OCR_CONFIG.engines.tesseract.downloadMB.toLocaleString("de-DE")} MB from this site on first use). Nothing is uploaded.
        </p>
        <label className="inline-label">
          <input
            type="checkbox"
            checked={st.ocrVlm}
            onChange={(e) => {
              const on = e.target.checked;
              if (on && !window.confirm(`Experimental: ${OCR_CONFIG.engines.graniteDocling.name}. It needs WebGPU and downloads about ${OCR_CONFIG.engines.graniteDocling.downloadMB} MB once (kept by the browser). Your payslip still never leaves this device. Switch it on?`)) return;
              update({ ocrVlm: on });
            }}
          />{" "}
          <span>
            Use the document AI model first <span className="badge badge--amber">experimental</span> (about {OCR_CONFIG.engines.graniteDocling.downloadMB} MB, needs WebGPU)
          </span>
        </label>
        <p className="small muted">
          Preview: the model run is not finished in this version, so the app falls back to {OCR_CONFIG.engines.tesseract.name} and nothing is downloaded yet. The import always shows which engine read the
          payslip.
        </p>
      </section>
    </>
  );
}

import { useMemo } from "react";
import { MonthNav } from "@/components/MonthNav";
import { calcMonth, rates } from "@/lib/calc";
import { eur, hours, num2 } from "@/lib/format";
import { regionLabel } from "@/lib/holidays";
import { useData } from "@/state/DataContext";

export function GrossOnlyNotice() {
  return (
    <div className="alert alert--info" role="note">
      <strong>Gross only.</strong> This app calculates gross pay (Brutto) from your shifts. It does <em>not</em> calculate tax, social insurance or net
      pay. The "tax-free" column shows the § 3b EStG limit for surcharges, not your tax.
    </div>
  );
}

export function PayPage({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const { data } = useData();
  const st = data.settings;
  const vacation = data.payslips[month]?.lines.tarifurlaub?.hours ?? 0;
  const payout = data.payslips[month]?.lines.freizeit?.hours ?? 0;
  const r = useMemo(() => calcMonth(data.shifts, month, st, vacation, payout), [data.shifts, month, st, vacation, payout]);
  const rt = rates(st);
  const h = r.hours;
  const noShifts = h.worked === 0;

  return (
    <>
      <MonthNav month={month} onChange={onMonth} />
      <GrossOnlyNotice />
      {noShifts && <p className="card muted">No shifts in this month yet. Add them on the Shifts tab.</p>}

      <section className="card">
        <h3>Hours</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Hours</th>
                <th>Rule</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Worked (breaks excluded)</td>
                <td className="num"><strong>{hours(h.worked)}</strong></td>
                <td className="small">contract {num2(r.contractHours)} h/month ({st.weeklyHours} h × 13 ÷ 3)</td>
              </tr>
              <tr>
                <td>Normal (no surcharge)</td>
                <td className="num">{hours(h.normal)}</td>
                <td />
              </tr>
              <tr>
                <td>Night (Nacht)</td>
                <td className="num">{hours(h.night)}</td>
                <td className="small">{st.nightStart}-{st.nightEnd}{h.rawNight !== h.night ? ` · ${hours(h.rawNight)} h in window` : ""}</td>
              </tr>
              <tr>
                <td>Sunday (Sonntag)</td>
                <td className="num">{hours(h.sunday)}</td>
                <td className="small">{h.rawSunday !== h.sunday ? `${hours(h.rawSunday)} h on Sundays` : ""}</td>
              </tr>
              <tr>
                <td>Holiday (Feiertag)</td>
                <td className="num">{hours(h.holiday)}</td>
                <td className="small">{regionLabel(st.region)}{st.eveAsHoliday ? " · 24./31.12. from 14:00" : ""}</td>
              </tr>
              <tr>
                <td>Overtime (Mehrarbeit)</td>
                <td className="num">{num2(r.overtimeHours)}</td>
                <td className="small">
                  full hours above {num2(r.overtimeThreshold)} h{vacation ? ` (incl. ${num2(vacation)} h Tarifurlaub from payslip)` : ""}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">
          {st.combine === "highest"
            ? "Combine rule: only the highest surcharge is paid when several apply (MTV § 6.4)."
            : "Combine rule: overlapping surcharges are added together (likely, from a real payslip)."}{" "}
          Arbeitszeitkonto: {r.azkDelta >= 0 ? "+" : ""}
          {num2(r.azkDelta)} h vs contract.
        </p>
      </section>

      <section className="card">
        <h3>Gross pay breakdown</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th className="num">Hours</th>
                <th className="num">€/h</th>
                <th className="num">Amount</th>
                <th className="num" title="§ 3b EStG tax-free limit">tax-free</th>
                <th className="num" title="§ 1 SvEV social-insurance-free">SV-free</th>
              </tr>
            </thead>
            <tbody>
              {r.components.map((c) => (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td className="num">{num2(c.hours)}</td>
                  <td className="num">{num2(c.rate)}</td>
                  <td className="num">{eur(c.amount)}</td>
                  <td className="num">{c.taxFree ? eur(c.taxFree) : "–"}</td>
                  <td className="num">{c.svFree ? eur(c.svFree) : "–"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Gross total (from shifts)</th>
                <td />
                <td />
                <th className="num">{eur(r.total)}</th>
                <th className="num">{eur(r.taxFree)}</th>
                <th className="num">{eur(r.svFree)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
        <ul className="small muted list">
          <li>
            Base {num2(st.baseRate)} €/h + Branchenzuschlag {num2(rt.bzPct)} % = {num2(rt.bz)} €/h. Base pay counts {st.baseHoursMode === "worked" ? "worked" : "contract"}{" "}
            hours ({num2(r.baseHours)} h).{" "}
            {st.bzHours === "paid" ? "The BZ is paid on all paid hours, including Urlaub and Freizeitauszahlung hours from the payslip." : "The BZ is paid on the base hours only."}
          </li>
          <li>
            Surcharges are calculated on {st.surchargeBase === "base" ? `the base rate (${num2(st.baseRate)} €)` : `base + BZ (${num2(rt.withBz)} €)`}
            {st.surchargeRounding === "rate" ? "; each €/h rate is rounded to cents first." : "; only the amount is rounded to cents (hours × % × rate)."}
          </li>
          <li>
            § 3b tax-free part: per minute, on a Grundlohn of {num2(rt.grundlohn)} €/h (max 50 €), capped at 25 % night (40 % 0-4 h if the shift started
            before midnight), 50 % Sunday, 125 % holiday (Oster-/Pfingstsonntag count as holidays here in every state), 150 % 24.12. from 14 h/25./26.12./1.5. Night and Sunday/holiday limits are added up, as is common
            practice. SV-free: same, but on at most 25 €/h.
          </li>
          <li>Not included: Tarifurlaub, Freizeitauszahlung, Fahrgeld, Erfahrungszuschlag, one-off payments. Compare those on the Payslip tab.</li>
        </ul>
      </section>
    </>
  );
}

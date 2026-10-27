import { useMemo } from "react";
import { MonthNav } from "@/components/MonthNav";
import { PdfImport } from "@/components/PdfImport";
import { calcMonth } from "@/lib/calc";
import { comparePayslip, type CompareStatus } from "@/lib/compare";
import { eur, num2 } from "@/lib/format";
import { PAYSLIP_LINE_LABEL, PAYSLIP_LINES, type Payslip, type PayslipLine } from "@/lib/model";
import { useData } from "@/state/DataContext";

const STATUS: Record<CompareStatus, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "badge--green" },
  diff: { label: "Difference", cls: "badge--red" },
  "no-payslip": { label: "not entered", cls: "badge--grey" },
  info: { label: "info", cls: "badge--blue" },
};

function NumField({ id, label, value, onChange }: { id: string; label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.01"
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value === "" ? undefined : Number(e.target.value);
          onChange(v === undefined || Number.isFinite(v) ? v : undefined);
        }}
      />
    </label>
  );
}

export function PayslipPage({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const { data, setPayslip } = useData();
  const st = data.settings;
  const p: Payslip = data.payslips[month] ?? { lines: {} };
  const vacation = p.lines.tarifurlaub?.hours ?? 0;
  const r = useMemo(() => calcMonth(data.shifts, month, st, vacation), [data.shifts, month, st, vacation]);
  const rows = useMemo(() => comparePayslip(r, p, st), [r, p, st]);
  const diffs = rows.filter((x) => x.status === "diff").length;

  const setLine = (line: PayslipLine, part: "hours" | "rate" | "amount", v: number | undefined) => {
    const cur = { ...p.lines[line], [part]: v };
    const lines = { ...p.lines, [line]: cur };
    setPayslip(month, { ...p, lines });
  };
  const setTop = (k: "gesamtbrutto" | "steuerfrei" | "azkSaldo", v: number | undefined) => setPayslip(month, { ...p, [k]: v });

  return (
    <>
      <MonthNav month={month} onChange={onMonth} />
      <PdfImport month={month} current={data.payslips[month]} onApply={(m, ps) => (setPayslip(m, ps), onMonth(m))} />

      <section className="card stack" aria-label="Comparison">
        <div className="row">
          <h3>Compare with your payslip</h3>
          <span className="spacer" />
          {diffs > 0 ? <span className="badge badge--red">{diffs} difference(s)</span> : <span className="badge badge--green">no differences</span>}
        </div>
        <p className="small muted">
          Differences above {eur(st.tolerance)} are highlighted (change the tolerance in Settings). "Expected" is calculated from your shifts and settings.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Line</th>
                <th className="num">Expected</th>
                <th className="num">Payslip</th>
                <th className="num">Diff</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={row.status === "diff" ? "row-diff" : undefined}>
                  <td>
                    {row.label}
                    {row.hints.length > 0 && (
                      <ul className="hints">
                        {row.hints.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="num">{row.expected === null ? "–" : eur(row.expected)}</td>
                  <td className="num">{row.actual === null ? "–" : eur(row.actual)}</td>
                  <td className="num">{row.diff === null ? "" : `${row.diff > 0 ? "+" : ""}${num2(row.diff)}`}</td>
                  <td>
                    <span className={`badge ${STATUS[row.status].cls}`}>{STATUS[row.status].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack" aria-label="Payslip values">
        <div className="row">
          <h3>Payslip values (enter by hand or import)</h3>
          <span className="spacer" />
          {data.payslips[month] && (
            <button type="button" className="btn btn--danger" onClick={() => confirm("Clear the payslip values for this month?") && setPayslip(month, null)}>
              Clear month
            </button>
          )}
        </div>
        {PAYSLIP_LINES.map((line) => (
          <fieldset key={line} className="line-fields">
            <legend>{PAYSLIP_LINE_LABEL[line]}</legend>
            <div className="field-grid">
              <NumField id={`${line}-h`} label="Hours" value={p.lines[line]?.hours} onChange={(v) => setLine(line, "hours", v)} />
              <NumField id={`${line}-r`} label="€/h" value={p.lines[line]?.rate} onChange={(v) => setLine(line, "rate", v)} />
              <NumField id={`${line}-a`} label="Amount €" value={p.lines[line]?.amount} onChange={(v) => setLine(line, "amount", v)} />
            </div>
          </fieldset>
        ))}
        <fieldset className="line-fields">
          <legend>Totals</legend>
          <div className="field-grid">
            <NumField id="gb" label="Gesamtbrutto €" value={p.gesamtbrutto} onChange={(v) => setTop("gesamtbrutto", v)} />
            <NumField id="sf" label="Steuerfreie Bezüge €" value={p.steuerfrei} onChange={(v) => setTop("steuerfrei", v)} />
            <NumField id="azk" label="AZK saldo (h)" value={p.azkSaldo} onChange={(v) => setTop("azkSaldo", v)} />
          </div>
          {p.azkSaldo !== undefined && (
            <p className="small muted">
              AZK saldo is shown for information. This month's shifts would change it by {r.azkDelta >= 0 ? "+" : ""}
              {num2(r.azkDelta)} h.
            </p>
          )}
        </fieldset>
      </section>
    </>
  );
}

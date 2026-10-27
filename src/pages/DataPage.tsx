import { useRef, useState } from "react";
import { PrivacyNote } from "@/components/AppShell";
import { RuleBadge, RuleNote } from "@/components/RuleBadge";
import { HOLIDAY_NOTE, holidays, regionLabel } from "@/lib/holidays";
import { exportJson, importJson } from "@/lib/storage";
import { ALL_RULES } from "@/rules/defaults";
import { useData } from "@/state/DataContext";

export function DataPage({ month }: { month: string }) {
  const { data, replaceAll } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const year = Number(month.slice(0, 4));

  const doExport = () => {
    const blob = new Blob([exportJson(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `schichtlohn-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const doImport = async (f: File | undefined) => {
    if (!f) return;
    const r = importJson(await f.text());
    if (fileRef.current) fileRef.current.value = "";
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    if (!confirm(`Replace your current data with "${f.name}" (${r.data.shifts.length} shifts)?`)) return;
    replaceAll(r.data);
    setMsg({ ok: true, text: `Imported ${r.data.shifts.length} shifts and ${Object.keys(r.data.payslips).length} payslip(s).` });
  };

  return (
    <>
      <h2>Data & sources</h2>
      <section className="card stack">
        <h3>Your data</h3>
        <PrivacyNote />
        <p className="small muted">
          {data.shifts.length} shifts and {Object.keys(data.payslips).length} payslip month(s) are stored in this browser. Clearing the browser data deletes them,
          so export a backup now and then.
        </p>
        <div className="row">
          <button type="button" className="btn btn--primary" onClick={doExport}>
            Export JSON backup
          </button>
          <label className="btn file-btn">
            Import JSON…
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => void doImport(e.target.files?.[0])} />
          </label>
        </div>
        {msg && (
          <div role={msg.ok ? "status" : "alert"} className={`alert${msg.ok ? " alert--ok" : ""}`}>
            {msg.text}
          </div>
        )}
      </section>

      <section className="card stack">
        <h3>Sources of the default values</h3>
        <p className="small muted">
          Every default shows where it comes from. <span className="badge badge--green">verified</span> = read in the official text.{" "}
          <span className="badge badge--amber">unconfirmed</span> = not confirmed from an official source: check your contract. Tariff rates are nationwide (no
          Ost/West difference).
        </p>
        <ul className="sources">
          {ALL_RULES.map((r) => (
            <li key={r.label}>
              <div className="row">
                <strong>{r.label}</strong>
                <RuleBadge rule={r} />
              </div>
              <RuleNote rule={r} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card stack">
        <h3>
          Public holidays {year}: {regionLabel(data.settings.region)}
        </h3>
        <p className="small muted">Work location decides holidays. {HOLIDAY_NOTE}</p>
        <ul className="small list">
          {holidays(year, data.settings.region).map((h) => (
            <li key={h.date}>
              {new Date(`${h.date}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" })} {h.name}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

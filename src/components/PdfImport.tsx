import { useRef, useState } from "react";
import { CONFIDENCE_LABEL, type Confidence } from "@/import/parser";
import { PdfImportError } from "@/import/pdfText";
import { applyPreview, buildPreview, type PreviewField } from "@/import/preview";
import { base64ToBytes, importPayslipPdf, type ImportedPayslip } from "@/import/source";
import { monthLabel } from "@/lib/format";
import type { Payslip } from "@/lib/model";

const CONF_CLASS: Record<Confidence, string> = { sicher: "badge--green", pruefen: "badge--amber", unsicher: "badge--red" };
const CONF_TITLE: Record<Confidence, string> = {
  sicher: "Found and the numbers add up (hours × rate = amount).",
  pruefen: "Found, but please check it against your paper payslip.",
  unsicher: "Uncertain: not applied unless you tick it.",
};

export function PdfImport({ month, current, onApply }: { month: string; current: Payslip | undefined; onApply: (month: string, p: Payslip) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportedPayslip | null>(null);
  const [fields, setFields] = useState<PreviewField[]>([]);
  const [target, setTarget] = useState(month);
  const [applyErrors, setApplyErrors] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const run = async (load: () => Promise<{ bytes: Uint8Array; name: string }>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    setApplyErrors([]);
    try {
      const { bytes, name } = await load();
      const r = await importPayslipPdf(bytes, name);
      setResult(r);
      setFields(buildPreview(r.parsed));
      setTarget(r.parsed.month?.value ?? month);
    } catch (e) {
      setResult(null);
      setError(e instanceof PdfImportError ? e.message : `The PDF could not be read (${e instanceof Error ? e.message : "unknown error"}).`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onFile = (f: File | undefined) => f && run(async () => ({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name }));
  const onSample = () =>
    run(async () => {
      const { SAMPLE_PAYSLIP_PDF_BASE64 } = await import("@/import/samplePayslipPdf");
      return { bytes: base64ToBytes(SAMPLE_PAYSLIP_PDF_BASE64), name: "Musterabrechnung-03-2026.pdf" };
    });

  const apply = () => {
    const base = target === month ? current : undefined;
    const r = applyPreview(fields, base ?? { lines: {} });
    if (!r.ok) {
      setApplyErrors(r.errors);
      return;
    }
    onApply(target, r.payslip);
    setDone(`${r.applied} value(s) applied to ${monthLabel(target)}.`);
    setResult(null);
    setFields([]);
  };

  const patch = (id: string, p: Partial<PreviewField>) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...p } : f)));

  return (
    <section className="card stack" aria-label="Import payslip PDF">
      <div>
        <h3>Import payslip PDF</h3>
        <p className="privacy-inline">
          <strong>Processed 100 % in your browser.</strong> The PDF is read on this device; nothing is uploaded and no network request is made.
        </p>
      </div>
      <div className="row">
        <label className="btn btn--primary file-btn">
          Choose PDF…
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <button type="button" className="btn" disabled={busy} onClick={onSample}>
          Try sample
        </button>
        {busy && <span className="muted" role="status">Reading PDF…</span>}
      </div>
      <p className="small muted">The sample is a made-up payslip (Max Beispiel, Musterzeit Personal GmbH). Scanned PDFs without text are not supported yet (no OCR).</p>
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {done && (
        <div role="status" className="alert alert--ok">
          {done}
        </div>
      )}

      {result && (
        <div className="stack">
          <div className="row">
            <strong>{result.fileName}</strong>
            <span className="spacer" />
            <label htmlFor="imp-month" className="inline-label">
              Apply to month
              <input id="imp-month" type="month" value={target} onChange={(e) => e.target.value && setTarget(e.target.value)} />
            </label>
          </div>
          {result.parsed.month && (
            <p className="small">
              Abrechnungsmonat found: <strong>{monthLabel(result.parsed.month.value)}</strong>{" "}
              <span className={`badge ${CONF_CLASS[result.parsed.month.confidence]}`}>{CONFIDENCE_LABEL[result.parsed.month.confidence]}</span>
            </p>
          )}
          <p className="small muted">Check every value against your payslip. Edit if needed, untick what you do not want. Nothing is saved until you press Apply.</p>
          <div className="table-wrap">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>Use</th>
                  <th>Field</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <input type="checkbox" aria-label={`Use ${f.label}`} checked={f.selected} onChange={(e) => patch(f.id, { selected: e.target.checked })} />
                    </td>
                    <td>
                      {f.label}
                      <details>
                        <summary className="small">source line</summary>
                        <code className="small">{f.source}</code>
                      </details>
                      {f.note && <p className="small muted">{f.note}</p>}
                    </td>
                    <td>
                      <input
                        className="num-input"
                        inputMode="decimal"
                        aria-label={`${f.label} value`}
                        value={f.text}
                        onChange={(e) => patch(f.id, { text: e.target.value, selected: true })}
                      />
                    </td>
                    <td>
                      <span className={`badge ${CONF_CLASS[f.confidence]}`} title={CONF_TITLE[f.confidence]}>
                        {CONFIDENCE_LABEL[f.confidence]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.parsed.info.length > 0 && (
            <details>
              <summary>Other values on the payslip (shown only, not checked)</summary>
              <ul className="small list">
                {result.parsed.info.map((i, k) => (
                  <li key={k}>
                    {i.label}: {i.value}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.parsed.ytd.length > 0 && (
            <details>
              <summary>Year-to-date lines (kumuliert, ignored)</summary>
              <ul className="small list">
                {result.parsed.ytd.map((l, k) => (
                  <li key={k}>
                    <code>{l}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.parsed.unmatched.length > 0 && (
            <details>
              <summary>Lines not recognised ({result.parsed.unmatched.length})</summary>
              <ul className="small list">
                {result.parsed.unmatched.map((l, k) => (
                  <li key={k}>
                    <code>{l}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary>Extracted text</summary>
            <pre className="small pre">{result.text.join("\n")}</pre>
          </details>
          {applyErrors.length > 0 && (
            <div role="alert" className="alert">
              {applyErrors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={apply}>
              Apply {fields.filter((f) => f.selected).length} value(s)
            </button>
            <button type="button" className="btn" onClick={() => (setResult(null), setFields([]))}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

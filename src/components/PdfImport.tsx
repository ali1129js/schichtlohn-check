import { useRef, useState } from "react";
import { CATEGORY_OPTIONS, isCategoryId } from "@/import/categories";
import { CONFIDENCE_LABEL, parsePayslipLines, SUMMARY_LABEL, type Confidence, type SummaryField } from "@/import/parser";
import { PdfImportError } from "@/import/pdfText";
import { applyOther, applyPreview, buildOther, buildPreview, formatDe, rememberLabel, toLabelMap, type OtherRow, type PreviewField } from "@/import/preview";
import { base64ToBytes, importPayslipFile, type ImportedPayslip } from "@/import/source";
import { OCR_CONFIG } from "@/ocr/config";
import type { OcrProgress } from "@/ocr/types";
import { applyOcrReliability } from "@/ocr/reliability";
import { monthLabel } from "@/lib/format";
import type { Payslip } from "@/lib/model";

const CONF_CLASS: Record<Confidence, string> = { sicher: "badge--green", pruefen: "badge--amber", unsicher: "badge--red" };
const CONF_TITLE: Record<Confidence, string> = {
  sicher: "Found and the numbers add up (hours × rate = amount).",
  pruefen: "Found, but please check it against your paper payslip.",
  unsicher: "Uncertain: not applied unless you tick it.",
};

interface Props {
  month: string;
  current: Payslip | undefined;
  onApply: (month: string, p: Payslip) => void;
  /** the user's saved "this line is ..." choices */
  labelMap?: Record<string, string>;
  onLabelMap?: (m: Record<string, string>) => void;
  /** experimental document-AI engine switched on in Settings (with consent to the download) */
  vlmOptIn?: boolean;
}

const SHOWN_ONLY: SummaryField[] = ["steuerbrutto", "svbrutto", "netto", "auszahlung", "gesStunden", "stundenlohn"];

export function PdfImport({ month, current, onApply, labelMap = {}, onLabelMap, vlmOptIn = false }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportedPayslip | null>(null);
  const [fields, setFields] = useState<PreviewField[]>([]);
  const [other, setOther] = useState<OtherRow[]>([]);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [confirmed, setConfirmed] = useState(false);
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
      const r = await importPayslipFile(bytes, name, {
        labelMap: toLabelMap(labelMap),
        // OCR engine: loaded only when a scan or photo needs it
        ocr: async () => {
          const { detectEnv, startOcr } = await import("@/ocr/engines");
          return startOcr(OCR_CONFIG, detectEnv({ graniteDocling: vlmOptIn }), setProgress);
        },
      });
      setResult(r);
      setFields(buildPreview(r.parsed));
      setOther(buildOther(r.parsed));
      setTarget(r.parsed.month?.value ?? month);
    } catch (e) {
      setResult(null);
      setError(e instanceof PdfImportError ? e.message : `The PDF could not be read (${e instanceof Error ? e.message : "unknown error"}).`);
    } finally {
      setBusy(false);
      setProgress(null);
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
    onApply(target, applyOther(r.payslip, other));
    setDone(`${r.applied} value(s) applied to ${monthLabel(target)}.`);
    setResult(null);
    setFields([]);
    setOther([]);
  };

  /** "This line is ...": remembered per label on this device, then the payslip is read again. */
  const recategorize = (label: string, cat: string) => {
    if (!result || !isCategoryId(cat)) return;
    const map = rememberLabel(toLabelMap(labelMap), label, cat);
    onLabelMap?.(map);
    let parsed = parsePayslipLines(result.lines, { labelMap: map, producer: result.producer });
    if (result.method !== "text") parsed = applyOcrReliability(parsed, result.lines, OCR_CONFIG.reliability);
    setResult({ ...result, parsed });
    setFields(buildPreview(parsed));
    setOther(buildOther(parsed));
  };

  const patch = (id: string, p: Partial<PreviewField>) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...p } : f)));

  return (
    <section className="card stack" aria-label="Import payslip">
      <div>
        <h3>Import payslip (PDF or photo)</h3>
        <p className="privacy-inline">
          <strong>Processed 100 % in your browser.</strong> The file is read on this device and never uploaded. The only downloads are the app's own OCR files, from this site, when a scan needs them.
        </p>
      </div>
      <div className="row">
        <label className="btn btn--primary file-btn">
          Choose PDF or photo…
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        <button type="button" className="btn" disabled={busy} onClick={onSample}>
          Try sample
        </button>
        {busy && !progress && (
          <span className="muted" role="status">
            Reading file…
          </span>
        )}
      </div>
      {busy && progress && (
        <div className="stack" role="status" aria-live="polite">
          <label className="small">
            {progress.stage === "loading" ? "Loading text recognition (OCR)…" : progress.stage === "rendering" ? `Preparing page ${progress.page ?? 1}…` : `Recognising text on page ${progress.page ?? 1}…`}
            <progress className="ocr-progress" max={1} value={progress.progress} />
          </label>
          {progress.stage === "loading" && (
            <p className="small muted">First use downloads about {OCR_CONFIG.engines.tesseract.downloadMB.toLocaleString("de-DE")} MB from this site (OCR engine and German language data). Your browser keeps it after that. Nothing is uploaded.</p>
          )}
        </div>
      )}
      <p className="small muted">
        The sample is a made-up payslip (Max Beispiel, Musterzeit Personal GmbH). Scans and phone photos (JPG, PNG, WebP; HEIC where the browser can open it) are read with text recognition (OCR) on
        this device. That is less reliable than a PDF from the payroll program.
      </p>
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
          {result.method !== "text" && (
            <div role="alert" className="alert alert--warn">
              <strong>This payslip was read with OCR (text recognition). Check every value against your real payslip before comparing.</strong>
              <div className="small">
                {result.method === "mixed" ? `Pages read by OCR: ${result.pages.filter((p) => p.method === "ocr").map((p) => p.page).join(", ")}. ` : ""}
                {result.ocrEngine ? `Engine: ${result.ocrEngine.name}. ` : ""}
                {result.ocrConfidence !== null ? `Average word confidence: ${result.ocrConfidence} %. ` : ""}
                OCR values are never marked "sicher"; uncertain ones are not ticked.
                {result.parsed.checks.some((c) => !c.ok) ? " The line sums do not match the payslip totals: some numbers were probably misread." : ""}
              </div>
            </div>
          )}
          {result.parsed.month && (
            <p className="small">
              Abrechnungsmonat found: <strong>{monthLabel(result.parsed.month.value)}</strong>{" "}
              <span className={`badge ${CONF_CLASS[result.parsed.month.confidence]}`}>{CONFIDENCE_LABEL[result.parsed.month.confidence]}</span>
            </p>
          )}
          <p className="small">
            Read by: <strong>{result.method === "text" ? "PDF text layer" : result.method === "mixed" ? `PDF text layer + ${result.ocrEngine?.name ?? "OCR"}` : (result.ocrEngine?.name ?? "OCR")}</strong>
            {" · "}Layout: <strong>{result.parsed.profile.name}</strong>{" "}
            {result.parsed.profile.checked ? (
              <span className="badge badge--green" title="This layout was checked against a real payslip.">checked layout</span>
            ) : (
              <span className="badge badge--amber" title={result.parsed.profile.note}>not checked against a real payslip</span>
            )}{" "}
            <span className="muted">
              ({result.parsed.table === "columns" ? "table read by its column headers" : result.parsed.table === "heuristic" ? "no column headers found: numbers read from the line ends" : "no wage-type table found"})
            </span>
          </p>
          {result.parsed.checks.length > 0 && (
            <ul className="small list" aria-label="Cross-checks">
              {result.parsed.checks.map((c) => (
                <li key={c.id}>
                  <span className={`badge ${c.ok ? "badge--green" : "badge--red"}`}>{c.ok ? "adds up" : "does not add up"}</span> {c.label}: rows {formatDe(c.rows)} € / payslip {formatDe(c.total)} €
                </li>
              ))}
            </ul>
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
                  <th>Source</th>
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
                    <td>
                      {f.origin === "ocr" ? (
                        <span className="badge badge--amber" title="Read by text recognition (OCR) from an image: check it.">
                          OCR{f.ocrConfidence !== undefined ? ` ${f.ocrConfidence} %` : ""}
                        </span>
                      ) : (
                        <span className="badge" title="Read from the PDF's text layer.">
                          Text
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {other.length > 0 && (
            <div className="stack">
              <h4>Other / not recognised ({other.length})</h4>
              <p className="small muted">
                The app does not calculate these lines. Kept lines are shown as info on the compare page and count towards the expected Gesamtbrutto. If a line is something the app knows (for
                example your night surcharge under another name), pick it: the choice is remembered on this device for that line name.
              </p>
              <div className="table-wrap">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>Keep</th>
                      <th>Line</th>
                      <th>Amount</th>
                      <th>What is it?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {other.map((o) => (
                      <tr key={o.key}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Keep ${o.label}`}
                            checked={o.keep}
                            onChange={(e) => setOther((rs) => rs.map((x) => (x.key === o.key ? { ...x, keep: e.target.checked } : x)))}
                          />
                        </td>
                        <td>
                          {o.label}
                          {o.hours !== undefined && <span className="small muted"> · {formatDe(o.hours)} h</span>}
                          <details>
                            <summary className="small">source line</summary>
                            <code className="small">{o.source}</code>
                          </details>
                        </td>
                        <td className="num">{o.amount !== undefined ? `${formatDe(o.amount)} €` : "–"}</td>
                        <td>
                          <select aria-label={`Category of ${o.label}`} value={o.category} onChange={(e) => recategorize(o.label, e.target.value)}>
                            {CATEGORY_OPTIONS.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.id === "other" ? "Other / not recognised" : c.label}
                              </option>
                            ))}
                          </select>
                          {o.by === "user" && <span className="small muted"> (your choice)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {SHOWN_ONLY.some((f) => result.parsed.summary[f]) && (
            <details>
              <summary>Totals found (shown only)</summary>
              <ul className="small list">
                {SHOWN_ONLY.filter((f) => result.parsed.summary[f]).map((f) => (
                  <li key={f}>
                    {SUMMARY_LABEL[f]}: {formatDe(result.parsed.summary[f]!.value)}
                  </li>
                ))}
              </ul>
              <p className="small muted">Gross only: the app does not calculate net pay or tax.</p>
            </details>
          )}
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
          {result.method !== "text" && (
            <label className="row small">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I have checked the ticked values against my real payslip.
            </label>
          )}
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={apply} disabled={result.method !== "text" && !confirmed}>
              Apply {fields.filter((f) => f.selected).length} value(s)
            </button>
            <button type="button" className="btn" onClick={() => (setResult(null), setFields([]), setOther([]))}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

import { monthLabel, shiftMonth } from "@/lib/format";

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="month-nav" role="group" aria-label="Month">
      <button type="button" className="btn" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">
        ‹
      </button>
      <h2 aria-live="polite">{monthLabel(month)}</h2>
      <button type="button" className="btn" onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month">
        ›
      </button>
    </div>
  );
}

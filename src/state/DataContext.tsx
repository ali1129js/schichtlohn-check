import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppData, Payslip, Settings, Shift } from "@/lib/model";
import { browserKV, loadData, saveData } from "@/lib/storage";

interface Ctx {
  data: AppData;
  loadError: { backupKey: string; reason: string } | null;
  saveError: string | null;
  setSettings: (s: Settings) => void;
  upsertShift: (s: Shift) => void;
  removeShift: (id: string) => void;
  setPayslip: (month: string, p: Payslip | null) => void;
  replaceAll: (d: AppData) => void;
}
const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const kv = useMemo(() => browserKV(), []);
  const initial = useMemo(() => loadData(kv), [kv]);
  const [data, setData] = useState<AppData>(initial.data);
  const [saveError, setSaveError] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    // do not overwrite corrupt stored data before the user changed anything
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      saveData(kv, data);
      setSaveError(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "could not save");
    }
  }, [kv, data]);

  const setSettings = useCallback((settings: Settings) => setData((d) => ({ ...d, settings })), []);
  const upsertShift = useCallback(
    (s: Shift) =>
      setData((d) => {
        const i = d.shifts.findIndex((x) => x.id === s.id);
        const shifts = i < 0 ? [...d.shifts, s] : d.shifts.map((x) => (x.id === s.id ? s : x));
        shifts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
        return { ...d, shifts };
      }),
    []
  );
  const removeShift = useCallback((id: string) => setData((d) => ({ ...d, shifts: d.shifts.filter((x) => x.id !== id) })), []);
  const setPayslip = useCallback(
    (month: string, p: Payslip | null) =>
      setData((d) => {
        const payslips = { ...d.payslips };
        if (p) payslips[month] = p;
        else delete payslips[month];
        return { ...d, payslips };
      }),
    []
  );
  const replaceAll = useCallback((d: AppData) => setData(d), []);

  const loadError = initial.ok ? null : { backupKey: initial.backupKey, reason: initial.reason };
  const value = useMemo(
    () => ({ data, loadError, saveError, setSettings, upsertShift, removeShift, setPayslip, replaceAll }),
    [data, loadError, saveError, setSettings, upsertShift, removeShift, setPayslip, replaceAll]
  );
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error("useData outside DataProvider");
  return c;
}

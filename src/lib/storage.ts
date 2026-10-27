import { AppDataSchema, emptyData, type AppData } from "./model";

export const DATA_KEY = "schichtlohn.data.v1";

export type KV = Pick<Storage, "getItem" | "setItem">;

export type LoadResult =
  | { ok: true; data: AppData }
  | { ok: false; data: AppData; backupKey: string; reason: string };

function describe(e: unknown): string {
  if (e && typeof e === "object" && "issues" in e) {
    const i = (e as { issues: { path: PropertyKey[]; message: string }[] }).issues[0];
    if (i) return `${i.path.map(String).join(".") || "(root)"}: ${i.message}`;
  }
  return e instanceof Error ? e.message : "invalid";
}

/** Load and validate. Corrupt data is copied to a backup key and never silently overwritten. */
export function loadData(kv: KV, now = Date.now()): LoadResult {
  const raw = kv.getItem(DATA_KEY);
  if (raw === null) return { ok: true, data: emptyData() };
  let reason: string;
  try {
    const parsed = AppDataSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { ok: true, data: parsed.data };
    reason = describe(parsed.error);
  } catch (e) {
    reason = e instanceof Error ? e.message : "unreadable JSON";
  }
  const backupKey = `${DATA_KEY}.backup-${now}`;
  kv.setItem(backupKey, raw);
  return { ok: false, data: emptyData(), backupKey, reason };
}

export function saveData(kv: KV, d: AppData): void {
  kv.setItem(DATA_KEY, JSON.stringify(AppDataSchema.parse(d)));
}

// ---- JSON export / import

export const EXPORT_APP = "schichtlohn-check";

export function exportJson(d: AppData, now = new Date()): string {
  return JSON.stringify({ app: EXPORT_APP, exportedAt: now.toISOString(), data: AppDataSchema.parse(d) }, null, 2);
}

export type ImportResult = { ok: true; data: AppData } | { ok: false; error: string };

/** Accepts our export envelope or a bare AppData object. Never throws. */
export function importJson(text: string): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  const candidate =
    json && typeof json === "object" && "data" in json && (json as { app?: unknown }).app === EXPORT_APP
      ? (json as { data: unknown }).data
      : json;
  const r = AppDataSchema.safeParse(candidate);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: `The file does not look like a Schichtlohn-Check backup (${describe(r.error)}).` };
}

export function memoryKV(init: Record<string, string> = {}): KV & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

export function browserKV(): KV {
  try {
    const t = "__schichtlohn_probe__";
    localStorage.setItem(t, t);
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    return memoryKV();
  }
}

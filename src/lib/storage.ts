import { AppDataSchema, defaultSettings, emptyData, SCHEMA_VERSION, type AppData } from "./model";

/** Storage key. It stays the same across app versions; the data carries its own schemaVersion. */
export const DATA_KEY = "schichtlohn.data.v1";

// ---- migrations: saved data from older app versions is upgraded, never wiped

type Json = Record<string, unknown>;
/** MIGRATIONS[n] turns schema version n into n + 1. Never drop shifts, settings or label mappings. */
export const MIGRATIONS: Record<number, (d: Json) => Json> = {
  // 1 -> 2: `version` renamed to `schemaVersion`, user label mappings added, settings that did
  // not exist yet get their defaults (the user's own values always win)
  1: ({ version: _v, ...rest }) => ({
    ...rest,
    schemaVersion: 2,
    settings: { ...defaultSettings(), ...(rest.settings && typeof rest.settings === "object" ? rest.settings : {}) },
    labelMap: rest.labelMap ?? {},
  }),
  // 2 -> 3: payslips may carry payType / abzuege / netto / auszahlung (all optional): saved
  // payslips stay as they are and are treated as hourly, as before
  2: (d) => ({ ...d, schemaVersion: 3 }),
};

export function schemaVersionOf(d: unknown): number | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Json;
  const v = o.schemaVersion ?? o.version;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

export type MigrateResult = { ok: true; data: unknown; from: number } | { ok: false; reason: string; from: number | null };

/** Bring saved JSON up to SCHEMA_VERSION. Data from a NEWER app version is not touched. */
export function migrate(d: unknown): MigrateResult {
  const from = schemaVersionOf(d);
  if (from === null) return { ok: false, reason: "no schema version", from };
  if (from > SCHEMA_VERSION) return { ok: false, reason: `saved by a newer app version (data version ${from}, this app ${SCHEMA_VERSION})`, from };
  let cur = d as Json;
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, reason: `no migration from version ${v}`, from };
    cur = step(cur);
  }
  return { ok: true, data: cur, from };
}

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
    const m = migrate(JSON.parse(raw));
    if (m.ok) {
      const parsed = AppDataSchema.safeParse(m.data);
      if (parsed.success) {
        // keep the old copy until the user has worked with the upgraded data
        const pre = `${DATA_KEY}.pre-v${SCHEMA_VERSION}`;
        if (m.from < SCHEMA_VERSION && kv.getItem(pre) === null) kv.setItem(pre, raw);
        return { ok: true, data: parsed.data };
      }
      reason = describe(parsed.error);
    } else reason = m.reason;
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
  const m = migrate(candidate);
  if (!m.ok) return { ok: false, error: `The file does not look like a Schichtlohn-Check backup (${m.reason}).` };
  const r = AppDataSchema.safeParse(m.data);
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

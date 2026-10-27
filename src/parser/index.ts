import { loadData, ProfileSchema, SynonymsSchema, type ProfileData } from "./schema";
import synonymsJson from "./synonyms.json";

/** All layout profiles: every JSON file in ./profiles is picked up automatically. */
const files = import.meta.glob("./profiles/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

export const PROFILE_DATA: ProfileData[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, data]) => loadData(ProfileSchema, data, name));

export const SYNONYMS = loadData(SynonymsSchema, synonymsJson, "synonyms.json");

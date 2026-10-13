import type { CvScanResult } from "./types";

const KEY = "hirex:cv-scan:session:v1";
type Session = { result: CvScanResult; activeTab: "pr" | "translated" };
type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readCvSession(storage: SessionStorage): Session | null {
  const raw = storage.getItem(KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    const result = saved?.result;
    const strings = ["candidateName", "prTitle", "translatedCvMarkdown"];
    const lists = ["experienceAndSkills", "educationAndCertificates", "additionalNotes", "importantPhrases", "sourceFiles"];
    if (saved.version !== 1 || !result || !strings.every(key => typeof result[key] === "string") ||
      !lists.every(key => Array.isArray(result[key]) && result[key].every((item: unknown) => typeof item === "string"))) {
      storage.removeItem(KEY);
      return null;
    }
    return { result, activeTab: saved.activeTab === "translated" ? "translated" : "pr" };
  } catch { storage.removeItem(KEY); return null; }
}

export function writeCvSession(storage: SessionStorage, session: Session | null) {
  if (session) storage.setItem(KEY, JSON.stringify({ version: 1, ...session }));
  else storage.removeItem(KEY);
}

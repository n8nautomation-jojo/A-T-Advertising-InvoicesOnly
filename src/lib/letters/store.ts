/**
 * ═══════════════════════════════════════════════════════════════
 * Official Letters Archive Store (SQLite Table + Web Storage)
 * ═══════════════════════════════════════════════════════════════
 * On native Android: persists directly to the dedicated `official_letters`
 * SQLite table via `OfficialLetterRepository` with unlimited capacity.
 * On Web/Test: falls back cleanly to browser `localStorage`.
 */

import { useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { getSetting } from "@/lib/repositories/SettingsRepository";
import {
  getAllOfficialLetters,
  upsertOfficialLetter as repoUpsertOfficialLetter,
  deleteOfficialLetter as repoDeleteOfficialLetter,
} from "@/lib/repositories/OfficialLetterRepository";
import { getStoredJsonSync, setMemoryCacheJson } from "@/lib/sqliteStorage";
import { getLocalIsoDate } from "@/lib/dateUtils";
import type { OfficialLetter } from "./types";

const LETTERS_STORAGE_KEY = "ta_official_letters_v1";
const MAX_STORED_LETTERS = 150;

function normalizeStoredLetter(item: Partial<OfficialLetter> & { id: string; subject: string }): OfficialLetter {
  return {
    id: item.id,
    reference: item.reference || "TA-001",
    language: item.language === "en" ? "en" : "ar",
    date: item.date || getLocalIsoDate(),
    showLetterTitle: item.showLetterTitle ?? Boolean(item.letterTitle && item.letterTitle.trim().length > 0),
    letterTitle: item.letterTitle || "",
    recipientHonorific: item.recipientHonorific || (item.language === "en" ? "Messrs." : "السادة /"),
    recipientName: item.recipientName || "",
    recipientTitle: item.recipientTitle || undefined,
    salutation: item.salutation || (item.language === "en" ? "Dear Sir / Madam," : "السلام عليكم ورحمة الله وبركاته،،،"),
    subject: item.subject,
    body: item.body || "",
    closingPhrase: item.closingPhrase || (item.language === "en" ? "Yours sincerely," : "وتفضلوا بقبول فائق الاحترام والتقدير،،،"),
    signatoryName: item.signatoryName || (item.language === "en" ? "Tarig Osman Ali" : "طارق عثمان علي"),
    signatoryTitle:
      item.signatoryTitle ||
      (item.language === "en"
        ? "General Manager — T.A Advertising Solution"
        : "المدير العام — T.A Advertising Solution"),
    includeSignature: item.includeSignature !== false,
    includeStamp: item.includeStamp !== false,
    includeQr: item.includeQr !== false,
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
}

function normalizeLettersArray(items: unknown): OfficialLetter[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (item): item is Partial<OfficialLetter> & { id: string; subject: string } =>
        Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.subject === "string")
    )
    .map(normalizeStoredLetter);
}

function parseLettersJson(raw: string): OfficialLetter[] {
  if (!raw || !raw.trim()) return [];
  try {
    return normalizeLettersArray(JSON.parse(raw));
  } catch {
    return [];
  }
}

function readWebRawSync(): string {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      return localStorage.getItem(LETTERS_STORAGE_KEY) || "[]";
    }
  } catch {}
  return "[]";
}

function writeWebRawSync(serialized: string): void {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
      localStorage.setItem(LETTERS_STORAGE_KEY, serialized);
    }
  } catch {}
}

function readInitialLetters(): OfficialLetter[] {
  if (Capacitor.isNativePlatform()) {
    const preloaded = getStoredJsonSync<OfficialLetter[]>(LETTERS_STORAGE_KEY, []);
    return normalizeLettersArray(preloaded);
  }
  return parseLettersJson(readWebRawSync());
}

let cachedLetters: OfficialLetter[] = readInitialLetters();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

async function hydrateLettersFromDb(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const fresh = parseLettersJson(readWebRawSync());
    cachedLetters = fresh;
    notify();
    return;
  }
  try {
    const rows = await getAllOfficialLetters();
    cachedLetters = normalizeLettersArray(rows);
    setMemoryCacheJson(LETTERS_STORAGE_KEY, cachedLetters);
    notify();
  } catch (err) {
    console.warn("[LettersStore] Failed to hydrate from official_letters table; trying legacy settings fallback:", err);
    try {
      const raw = await getSetting(LETTERS_STORAGE_KEY, "[]");
      cachedLetters = parseLettersJson(raw);
      setMemoryCacheJson(LETTERS_STORAGE_KEY, cachedLetters);
      notify();
    } catch (fallbackErr) {
      console.warn("[LettersStore] Legacy settings fallback failed:", fallbackErr);
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("native-storage-ready", () => {
    void hydrateLettersFromDb();
  });
}

function persistWebLetters(next: OfficialLetter[]): void {
  const trimmed = next.slice(0, MAX_STORED_LETTERS);
  cachedLetters = trimmed;
  writeWebRawSync(JSON.stringify(trimmed));
  notify();
}

export function getOfficialLettersSnapshot(): OfficialLetter[] {
  return cachedLetters;
}

export function useOfficialLetters(): OfficialLetter[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => cachedLetters,
    () => []
  );
}

/**
 * Generates next sequential official letter reference (e.g. TA-26-001).
 */
export function getNextLetterReference(dateStr = getLocalIsoDate()): string {
  const yearMatch = /^(\d{4})/.exec(dateStr || "");
  const yy = (yearMatch ? yearMatch[1] : String(new Date().getFullYear())).slice(-2);
  const prefix = `TA-${yy}-`;

  let maxSeq = 0;
  for (const letter of cachedLetters) {
    if (letter.reference?.startsWith(prefix)) {
      const num = Number.parseInt(letter.reference.slice(prefix.length), 10);
      if (Number.isFinite(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

export async function saveOfficialLetter(letter: OfficialLetter): Promise<OfficialLetter> {
  const nowIso = new Date().toISOString();
  const normalized: OfficialLetter = {
    ...letter,
    language: letter.language === "en" ? "en" : "ar",
    showLetterTitle: Boolean(letter.showLetterTitle && letter.letterTitle.trim()),
    reference: letter.reference.trim() || getNextLetterReference(letter.date),
    recipientName: letter.recipientName.trim(),
    recipientTitle: letter.recipientTitle?.trim() || undefined,
    letterTitle: letter.letterTitle.trim(),
    subject: letter.subject.trim(),
    body: letter.body.trim(),
    updatedAt: nowIso,
    createdAt: letter.createdAt || nowIso,
  };

  const existingIdx = cachedLetters.findIndex((item) => item.id === normalized.id);
  const next =
    existingIdx >= 0
      ? [normalized, ...cachedLetters.filter((item) => item.id !== normalized.id)]
      : [normalized, ...cachedLetters];

  if (Capacitor.isNativePlatform()) {
    await repoUpsertOfficialLetter(normalized);
    cachedLetters = next;
    setMemoryCacheJson(LETTERS_STORAGE_KEY, cachedLetters);
    notify();
    return normalized;
  }

  persistWebLetters(next);
  return normalized;
}

export async function deleteOfficialLetter(id: string): Promise<void> {
  const next = cachedLetters.filter((item) => item.id !== id);

  if (Capacitor.isNativePlatform()) {
    await repoDeleteOfficialLetter(id);
    cachedLetters = next;
    setMemoryCacheJson(LETTERS_STORAGE_KEY, cachedLetters);
    notify();
    return;
  }

  persistWebLetters(next);
}

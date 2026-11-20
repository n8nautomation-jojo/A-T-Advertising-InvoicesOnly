/**
 * ═══════════════════════════════════════════════════════════════
 * Persistence → backup hook
 * ═══════════════════════════════════════════════════════════════
 * One import for every write path. Kept separate from autoBackup.ts so a
 * repository never pulls the whole backup UI graph into its module.
 *
 * Contract: fire-and-forget. It must never throw and never await the caller.
 */

import { Capacitor } from "@capacitor/core";
import { markDataChangedInMemory } from "./settingsStore";

let scheduled = false;

/**
 * Schedules a transaction-triggered backup.
 * The actual work happens after the current tick so the SQLite write that
 * called us has been committed first.
 */
export function notifyDataChanged(): void {
  if (!Capacitor.isNativePlatform()) return;
  markDataChangedInMemory();
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    import("./autoBackup")
      .then((m) => m.triggerBackupAfterTransaction())
      .catch(() => {
        // automatic backups must never break a save
      });
  }, 0);
}

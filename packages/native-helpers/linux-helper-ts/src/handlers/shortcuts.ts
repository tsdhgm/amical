/**
 * Store the configured shortcut chords.
 *
 * On macOS/Windows the helper uses these to decide which keys to swallow. The
 * Linux helper only observes keys through evdev and cannot consume them, so
 * the chords are kept for diagnostics only; matching lives in the desktop
 * ShortcutManager.
 */

interface ShortcutConfig {
  subsetChords: number[][];
  exactChords: number[][];
}

let shortcuts: ShortcutConfig = {
  subsetChords: [],
  exactChords: [],
};

export function getShortcuts(): ShortcutConfig {
  return shortcuts;
}

export async function handleSetShortcuts(
  params: Record<string, unknown>,
): Promise<{ success: boolean }> {
  shortcuts = {
    subsetChords: (params.subsetChords as number[][]) ?? [],
    exactChords: (params.exactChords as number[][]) ?? [],
  };
  return { success: true };
}

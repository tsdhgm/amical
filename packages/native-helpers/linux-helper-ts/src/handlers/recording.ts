import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";

const execFileAsync = promisify(execFile);

let wasMutedBeforeRecording = false;
// True while the system output is muted because of a recording we started.
let mutedByRecording = false;

/**
 * Undo a recording-time mute when the helper is going away (app quit, crash,
 * kill). Without this the system output would stay muted, and the next
 * session would then take "muted" for the user's own setting and never
 * unmute. Synchronous, because it runs on the way out of the process.
 */
export function restoreSystemAudioOnExit(): void {
  if (!mutedByRecording) return;
  mutedByRecording = false;
  try {
    execFileSync("pactl", ["set-sink-mute", "@DEFAULT_SINK@", "0"], {
      timeout: 2000,
    });
  } catch {
    // Best effort
  }
}

/**
 * Resolve the resources directory.
 * In development: <project>/resources/
 * When packaged: the binary sits in bin/, resources/ is a sibling directory.
 */
function getResourcesDir(): string {
  // Built layout: dist/handlers/recording.js → ../../resources/
  const fromDist = path.join(__dirname, "..", "..", "resources");
  if (fs.existsSync(fromDist)) return fromDist;
  // Source layout: src/handlers/recording.ts → ../../resources/
  const fromSrc = path.join(__dirname, "..", "..", "resources");
  if (fs.existsSync(fromSrc)) return fromSrc;
  // Packaged layout: bin/LinuxHelper → ../resources/
  const fromBin = path.join(path.dirname(process.argv[0] || __dirname), "..", "resources");
  if (fs.existsSync(fromBin)) return fromBin;
  return fromDist;
}

/**
 * Play a sound file using the best available player.
 * Detached so it doesn't block the RPC response.
 *
 * The returned promise settles when the player exits (or after a short cap),
 * for callers that must not cut the sound off, e.g. by muting the output.
 */
function playSound(soundName: string): Promise<void> {
  const soundFile = path.join(getResourcesDir(), `${soundName}.mp3`);
  if (!fs.existsSync(soundFile)) {
    process.stderr.write(`Sound file not found: ${soundFile}\n`);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    // The cap keeps a stuck player from holding up the caller.
    const cap = setTimeout(resolve, 1000);
    const done = () => {
      clearTimeout(cap);
      resolve();
    };
    // gst-play-1.0 (GStreamer, widely available on Linux desktops)
    const child = spawn("gst-play-1.0", [soundFile], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    child.on("exit", done);
    child.on("error", () => {
      process.stderr.write(`gst-play-1.0 not available, sound skipped\n`);
      done();
    });
  });
}

async function getSinkMuteState(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("pactl", [
      "get-sink-mute",
      "@DEFAULT_SINK@",
    ]);
    return stdout.includes("yes");
  } catch {
    return false;
  }
}

export async function handleStartRecording(
  params: Record<string, unknown>,
): Promise<{ success: boolean; message?: string }> {
  const muteSystemAudio = params.muteSystemAudio === true;
  const muteSounds = params.muteSounds === true;

  try {
    const startSound = muteSounds ? Promise.resolve() : playSound("rec-start");

    // Clear clipboard to prevent stale content from being pasted
    // if the paste fires before wl-copy finishes setting new content.
    try {
      await execFileAsync("wl-copy", ["--clear"]);
      await execFileAsync("wl-copy", ["--primary", "--clear"]);
    } catch {
      // Best effort
    }

    if (muteSystemAudio) {
      wasMutedBeforeRecording = await getSinkMuteState();
      if (!wasMutedBeforeRecording) {
        // Let the start sound finish first, or the mute would silence it.
        await startSound;
        await execFileAsync("pactl", [
          "set-sink-mute",
          "@DEFAULT_SINK@",
          "1",
        ]);
        mutedByRecording = true;
      }
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}

export async function handleStopRecording(
  params: Record<string, unknown>,
): Promise<{ success: boolean; message?: string }> {
  const wasMuted = params.wasMuted === true;
  const muteSounds = params.muteSounds === true;

  try {
    if (wasMuted && !wasMutedBeforeRecording) {
      await execFileAsync("pactl", [
        "set-sink-mute",
        "@DEFAULT_SINK@",
        "0",
      ]);
      mutedByRecording = false;
    }

    if (!muteSounds) {
      void playSound("rec-stop");
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}

import * as readline from "node:readline";
import { dispatch } from "./rpc/dispatcher.js";
import { startKeyboardMonitor, stopXkbRemapWatch } from "./evdev/monitor.js";
import { restoreSystemAudioOnExit } from "./handlers/recording.js";

/**
 * Leave the process for good.
 *
 * process.exit() is not enough here: the evdev monitor keeps blocking reads
 * open on the keyboard devices in libuv's thread pool, and Node waits for
 * those threads while shutting down, so the helper would hang half-exited and
 * outlive the app as an orphan. After the cleanup, kill the process outright.
 */
function exitNow(): never {
  restoreSystemAudioOnExit();
  stopXkbRemapWatch();
  process.kill(process.pid, "SIGKILL");
  // Unreachable in practice; satisfies the type and covers a failed kill.
  process.exit(0);
}

process.stderr.write("LinuxHelper: starting\n");

// Start evdev keyboard monitoring in parallel
startKeyboardMonitor();

// Track pending dispatches so we don't exit mid-flight
let pendingCount = 0;
let stdinClosed = false;

function maybeExit(): void {
  if (stdinClosed && pendingCount === 0) {
    exitNow();
  }
}

// Read JSON-RPC requests from stdin (one JSON object per line)
const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on("line", (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const request = JSON.parse(trimmed);
    if (!request.id || !request.method) {
      process.stderr.write(`LinuxHelper: invalid request (missing id or method)\n`);
      return;
    }
    pendingCount++;
    dispatch(request)
      .catch((err) => {
        process.stderr.write(`LinuxHelper: dispatch error: ${err}\n`);
      })
      .finally(() => {
        pendingCount--;
        maybeExit();
      });
  } catch (err) {
    process.stderr.write(`LinuxHelper: JSON parse error: ${err}\n`);
  }
});

rl.on("close", () => {
  stdinClosed = true;
  maybeExit();
});

process.on("SIGTERM", () => {
  exitNow();
});

process.on("SIGINT", () => {
  exitNow();
});

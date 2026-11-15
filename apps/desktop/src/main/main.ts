import { app, protocol } from "electron";
import started from "electron-squirrel-startup";
import path from "node:path";
import { showFatalStartupDialog } from "./fatal-startup-dialog";

// E2E harness hook (see e2e/): give each test run an isolated profile. Must
// happen before ./app loads — requestSingleInstanceLock() there keys its lock
// off userData, and an isolated path keeps test instances from colliding with
// a real running Amical. sessionData is set too so Chromium caches follow.
// Unpackaged dev builds get their own profile for the same reason, so dev can
// run next to an installed Amical.
const profileDir =
  process.env.AMICAL_E2E_USER_DATA_DIR ||
  (app.isPackaged
    ? undefined
    : path.join(app.getPath("appData"), "Amical-dev"));
if (profileDir) {
  app.setPath("userData", profileDir);
  app.setPath("sessionData", profileDir);
}

// macOS activates a regular app when it launches from a terminal, which takes
// focus and switches Spaces. Unpackaged builds launch as an accessory app
// (never activated at launch), then turn regular at ready; the startup windows
// open with showInactive (see AppManager.initialize).
if (!app.isPackaged && process.platform === "darwin") {
  app.setActivationPolicy("accessory");
  app.once("ready", () => app.setActivationPolicy("regular"));
}

if (process.platform === "linux") {
  // Match the WM class to amical.desktop so the GNOME Dock shows the right
  // icon (must be set before the app is ready).
  app.commandLine.appendSwitch("class", "amical");

  // Note on the display backend: the app is meant to run through XWayland
  // (--ozone-platform=x11), not as a native Wayland client (Electron's default
  // since v38). Wayland gives clients no way to position a window or keep it
  // above others, and reports a work area that ignores the Dock, so the
  // floating widget could not sit above the Dock. The backend is fixed before
  // any JavaScript runs, so the switch cannot be set here; it comes from the
  // launcher instead: the .deb desktop entry (resources/desktop.ejs), or the
  // command line for the AppImage and `pnpm start` (see README). Relaunching
  // with the switch from here was tried and dropped: the relaunched process
  // dies in Chromium's sandbox setup under Ubuntu's AppArmor userns rules.

  // The Linux OAuth flow runs in an in-app window (see AuthService) and reads
  // the callback URL there. Registering the deep-link schemes as standard
  // makes Chromium keep the full URL (path and query). Must precede app ready.
  protocol.registerSchemesAsPrivileged(
    ["amical", "amical-dev"].map((scheme) => ({
      scheme,
      privileges: { standard: true, secure: true },
    })),
  );
}

if (started) {
  // Squirrel.Windows event hook process (--squirrel-install/-updated/
  // -obsolete/-uninstall): electron-squirrel-startup spawns the Update.exe
  // shortcut work and quits once it completes. Nothing else may run here —
  // loading the app would reach requestSingleInstanceLock(), which fires
  // second-instance in the already-running app and pops the main window
  // mid-background-update.
  app.quit();
} else {
  // The entire app lives behind this dynamic import so a module-evaluation
  // failure anywhere in its graph (broken native binding, quarantined file)
  // rejects here — where the user can still be told — instead of crashing the
  // process before any error handling exists. Keep this entry's own imports
  // minimal for the same reason. The fatal-dialog helper retains showErrorBox
  // as its pre-ready-safe fallback.
  import("./app").catch(async (error: unknown) => {
    console.error("Failed to load application", error);
    await showFatalStartupDialog(error, "module_load");
    app.exit(1);
  });
}

# Linux port: notes from re-basing onto upstream v1.13.2

Japanese version: [linux-upstream-sync-notes_ja.md](linux-upstream-sync-notes_ja.md)

In November 2026 the Linux port was moved from the earlier fork
(`tosihide/amical`, based on upstream as of 2026-04-01) onto a fresh fork of
upstream v1.13.2 (`tsdhgm/amical`, branch `develop_ubuntu`). Upstream had moved
458 commits in between. This file records what broke, why, and what to check
the next time upstream is merged.

## Summary

The assumption going in was that the port lived on its own branch and could be
carried over almost unchanged. That held for the files the port **added**
(native helper, docs, packaging config). It did not hold for the Linux
branches the port had **inserted into upstream files**: upstream had rewritten
most of those files, so the insertions had to be re-implemented, and new
upstream code had appeared that never considered Linux at all.

Of the problems found during testing, most came from upstream changes, one
was a plain porting omission, and two were latent weaknesses in the Linux
helper that the old build happened not to trigger.

## Problems caused by upstream changes

| Symptom | Cause | Fix |
| --- | --- | --- |
| App failed at startup with `systemPreferences.getMediaAccessStatus is not a function` | New upstream onboarding code calls macOS/Windows-only permission APIs | Guard those calls on Linux (`onboarding-service.ts`, `trpc/routers/onboarding.ts`) |
| Recording widget never appeared above the Dock | Electron went from 38 to 44 and now runs as a native Wayland client by default. Wayland clients cannot position their own windows or keep them on top, and the reported work area ignores the Dock | Run through XWayland (`--ozone-platform=x11`). Packaged builds relaunch themselves with the switch (`main/main.ts`); for `pnpm start` pass it on the command line |
| Dictation returned empty text | Upstream turned off `autoGainControl` for microphone capture. With a low input volume the audio is too quiet for voice detection | Not changed in code. Raise the microphone input volume |
| Sign-in window was empty and "vibrated" | OAuth endpoints no longer have defaults in code, so without `apps/desktop/.env` every value was empty | Create `.env` (see below). The auth window now fails before it is created when the configuration is missing |
| Cloud transcription failed with `NETWORK_ERROR` | `API_ENDPOINT` also has no default any more, and the old host is gone | Set `API_ENDPOINT=https://dictation.amical.ai` |
| Merge conflicts in auth, service start-up and recording code | `AuthService` is now Effect-based, `ServiceManager` builds a service graph, and `recording-manager.ts` was replaced by `main/lifecycle/` | Linux auth window re-implemented in `auth-service.ts`; Linux paste path moved to `main/lifecycle/live.ts`; native bridge enabled for Linux in `main/runtime/layers.ts` |
| Helper protocol mismatch | `setShortcuts` now takes `subsetChords` / `exactChords`, and new RPC methods were added | Helper accepts the new shape and answers the methods it cannot implement with the protocol's "nothing happened" result (`handlers/unsupported.ts`) |
| Shortcut defaults and key labels wrong on Linux | Shortcuts are now lists of chords, a `draftMode` shortcut exists, and the key-legend code only knew macOS and Windows | Linux defaults updated in `db/app-settings.ts`; Linux branch added in `utils/keycode-map.ts` |
| Tests failed only when run on a Linux host | Tests assumed the host was not Linux once Linux branches existed | Tests pin the platform through the mockable `utils/platform` helpers |

## Porting omission

**Paste did nothing.** The released `.deb` (v1.1.0-linux.8) had been built from
`ubuntu-26.04-lts`, which is seven commits ahead of `develop_ubuntu`. Only
`develop_ubuntu` was merged at first, so the ydotool 1.x fix was missing:
ydotool 1.0.4 treats `shift+Insert` as a delay and exits 0, so no key was sent
and the call still reported success. Merging `ubuntu-26.04-lts` fixed it.

Lesson: before porting, compare every branch of the old repository against the
one being merged (`git log --oneline A..B`) and confirm which branch the
released build came from.

## Latent weaknesses in the Linux helper

- **Start sound not heard.** The helper started the sound player and muted the
  system output right after, before the player had produced any sound. The
  helper now waits for the start sound to finish before muting.
- **System output left muted.** Recording mutes the default sink. If the app
  or helper was killed mid-recording, the sink stayed muted, and later
  sessions took that for the user's own setting and never unmuted. The helper
  now unmutes on exit. `SIGKILL` cannot be covered; recover with
  `pactl set-sink-mute @DEFAULT_SINK@ 0`.

## Deliberately not carried over

- Deferring the recording services until after onboarding on Linux. It does
  not map onto upstream's service graph, and sign-in during onboarding was
  tested and works without it.
- Reporting modifier keys as `flagsChanged`. The helper now sends plain
  `keyDown` / `keyUp`, so `shortcut-manager.ts` stays identical to upstream.

## Local configuration (`apps/desktop/.env`)

`.env` is not committed. Both `pnpm start` and `pnpm make:linux` read it; the
packaged app has the values compiled in.

```bash
AUTH_CLIENT_ID=<oauth client id>
AUTHORIZATION_ENDPOINT=https://core.amical.ai/api/auth/oauth2/authorize
AUTH_LOGIN_URL=https://login.amical.ai/auth/sign-in
AUTH_TOKEN_ENDPOINT=https://core.amical.ai/api/auth/oauth2/token
AUTH_REDIRECT_URI=amical://oauth/callback
API_ENDPOINT=https://dictation.amical.ai
# Inferred from the auth endpoints; not confirmed against upstream.
CORE_API_URL=https://core.amical.ai
TELEMETRY_ENABLED=false
```

## Installing dependencies

- `ONNXRUNTIME_NODE_INSTALL=skip pnpm install --frozen-lockfile` — the
  variable skips onnxruntime's optional CUDA download, which fails on Linux.
- Adding or updating a dependency needs
  `--config.blockExoticSubdeps=false`: pnpm 11 rejects the git-hosted
  `@electron/node-gyp` that Electron Forge depends on as soon as the lockfile
  has to be re-resolved (it is already in upstream's lockfile).

## Checklist for the next upstream merge

1. Keep `main` identical to upstream and merge it into `develop_ubuntu` often.
   The cost of this port came from seven months of drift, not from any one
   change.
2. After merging, search upstream's new code for platform branches that only
   know macOS and Windows: `isWindows()`, `process.platform === "win32"`,
   `WINDOWS_` constants used as the fallback, and `systemPreferences.` calls.
3. Compare `packages/types/src/schemas` with the Linux helper's dispatcher
   (`linux-helper-ts/src/rpc/dispatcher.ts`) for new or changed RPC methods.
4. Check the Electron version. A major bump can change the display backend,
   clipboard API (async since Electron 44) and window behaviour.
5. Run `pnpm type:check` and `pnpm test` on Linux, then test by hand:
   start-up, sign-in, shortcut, start/stop sounds, widget position,
   transcription, and paste into another window.
6. Stop the app from its tray menu while testing. Killing it mid-recording is
   what left the system output muted.

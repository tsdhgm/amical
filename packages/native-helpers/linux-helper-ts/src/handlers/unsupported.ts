/**
 * RPC methods the desktop app calls on every platform but that the Linux
 * helper cannot implement yet. Each answers with the protocol's own "nothing
 * happened" result so the desktop degrades gracefully instead of logging
 * "Method not found" errors.
 */

// evdev is read-only: the helper cannot swallow Enter for the Draft review
// window, so Enter also reaches the focused app.
export async function handleSetDraftEnterCapture(): Promise<{
  success: boolean;
}> {
  return { success: false };
}

// Windows-only concept (LLKHF_INJECTED); accepted as a no-op like on macOS.
export async function handleSetAllowInjectedKeys(): Promise<{
  success: boolean;
}> {
  return { success: true };
}

export async function handleGetSelectedTextViaCopy(): Promise<{
  selectedText: string | null;
  clipboardChanged: boolean;
  message?: string;
}> {
  return {
    selectedText: null,
    clipboardChanged: false,
    message: "Not supported on Linux",
  };
}

export async function handleStartEditWatch(): Promise<{
  watchId: string | null;
  startStatus: string;
}> {
  return { watchId: null, startStatus: "no_element" };
}

export async function handleReadEditWatch(): Promise<{
  readStatus: string;
  text: string | null;
  selection: null;
  readMs: number;
}> {
  return {
    readStatus: "unknown_watch",
    text: null,
    selection: null,
    readMs: 0,
  };
}

export async function handleStopEditWatch(): Promise<{ stopped: boolean }> {
  return { stopped: false };
}

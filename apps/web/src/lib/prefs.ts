// UI preferences persisted to localStorage and applied to <html>.
// fontScale drives the root font-size (all Tailwind rem-based sizes scale with it).
// wideMode is read by Layout to drop the max-width on the main content column.
import { useSyncExternalStore } from 'react';

export type FontScale = 'sm' | 'md' | 'lg' | 'xl';

const FONT_PX: Record<FontScale, string> = {
  sm: '14px',
  md: '16px',
  lg: '18px',
  xl: '20px',
};
const FONT_KEY = 'darrow:fontScale';
const WIDE_KEY = 'darrow:wideMode';
const EVENT = 'darrow-prefs-change';

// useSyncExternalStore compares snapshots by reference — return the same
// object until something actually changes, otherwise React loops.
let cached: { fontScale: FontScale; wideMode: boolean } = { fontScale: 'md', wideMode: false };
function read(): { fontScale: FontScale; wideMode: boolean } {
  const raw = (localStorage.getItem(FONT_KEY) as FontScale | null) ?? 'md';
  const fontScale: FontScale = FONT_PX[raw] ? raw : 'md';
  const wideMode = localStorage.getItem(WIDE_KEY) === '1';
  if (cached.fontScale !== fontScale || cached.wideMode !== wideMode) {
    cached = { fontScale, wideMode };
  }
  return cached;
}

function apply(): void {
  const { fontScale, wideMode } = read();
  document.documentElement.style.fontSize = FONT_PX[fontScale];
  document.documentElement.dataset.wide = wideMode ? 'true' : 'false';
}

export function setFontScale(s: FontScale): void {
  localStorage.setItem(FONT_KEY, s);
  apply();
  window.dispatchEvent(new Event(EVENT));
}
export function setWideMode(w: boolean): void {
  localStorage.setItem(WIDE_KEY, w ? '1' : '0');
  apply();
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb); // sync across tabs
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function usePrefs(): { fontScale: FontScale; wideMode: boolean } {
  return useSyncExternalStore(subscribe, read, read);
}

// Apply once at module load so the page paints with the saved settings.
if (typeof window !== 'undefined') apply();

import type { SessionResponse } from '@printbox/shared';
import { describe, expect, it } from 'vitest';
import { fitWithin, jpegName } from './photo';
import { clearSession, loadSession, saveSession, type SessionStorageLike } from './session-store';

function memory(): SessionStorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const now = Date.parse('2026-10-16T10:00:00Z');
const session = (expiresAt: string): SessionResponse => ({
  sessionId: 's1',
  sessionToken: 'token-123456789',
  expiresAt,
  kiosk: { id: 'k1', name: 'Borne', supportsColor: true, supportsDuplex: true },
});

describe('session store', () => {
  it('resumes a saved session of the same kiosk only', () => {
    const storage = memory();
    saveSession(storage, 'k1', { session: session('2026-10-16T10:20:00Z'), jobId: 'j1' });
    expect(loadSession(storage, 'k1', now)).toMatchObject({
      jobId: 'j1',
      session: { sessionId: 's1' },
    });
    expect(loadSession(storage, 'k2', now)).toBeNull();
  });

  it('ignores a session about to expire, corrupt data and cleared sessions', () => {
    const storage = memory();
    saveSession(storage, 'k1', { session: session('2026-10-16T10:00:30Z'), jobId: null });
    expect(loadSession(storage, 'k1', now)).toBeNull();
    storage.setItem('printbox.session.k1', '{not json');
    expect(loadSession(storage, 'k1', now)).toBeNull();
    saveSession(storage, 'k1', { session: session('2026-10-16T10:20:00Z'), jobId: null });
    clearSession(storage, 'k1');
    expect(loadSession(storage, 'k1', now)).toBeNull();
  });

  it('works without storage', () => {
    expect(loadSession(null, 'k1', now)).toBeNull();
    expect(() =>
      saveSession(null, 'k1', { session: session('2026-10-16T10:20:00Z'), jobId: null }),
    ).not.toThrow();
  });
});

describe('photo resizing', () => {
  it('fits the long side within 2480 px, keeping the ratio, never upscaling', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2480, height: 1860 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1860, height: 2480 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('renames to .jpg', () => {
    expect(jpegName('IMG_0042.PNG')).toBe('IMG_0042.jpg');
    expect(jpegName('scan')).toBe('scan.jpg');
  });
});

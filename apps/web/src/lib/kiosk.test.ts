import { describe, expect, it } from 'vitest';
import {
  coinProgress,
  type KeyStorage,
  msUntilNextReload,
  resolveDisplayKey,
  secondsLeft,
} from './kiosk';

function memoryStorage(
  initial: Record<string, string> = {},
): KeyStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('resolveDisplayKey', () => {
  it('takes the key from the URL fragment, stores it and asks to strip the fragment', () => {
    const storage = memoryStorage();
    expect(resolveDisplayKey('k1', '#key=pbd_abc', storage)).toEqual({
      key: 'pbd_abc',
      stripHash: true,
    });
    expect(storage.data['printbox.kiosk-key.k1']).toBe('pbd_abc');
  });

  it('falls back to the stored key on the next start', () => {
    const storage = memoryStorage({ 'printbox.kiosk-key.k1': 'pbd_abc' });
    expect(resolveDisplayKey('k1', '', storage)).toEqual({ key: 'pbd_abc', stripHash: false });
    expect(resolveDisplayKey('k2', '', storage)).toEqual({ key: null, stripHash: false });
  });

  it('ignores anything that is not a display key (agent key, junk)', () => {
    expect(resolveDisplayKey('k1', '#key=pbk_agent', memoryStorage()).key).toBeNull();
    expect(resolveDisplayKey('k1', '#other=1', null).key).toBeNull();
  });

  it('survives a storage that throws (private mode)', () => {
    const throwing: KeyStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(resolveDisplayKey('k1', '#key=pbd_x', throwing).key).toBe('pbd_x');
    expect(resolveDisplayKey('k1', '', throwing).key).toBeNull();
  });
});

describe('coin payment display', () => {
  it('computes what is left to insert', () => {
    const payment = {
      codeHint: '•••123',
      amountDueMillimes: 700,
      receivedMillimes: 500,
      expiresAt: '',
    };
    expect(coinProgress(payment)).toEqual({ remainingMillimes: 200, percent: 71 });
    expect(coinProgress({ ...payment, receivedMillimes: 900 })).toEqual({
      remainingMillimes: 0,
      percent: 100,
    });
  });

  it('counts seconds left, never below zero', () => {
    const now = Date.parse('2026-10-16T10:00:00Z');
    expect(secondsLeft('2026-10-16T10:01:30Z', now)).toBe(90);
    expect(secondsLeft('2026-10-16T09:59:00Z', now)).toBe(0);
  });
});

describe('msUntilNextReload', () => {
  it('targets the next 04:00 local time', () => {
    expect(msUntilNextReload(new Date(2026, 9, 16, 3, 0, 0))).toBe(60 * 60_000);
    expect(msUntilNextReload(new Date(2026, 9, 16, 5, 0, 0))).toBe(23 * 60 * 60_000);
  });
});

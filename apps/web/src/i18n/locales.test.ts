import { describe, expect, it } from 'vitest';
import { isRtl, pickLocale } from './locales';

describe('pickLocale', () => {
  it('prefers the language chosen with the switcher', () => {
    expect(pickLocale('ar', 'fr-FR,fr;q=0.9')).toBe('ar');
  });

  it('follows the browser languages by preference', () => {
    expect(pickLocale(undefined, 'ar-TN,ar;q=0.9,fr;q=0.8')).toBe('ar');
    expect(pickLocale(undefined, 'de-DE,en;q=0.7,fr;q=0.8')).toBe('fr');
    expect(pickLocale(undefined, 'en-US')).toBe('en');
  });

  it('falls back to French', () => {
    expect(pickLocale(undefined, null)).toBe('fr');
    expect(pickLocale('xx', 'de,it;q=0.5')).toBe('fr');
  });

  it('marks Arabic as right-to-left', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('fr')).toBe(false);
  });
});

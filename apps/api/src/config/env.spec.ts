import { describe, expect, it } from 'vitest';
import { validateEnv } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://printbox:printbox@localhost:5432/printbox',
  PUBLIC_WEB_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000, http://192.168.1.10:3000',
  QR_TOKEN_SECRET: 'x'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'printbox',
  S3_ACCESS_KEY_ID: 'minio',
  S3_SECRET_ACCESS_KEY: 'miniosecret',
};

describe('validateEnv', () => {
  it('applies defaults and parses typed values', () => {
    const env = validateEnv({ ...validEnv, PORT: '4000', S3_FORCE_PATH_STYLE: 'false' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://192.168.1.10:3000']);
  });

  it('rejects a missing required variable', () => {
    const { DATABASE_URL: _omitted, ...rest } = validEnv;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects a short QR secret', () => {
    expect(() => validateEnv({ ...validEnv, QR_TOKEN_SECRET: 'short' })).toThrow(/QR_TOKEN_SECRET/);
  });

  it('rejects placeholder secrets in production only', () => {
    const placeholder = { ...validEnv, QR_TOKEN_SECRET: `change-me-${'x'.repeat(32)}` };
    expect(() => validateEnv(placeholder)).not.toThrow();
    expect(() => validateEnv({ ...placeholder, NODE_ENV: 'production' })).toThrow(/placeholder/);
  });
});

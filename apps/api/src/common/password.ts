import { argon2id, hash, verify } from 'argon2';

/** OWASP minimum recommendation for argon2id (19 MiB, 2 iterations, 1 lane). */
const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

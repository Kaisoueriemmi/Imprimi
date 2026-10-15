/** Public URL of the PrintBox API (inlined at build time by Next.js). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(
  /[/]+$/,
  '',
);

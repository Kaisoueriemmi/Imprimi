import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentConfigError, loadAgentConfig, parseAgentConfig } from './config';

const valid = {
  apiUrl: 'http://localhost:3001',
  kioskId: 'demo-kiosk',
  apiKey: 'pbk_secret',
  printerName: 'HP LaserJet',
};

describe('agent config', () => {
  it('accepts a minimal config and applies safe defaults', () => {
    expect(parseAgentConfig(valid)).toMatchObject({
      ...valid,
      printer: 'windows',
      dataDir: 'data',
      logLevel: 'info',
      coinDevice: { driver: 'none', simulatorPort: 7575 },
    });
  });

  it('lists invalid fields without echoing the key', () => {
    const bad = { ...valid, apiUrl: 'not a url', apiKey: 'wrong-secret' };
    expect(() => parseAgentConfig(bad)).toThrow(AgentConfigError);
    try {
      parseAgentConfig(bad);
    } catch (error) {
      expect((error as Error).message).toMatch(/apiUrl/);
      expect((error as Error).message).not.toContain('wrong-secret');
    }
  });

  it('loads a file saved with a UTF-8 BOM and resolves dataDir next to it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'printbox-agent-'));
    const file = join(dir, 'agent.config.json');
    await writeFile(file, String.fromCharCode(0xfeff) + JSON.stringify(valid), 'utf8');
    const config = await loadAgentConfig(file);
    expect(config.kioskId).toBe('demo-kiosk');
    expect(config.dataDir).toBe(join(dir, 'data'));
  });
});

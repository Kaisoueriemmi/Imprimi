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
  it('accepts a valid config', () => {
    expect(parseAgentConfig(valid)).toEqual(valid);
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

  it('loads a file saved with a UTF-8 BOM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'printbox-agent-'));
    const file = join(dir, 'agent.config.json');
    await writeFile(file, `\uFEFF${JSON.stringify(valid)}`, 'utf8');
    await expect(loadAgentConfig(file)).resolves.toEqual(valid);
  });
});

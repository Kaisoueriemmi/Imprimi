import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeDocxSkeleton, makeImage, makePdf, makeZip } from '../../testing/fixtures';
import { detectFileType } from './file-type';

let dir: string;
let counter = 0;

async function detect(content: Buffer): Promise<string | null> {
  // Deliberately misleading extension: only the content may matter.
  const path = join(dir, `file-${counter++}.pdf`);
  await writeFile(path, content);
  return detectFileType(path);
}

describe('detectFileType (magic bytes)', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'printbox-filetype-'));
  });

  it('recognises a PDF, even with leading junk', async () => {
    expect(await detect(await makePdf(1))).toBe('application/pdf');
    const junk = Buffer.alloc(100, 0x20);
    expect(await detect(Buffer.concat([junk, await makePdf(1)]))).toBe('application/pdf');
  });

  it('recognises JPEG and PNG', async () => {
    const size = { width: 10, height: 10 };
    expect(await detect(await makeImage('jpeg', size))).toBe('image/jpeg');
    expect(await detect(await makeImage('png', size))).toBe('image/png');
  });

  it('recognises a DOCX by its ZIP entries', async () => {
    expect(await detect(await makeDocxSkeleton())).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('rejects other ZIP files (xlsx, archives)', async () => {
    const xlsx = await makeZip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<w/>' });
    expect(await detect(xlsx)).toBeNull();
  });

  it('rejects text and executables named .pdf', async () => {
    expect(await detect(Buffer.from('hello, not a pdf'))).toBeNull();
    expect(await detect(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
    expect(await detect(Buffer.alloc(0))).toBeNull();
  });
});

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { buildTestPdf } from '../test-pdf';
import { AGENT_VERSION } from '../version';
import { parseJsonList } from './powershell';
import { isBlockingJobStatus, isFinishedJobStatus, toPrinterState } from './printer-state';
import { buildPrintSettings } from './sumatra-settings';

describe('buildPrintSettings (SumatraPDF -print-settings)', () => {
  it('builds <pages>,<copies>x,duplex,colour', () => {
    expect(
      buildPrintSettings({ pageRange: '1-3,5', copies: 2, duplex: true, colorMode: 'BW' }),
    ).toBe('1-3,5,2x,duplexlong,monochrome');
    expect(
      buildPrintSettings({ pageRange: null, copies: 1, duplex: false, colorMode: 'COLOR' }),
    ).toBe('1x,simplex,color');
  });

  it('refuses anything that is not a plain page range', () => {
    for (const pageRange of ['1-3 & del', '1;2', '"1"', 'odd']) {
      expect(() =>
        buildPrintSettings({ pageRange, copies: 1, duplex: false, colorMode: 'BW' }),
      ).toThrow(RangeError);
    }
    expect(() =>
      buildPrintSettings({ pageRange: null, copies: 0, duplex: false, colorMode: 'BW' }),
    ).toThrow(RangeError);
  });
});

describe('printer state from Get-Printer', () => {
  it('maps a healthy printer', () => {
    expect(
      toPrinterState({ Name: 'HP', Status: 'Normal', JobCount: 2, Offline: false }, 'HP'),
    ).toEqual({
      name: 'HP',
      online: true,
      status: 'Normal',
      queuedJobs: 2,
      paperLevel: 'OK',
    });
  });

  it('derives paper and offline hints', () => {
    expect(
      toPrinterState({ Name: 'HP', Status: 'PaperOut', JobCount: 0, Offline: false }, 'HP'),
    ).toMatchObject({
      online: true,
      paperLevel: 'EMPTY',
    });
    expect(
      toPrinterState({ Name: 'HP', Status: 'Normal', JobCount: 0, Offline: true }, 'HP').online,
    ).toBe(false);
    expect(toPrinterState(undefined, 'Missing')).toMatchObject({
      online: false,
      status: 'NotFound',
    });
  });

  it('classifies spooler job states', () => {
    expect(isBlockingJobStatus('Error, Printing')).toBe(true);
    expect(isBlockingJobStatus('PaperOut')).toBe(true);
    expect(isBlockingJobStatus('Spooling, Printing')).toBe(false);
    expect(isFinishedJobStatus('Printed, Retained')).toBe(true);
  });

  it('parses ConvertTo-Json output for zero, one or many items', () => {
    expect(parseJsonList('')).toEqual([]);
    expect(parseJsonList('{"Id":1}')).toEqual([{ Id: 1 }]);
    expect(parseJsonList('[{"Id":1},{"Id":2}]')).toHaveLength(2);
  });
});

describe('test page', () => {
  it('is a valid one-page A4 PDF', async () => {
    const pdf = await PDFDocument.load(buildTestPdf(['PrintBox - page de test', 'Borne : (x)']));
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
  });
});

describe('version', () => {
  it('matches package.json', () => {
    expect(AGENT_VERSION).toBe(packageJson.version);
  });
});

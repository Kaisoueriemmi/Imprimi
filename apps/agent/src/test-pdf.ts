const NL = String.fromCharCode(10);

/** Keeps characters that are safe inside a PDF string literal with the standard font. */
function pdfText(value: string): string {
  let safe = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    const forbidden = char === '(' || char === ')' || code === 92;
    if (code >= 32 && code < 127 && !forbidden) safe += char;
  }
  return safe;
}

/**
 * One-page A4 test PDF (Helvetica text in a frame), built by hand so the agent needs no PDF
 * library. Used by `printbox-agent test-print`.
 */
export function buildTestPdf(lines: readonly string[]): Buffer {
  const text = lines
    .map((line, index) => `${index === 0 ? '' : '0 -26 Td '}(${pdfText(line)}) Tj`)
    .join(NL);
  const content = ['2 w 36 36 523 770 re S', 'BT', '/F1 18 Tf', '72 760 Td', text, 'ET'].join(NL);

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>${NL}stream${NL}${content}${NL}endstream`,
  ];

  let pdf = `%PDF-1.4${NL}`;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj${NL}${body}${NL}endobj${NL}`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref${NL}0 ${objects.length + 1}${NL}0000000000 65535 f ${NL}`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n ${NL}`;
  pdf += `trailer${NL}<< /Size ${objects.length + 1} /Root 1 0 R >>${NL}startxref${NL}${xrefOffset}${NL}%%EOF${NL}`;
  return Buffer.from(pdf, 'latin1');
}

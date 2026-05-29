// Phase 10: image-to-pdf core. Asserts an image buffer becomes a valid 1-page PDF.
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { imageBufferToPdf } from './image-to-pdf.js';

describe('imageBufferToPdf', () => {
  it('embeds a JPEG into a single-page PDF', async () => {
    const jpg = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
    const out = await imageBufferToPdf(jpg);
    expect(Buffer.from(out.subarray(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
  });

  it('handles PNG and produces a non-trivial PDF', async () => {
    const png = await sharp({ create: { width: 100, height: 700, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    const out = await imageBufferToPdf(png);
    expect(out.length).toBeGreaterThan(500);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});

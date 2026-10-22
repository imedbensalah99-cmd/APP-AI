import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { resolveApplicationChannel, channelForJob } from './applicationChannel';
import { assertOriginalPdf, fitLines } from './originalCvPdf';

describe('Verified application channels', () => {
  const url='https://example.org/careers/123';
  it('shows website-only when no actual recruitment email appears', () => {
    const result=resolveApplicationChannel('Apply through the website. Company contact is info@example.org.',url);
    expect(result).toEqual({kind:'website_only',sourceUrl:url,verified:false,evidence:'job_ad'});
  });
  it('recognizes an email mentioned as the application destination without falsely calling it official', () => {
    const result=resolveApplicationChannel('To apply, please send your CV to recruitment@acme-corp.qa',url);
    expect(result.kind).toBe('email_candidate');
    if (result.kind==='email_candidate') {
      expect(result.email).toBe('recruitment@acme-corp.qa');
      expect(result.verified).toBe(false);
      expect(result.sourceUrl).toBe(url);
    }
  });
  it('does not treat privacy / support mail or unrelated email as an HR destination', () => {
    expect(resolveApplicationChannel('Questions? support@another-company.com',url).kind).toBe('website_only');
    expect(resolveApplicationChannel('Job opportunity. Updated by Jane at jane@personal.net.',url).kind).toBe('website_only');
  });
  it('derives channel for existing older saved jobs without metadata', () => {
    expect(channelForJob({description:'Apply at jobs@company.qa',sourceUrl:url}).kind).toBe('email_candidate');
  });
});
describe('Keep original user PDF layout safe', () => {
  it('refuses to edit an unrecognized uploaded PDF instead of overwriting unknown coordinates', async () => {
    await expect(assertOriginalPdf(new Uint8Array([0x25,0x50,0x44,0x46]))).rejects.toThrow();
  });
  it('wraps fitted CV skills at a maximum number of lines', async () => {
    const doc=await PDFDocument.create();
    const font=await doc.embedFont(StandardFonts.Helvetica);
    const lines=fitLines('Transaction monitoring, Know Your Customer and sanctions screening',font,125,10,2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[0].length).toBeGreaterThan(0);
  });
});

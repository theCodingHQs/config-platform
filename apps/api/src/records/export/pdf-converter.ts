export interface PdfConverter {
  convert(input: { html?: string; buffer?: Buffer }): Promise<Buffer>;
}

export type PdfLayoutConverterType = 'none' | 'libreoffice';

export class UnsupportedPdfConverter implements PdfConverter {
  async convert(): Promise<Buffer> {
    const error = new Error('PDF export is not enabled yet');
    (error as any).statusCode = 501;
    throw error;
  }
}

export function getPdfConverter(): PdfConverter {
  const config = (process.env.PDF_LAYOUT_CONVERTER || 'none').toLowerCase() as PdfLayoutConverterType;
  if (config === 'libreoffice') {
    // Layout mode placeholder ready to plug in libreoffice converter
    return new UnsupportedPdfConverter();
  }
  return new UnsupportedPdfConverter();
}

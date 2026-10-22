/**
 * Builds a report's Excel file in memory (for an email attachment) by running the normal export
 * against a stand-in for the HTTP reply, so emailed reports are exactly what a download gives.
 */
import { PassThrough } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { exportService, type ExportRecordsParams } from '../records/export/export-service.js';

export interface ReportFile {
  filename: string;
  content: Buffer;
  contentType: string;
}

function filenameFrom(disposition: string | undefined, fallback: string): string {
  if (!disposition) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // fall through to the plain name
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1] || fallback;
}

export async function renderReportFile(params: ExportRecordsParams): Promise<ReportFile> {
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let sent: Buffer | null = null;

  const raw = new PassThrough();
  raw.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const finished = new Promise<void>((resolve, reject) => {
    raw.on('end', resolve);
    raw.on('error', reject);
  });
  (raw as any).writeHead = (_status: number, h: Record<string, string>) => {
    for (const [k, v] of Object.entries(h || {})) headers[k.toLowerCase()] = String(v);
    return raw;
  };

  const reply = {
    raw,
    hijack() {
      return reply;
    },
    header(name: string, value: string) {
      headers[name.toLowerCase()] = String(value);
      return reply;
    },
    status() {
      return reply;
    },
    send(body: Buffer | string) {
      sent = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      return reply;
    },
  } as unknown as FastifyReply;

  await exportService.streamExport(params, reply);

  let content: Buffer;
  if (sent) {
    content = sent;
  } else {
    if (!raw.writableEnded) raw.end();
    await finished;
    content = Buffer.concat(chunks);
  }

  const extension = params.format === 'csv' ? 'csv' : 'xlsx';
  return {
    filename: filenameFrom(headers['content-disposition'], `report.${extension}`),
    content,
    contentType:
      headers['content-type'] ||
      (extension === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  };
}

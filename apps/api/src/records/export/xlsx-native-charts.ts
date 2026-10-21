import JSZip from 'jszip';
import {
  type GridChartDefinition,
  type ChartRenderData,
  resolveChartColor,
} from '@config-platform/schema';
import { parseA1Range, indexToColLetter } from './chart-range-helper.js';

/**
 * Native (editable, live) Excel charts for range-sourced grid charts.
 *
 * ExcelJS cannot author charts, so after it writes the workbook we inject DrawingML chart parts:
 * xl/charts/chartN.xml, a drawing per worksheet (or the existing ExcelJS image drawing), and the
 * relationships + content types that tie them together. Series reference the source cells
 * ('Sheet'!$C$30:$AG$30), so a chart updates in Excel when the cells it reads (or the checkboxes
 * feeding their formulas) change. The cached point values come from the server's formula pass so
 * the chart also renders correctly before Excel recalculates.
 */

export interface NativeChartSpec {
  chart: GridChartDefinition & { source: Extract<GridChartDefinition['source'], { kind: 'range' }> };
  /** Worksheet the chart is drawn on (anchor sheet). */
  sheetName: string;
  /** Worksheet the series/category ranges read from. */
  sourceSheetName: string;
  /** Computed values used for the chart caches. */
  data: ChartRenderData;
}

const NS_MAIN = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_SHEET_DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_TYPE_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const REL_TYPE_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
const CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml';

const AXIS_CAT_ID = 500001;
const AXIS_VAL_ID = 500002;

function escapeXml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** "C30:AG30" on sheet "Production Tracker" → "'Production Tracker'!$C$30:$AG$30" */
export function toAbsoluteSheetRef(sheetName: string, rangeA1: string): string | null {
  const parsed = parseA1Range(rangeA1);
  if (!parsed) return null;
  const sheet = `'${(parsed.sheetName || sheetName).replace(/'/g, "''")}'`;
  const start = `$${indexToColLetter(parsed.startCol)}$${parsed.startRow + 1}`;
  const end = `$${indexToColLetter(parsed.endCol)}$${parsed.endRow + 1}`;
  return start === end ? `${sheet}!${start}` : `${sheet}!${start}:${end}`;
}

function hex(color: string): string {
  return color.replace(/^#/, '').slice(0, 6).toUpperCase();
}

function solidFill(color: string, alpha?: number): string {
  const alphaXml = alpha !== undefined ? `<a:alpha val="${Math.round(alpha * 100000)}"/>` : '';
  return `<a:solidFill><a:srgbClr val="${hex(color)}">${alphaXml}</a:srgbClr></a:solidFill>`;
}

function textProps(size: number, color: string, bold = false): string {
  return `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size * 100}" b="${bold ? 1 : 0}">${solidFill(color)}</a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
}

function richTitle(text: string, size: number, color: string): string {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size * 100}" b="1">${solidFill(color)}</a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="${size * 100}" b="1">${solidFill(color)}</a:rPr><a:t>${escapeXml(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function strRef(ref: string, values: string[]): string {
  const pts = values.map((v, i) => `<c:pt idx="${i}"><c:v>${escapeXml(v)}</c:v></c:pt>`).join('');
  return `<c:strRef><c:f>${escapeXml(ref)}</c:f><c:strCache><c:ptCount val="${values.length}"/>${pts}</c:strCache></c:strRef>`;
}

function numRef(ref: string, values: (number | null)[]): string {
  const pts = values
    .map((v, i) => (v === null || !isFinite(v) ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`))
    .join('');
  return `<c:numRef><c:f>${escapeXml(ref)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache></c:numRef>`;
}

type SeriesKind = 'bar' | 'line' | 'area';

function seriesKindFor(chart: GridChartDefinition, seriesType?: SeriesKind): SeriesKind {
  if (chart.type === 'line') return chart.options?.area ? 'area' : 'line';
  if (chart.type === 'area') return 'area';
  if (chart.type === 'combo') return seriesType || 'bar';
  return 'bar';
}

/** Builds the c:chartSpace XML for one chart. Returns null when no series range resolves. */
export function buildChartXml(spec: NativeChartSpec): string | null {
  const { chart, sourceSheetName, data } = spec;
  const categoryRef = chart.source.categoryRange ? toAbsoluteSheetRef(sourceSheetName, chart.source.categoryRange) : null;
  const catXml = categoryRef ? `<c:cat>${strRef(categoryRef, data.categories)}</c:cat>` : '';

  const series = chart.source.series
    .map((s, idx) => {
      const ref = toAbsoluteSheetRef(sourceSheetName, s.range);
      if (!ref) return null;
      return {
        idx,
        name: s.name || `Series ${idx + 1}`,
        ref,
        color: resolveChartColor(s.color, idx),
        kind: seriesKindFor(chart, s.type),
        values: data.series[idx]?.data ?? [],
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  if (series.length === 0) return null;

  const isPie = chart.type === 'pie' || chart.type === 'donut';
  const showLegend = chart.options?.legend !== false;
  let plotXml: string;

  if (isPie) {
    const s = series[0];
    const pointCount = Math.max(data.categories.length, s.values.length);
    const points = Array.from({ length: pointCount }, (_, i) => {
      const color = resolveChartColor(chart.options?.sliceColors?.[i], i);
      return `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr>${solidFill(color)}<a:ln w="19050">${solidFill('#FFFFFF')}</a:ln></c:spPr></c:dPt>`;
    }).join('');
    const labels = `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${textProps(9, '#334155')}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="${showLegend ? 0 : 1}"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>`;
    const ser = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${escapeXml(s.name)}</c:v></c:tx>${points}${labels}${catXml}<c:val>${numRef(s.ref, s.values)}</c:val></c:ser>`;
    plotXml =
      chart.type === 'donut'
        ? `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/><c:holeSize val="58"/></c:doughnutChart>`
        : `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/></c:pieChart>`;
  } else {
    const stacked = Boolean(chart.options?.stacked);
    const smooth = Boolean(chart.options?.smooth);
    const axIds = `<c:axId val="${AXIS_CAT_ID}"/><c:axId val="${AXIS_VAL_ID}"/>`;
    const head = (s: (typeof series)[number]) =>
      `<c:idx val="${s.idx}"/><c:order val="${s.idx}"/><c:tx><c:v>${escapeXml(s.name)}</c:v></c:tx>`;

    const bars = series.filter((s) => s.kind === 'bar');
    const lines = series.filter((s) => s.kind === 'line');
    const areas = series.filter((s) => s.kind === 'area');
    const groups: string[] = [];

    if (areas.length > 0) {
      const sers = areas
        .map((s) => `<c:ser>${head(s)}<c:spPr>${solidFill(s.color, 0.35)}<a:ln w="25400">${solidFill(s.color)}</a:ln></c:spPr>${catXml}<c:val>${numRef(s.ref, s.values)}</c:val></c:ser>`)
        .join('');
      groups.push(`<c:areaChart><c:grouping val="${stacked ? 'stacked' : 'standard'}"/><c:varyColors val="0"/>${sers}${axIds}</c:areaChart>`);
    }
    if (bars.length > 0) {
      const sers = bars
        .map((s) => `<c:ser>${head(s)}<c:spPr>${solidFill(s.color)}</c:spPr><c:invertIfNegative val="0"/>${catXml}<c:val>${numRef(s.ref, s.values)}</c:val></c:ser>`)
        .join('');
      groups.push(
        `<c:barChart><c:barDir val="col"/><c:grouping val="${stacked ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${sers}<c:gapWidth val="${stacked ? 40 : 80}"/>${stacked ? '<c:overlap val="100"/>' : ''}${axIds}</c:barChart>`,
      );
    }
    if (lines.length > 0) {
      const sers = lines
        .map((s) => `<c:ser>${head(s)}<c:spPr><a:ln w="28575" cap="rnd">${solidFill(s.color)}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${solidFill(s.color)}</c:spPr></c:marker>${catXml}<c:val>${numRef(s.ref, s.values)}</c:val><c:smooth val="${smooth ? 1 : 0}"/></c:ser>`)
        .join('');
      groups.push(`<c:lineChart><c:grouping val="${stacked ? 'stacked' : 'standard'}"/><c:varyColors val="0"/>${sers}<c:marker val="1"/>${axIds}</c:lineChart>`);
    }

    const axisLine = `<c:spPr><a:ln w="9525">${solidFill('#CBD5E1')}</a:ln></c:spPr>`;
    const gridLines = `<c:majorGridlines><c:spPr><a:ln w="6350">${solidFill('#E2E8F0')}<a:prstDash val="dash"/></a:ln></c:spPr></c:majorGridlines>`;
    const xTitle = chart.options?.xAxisTitle ? richTitle(chart.options.xAxisTitle, 9, '#64748B') : '';
    const yTitle = chart.options?.yAxisTitle ? richTitle(chart.options.yAxisTitle, 9, '#64748B') : '';
    const catAx = `<c:catAx><c:axId val="${AXIS_CAT_ID}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${xTitle}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisLine}${textProps(8, '#64748B')}<c:crossAx val="${AXIS_VAL_ID}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
    const valAx = `<c:valAx><c:axId val="${AXIS_VAL_ID}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${gridLines}${yTitle}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${textProps(8, '#64748B')}<c:crossAx val="${AXIS_CAT_ID}"/><c:crosses val="autoZero"/><c:crossBetween val="${bars.length > 0 ? 'between' : 'midCat'}"/></c:valAx>`;
    plotXml = `${groups.join('')}${catAx}${valAx}`;
  }

  const titleXml = chart.title ? richTitle(chart.title, 12, '#1E293B') : '';
  const legendXml = showLegend
    ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${textProps(9, '#475569')}</c:legend>`
    : '';

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<c:roundedCorners val="0"/>` +
    `<c:chart>${titleXml}<c:autoTitleDeleted val="${chart.title ? 0 : 1}"/><c:plotArea><c:layout/>${plotXml}</c:plotArea>${legendXml}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr>${solidFill('#FFFFFF')}<a:ln w="9525">${solidFill('#E2E8F0')}</a:ln></c:spPr>` +
    `</c:chartSpace>`
  );
}

function graphicFrameAnchor(chart: GridChartDefinition, shapeId: number, relId: string): string {
  const { startCol, startRow, endCol, endRow } = chart.anchor;
  return (
    `<xdr:twoCellAnchor editAs="twoCell">` +
    `<xdr:from><xdr:col>${startCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${startRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${endCol + 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${endRow + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${shapeId}" name="${escapeXml(chart.title || `Chart ${shapeId}`)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
    `<a:graphic><a:graphicData uri="${NS_CHART}"><c:chart xmlns:c="${NS_CHART}" xmlns:r="${NS_REL}" r:id="${relId}"/></a:graphicData></a:graphic>` +
    `</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
  );
}

function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  return `${partPath.slice(0, slash)}/_rels/${partPath.slice(slash + 1)}.rels`;
}

/** Resolves a relationship Target relative to the part that owns the rels file. */
function resolveTarget(ownerPartPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ownerPartPath.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function nextRelId(relsXml: string): string {
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => parseInt(m[1], 10));
  return `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
}

function emptyRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG_REL}"></Relationships>`;
}

function addRel(relsXml: string, id: string, type: string, target: string): string {
  return relsXml.replace('</Relationships>', `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`);
}

function addContentTypeOverride(ctXml: string, partName: string, contentType: string): string {
  if (ctXml.includes(`PartName="${partName}"`)) return ctXml;
  return ctXml.replace('</Types>', `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`);
}

/** Inserts <drawing r:id> into a worksheet at the position the schema requires. */
function insertDrawingElement(sheetXml: string, relId: string): string {
  const el = `<drawing r:id="${relId}"/>`;
  const withNs = sheetXml.includes('xmlns:r=')
    ? sheetXml
    : sheetXml.replace('<worksheet ', `<worksheet xmlns:r="${NS_REL}" `);
  const followers = ['<legacyDrawing', '<legacyDrawingHF', '<drawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst'];
  for (const tag of followers) {
    const idx = withNs.indexOf(tag);
    if (idx !== -1) return withNs.slice(0, idx) + el + withNs.slice(idx);
  }
  return withNs.replace('</worksheet>', `${el}</worksheet>`);
}

/**
 * Injects native charts into an XLSX buffer produced by ExcelJS. Specs whose sheet or ranges
 * cannot be resolved are skipped (the rest of the workbook is untouched).
 */
export async function injectNativeCharts(xlsx: Buffer, specs: NativeChartSpec[]): Promise<Buffer> {
  if (specs.length === 0) return xlsx;
  const zip = await JSZip.loadAsync(xlsx);

  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const workbookRels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  let contentTypes = await zip.file('[Content_Types].xml')?.async('string');
  if (!workbookXml || !workbookRels || !contentTypes) return xlsx;

  // Sheet name → worksheet part path
  const relTargets = new Map<string, string>();
  for (const m of workbookRels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) relTargets.set(id, resolveTarget('xl/workbook.xml', target));
  }
  const sheetParts = new Map<string, string>();
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const rawName = m[0].match(/name="([^"]*)"/)?.[1];
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1];
    if (rawName === undefined || !rid) continue;
    const name = rawName
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const part = relTargets.get(rid);
    if (part) sheetParts.set(name, part);
  }

  const existingCharts = Object.keys(zip.files).filter((p) => /^xl\/charts\/chart\d+\.xml$/.test(p)).length;
  const existingDrawings = Object.keys(zip.files).filter((p) => /^xl\/drawings\/drawing\d+\.xml$/.test(p)).length;
  let chartCounter = existingCharts;
  let drawingCounter = existingDrawings;

  const bySheet = new Map<string, NativeChartSpec[]>();
  for (const spec of specs) {
    if (!sheetParts.has(spec.sheetName)) continue;
    bySheet.set(spec.sheetName, [...(bySheet.get(spec.sheetName) || []), spec]);
  }

  for (const [sheetName, sheetSpecs] of bySheet) {
    const sheetPath = sheetParts.get(sheetName)!;
    const sheetRelsPath = relsPathFor(sheetPath);
    let sheetXml = await zip.file(sheetPath)?.async('string');
    if (!sheetXml) continue;
    let sheetRels = (await zip.file(sheetRelsPath)?.async('string')) || emptyRels();

    // Reuse the drawing ExcelJS created for images, or create a new one
    let drawingPath: string | null = null;
    const drawingRelMatch = sheetXml.match(/<drawing\s+r:id="([^"]+)"/);
    if (drawingRelMatch) {
      const relTag = [...sheetRels.matchAll(/<Relationship\b[^>]*>/g)].find((m) => m[0].includes(`Id="${drawingRelMatch[1]}"`));
      const target = relTag?.[0].match(/Target="([^"]+)"/)?.[1];
      if (target) drawingPath = resolveTarget(sheetPath, target);
    }

    let drawingXml: string;
    if (drawingPath && zip.file(drawingPath)) {
      drawingXml = (await zip.file(drawingPath)!.async('string'))!;
    } else {
      drawingCounter += 1;
      drawingPath = `xl/drawings/drawing${drawingCounter}.xml`;
      drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="${NS_SHEET_DRAWING}" xmlns:a="${NS_MAIN}"></xdr:wsDr>`;
      const relId = nextRelId(sheetRels);
      sheetRels = addRel(sheetRels, relId, REL_TYPE_DRAWING, `../drawings/drawing${drawingCounter}.xml`);
      sheetXml = insertDrawingElement(sheetXml, relId);
      contentTypes = addContentTypeOverride(contentTypes, `/${drawingPath}`, CT_DRAWING);
    }

    const drawingRelsPath = relsPathFor(drawingPath);
    let drawingRels = (await zip.file(drawingRelsPath)?.async('string')) || emptyRels();
    let shapeId = Math.max(1, ...[...drawingXml.matchAll(/cNvPr id="(\d+)"/g)].map((m) => parseInt(m[1], 10)));
    const anchors: string[] = [];

    for (const spec of sheetSpecs) {
      const chartXml = buildChartXml(spec);
      if (!chartXml) continue;
      chartCounter += 1;
      const chartPath = `xl/charts/chart${chartCounter}.xml`;
      zip.file(chartPath, chartXml);
      contentTypes = addContentTypeOverride(contentTypes, `/${chartPath}`, CT_CHART);
      const relId = nextRelId(drawingRels);
      drawingRels = addRel(drawingRels, relId, REL_TYPE_CHART, `../charts/chart${chartCounter}.xml`);
      shapeId += 1;
      anchors.push(graphicFrameAnchor(spec.chart, shapeId, relId));
    }
    if (anchors.length === 0) continue;

    // Graphic frames declare their own c:/r: namespaces, so they can be appended to any drawing
    drawingXml = drawingXml.replace(/<\/xdr:wsDr>\s*$/, `${anchors.join('')}</xdr:wsDr>`);
    zip.file(drawingPath, drawingXml);
    zip.file(drawingRelsPath, drawingRels);
    zip.file(sheetPath, sheetXml);
    zip.file(sheetRelsPath, sheetRels);
  }

  zip.file('[Content_Types].xml', contentTypes);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

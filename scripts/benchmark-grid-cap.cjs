/**
 * Real Benchmark for Grid Template Rendering at Cap (10,000 rows x 20 cols = 200,000 cells).
 * Measures:
 * - JSON serialization size
 * - Elapsed execution time for XLSX rendering
 * - Peak heap usage delta
 */
const { performance } = require('perf_hooks');
const path = require('path');
const ExcelJS = require(path.resolve(__dirname, '../apps/api/node_modules/exceljs'));

async function runBenchmark() {
  console.log('--- Phase 2A Grid Cap Benchmark ---');
  console.log('Target: 10,000 rows x 20 columns = 200,000 cells at the limit');

  if (global.gc) {
    global.gc();
  }
  const initialMem = process.memoryUsage();

  const numRows = 10000;
  const numCols = 20;
  const cells = {};

  const tStartBuild = performance.now();
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      if (c === 0) {
        cells[`${r}:${c}`] = { value: `Item-${r}` };
      } else if (c === 1) {
        cells[`${r}:${c}`] = { value: '2026-10-10', numFmt: 'yyyy-mm-dd' };
      } else if (c === 2) {
        cells[`${r}:${c}`] = { value: r * 1.5, numFmt: '$#,##0.00' };
      } else if (c === 3) {
        cells[`${r}:${c}`] = { value: 0.15, numFmt: '0.0%' };
      } else if (c === 19 && r > 0) {
        // Static formula
        cells[`${r}:${c}`] = { formula: `C${r + 1}*D${r + 1}`, value: r * 1.5 * 0.15, numFmt: '$#,##0.00' };
      } else {
        cells[`${r}:${c}`] = { value: (r + 1) * (c + 1) };
      }
    }
  }
  const tEndBuild = performance.now();

  const template = {
    kind: 'grid',
    sheets: [
      {
        id: 'bench_sheet_1',
        name: 'Benchmark Data',
        order: 0,
        cells,
      },
    ],
  };

  const jsonStr = JSON.stringify(template);
  const jsonBytes = Buffer.byteLength(jsonStr, 'utf8');
  console.log(`JSON Build Time: ${(tEndBuild - tStartBuild).toFixed(2)} ms`);
  console.log(`JSON Byte Size: ${(jsonBytes / (1024 * 1024)).toFixed(2)} MB (${jsonBytes.toLocaleString()} bytes)`);

  let peakHeap = process.memoryUsage().heapUsed;
  const trackHeapInterval = setInterval(() => {
    const cur = process.memoryUsage().heapUsed;
    if (cur > peakHeap) peakHeap = cur;
  }, 10);

  // Dynamically import or require renderer
  const tStartRender = performance.now();

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Benchmark Data');

  // Populate worksheet
  for (const [coordKey, cellDef] of Object.entries(cells)) {
    const [rStr, cStr] = coordKey.split(':');
    const rowNum = parseInt(rStr, 10) + 1;
    const colNum = parseInt(cStr, 10) + 1;
    const cell = ws.getCell(rowNum, colNum);
    if (cellDef.formula) {
      cell.value = {
        formula: cellDef.formula,
        result: cellDef.value,
      };
    } else {
      cell.value = cellDef.value;
    }
    if (cellDef.numFmt) {
      cell.numFmt = cellDef.numFmt;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const tEndRender = performance.now();
  clearInterval(trackHeapInterval);

  const finalMem = process.memoryUsage();
  const elapsedMs = tEndRender - tStartRender;
  const peakHeapMb = (peakHeap / (1024 * 1024)).toFixed(2);
  const heapDeltaMb = ((peakHeap - initialMem.heapUsed) / (1024 * 1024)).toFixed(2);
  const bufferMb = (buffer.length / (1024 * 1024)).toFixed(2);

  console.log(`Render Time (200,000 cells): ${elapsedMs.toFixed(2)} ms (${(elapsedMs / 1000).toFixed(2)} s)`);
  console.log(`Generated XLSX Buffer: ${bufferMb} MB (${buffer.length.toLocaleString()} bytes)`);
  console.log(`Initial Heap: ${(initialMem.heapUsed / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Peak Heap: ${peakHeapMb} MB`);
  console.log(`Peak Heap Delta: ${heapDeltaMb} MB`);
  console.log(`Final Heap: ${(finalMem.heapUsed / (1024 * 1024)).toFixed(2)} MB`);
}

runBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});

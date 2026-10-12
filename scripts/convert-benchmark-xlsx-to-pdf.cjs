#!/usr/bin/env node
/**
 * Dev-only script to render the benchmark XLSX layout and convert it to PDF
 * using LibreOffice headless (soffice --headless --convert-to pdf) for visual comparison.
 *
 * Usage:
 *   node scripts/convert-benchmark-xlsx-to-pdf.cjs [--outdir <dir>]
 *
 * Note: Not part of CI. Requires LibreOffice installed on host system.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

async function main() {
  const args = process.argv.slice(2);
  let outDir = path.resolve(__dirname, '../artifacts');
  const outDirIdx = args.indexOf('--outdir');
  if (outDirIdx !== -1 && args[outDirIdx + 1]) {
    outDir = path.resolve(args[outDirIdx + 1]);
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('1. Generating benchmark kind: "grid" template...');
  const { buildPersonalMonthlyBudgetBenchmark } = require('../packages/schema/dist/export-template-grid.js');
  const { renderGridTemplateToXlsxBuffer } = require('../apps/api/dist/records/export/grid-xlsx-renderer.js');

  const benchmarkTemplate = buildPersonalMonthlyBudgetBenchmark();
  console.log('2. Rendering benchmark template to XLSX buffer with ExcelJS...');
  const xlsxBuffer = await renderGridTemplateToXlsxBuffer(benchmarkTemplate);

  const xlsxPath = path.join(outDir, 'benchmark_budget.xlsx');
  fs.writeFileSync(xlsxPath, xlsxBuffer);
  console.log(`   Saved benchmark XLSX to: ${xlsxPath} (${xlsxBuffer.length} bytes)`);

  console.log('3. Searching for LibreOffice (soffice) executable...');
  const candidatePaths = [
    'soffice',
    'libreoffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ];

  let sofficeBin = null;
  for (const bin of candidatePaths) {
    try {
      execSync(`"${bin}" --version`, { stdio: 'ignore' });
      sofficeBin = bin;
      break;
    } catch {
      // not found, continue
    }
  }

  if (!sofficeBin) {
    console.warn('\n[!] LibreOffice executable ("soffice") not found on PATH or standard install paths.');
    console.warn('    To convert the XLSX to PDF:');
    console.warn('    - Install LibreOffice (https://www.libreoffice.org/download/download/)');
    console.warn(`    - Or run manually: soffice --headless --convert-to pdf --outdir "${outDir}" "${xlsxPath}"`);
    console.log(`\nBenchmark XLSX ready for visual inspection in Excel/Calc: ${xlsxPath}`);
    return;
  }

  console.log(`4. Converting XLSX to PDF via LibreOffice headless: ${sofficeBin}`);
  try {
    execSync(`"${sofficeBin}" --headless --convert-to pdf --outdir "${outDir}" "${xlsxPath}"`, {
      stdio: 'inherit',
    });
    const pdfPath = path.join(outDir, 'benchmark_budget.pdf');
    if (fs.existsSync(pdfPath)) {
      console.log(`\n[SUCCESS] Visual comparison PDF generated: ${pdfPath}`);
    } else {
      console.log(`\nConversion command executed. Check output directory: ${outDir}`);
    }
  } catch (err) {
    console.error('Failed to convert XLSX to PDF:', err.message);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

const path = require('path');

async function main() {
  const { THEME_PRESETS, getContrastRatio } = await import('../packages/schema/dist/index.js');

  console.log('--- STATUS CONTRAST AUDIT ---');
  let failures = 0;

  for (const [id, preset] of Object.entries(THEME_PRESETS)) {
    for (const mode of ['light', 'dark']) {
      const p = preset[mode];
      for (const type of ['warning', 'success', 'danger']) {
        const solid = p[type];
        const contrast = p[type + '-contrast'];
        const subtle = p[type + '-subtle'];

        // Contrast text on solid background
        const solidRatio = getContrastRatio(contrast, solid);
        // Status text on subtle background
        const subtleRatio = getContrastRatio(solid, subtle);

        const solidPass = solidRatio >= 4.5;
        const subtlePass = subtleRatio >= 4.5;

        if (!solidPass || !subtlePass) {
          failures++;
          console.log(`[FAIL] ${id} (${mode}) ${type}:`);
          if (!solidPass) console.log(`   - text ${contrast} on solid ${solid}: ${solidRatio.toFixed(2)}:1 (need >= 4.5)`);
          if (!subtlePass) console.log(`   - text ${solid} on subtle ${subtle}: ${subtleRatio.toFixed(2)}:1 (need >= 4.5)`);
        } else {
          console.log(`[PASS] ${id} (${mode}) ${type}: solid=${solidRatio.toFixed(2)}, subtle=${subtleRatio.toFixed(2)}`);
        }
      }
    }
  }

  console.log(`\nTotal failures: ${failures}`);
  if (failures > 0) process.exit(1);
}

main().catch(console.error);

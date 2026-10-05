const fs = require('fs');
const path = require('path');

async function main() {
  const schemaPath = path.resolve(__dirname, '../packages/schema/dist/index.js');
  const { generateTokensCss } = await import(`file://${schemaPath.replace(/\\/g, '/')}`);

  const css = generateTokensCss({ presetId: 'neutral', overrides: {} });
  const targetPath = path.resolve(__dirname, '../apps/web/src/styles/tokens.css');

  fs.writeFileSync(targetPath, css.trim() + '\n', 'utf8');
  console.log(`Successfully generated tokens.css at ${targetPath}`);
}

main().catch((err) => {
  console.error('Failed to generate tokens.css:', err);
  process.exit(1);
});

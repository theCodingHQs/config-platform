const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else if (file.endsWith('.css') || file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(fullPath);
    }
  });
  return results;
}

const rootDir = path.resolve(__dirname, '../apps/web/src');
const files = walk(rootDir);

const colorRegex = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|rgba?\([^)]+\)|hsla?\([^)]+\)/;
const radiusRegex = /(?:borderRadius|border-radius)\s*:\s*(?:['"]?(?:\d+px|\d+rem|\d+)['"]?)/;
const shadowRegex = /(?:boxShadow|box-shadow)\s*:\s*['"]?(?:none|\d+px[^;'"]+)['"]?/;
const fontSizeRegex = /(?:fontSize|font-size)\s*:\s*(?:['"]?(?:\d+px|\d+rem|\d+em|\d+)['"]?)/;
const spacingRegex = /(?:margin|padding|gap|top|bottom|left|right)(?:Top|Bottom|Left|Right)?\s*:\s*['"]?\d+px['"]?/;

// Rule: Direct use of base radius token (var(--radius)) is forbidden in components.
// Components must use semantic roles: var(--radius-control), var(--radius-surface), var(--radius-pill), or var(--radius-button).
const baseRadiusTokenRegex = /var\(--radius\)(?!-)/;

let hasError = false;
let totalViolations = 0;

files.forEach((file) => {
  const relPath = path.relative(rootDir, file).replace(/\\/g, '/');

  // tokens.css is the canonical definition file for raw values
  if (relPath === 'styles/tokens.css') {
    return;
  }

  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    // Skip single-line comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      return;
    }

    const colorMatch = line.match(colorRegex);
    const radiusMatch = line.match(radiusRegex);
    const shadowMatch = line.match(shadowRegex);
    const fontSizeMatch = line.match(fontSizeRegex);
    const spacingMatch = line.match(spacingRegex);

    if (colorMatch) {
      console.error(`[THEME LINT ERROR] ${relPath}:${index + 1} - Hardcoded color found: "${colorMatch[0]}"`);
      hasError = true;
      totalViolations++;
    }
    if (radiusMatch) {
      console.error(`[THEME LINT ERROR] ${relPath}:${index + 1} - Hardcoded radius found: "${radiusMatch[0]}"`);
      hasError = true;
      totalViolations++;
    }
    if (shadowMatch) {
      console.error(`[THEME LINT ERROR] ${relPath}:${index + 1} - Hardcoded shadow found: "${shadowMatch[0]}"`);
      hasError = true;
      totalViolations++;
    }
    if (fontSizeMatch) {
      console.error(`[THEME LINT ERROR] ${relPath}:${index + 1} - Hardcoded fontSize found: "${fontSizeMatch[0]}"`);
      hasError = true;
      totalViolations++;
    }
    if (spacingMatch) {
      console.error(`[THEME LINT ERROR] ${relPath}:${index + 1} - Hardcoded spacing found: "${spacingMatch[0]}"`);
      hasError = true;
      totalViolations++;
    }

    const baseRadiusMatch = line.match(baseRadiusTokenRegex);
    if (baseRadiusMatch) {
      console.error(
        `[THEME LINT ERROR] ${relPath}:${index + 1} - Direct use of base radius token forbidden. Use semantic roles (var(--radius-control), var(--radius-surface), var(--radius-pill), var(--radius-button)): "${line.trim()}"`
      );
      hasError = true;
      totalViolations++;
    }
  });
});

if (hasError) {
  console.error(`\nTheme Lint FAILED with ${totalViolations} violations outside tokens.css.`);
  process.exit(1);
} else {
  console.log(`\nTheme Lint PASSED! All component styles strictly adhere to tokens.`);
  process.exit(0);
}

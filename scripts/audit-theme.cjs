const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
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

const files = walk(path.resolve('apps/web/src'));
const stats = {};

// Regex patterns for hardcoded styles:
// Colors: hex, rgb, rgba, hsl, hsla
const colorRegex = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g;
// Radius: numeric values with px/rem or inline numbers
const radiusRegex = /(?:borderRadius|border-radius)\s*:\s*(?:['"]?(?:\d+px|\d+rem|\d+)['"]?)/g;
// Shadows: boxShadow: '...' or box-shadow: ...
const shadowRegex = /(?:boxShadow|box-shadow)\s*:\s*['"]?(?:none|\d+px[^;'"]+)['"]?/g;
// Font size: fontSize: '...' or font-size: ...
const fontSizeRegex = /(?:fontSize|font-size)\s*:\s*(?:['"]?(?:\d+px|\d+rem|\d+em|\d+)['"]?)/g;
// Spacing/Padding/Margin raw px/rem
const spacingRegex = /(?:margin|padding|gap|top|bottom|left|right)(?:Top|Bottom|Left|Right)?\s*:\s*['"]?\d+px['"]?/g;

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  // Ignore imports or comments if needed, but let's count raw style declarations
  const colors = (content.match(colorRegex) || []).length;
  const radii = (content.match(radiusRegex) || []).length;
  const shadows = (content.match(shadowRegex) || []).length;
  const fontSizes = (content.match(fontSizeRegex) || []).length;
  const spacing = (content.match(spacingRegex) || []).length;
  const total = colors + radii + shadows + fontSizes + spacing;
  const relPath = path.relative(path.resolve('apps/web/src'), f).replace(/\\/g, '/');
  if (total > 0) {
    stats[relPath] = { colors, radii, shadows, fontSizes, spacing, total };
  }
});

console.log(JSON.stringify(stats, null, 2));

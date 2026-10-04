import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Production Build & Demo Credentials Verification', () => {
  it('production build bundle does not contain seeded email, password or "Fill Demo" button label', () => {
    const webRoot = path.resolve(__dirname, '..');
    const distAssetsDir = path.resolve(webRoot, 'dist/assets');

    // Ensure production bundle is built using a clean subprocess to avoid jsdom Uint8Array conflict
    if (!fs.existsSync(distAssetsDir) || fs.readdirSync(distAssetsDir).filter((f) => f.endsWith('.js')).length === 0) {
      execSync('npx vite build', {
        cwd: webRoot,
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: 'pipe',
      });
    }

    const files = fs.readdirSync(distAssetsDir);
    const jsFiles = files.filter((f) => f.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);

    for (const jsFile of jsFiles) {
      const content = fs.readFileSync(path.join(distAssetsDir, jsFile), 'utf8');
      // Assert actual seeded credentials are tree-shaken
      expect(content).not.toContain('admin@example.com');
      expect(content).not.toContain('password123');
      // Assert the "Fill Demo" button label is tree-shaken
      expect(content).not.toContain('Fill Demo');
    }
  }, 60000);
});

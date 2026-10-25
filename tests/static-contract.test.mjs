import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(__dirname, '../public/app.js');

test('frontend exige VITE_API_BASE_URL e evita fallback fictício', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.match(source, /VITE_API_BASE_URL/);
  assert.match(source, /API_BASE_URL_NOT_CONFIGURED/);
  assert.match(source, /API indisponível no GitHub Pages/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');

test('artifact de produção contém arquivos exigidos do GitHub Pages', async () => {
  await access(path.join(distDir, 'index.html'));
  await access(path.join(distDir, '404.html'));
  await access(path.join(distDir, '.nojekyll'));
});

test('build referencia assets com subpath /voto-aberto-2026/', async () => {
  const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
  assert.match(html, /\/voto-aberto-2026\/assets\//);
});

test('bundle mantém mensagem de indisponibilidade quando API não configurada', async () => {
  const assetsDir = path.join(distDir, 'assets');
  const files = await readdir(assetsDir);
  const jsFile = files.find((name) => name.endsWith('.js'));
  assert.ok(jsFile, 'Nenhum bundle JavaScript encontrado em dist/assets.');
  const js = await readFile(path.join(assetsDir, jsFile), 'utf8');
  assert.match(js, /API indisponível no GitHub Pages/);
});

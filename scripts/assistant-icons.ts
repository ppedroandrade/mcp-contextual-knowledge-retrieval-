/** Regenera apenas os ícones usados pelo Nexo, sem bundle ou dependência no navegador. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const lucide = dirname(require.resolve('lucide-static/package.json'));
const target = join(import.meta.dirname, '..', 'apps', 'assistant');
const names = [
  'arrow-right', 'arrow-up', 'arrow-up-right', 'chevron-down',
  'circle-help', 'copy', 'external-link',
  'file-text', 'files', 'folder-open', 'panel-left', 
  'monitor', 'moon', 'sun', 'plus', 'refresh-cw', 'shield-check', 'sliders-horizontal', 'square',
  'square-pen', 'trash-2', 'upload', 'users', 'x',
];

const symbols = names.map((name) => {
  const svg = readFileSync(join(lucide, 'icons', `${name}.svg`), 'utf8');
  const content = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  if (!content) throw new Error(`SVG do Lucide inválido: ${name}`);
  return `  <symbol id="${name}" viewBox="0 0 24 24">${content}  </symbol>`;
});

const license = readFileSync(join(lucide, 'LICENSE'), 'utf8');
writeFileSync(join(target, 'icons.svg'), `<!-- Gerado por npm run icons:assistant.\n${license.replaceAll('--', '—')}-->\n<svg xmlns="http://www.w3.org/2000/svg">\n${symbols.join('\n')}\n</svg>\n`);
console.log(`${names.length} ícones Lucide gerados em apps/assistant/.`);

// Generates CSS custom properties + the Tailwind v4 @theme mapping from
// replica/design/tokens.json. Run on every dev/build so tokens.json stays the source of truth.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../replica/design/tokens.json');
const t = JSON.parse(readFileSync(src, 'utf8'));

const vars = [];
const theme = [];

for (const [k, v] of Object.entries(t.color)) {
  vars.push(`  --pw-color-${k}: ${v};`);
  theme.push(`  --color-${k}: var(--pw-color-${k});`);
}
for (const [k, v] of Object.entries(t.font)) {
  vars.push(`  --pw-font-${k}: ${v};`);
  theme.push(`  --font-${k}: var(--pw-font-${k});`);
}
for (const [k, v] of Object.entries(t.type)) {
  vars.push(`  --pw-text-${k}: ${v.size}px;`, `  --pw-text-${k}-line: ${v.line}px;`, `  --pw-text-${k}-weight: ${v.weight};`);
  theme.push(`  --text-${k}: var(--pw-text-${k});`, `  --text-${k}--line-height: var(--pw-text-${k}-line);`, `  --text-${k}--font-weight: var(--pw-text-${k}-weight);`);
}
t.space.forEach((v, i) => vars.push(`  --pw-space-${i}: ${v}px;`));
for (const [k, v] of Object.entries(t.radius)) {
  vars.push(`  --pw-radius-${k}: ${v}px;`);
  theme.push(`  --radius-${k}: var(--pw-radius-${k});`);
}
for (const [k, v] of Object.entries(t.shadow)) {
  vars.push(`  --pw-shadow-${k}: ${v};`);
  theme.push(`  --shadow-${k}: var(--pw-shadow-${k});`);
}
for (const [k, v] of Object.entries(t.motion)) vars.push(`  --pw-motion-${k}: ${v};`);
for (const [k, v] of Object.entries(t.layout)) vars.push(`  --pw-layout-${k}: ${v}px;`);

const header = '/* GENERATED from replica/design/tokens.json by scripts/gen-tokens.mjs. Do not edit. */\n';
const tokensCss = `${header}:root {\n${vars.join('\n')}\n}\n`;
// Tailwind v4: spacing base 2px so p-1=2px, p-2=4px, p-4=8px, p-6=12px, p-8=16px.
const themeCss = `${header}@theme inline {\n  --color-*: initial;\n  --spacing: 2px;\n${theme.join('\n')}\n}\n`;

const outs = [resolve(here, '../src/styles'), resolve(here, '../../replica/design')];
for (const dir of outs) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'tokens.css'), tokensCss);
  writeFileSync(resolve(dir, 'tailwind-theme.css'), themeCss);
}
console.log('tokens: wrote tokens.css + tailwind-theme.css');

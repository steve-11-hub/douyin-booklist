import fs from 'node:fs';
import path from 'node:path';

const lib = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'books.json'), 'utf8'));
const errs = [];
const ids = new Set();
const titles = new Set();
const req = ['id', 't', 'a', 'c', 'p', 's', 'q', 'qt', 'e'];

for (const b of lib.books) {
  for (const k of req) if (!b[k] || (Array.isArray(b[k]) && !b[k].length)) errs.push(`${b.id || '?'} 缺少 ${k}`);
  if (ids.has(b.id)) errs.push(`重复 id: ${b.id}`);
  if (titles.has(b.t)) errs.push(`重复书名: ${b.t}`);
  ids.add(b.id);
  titles.add(b.t);
  if (b.p && b.p.length > 2) errs.push(`${b.t}: 标题超过2行`);
  if (b.p && Math.max(...b.p.map((x) => [...x].length)) > 11) errs.push(`${b.t}: 单行超过11字`);
  if (b.qt && !['原文', '提炼'].includes(b.qt)) errs.push(`${b.t}: qt 非法`);
}

const counts = {};
for (const b of lib.books) counts[b.c] = (counts[b.c] || 0) + 1;
console.log('总数:', lib.books.length);
console.log('分类:', counts);
console.log('缺失分类顺序:', (lib.meta.categoryOrder || []).filter((c) => !counts[c]));
if (errs.length) {
  console.log('问题:');
  errs.forEach((e) => console.log(' -', e));
  process.exitCode = 1;
} else {
  console.log('✅ 校验通过');
}

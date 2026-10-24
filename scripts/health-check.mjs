#!/usr/bin/env node
/**
 * 每日体检：在生成之后、发布之前跑一次。
 *
 *   node scripts/health-check.mjs
 *   node scripts/health-check.mjs --date 2026-10-24
 *
 * 长期运行最怕的不是「报错」，而是「看起来在跑，其实已经废了」：
 * 书库被改坏、产物缺图、轮转卡死、页面只剩空壳。
 * 这里逐项检查，任何一项不过就以非 0 退出，让 GitHub Actions 变红 + 开 Issue。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const date = arg('--date', new Date().toISOString().slice(0, 10));

const problems = [];
const notes = [];
const bad = (m) => problems.push(m);
const note = (m) => notes.push(m);

const readJSON = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};

/* ------------------------------ 1. 书库 ------------------------------ */
const libPath = path.join(ROOT, 'data', 'books.json');
const lib = readJSON(libPath, null);
if (!lib || !Array.isArray(lib.books)) {
  bad('书库 data/books.json 读不出来或没有 books 数组');
} else {
  const books = lib.books;
  if (books.length < 100) bad(`书库只有 ${books.length} 本，低于 100 本下限`);

  // id 唯一
  const ids = new Set();
  for (const b of books) {
    if (!b || !b.id) bad('有书缺少 id');
    else if (ids.has(b.id)) bad(`书 id 重复：${b.id}`);
    else ids.add(b.id);
  }

  // 关键字段齐全：缺了会在生成阶段炸，或页面上露出空标题
  const need = ['t', 'c', 'p', 'q', 'e'];
  let longTitle = 0;
  for (const b of books) {
    const miss = need.filter((k) => !b[k] || (Array.isArray(b[k]) && !b[k].length));
    if (miss.length) bad(`《${b.t || b.id}》缺字段：${miss.join(', ')}`);
    // 封面标题按设计是 1~2 行、末行反白；单行超过 12 字才会明显缩排
    const lines = [].concat(b.p || []);
    if (lines.length > 2 || lines.some((l) => [...String(l)].length > 12)) longTitle++;
    if (b.qt && !['原文', '提炼'].includes(b.qt)) bad(`《${b.t}》金句类型非法：${b.qt}`);
  }
  if (longTitle) note(`${longTitle} 本封面标题偏长，出图时会自动缩排（不影响正确性）`);

  // 类别覆盖：每天要 5 个不同类别
  const cats = new Set(books.map((b) => b.c));
  if (cats.size < 5) bad(`类别只有 ${cats.size} 个，凑不齐「每天 5 本不同类型」`);
  note(`书库 ${books.length} 本，${cats.size} 个类别`);
}

/* ------------------------------ 2. 轮转 ------------------------------ */
const state = readJSON(path.join(ROOT, 'data', 'state.json'), null);
if (!state) {
  bad('轮转进度 data/state.json 读不出来（会导致每天重复同一批书）');
} else if (lib && lib.books) {
  const used = state.lastUsed || {};
  const usedCount = lib.books.filter((b) => used[b.id]).length;
  const left = lib.books.length - usedCount;
  note(`轮转：第 ${(state.dayIndex || 0) + 1} 天，已用 ${usedCount}/${lib.books.length}，剩 ${left}`);
  if (left === 0) note('100 本已全部用过，进入复用期（按最久未出现排期）');
}

/* ------------------------------ 3. 当天产物 ------------------------------ */
const outDir = path.join(ROOT, 'output', date);
const manifest = readJSON(path.join(outDir, 'manifest.json'), null);
if (!manifest || !Array.isArray(manifest.books)) {
  bad(`没有当天的 ${date} 产物清单 manifest.json`);
} else {
  const n = manifest.books.length;
  if (n !== 5) bad(`当天应该 5 本，实际 ${n} 本`);
  for (const b of manifest.books) {
    const imgs = b.images || [];
    if (imgs.length !== 3) bad(`《${b.bookTitle}》应该有 3 张图，实际 ${imgs.length} 张`);
    for (const p of imgs) {
      const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
      if (!fs.existsSync(abs)) bad(`《${b.bookTitle}》缺图：${path.basename(abs)}`);
      else if (fs.statSync(abs).size < 10 * 1024) bad(`《${b.bookTitle}》图片过小疑似空图：${path.basename(abs)}`);
    }
  }
  note(`当天 ${n} 本 × 3 图齐全`);
}

/* ------------------------------ 4. 手机页 ------------------------------ */
const mobilePath = path.join(outDir, 'mobile', 'index.html');
if (!fs.existsSync(mobilePath)) {
  bad(`没有手机版页面 ${date}/mobile/index.html`);
} else {
  const html = fs.readFileSync(mobilePath, 'utf8');
  const kb = Math.round(html.length / 1024);
  if (html.length < 200 * 1024) bad(`手机页只有 ${kb} KB，疑似图片没内联`);
  if (!html.includes('data:image/png;base64,')) bad('手机页里没有内联图片');
  // 注意：页面的卡片是用内嵌 JS 模板字符串渲染的，源码里出现 ${it.xxx} 是正常的，
  // 不能据此判错。真正会露在屏幕上的只有 undefined / null / NaN 这类值。
  if (html.includes('>undefined<') || html.includes('>null<') || html.includes('>NaN<')) {
    bad('手机页里有 undefined / null / NaN 之类的空值');
  }
  // 书名必须真的出现在页面上（防止渲染彻底失败只剩空壳）。
  // 注意：书名嵌在内联 JS 里，中文会被转义成 \uXXXX（《活着》→ \u6d3b\u7740），
  // 所以要先反转义再比，单靠 includes('《活着》') 一定找不到。
  const unescape = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const decoded = unescape(html);
  if (manifest && Array.isArray(manifest.books)) {
    for (const b of manifest.books) {
      if (!decoded.includes(b.bookTitle)) bad(`手机页里找不到书名《${b.bookTitle}》，渲染可能失败`);
    }
  }
  note(`手机页 ${kb} KB`);
}

/* ------------------------------ 汇总 ------------------------------ */
for (const n of notes) console.log(`  · ${n}`);
if (problems.length) {
  console.error(`\n✗ 体检未通过（${problems.length} 项）：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n✅ 体检通过');

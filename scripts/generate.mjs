#!/usr/bin/env node
/**
 * 每日书单 · 图文生成器
 * 选出 N 本书 -> 生成 3N 张 1080x1440 HTML 卡片 -> headless Edge 截图 -> 打包草稿
 * 只生成与打包，绝不发布。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { coverHTML, quoteHTML, essenceHTML } from './templates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'output');
const DRAFTS = path.join(ROOT, 'drafts');
const CACHE = path.join(ROOT, '.cache');
const LOGS = path.join(ROOT, 'logs');

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  // GitHub Actions / Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
].filter(Boolean);

function findBrowser() {
  for (const c of EDGE_CANDIDATES) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

const EDGE = findBrowser();

/* ------------------------------- 小工具 ------------------------------- */
const pad = (n) => String(n).padStart(2, '0');
const nowLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}]`, ...a);

function parseArgs(argv) {
  const args = { count: 5, date: nowLocal(), force: false, shoot: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count') args.count = Number(argv[++i]);
    else if (a === '--date') args.date = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a === '--no-shoot') args.shoot = false;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error(`日期格式应为 YYYY-MM-DD: ${args.date}`);
  if (!Number.isInteger(args.count) || args.count < 1) throw new Error('--count 必须是正整数');
  return args;
}

function readJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}
function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}
function slug(s) {
  return String(s).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40);
}
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

/* ------------------------------ 选书引擎 ------------------------------ */
/**
 * 四层优先级：
 *   1) 从没用过的书（按类别轮转，保证每天类别不重复）
 *   2) 用过的书里最久没出现的（时间最旧优先）
 *   3) 类别池不够时，从其它类别补未用过的
 *   4) 还凑不齐，才用全库里最久没出现的
 * 结果：100 本用完后自动回到第 1 本，循环播放，不会空档。
 */
function pickBooks(lib, state, count) {
  const cats = lib.meta.categoryOrder || [...new Set(lib.books.map((b) => b.c))];
  const used = state.lastUsed || {};
  const picks = [];
  const picked = new Set();

  const neverUsed = (b) => !used[b.id];
  const oldestFirst = (a, b) =>
    String(used[a.id] || '0000-00-00').localeCompare(String(used[b.id] || '0000-00-00'));

  // 全新一轮的起点：每轮从不同类别开始，避免每次循环都是同一个顺序
  const cycle = Math.floor((state.dayIndex || 0) / Math.max(1, Math.ceil(lib.books.length / count)));
  const start = ((state.dayIndex || 0) * count + cycle) % cats.length;

  const take = (b) => {
    if (!b || picked.has(b.id) || picks.length >= count) return false;
    picks.push(b);
    picked.add(b.id);
    return true;
  };

  // 1) 按类别取未用过的
  for (let i = 0; i < cats.length && picks.length < count; i++) {
    const cat = cats[(start + i) % cats.length];
    const pool = lib.books.filter((b) => b.c === cat && !picked.has(b.id));
    if (!pool.length) continue;
    take(pool.find(neverUsed) || [...pool].sort(oldestFirst)[0]);
  }

  // 2) 全库里没用过的补齐（类别不重复优先）
  if (picks.length < count) {
    for (const b of lib.books) {
      if (picks.length >= count) break;
      take(neverUsed(b) ? b : null);
    }
  }

  // 3) 全部用过：取最久没出现的
  if (picks.length < count) {
    for (const b of [...lib.books].sort(oldestFirst)) {
      if (picks.length >= count) break;
      take(b);
    }
  }

  return picks;
}

/** 统计这轮进度，方便在页面上显示 */
function rotationInfo(lib, state) {
  const used = state.lastUsed || {};
  const total = lib.books.length;
  const done = lib.books.filter((b) => used[b.id]).length;
  return { total, used: done, left: total - done };
}

/* ------------------------------ 文案拼装 ------------------------------ */
function buildCaption(book) {
  if (book.caption) return book.caption;
  return `读完《${book.t}》我才明白：${book.e}\n\n${book.s}\n\n适合${book.fit || '想读点真东西'}的人。`;
}
function buildTags(book) {
  const clean = String(book.t).replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  return [`#${clean}`, `#${book.c}`, '#书单', '#读书', '#每日书单'];
}
function buildTitle(book) {
  return `读完《${book.t}》我才发现：${book.p.join('，')}`;
}

/* ------------------------------ 截图引擎 ------------------------------ */
function shoot(htmlPath, pngPath, profileDir) {
  return new Promise((resolve, reject) => {
    if (!EDGE) return reject(new Error('找不到可用的浏览器（Edge / Chrome / Chromium），可设 EDGE_PATH 指定'));
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--force-device-scale-factor=1',
      '--window-size=1080,1440',
      '--virtual-time-budget=2500',
      '--run-all-compositor-stages-before-draw',
      `--user-data-dir=${profileDir}`,
      `--screenshot=${pngPath.replace(/\\/g, '/')}`,
      pathToFileURL(htmlPath).href,
    ];
    const child = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { child.kill('SIGKILL'); } catch {}
        reject(new Error(`截图超时: ${path.basename(htmlPath)}`));
      }
    }, 45000);
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setTimeout(() => {
        const sz = fs.existsSync(pngPath) ? pngSize(pngPath) : null;
        if (sz && sz.w === 1080 && sz.h === 1440) resolve(sz);
        else reject(new Error(`截图无效: ${pngPath} ${sz ? `${sz.w}x${sz.h}` : '缺失'}`));
      }, 250);
    });
  });
}

/* -------------------------------- 主流程 -------------------------------- */
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('用法: node scripts/generate.mjs [--count 5] [--date 2026-10-23] [--force] [--no-shoot]');
    return;
  }

  const lib = readJSON(path.join(DATA, 'books.json'));
  if (!Array.isArray(lib.books) || lib.books.length < args.count) {
    throw new Error(`书库不足：需要至少 ${args.count} 本，当前 ${lib.books?.length || 0} 本`);
  }
  const statePath = path.join(DATA, 'state.json');
  const state = readJSON(statePath, { startDate: args.date, dayIndex: 0, lastUsed: {} });
  const day = (state.dayIndex || 0) + 1;

  const dateDir = path.join(OUT, args.date);
  const manifestPath = path.join(dateDir, 'manifest.json');
  if (fs.existsSync(manifestPath) && !args.force) {
    const old = readJSON(manifestPath);
    log(`⏭  ${args.date} 已生成过（${old.books?.length || 0} 本），跳过。需要重做请加 --force`);
    return;
  }

  const picks = pickBooks(lib, state, args.count);
  if (picks.length < args.count) throw new Error(`只选出 ${picks.length} 本，检查书库分类`);
  log(`📚 ${args.date} · 第 ${day} 天 · 选书: ${picks.map((b) => `《${b.t}》`).join(' ')}`);

  fs.mkdirSync(dateDir, { recursive: true });
  fs.mkdirSync(LOGS, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });
  const profileDir = path.join(CACHE, `edge-profile-${process.pid}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const ctxBase = {
    day,
    year: String(args.date).slice(0, 4),
    dateDot: args.date.replace(/-/g, '.'),
  };

  const manifest = {
    date: args.date,
    day,
    generatedAt: new Date().toISOString(),
    count: picks.length,
    status: 'pending_draft',
    note: '仅生成与打包草稿，未发布、未上传。',
    books: [],
  };

  for (let i = 0; i < picks.length; i++) {
    const b = picks[i];
    const indexLabel = pad(i + 1);
    const dir = path.join(dateDir, `${b.id}-${slug(b.t)}`);
    fs.mkdirSync(dir, { recursive: true });

    const pages = [
      { html: coverHTML(b, ctxBase), name: '01' },
      { html: quoteHTML(b, ctxBase), name: '02' },
      { html: essenceHTML(b, ctxBase), name: '03' },
    ];
    for (const p of pages) {
      fs.writeFileSync(path.join(dir, `page${p.name}.html`), p.html, 'utf8');
    }

    if (args.shoot) {
      for (const p of pages) {
        const png = path.join(dir, `${p.name}.png`);
        const sz = await shoot(path.join(dir, `page${p.name}.html`), png, profileDir);
        log(`   🖼  ${indexLabel} 《${b.t}》 ${p.name}.png  ${sz.w}x${sz.h}  ${(sz.bytes / 1024).toFixed(0)}KB`);
      }
    }

    const caption = buildCaption(b);
    const tags = buildTags(b);
    fs.writeFileSync(
      path.join(dir, 'caption.txt'),
      `${buildTitle(b)}\n\n${caption}\n\n${tags.join(' ')}\n`,
      'utf8'
    );

    const meta = {
      order: i + 1,
      id: b.id,
      title: `《${b.t}》`,
      bookTitle: b.t,
      author: b.a,
      category: b.c,
      douyinTitle: buildTitle(b),
      douyinDesc: `${caption}\n\n${tags.join(' ')}`,
      tags,
      images: [
        path.join(dir, '01.png'),
        path.join(dir, '02.png'),
        path.join(dir, '03.png'),
      ],
      html: [
        path.join(dir, 'page01.html'),
        path.join(dir, 'page02.html'),
        path.join(dir, 'page03.html'),
      ],
    };
    writeJSON(path.join(dir, 'meta.json'), meta);
    manifest.books.push(meta);
  }

  writeJSON(manifestPath, manifest);

  // 今日文案总表
  const md = [
    `# ${args.date} · 第 ${day} 天 · ${picks.length} 本`,
    '',
    '> 仅生成草稿包，未发布。',
    '',
    ...manifest.books.map(
      (m) =>
        `## ${pad(m.order)} ${m.title}\n\n**发布标题**：${m.douyinTitle}\n\n**文案**：\n\n${m.douyinDesc}\n\n**图片**：\n${m.images
          .map((p, i) => `- ${i + 1}. ${p}`)
          .join('\n')}\n`
    ),
  ].join('\n');
  fs.writeFileSync(path.join(dateDir, 'captions.md'), md, 'utf8');

  // 草稿包
  const draftDir = path.join(DRAFTS, args.date);
  fs.mkdirSync(draftDir, { recursive: true });
  writeJSON(path.join(draftDir, 'manifest.json'), manifest);
  fs.writeFileSync(
    path.join(draftDir, 'PENDING.md'),
    `# 待入抖音草稿箱 · ${args.date}\n\n` +
      `共 ${picks.length} 本、${picks.length * 3} 张图。\n\n` +
      `状态：**未上传**。本机未检测到 dsh-douyin-publish 插件。\n\n` +
      `安装插件后运行：\n\n\`node scripts/upload-drafts.mjs --date ${args.date}\`\n\n` +
      `红线：只写入草稿箱，不发布。\n`,
    'utf8'
  );

  // 更新状态
  const next = {
    startDate: state.startDate || args.date,
    dayIndex: (state.dayIndex || 0) + 1,
    lastUsed: { ...(state.lastUsed || {}) },
    lastRun: args.date,
  };
  for (const b of picks) next.lastUsed[b.id] = args.date;
  writeJSON(statePath, next);

  log(`✅ 完成：${picks.length} 本 / ${picks.length * 3} 张图 -> ${dateDir}`);
  log(`📦 草稿包 -> ${draftDir}（未上传、未发布）`);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exitCode = 1;
});

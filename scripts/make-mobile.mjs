#!/usr/bin/env node
/**
 * 生成「手机版」每日书单页面：视频可在线播放 + 标题文案一键复制。
 *
 *   node scripts/make-mobile.mjs --date 2026-10-24
 *   node scripts/make-mobile.mjs --date 2026-10-24 --base https://example.com/books
 *
 * 产物：output/<日期>/mobile/index.html（所有资源用相对路径，整目录可直接上传）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const pad = (n) => String(n).padStart(2, '0');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const date = arg('--date', new Date().toISOString().slice(0, 10));
const base = arg('--base', '');

const outDir = path.join(ROOT, 'output', date);
const manifestPath = path.join(outDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`✗ 没有 ${manifestPath}`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'books.json'), 'utf8'));
const byId = new Map(lib.books.map((b) => [b.id, b]));

const TITLE_MAX = 20;
const len = (s) => [...String(s)].length;
function makeTitle(book, i = 0) {
  const core = book.p.join('').replace(/[，。！？、,.!?]/g, '');
  const cands = [
    `读完《${book.t}》${core}`,
    `${core}｜${book.c}必读`,
    `读完《${book.t}》：${core}`,
    `《${book.t}》：${core}`,
    `${core}`,
    `读完《${book.t}》`,
  ];
  for (const c of cands) if (len(c) <= TITLE_MAX) return c;
  return [...`读完《${book.t}》：${core}`].slice(0, TITLE_MAX).join('');
}
function makeDesc(book) {
  const tags = (book.tags || []).join(' ');
  let s = `读完《${book.t}》我才发现：${book.p.join('，')}。\n\n${book.s}\n\n${book.fit ? `适合${book.fit}。` : ''}`;
  const room = 1000 - len(tags) - 4;
  if (len(s) > room) s = [...s].slice(0, room).join('') + '…';
  return `${s.trim()}\n\n${tags}`;
}

const rel = (abs) => path.relative(path.join(outDir, 'mobile'), abs).replace(/\\/g, '/');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* 手机页如果只发布目录、不带 output/<日期>/ 下的原图，原图就会 404。
   所以把图片内联成 data URL：页面自包含，单文件即可访问。
   maxW 是给缩略图/海报用的宽度，原图仍按 1080 出，这里只缩小以控制页面体积。 */
const resizedCache = new Map();
function dataUrl(abs, maxW) {
  const key = `${abs}|${maxW || 'orig'}`;
  if (resizedCache.has(key)) return resizedCache.get(key);
  let out;
  if (!maxW) {
    out = `data:image/png;base64,${fs.readFileSync(abs).toString('base64')}`;
  } else {
    // 用 Edge 原生缩放渲染一张小图，避免引入图像库
    const dir = path.join(ROOT, '.cache', 'thumb');
    fs.mkdirSync(dir, { recursive: true });
    const small = path.join(dir, `${path.basename(path.dirname(abs))}-${path.basename(abs, '.png')}-${maxW}.png`);
    if (!fs.existsSync(small)) {
      const browser = findBrowserPath();
      if (browser) {
        const h = path.join(dir, 'scale.html');
        fs.writeFileSync(
          h,
          `<body style="margin:0"><img id=i src="file:///${abs.replace(/\\/g, '/')}" style="width:${maxW}px;display:block"></body>`
        );
        try {
          execFileSync(
            browser,
            ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
              `--user-data-dir=${path.join(dir, 'profile')}`, `--window-size=${maxW},${Math.round((maxW * 1440) / 1080)}`,
              '--virtual-time-budget=1500', `--screenshot=${small.replace(/\\/g, '/')}`,
              `file:///${h.replace(/\\/g, '/')}`],
            { stdio: 'ignore', timeout: 30000 }
          );
        } catch {}
      }
    }
    const src = fs.existsSync(small) ? small : abs;
    out = `data:image/png;base64,${fs.readFileSync(src).toString('base64')}`;
  }
  resizedCache.set(key, out);
  return out;
}

function findBrowserPath() {
  const cands = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return cands.find((c) => {
    try { return fs.existsSync(c); } catch { return false; }
  }) || null;
}

const items = manifest.books.map((b, i) => {
  const src = byId.get(b.id) || {};
  const book = { t: b.bookTitle, c: b.category, p: src.p || [], s: src.s || '', fit: src.fit, tags: b.tags };
  const videoAbs = path.join(outDir, `${b.id}-${b.bookTitle}.mp4`);
  return {
    order: b.order ?? i + 1,
    title: b.bookTitle,
    author: b.author,
    cat: b.category,
    dTitle: makeTitle(book, i),
    desc: makeDesc(book),
    video: fs.existsSync(videoAbs) ? rel(videoAbs) : null,
    cover: dataUrl(b.images[0]),
    poster: dataUrl(b.images[0], 480),
    images: b.images.map((p) => dataUrl(p, 360)),
    videoSize: fs.existsSync(videoAbs) ? (fs.statSync(videoAbs).size / 1024 / 1024).toFixed(1) : null,
  };
});

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0C0B09">
<title>${esc(date)} 每日书单 · ${manifest.books.length} 本</title>
<style>
:root{--ink:#0C0B09;--red:#C0392B;--cream:#F4F0E5;--paper:#FBFAF6;--line:#E6E0D2;--mute:#8A8477}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--cream);color:var(--ink);max-width:100%;overflow-x:hidden;
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
img,video{max-width:100%}
body{padding:0 0 40px}
.hd{padding:26px 20px 18px;background:#fff;border-bottom:1px solid var(--line)}
.hd h1{margin:0;font-size:clamp(17px,4.6vw,21px);letter-spacing:-.01em}
.hd h1 small{display:block;margin-top:6px;font-size:12px;color:var(--mute);font-weight:400;letter-spacing:.08em}
.hint{margin:14px 20px 0;background:#FFF8E6;border-left:3px solid var(--red);border-radius:0 10px 10px 0;
  padding:11px 14px;font-size:13px;line-height:1.75;color:#4C4740}
.card{background:#fff;margin:14px 14px 0;border-radius:16px;overflow:hidden;max-width:100%;
  box-shadow:0 1px 0 var(--line),0 10px 30px rgba(0,0,0,.05)}
.card .top{display:flex;align-items:baseline;gap:10px;padding:16px 18px 12px;min-width:0}
.wrap{padding:0 14px 12px}
.wrap video,.wrap img{max-width:100%;display:block;margin:0 auto}
.wrap img.cover{width:100%;max-width:100%;height:auto}
.thumbs img{width:100%;height:auto;border-radius:8px;border:1px solid var(--line);display:block;object-fit:cover}
.cover{width:100%;max-width:100%;border-radius:10px;overflow:hidden;margin:0 auto}
.no{font-family:Georgia,serif;font-style:italic;font-size:24px;color:var(--red);line-height:1;flex:none}
.ttl{font-size:18px;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub{font-size:11px;color:var(--mute);margin-left:auto;letter-spacing:.05em;flex:none}
.video{display:block;width:100%;max-width:100%;background:#000;aspect-ratio:9/16;object-fit:contain}
.cover{display:block;width:100%;max-width:100%;background:#111}
.ctrl{display:flex;gap:10px;padding:12px 18px;border-bottom:1px solid var(--line)}
button{flex:1;font:inherit;font-size:14px;border-radius:999px;padding:11px 0;border:1px solid var(--ink);
  background:var(--ink);color:#fff;cursor:pointer}
button.ghost{background:#fff;color:var(--ink)}
button.done{background:#2E7D32;border-color:#2E7D32}
.fields{padding:14px 18px 18px}
.lab{display:flex;justify-content:space-between;font-size:11px;color:var(--mute);letter-spacing:.08em;margin:12px 0 6px}
.lab:first-child{margin-top:0}
.lab em{font-style:normal}
textarea{width:100%;border:1px solid var(--line);border-radius:10px;background:var(--paper);padding:10px 12px;
  font:inherit;font-size:14px;line-height:1.7;color:var(--ink);resize:none}
textarea.t{height:44px}
textarea.d{height:120px}
.thumbs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:0 14px 14px}
.toast{position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translate(-50%,20px);
  opacity:0;background:var(--ink);color:#fff;padding:12px 22px;border-radius:999px;font-size:14px;
  transition:.22s;pointer-events:none;z-index:9;white-space:nowrap}
.toast.on{opacity:1;transform:translate(-50%,0)}
.ft{text-align:center;font-size:11px;color:var(--mute);margin-top:22px;letter-spacing:.1em}
@media (prefers-color-scheme:dark){
  html,body{background:#0B0B0B;color:#F2EEE4}
  .hd{background:#111;border-color:#222}
  .card{background:#111;box-shadow:0 0 0 1px #1e1e1e}
  textarea{background:#181818;color:#EEE;border-color:#2a2a2a}
  .ctrl{border-color:#222}
  .thumbs img{border-color:#2a2a2a}
  button{background:#fff;color:#0C0B09;border-color:#fff}
  button.ghost{background:transparent;color:#EEE;border-color:#3a3a3a}
  button.done{background:#2E7D32;color:#fff;border-color:#2E7D32}
  .hint{background:#1d1a12;color:#D8D2C4}
}
</style></head>
<body>
<div class="hd">
  <h1>${esc(date)} · 每日书单<small>第 ${manifest.day} 天 · ${manifest.books.length} 本 · 每天更新</small></h1>
</div>
<div class="hint">点视频在线看；点「复制标题 / 复制文案」→ 去抖音图文或视频发布页粘贴。全程不要点「发布」，存档即可。</div>
<div id="list"></div>
<div class="ft">每日书单 · 只读好书</div>
<div class="toast" id="toast">已复制</div>

<script>
const DATA = ${JSON.stringify({ date, day: manifest.day, base, items })};

function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('on');
  clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),1500);}

async function copy(text, btn){
  try{ await navigator.clipboard.writeText(text); }
  catch(e){
    const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();ta.setSelectionRange(0,text.length);
    document.execCommand('copy');ta.remove();
  }
  if(btn){const l=btn.dataset.label;btn.textContent='✓ 已复制';btn.classList.add('done');
    setTimeout(()=>{btn.textContent=l;btn.classList.remove('done')},1400);}
  toast('已复制，去抖音粘贴');
}

function videoSrc(it){
  if(DATA.base) return DATA.base.replace(/\\/$/,'') + '/' + it.video;
  return it.video;
}

const list=document.getElementById('list');
DATA.items.forEach((it)=>{
  const card=document.createElement('section');card.className='card';
  card.innerHTML = \`
    <div class="top">
      <span class="no">\${String(it.order).padStart(2,'0')}</span>
      <span class="ttl">《\${it.title}》</span>
      <span class="sub">\${it.cat||''}</span>
    </div>
    \${it.video
      ? \`<div class="wrap"><video class="video" controls playsinline preload="none"
          poster="\${it.poster}" src="\${videoSrc(it)}"></video></div>\`
      : \`<div class="wrap"><img class="cover" src="\${it.cover}" alt="《\${it.title}》封面"></div>\`}
    <div class="ctrl">
      <button class="ghost" data-label="复制标题">复制标题</button>
      <button data-label="复制文案">复制文案</button>
    </div>
    <div class="fields">
      <div class="lab"><span>标题</span><em>\${[...it.dTitle].length} / 20</em></div>
      <textarea class="t" readonly>\${it.dTitle}</textarea>
      <div class="lab"><span>文案 + 标签</span><em>\${[...it.desc].length} / 1000</em></div>
      <textarea class="d" readonly>\${it.desc}</textarea>
    </div>
    <div class="thumbs">\${it.images.map((s,i)=>\`<img src="\${s}" alt="图\${i+1}">\`).join('')}</div>\`;
  list.appendChild(card);

  const [bT,bD]=card.querySelectorAll('.ctrl button');
  bT.addEventListener('click',()=>copy(it.dTitle,bT));
  bD.addEventListener('click',()=>copy(it.desc,bD));
});
</script>
</body></html>`;

const mDir = path.join(outDir, 'mobile');
fs.mkdirSync(mDir, { recursive: true });
fs.writeFileSync(path.join(mDir, 'index.html'), html, 'utf8');
fs.writeFileSync(path.join(mDir, 'data.json'), JSON.stringify({ date, day: manifest.day, base, items }, null, 2), 'utf8');
console.log(`✅ 手机版：${path.join(mDir, 'index.html')}`);
const withVideo = items.filter((i) => i.video).length;
console.log(`   ${items.length} 本${withVideo ? ` · ${withVideo} 个视频` : ''}`);
for (const it of items) {
  console.log(`   ${pad(it.order)} 《${it.title}》 标题 ${len(it.dTitle)} 字${it.video ? ` · 视频 ${it.videoSize}MB` : ''}`);
}

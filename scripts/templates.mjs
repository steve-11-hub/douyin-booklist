import { pathToFileURL } from 'node:url';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const len = (s) => [...String(s)].length;

// 防止“·”被断到行首，同时保持中文正常换行
const typo = (s) => esc(s).replace(/·/g, '\u2060·\u2060');

function fit(chars, width, max, min) {
  return Math.max(min, Math.min(max, Math.floor((width / Math.max(chars, 1)) * 0.98)));
}

const BASE_CSS = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1080px;height:1440px;overflow:hidden}
  body{
    background:#fff;color:#0C0B09;
    font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased;
    text-rendering:geometricPrecision;
  }
  .serif{font-family:"Source Han Serif SC Heavy","Source Han Serif SC","Noto Serif SC",serif;font-weight:900}
  .mono{font-family:Georgia,"Times New Roman",serif}
  .page{position:relative;width:1080px;height:1440px;overflow:hidden}
  .tick{position:absolute;width:14px;height:14px;z-index:5}
  .tick:before,.tick:after{content:"";position:absolute;background:#CFC9BA}
  .tick:before{width:14px;height:1px;top:6px;left:0}
  .tick:after{width:1px;height:14px;left:6px;top:0}
  .tick.tl{left:26px;top:26px}.tick.tr{right:26px;top:26px}
  .tick.bl{left:26px;bottom:26px}.tick.br{right:26px;bottom:26px}
`;

function shell(title, css, body, cls = '') {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${BASE_CSS}${css}</style></head>
<body><main class="page ${cls}">${body}</main></body></html>`;
}

/* ---------------------------------- 封面 ---------------------------------- */
export function coverHTML(book, ctx) {
  const W = 936;
  const setupText = book.setup || `读完《${book.t}》`;
  const payMax = Math.max(...book.p.map(len));
  const paySize = fit(payMax, W, 128, 70);
  const setupSize = fit(len(setupText), W, 84, 46);
  const hl = Number.isInteger(book.hl) ? book.hl : book.p.length - 1;

  const lines = book.p
    .map((line, i) =>
      i === hl
        ? `<div class="pline"><span class="hl">${typo(line)}</span></div>`
        : `<div class="pline">${typo(line)}</div>`
    )
    .join('');

  const body = `
  <div class="tick tl"></div><div class="tick tr"></div><div class="tick bl"></div><div class="tick br"></div>
  <div class="ghost mono">${String(book.id).slice(-2)}</div>

  <div class="top">
    <div class="brand"><i></i>每 日 书 单</div>
    <div class="issue mono"><em>NO.</em> ${esc(book.id)} <span>/ 100</span></div>
  </div>
  <div class="hair"></div>
  <div class="kicker">
    <span class="day mono">DAY ${String(ctx.day).padStart(2, '0')}</span>
    <span class="rdot"></span>
    <span class="cat">${esc(book.c)}</span>
    <span class="date mono">${esc(ctx.dateDot)}</span>
  </div>

  <h1 class="serif">
    <span class="setup" style="font-size:${setupSize}px">${typo(setupText)}</span>
    <span class="turn">${esc(book.turn || '我才发现')}</span>
    <span class="pay" style="font-size:${paySize}px">${lines}</span>
  </h1>

  <p class="sub"><i></i>${esc(book.s)}</p>

  <div class="note">
    <div class="note-hd mono">MARGIN NOTES</div>
    <div class="note-row"><span>适 合</span><b>${esc(book.fit || '想读点真东西的人')}</b></div>
    <div class="note-row"><span>读 法</span><b>3 张图 · 约 5 分钟</b></div>
  </div>

  <div class="vtext">每天五本 · 只读好书 · ${esc(ctx.year)}</div>

  <div class="foot">
    <div class="fbook">
      <div class="ft serif">《${esc(book.t)}》</div>
      <div class="fa">${esc(book.a)}</div>
    </div>
    <div class="fnum mono"><b>01</b><span>—</span>03</div>
  </div>`;

  const css = `
  .cover{background:#fff;padding:0 72px}
  .ghost{position:absolute;right:2px;bottom:212px;font-size:340px;line-height:1;font-style:italic;
         color:#F4F0E6;z-index:0;letter-spacing:-.04em}
  .top{position:relative;z-index:2;display:flex;justify-content:space-between;align-items:flex-end;
       padding-top:58px}
  .brand{font-size:19px;letter-spacing:.34em;font-weight:700;display:flex;align-items:center;gap:12px}
  .brand i{width:11px;height:11px;background:#0C0B09;display:block}
  .issue{font-size:23px;font-style:italic;letter-spacing:.02em;color:#0C0B09}
  .issue em{font-style:normal;font-family:"Noto Sans SC",sans-serif;font-size:13px;letter-spacing:.18em;color:#8A8477;margin-right:6px}
  .issue span{color:#A9A292;font-size:18px}
  .hair{position:relative;z-index:2;height:1px;background:#0C0B09;margin-top:18px;opacity:.9}
  .kicker{position:relative;z-index:2;display:flex;align-items:center;gap:14px;margin-top:44px;
          font-size:15px;letter-spacing:.16em;color:#6F6A5E}
  .kicker .day{font-style:italic;letter-spacing:.08em;font-size:16px;color:#0C0B09}
  .rdot{width:7px;height:7px;background:#D8382B;border-radius:50%}
  .cat{font-weight:700;color:#0C0B09;letter-spacing:.3em}
  .date{margin-left:auto;font-style:italic;letter-spacing:.06em;font-size:16px;color:#8A8477}

  h1{position:relative;z-index:2;margin-top:30px;font-weight:900}
  .setup{display:block;line-height:1.28;letter-spacing:-.015em;color:#17150F;white-space:nowrap}
  .turn{display:block;margin:22px 0 20px;font-family:"Noto Sans SC",sans-serif;font-weight:500;
        font-size:21px;letter-spacing:.42em;color:#938C7D}
  .pay{display:block;line-height:1.16;letter-spacing:-.02em}
  .pline{display:block;margin-bottom:6px}
  .hl{display:inline-block;background:#0C0B09;color:#fff;padding:2px 16px 12px;margin-left:-16px}

  .sub{position:relative;z-index:2;margin-top:46px;font-size:28px;line-height:1.9;color:#3F3B34;
       max-width:820px;letter-spacing:.01em}
  .sub{padding-left:24px;border-left:3px solid #D8382B}

  .note{position:absolute;left:72px;bottom:268px;z-index:2;width:580px}
  .note-hd{font-size:11px;letter-spacing:.3em;color:#B3AB99;margin-bottom:14px}
  .note-row{display:flex;align-items:baseline;gap:18px;padding:9px 0;border-top:1px solid #EDE8DB}
  .note-row span{font-size:13px;letter-spacing:.3em;color:#9C9483;width:54px;flex:none}
  .note-row b{font-size:19px;font-weight:500;color:#2A2721;letter-spacing:.02em}

  .vtext{position:absolute;right:26px;top:560px;writing-mode:vertical-rl;font-size:12px;
         letter-spacing:.42em;color:#B3AB99;z-index:2}

  .foot{position:absolute;left:72px;right:72px;bottom:56px;z-index:2;display:flex;
        justify-content:space-between;align-items:flex-end;border-top:2px solid #0C0B09;padding-top:20px}
  .ft{font-size:30px;letter-spacing:-.01em;line-height:1.2}
  .fa{font-size:17px;color:#8A8477;margin-top:9px;letter-spacing:.04em}
  .fnum{font-size:24px;letter-spacing:.06em;color:#A9A292}
  .fnum b{color:#0C0B09;font-weight:400}
  .fnum span{margin:0 8px;color:#CFC8B8}
  `;

  return shell(`${book.t} · 封面`, css, body, 'cover');
}

/* --------------------------------- 干货页 --------------------------------- */
export function quoteHTML(book, ctx) {
  const qlen = len(book.q);
  const clauses = book.q.match(/[^，。；：！？、]+[，。；：！？、]?/g) || [book.q];
  const maxClause = Math.max(...clauses.map(len));
  const useClauses = maxClause <= 16;
  let qsize = qlen <= 16 ? 76 : qlen <= 26 ? 68 : qlen <= 38 ? 60 : 52;
  if (useClauses) qsize = Math.min(qsize, Math.floor((900 / maxClause) * 0.98));
  qsize = Math.max(qsize, 44);
  const isOriginal = book.qt !== '提炼';
  const quoteInner = useClauses
    ? clauses.map((c) => `<span class="cl">${typo(c)}</span>`).join('')
    : typo(book.q);

  const body = `
  <div class="tick tl"></div><div class="tick tr"></div><div class="tick bl"></div><div class="tick br"></div>
  <div class="p2top">
    <div class="p2no mono"><b>02</b><span>${isOriginal ? '原 文 金 句' : '观 点 提 炼'}</span></div>
    <div class="p2book">《${esc(book.t)}》</div>
  </div>
  <div class="qmark serif">“</div>
  <blockquote class="serif" style="font-size:${qsize}px">${quoteInner}</blockquote>
  <div class="qmeta">
    <span class="qline"></span>
    <span>${esc(book.a)}　《${esc(book.t)}》</span>
    <span class="badge">${isOriginal ? '原文' : '提炼'}</span>
  </div>

  <section class="panel">
    <div class="plain-hd"><i></i>白 话 解 读</div>
    <p style="font-size:${len(book.e) > 44 ? 28 : 31}px">${esc(book.e)}</p>
    <div class="p2foot">
      <div class="pf-left"><span class="pfd"></span>每天五本 · 第 ${String(ctx.day).padStart(2, '0')} 天</div>
      <div class="pf-right mono">02 <span>/</span> 03</div>
    </div>
  </section>`;

  const css = `
  .quote{background:#F4F0E5;padding:0 72px;color:#14120E}
  .p2top{display:flex;justify-content:space-between;align-items:baseline;padding-top:58px}
  .p2no{display:flex;align-items:baseline;gap:16px}
  .p2no b{font-size:26px;font-style:italic;font-weight:400}
  .p2no span{font-size:13px;letter-spacing:.34em;color:#6F6A5E}
  .p2book{font-size:15px;letter-spacing:.08em;color:#8A8477}
  .qmark{position:absolute;left:46px;top:176px;font-size:240px;line-height:.8;color:#D8382B;z-index:0}
  blockquote{position:relative;z-index:2;margin-top:214px;padding-left:24px;line-height:1.62;
             letter-spacing:.005em;max-width:912px}
  .cl{display:inline-block}
  .qmeta{position:relative;z-index:2;display:flex;align-items:center;gap:14px;margin-top:38px;
         padding-left:24px;font-size:15px;letter-spacing:.06em;color:#7A7467}
  .qline{width:34px;height:1px;background:#B9B19F}
  .badge{font-size:11px;letter-spacing:.18em;border:1px solid #B9B19F;padding:4px 8px 3px;color:#7A7467}

  .panel{position:absolute;left:0;right:0;bottom:0;height:500px;background:#12100C;color:#fff;
         padding:54px 72px 0;z-index:3}
  .plain-hd{display:flex;align-items:center;gap:12px;font-size:13px;letter-spacing:.34em;color:#A39C8B}
  .plain-hd i{width:9px;height:9px;background:#D8382B;display:block}
  .panel p{margin-top:22px;line-height:1.95;color:#E9E3D4;letter-spacing:.01em;max-width:906px}
  .p2foot{position:absolute;left:72px;right:72px;bottom:42px;display:flex;justify-content:space-between;
          align-items:center;font-size:13px;letter-spacing:.18em;color:#7E7869}
  .pf-left{display:flex;align-items:center;gap:10px}
  .pfd{width:6px;height:6px;border-radius:50%;background:#D8382B}
  .pf-right{font-size:20px;letter-spacing:.06em}
  .pf-right span{color:#4A453B;margin:0 6px}
  `;

  return shell(`${book.t} · 金句`, css, body, 'quote');
}

/* --------------------------------- 引导页 --------------------------------- */
export function ctaHTML(book, ctx) {
  const body = `
  <div class="ghost3 mono">03</div>
  <div class="p3top">
    <div class="p3no mono"><b>03</b><span>入 门 指 南</span></div>
    <div class="p3issue">第 ${String(ctx.day).padStart(2, '0')} 期</div>
  </div>
  <div class="p3kicker"><i></i>写 给 第 一 次 读 它 的 你</div>
  <h2 class="serif">零基础<br><span>必看</span></h2>
  <p class="p3sub">不啃原著，3 张图读懂一本好书。<br>今天这本，叫《${esc(book.t)}》。</p>

  <a class="cta">
    <span class="cta-t">同款书单 · 主页合集</span>
    <span class="cta-a">→</span>
  </a>
  <div class="p3path">主页 <span>›</span> 合集 <span>›</span> 「每日书单」</div>

  <div class="p3foot">
    <div class="p3f-l"><i></i>每 日 08:00 · 五 本 好 书</div>
    <div class="dots"><b></b><b></b><b></b></div>
  </div>`;

  const css = `
  .cta-page{background:#0B0B0B;color:#fff;padding:0 72px}
  .p3top{display:flex;justify-content:space-between;align-items:baseline;padding-top:58px;
         position:relative;z-index:2}
  .p3no{display:flex;align-items:baseline;gap:16px}
  .p3no b{font-size:26px;font-style:italic;font-weight:400;color:#fff}
  .p3no span{font-size:13px;letter-spacing:.34em;color:#8C877C}
  .p3issue{font-size:13px;letter-spacing:.2em;color:#8C877C}
  .p3kicker{position:relative;z-index:2;display:flex;align-items:center;gap:12px;margin-top:110px;
            font-size:14px;letter-spacing:.3em;color:#A9A292}
  .p3kicker i{width:9px;height:9px;background:#D8382B;display:block}
  h2{position:relative;z-index:2;margin-top:36px;font-size:196px;line-height:1.02;
     letter-spacing:-.03em;font-weight:900}
  h2 span{color:#fff}
  .p3sub{position:relative;z-index:2;margin-top:44px;font-size:29px;line-height:1.85;color:#BDB7A9;
         letter-spacing:.02em}
  .cta{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;
       width:660px;height:112px;margin-top:64px;background:#fff;color:#0B0B0B;border-radius:999px;
       padding:0 38px 0 44px;text-decoration:none}
  .cta-t{font-size:31px;font-weight:700;letter-spacing:.04em}
  .cta-a{font-size:38px;font-weight:300;line-height:1}
  .p3path{position:relative;z-index:2;margin-top:24px;font-size:15px;letter-spacing:.2em;color:#726D62}
  .p3path span{margin:0 10px;color:#4A463D}
  .p3foot{position:absolute;left:72px;right:72px;bottom:54px;display:flex;justify-content:space-between;
          align-items:center;z-index:2}
  .p3f-l{display:flex;align-items:center;gap:12px;font-size:13px;letter-spacing:.22em;color:#8C877C}
  .p3f-l i{width:6px;height:6px;border-radius:50%;background:#D8382B}
  .dots{display:flex;gap:9px}
  .dots b{width:7px;height:7px;border-radius:50%;background:#3A3A3A;display:block}
  .dots b:first-child{background:#fff}
  .ghost3{position:absolute;right:-30px;bottom:-150px;font-size:540px;line-height:1;font-style:italic;
          color:transparent;-webkit-text-stroke:1px #262626;z-index:0;letter-spacing:-.05em}
  `;

  return shell(`${book.t} · 引导`, css, body, 'cta-page');
}

export function pageURL(p) {
  return pathToFileURL(p).href;
}

import pptxgen from 'pptxgenjs';

const NAVY = '1B1B3A';
const ACCENT = 'FF5A36';
const MUTED = '6B6B80';
const LIGHT = 'F4F4F8';

const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB');
const fmtMoney = (n, cur) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n) || 0);
const fmtMoney2 = (n, cur) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

const fmtMoney4 = (n, cur) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(Number(n) || 0);

/**
 * One client-facing slide for a package. Only client fields are used: price,
 * creators, videos, views, reach, cost per 1,000 views. No fees or margin.
 */
export async function buildSlide({ proposal, pkg }) {
  const r = pkg.result;
  const c = r.client;
  const cur = r.currency;
  const price = pkg.agreed_price ?? c.price;
  const cpm = c.viewsPromised ? (price / c.viewsPromised) * 1000 : null;

  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pres.title = `${proposal.org_name || proposal.deal_title} — ${pkg.name}`;
  const s = pres.addSlide();
  s.background = { color: 'FFFFFF' };

  s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: ACCENT }, line: { color: ACCENT } });
  s.addText(proposal.org_name || proposal.deal_title || 'Creator campaign', {
    x: 0.6, y: 0.4, w: 9, h: 0.6, fontFace: 'Arial', fontSize: 28, bold: true, color: NAVY,
  });
  const inp = r.inputs || {};
  s.addText([inp.campaign || pkg.name, (inp.platforms || [inp.platform]).filter(Boolean).join(' & '), (inp.markets || [inp.market]).filter(Boolean).join(', '), inp.niche].filter(Boolean).join(' · '), {
    x: 0.6, y: 1.0, w: 12, h: 0.4, fontFace: 'Arial', fontSize: 14, color: MUTED,
  });

  // KPI tiles
  const tiles = [
    ['Investment', fmtMoney(price, cur)],
    ['Views we promise', fmtInt(c.viewsPromised)],
    ['Reach we promise', fmtInt(c.reachPromised)],
    ['Cost per 1,000 views', cpm ? fmtMoney2(cpm, cur) : '–'],
  ];
  tiles.forEach(([label, value], i) => {
    const x = 0.6 + i * 3.08;
    s.addShape(pres.ShapeType.roundRect, { x, y: 1.75, w: 2.88, h: 1.5, fill: { color: i === 0 ? NAVY : LIGHT }, line: { color: i === 0 ? NAVY : LIGHT }, rectRadius: 0.08 });
    s.addText(value, { x: x + 0.2, y: 1.9, w: 2.5, h: 0.75, fontFace: 'Arial', fontSize: 26, bold: true, color: i === 0 ? 'FFFFFF' : NAVY });
    s.addText(label, { x: x + 0.2, y: 2.6, w: 2.5, h: 0.45, fontFace: 'Arial', fontSize: 12, color: i === 0 ? 'D0D0E0' : MUTED });
  });

  // Creators table
  const head = ['Creator size', 'Creators', 'Videos each', 'Videos'].map((t) => ({
    text: t, options: { bold: true, color: 'FFFFFF', fill: { color: NAVY } },
  }));
  const several = (inp.platforms?.length || 1) > 1 || (inp.markets?.length || 1) > 1;
  const rows = c.creators.map((cr) => [several ? `${cr.label} · ${cr.platform} · ${cr.market}` : cr.label, fmtInt(cr.count), fmtInt(cr.videosEach), fmtInt(cr.videos)]);
  if (c.giftedCreators) rows.push(['Gifted creators', fmtInt(c.giftedCreators), '–', fmtInt(c.giftedPosts)]);
  rows.push([
    { text: 'Total', options: { bold: true } },
    { text: fmtInt(c.totalCreators + (c.giftedCreators || 0)), options: { bold: true } },
    '',
    { text: fmtInt(c.totalVideos), options: { bold: true } },
  ]);
  s.addTable([head, ...rows], {
    x: 0.6, y: 3.6, w: 7.6, colW: [4.0, 1.2, 1.2, 1.2], fontFace: 'Arial', fontSize: 12, color: NAVY,
    border: { type: 'solid', color: 'E2E2EA', pt: 0.75 }, rowH: Math.min(0.36, 3.0 / (rows.length + 1)), valign: 'middle',
  });

  // Side notes
  const notes = [
    `${fmtInt(c.totalCreators)} creators producing ${fmtInt(c.totalVideos)} videos`,
    `Cost per view: ${c.viewsPromised ? fmtMoney4(price / c.viewsPromised, cur) : '–'}`,
  ];
  if (c.boostedViews) notes.push(`Plus about ${fmtInt(c.boostedViews)} boosted views from paid amplification (on top of the promised views)`);
  s.addText(notes.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })), {
    x: 8.6, y: 3.6, w: 4.2, h: 2.2, fontFace: 'Arial', fontSize: 13, color: NAVY, valign: 'top', paraSpaceAfter: 6,
  });
  s.addText('Promised views and reach are organic only and set conservatively.', {
    x: 0.6, y: 6.75, w: 12, h: 0.4, fontFace: 'Arial', fontSize: 10, italic: true, color: MUTED,
  });

  const buffer = await pres.write({ outputType: 'nodebuffer' });
  const safe = (x) => String(x || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
  return { buffer, fileName: `${safe(proposal.org_name || proposal.deal_title)}_${safe(pkg.name)}.pptx` };
}

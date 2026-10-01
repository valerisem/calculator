import pptxgenjs from 'pptxgenjs';
import { SIZE_BY_KEY } from './engine/constants.js';

// Campaign pricing slide, built from the "Campaign Pricing Template" (1920x1080).
// Coordinates are template pixels; 144 px = 1 inch on the 13.33 x 7.5 in slide.
const px = (v) => v / 144;
const pt = (v) => v / 2; // template px font size -> points

const THEMES = {
  light: {
    bg: 'F0EBFA',
    eyebrow: 'E91E8C',
    title: '1A1A2E',
    subtitle: '8B5CF6',
    subtitleFont: 'Montserrat',
    subtitleBold: true,
    card: 'FFFFFF',
    cardLine: 'E2D9F2',
    label: '5B5670',
    text: '1A1A2E',
    muted: '5B5670',
    badgeFill: 'FDE8F3',
    badgeLine: 'F9A8D4',
    badgeText: 'B0126A',
    check: '8B5CF6',
    totalFill: 'F7F3FD',
    totalLine: 'E2D9F2',
    totalText: 'E91E8C',
    tileFill: 'F7F3FD',
    tileLine: 'F7F3FD',
    tileTransparency: 0,
    tileValue: '8B5CF6',
    salesLine: 'C4B5FD',
    salesValue: 'E91E8C',
    icon: 'E91E8C',
  },
  dark: {
    bg: '0B0E1A',
    glow: '2B1140',
    eyebrow: 'E91E8C',
    title: 'FFFFFF',
    subtitle: 'C8D0D8',
    subtitleFont: 'Playfair Display',
    subtitleBold: false,
    card: '121728',
    cardLine: '2A2F40',
    label: 'C8D0D8',
    text: 'FFFFFF',
    muted: 'C8D0D8',
    badgeFill: '3A1530',
    badgeLine: 'E91E8C',
    badgeText: 'FFFFFF',
    check: 'E91E8C',
    totalFill: '2A1430',
    totalLine: '6B1F4A',
    totalText: 'E91E8C',
    tileFill: '1D2234',
    tileLine: '2A2F40',
    tileTransparency: 0,
    tileValue: 'E91E8C',
    salesLine: '4A3F6B',
    salesValue: '8B5CF6',
    icon: 'E91E8C',
  },
};

const SYMBOL = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', SGD: 'S$', CHF: 'CHF ', SEK: 'SEK ', NOK: 'NOK ', DKK: 'DKK ', PLN: 'PLN ' };
const money = (n, cur, digits = 0) =>
  `${SYMBOL[cur] ?? `${cur} `}${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const short = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
};
const followers = (n) => (n >= 1e6 ? `${n / 1e6}M` : `${Math.round(n / 1e3)}K`);
const int = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB');

// "18 micro creators · up to 50K followers", one line per tier.
function creatorLines(creators) {
  const tiers = new Map();
  for (const c of creators) {
    const band = SIZE_BY_KEY[c.size];
    const t = tiers.get(band.tier) || { tier: band.tier, count: 0, max: 0 };
    t.count += c.count;
    t.max = Math.max(t.max, band.max);
    tiers.set(band.tier, t);
  }
  return [...tiers.values()].map((t) =>
    t.max === Infinity
      ? `${int(t.count)} celebrity creators · 1M+ followers`
      : `${int(t.count)} ${t.tier.toLowerCase()} creator${t.count === 1 ? '' : 's'} · up to ${followers(t.max)} followers`,
  );
}

/**
 * @param {object} p
 * @param {object} p.proposal  pc_proposals row
 * @param {object} p.pkg       pc_packages row
 * @param {object} p.options   { theme, part, subtitle, oneLine, badge, extraLines[], estimatedSales, salesNote }
 */
export async function buildSlide({ proposal, pkg, options = {} }) {
  const T = THEMES[options.theme === 'dark' ? 'dark' : 'light'];
  const r = pkg.result;
  const c = r.client;
  const inp = r.inputs || {};
  const cur = r.currency;
  const price = c.price; // final quote, after any commercial adjustment
  const brand = proposal.org_name || '';
  const campaign = inp.campaign || proposal.campaign_name || 'Influencer campaign';
  const title = (brand ? `${campaign} for ${brand}` : campaign).toUpperCase();

  const pres = new pptxgenjs();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = `${campaign} – ${pkg.name}`;
  const s = pres.addSlide();
  s.background = { color: T.bg };
  if (T.glow) {
    s.addShape(pres.ShapeType.ellipse, { x: px(1000), y: px(-700), w: px(1800), h: px(1400), fill: { color: T.glow, transparency: 35 }, line: { color: T.glow, transparency: 100 } });
  }

  // Header
  const eyebrow = [options.part ? `PART ${options.part}` : null, 'INFLUENCER CAMPAIGN'].filter(Boolean).join(' · ');
  s.addText(eyebrow, { x: 0, y: px(66), w: px(1920), h: px(44), align: 'center', fontFace: 'Montserrat', bold: true, fontSize: pt(24), color: T.eyebrow, charSpacing: 2 });
  s.addText(title, { x: px(80), y: px(108), w: px(1760), h: px(90), align: 'center', fontFace: 'Montserrat', bold: true, fontSize: pt(title.length > 34 ? 52 : 64), color: T.title, fit: 'shrink' });
  if (options.subtitle) {
    s.addText(options.subtitle, { x: 0, y: px(192), w: px(1920), h: px(50), align: 'center', fontFace: T.subtitleFont, bold: T.subtitleBold, fontSize: pt(32), color: T.subtitle });
  }

  // Left card: the package
  const L = { x: 129, y: 277, w: 954, h: 730 };
  s.addShape(pres.ShapeType.roundRect, { x: px(L.x), y: px(L.y), w: px(L.w), h: px(L.h), fill: { color: T.card }, line: { color: T.cardLine, width: 1 }, rectRadius: px(20) });
  s.addText('INFLUENCER CAMPAIGN', { x: px(169), y: px(322), w: px(560), h: px(40), fontFace: 'Montserrat', bold: true, fontSize: pt(24), color: T.label, charSpacing: 1.5 });
  if (options.badge) {
    s.addShape(pres.ShapeType.roundRect, { x: px(751), y: px(317), w: px(292), h: px(47), fill: { color: T.badgeFill }, line: { color: T.badgeLine, width: 1 }, rectRadius: px(23) });
    s.addText(options.badge.toUpperCase(), { x: px(751), y: px(317), w: px(292), h: px(47), align: 'center', fontFace: 'Montserrat', bold: true, fontSize: pt(22), color: T.badgeText, charSpacing: 1 });
  }
  s.addText(
    [
      { text: money(price, cur), options: { fontFace: 'Montserrat', bold: true, fontSize: pt(88), color: T.title } },
      { text: '  / campaign', options: { fontFace: 'Inter', fontSize: pt(30), color: T.muted } },
    ],
    { x: px(165), y: px(372), w: px(860), h: px(110), valign: 'bottom' },
  );
  let y = 482;
  if (options.oneLine) {
    s.addText(options.oneLine, { x: px(169), y: px(y), w: px(870), h: px(40), fontFace: 'Inter', fontSize: pt(26), color: T.muted });
    y += 50;
  }
  const bullets = [
    ...creatorLines(c.creators),
    ...(c.giftedCreators ? [`${int(c.giftedCreators)} gifted creators · product seeding`] : []),
    `${inp.videosPerCreator || c.creators[0]?.videosEach || 1} video${(inp.videosPerCreator || 1) === 1 ? '' : 's'} per creator · organic usage rights included`,
    ...(c.boostedViews ? [`Plus ${short(c.boostedViews)} boosted views from paid amplification`] : []),
    ...(options.extraLines || []).filter((l) => l && l.trim()),
  ].slice(0, 8);
  const room = 870 - y; // space above the total box
  const step = Math.min(49, room / Math.max(bullets.length, 1));
  bullets.forEach((b, i) => {
    const by = y + 14 + i * step;
    s.addText('✓', { x: px(169), y: px(by), w: px(30), h: px(40), fontFace: 'Inter', fontSize: pt(24), color: T.check });
    s.addText(b, { x: px(213), y: px(by), w: px(830), h: px(40), fontFace: 'Inter', fontSize: pt(step < 44 ? 23 : 26), color: T.text, fit: 'shrink' });
  });
  s.addShape(pres.ShapeType.roundRect, { x: px(169), y: px(890), w: px(874), h: px(76), fill: { color: T.totalFill }, line: { color: T.totalLine, width: 1 }, rectRadius: px(16) });
  s.addText('TOTAL', { x: px(197), y: px(890), w: px(200), h: px(76), fontFace: 'Montserrat', bold: true, fontSize: pt(24), color: T.label, charSpacing: 1.5 });
  s.addText(`${int(c.totalCreators + (c.giftedCreators || 0))} creators · ${int(c.totalVideos)} videos`, {
    x: px(420), y: px(890), w: px(595), h: px(76), align: 'right', fontFace: 'Montserrat', bold: true, fontSize: pt(30), color: T.totalText,
  });

  // Right card: results
  const R = { x: 1113, y: 277, w: 678, h: 730 };
  s.addShape(pres.ShapeType.roundRect, { x: px(R.x), y: px(R.y), w: px(R.w), h: px(R.h), fill: { color: T.card }, line: { color: T.cardLine, width: 1 }, rectRadius: px(20) });
  s.addText('RESULTS', { x: px(1153), y: px(314), w: px(400), h: px(40), fontFace: 'Montserrat', bold: true, fontSize: pt(24), color: T.label, charSpacing: 1.5 });
  s.addShape(pres.ShapeType.ellipse, { x: px(1159), y: px(375), w: px(42), h: px(42), fill: { color: T.card }, line: { color: T.icon, width: 2 } });
  s.addText('✓', { x: px(1159), y: px(375), w: px(42), h: px(42), align: 'center', valign: 'middle', fontFace: 'Inter', bold: true, fontSize: pt(24), color: T.icon });
  s.addText('GUARANTEED', { x: px(1225), y: px(360), w: px(540), h: px(72), fontFace: 'Montserrat', bold: true, fontSize: pt(56), color: T.title });
  const cpv = c.viewsPromised ? price / c.viewsPromised : null;
  const ecpm = c.viewsPromised ? (price / c.viewsPromised) * 1000 : null;
  const tiles = [
    [short(c.viewsPromised), 'Video views'],
    [int(c.totalVideos), 'Videos'],
    [cpv ? money(cpv, cur, 3) : '–', 'Cost per view'],
    [ecpm ? money(ecpm, cur, 2) : '–', 'eCPM'],
  ];
  tiles.forEach(([value, label], i) => {
    const tx = i % 2 ? 1459 : 1153;
    const ty = i < 2 ? 452 : 596;
    s.addShape(pres.ShapeType.roundRect, { x: px(tx), y: px(ty), w: px(292), h: px(129), fill: { color: T.tileFill }, line: { color: T.tileLine, width: 1 }, rectRadius: px(16) });
    s.addText(value, { x: px(tx + 20), y: px(ty + 18), w: px(260), h: px(60), fontFace: 'Montserrat', bold: true, fontSize: pt(44), color: T.tileValue, fit: 'shrink' });
    s.addText(label, { x: px(tx + 20), y: px(ty + 76), w: px(260), h: px(36), fontFace: 'Inter', fontSize: pt(24), color: T.muted });
  });
  if (options.estimatedSales) {
    s.addShape(pres.ShapeType.roundRect, { x: px(1153), y: px(867), w: px(597), h: px(99), fill: { color: T.card }, line: { color: T.salesLine, width: 1.5, dashType: 'dash' }, rectRadius: px(16) });
    s.addText('ESTIMATED SALES', { x: px(1183), y: px(882), w: px(380), h: px(36), fontFace: 'Montserrat', bold: true, fontSize: pt(24), color: T.label, charSpacing: 1.5 });
    if (options.salesNote) s.addText(options.salesNote, { x: px(1183), y: px(918), w: px(380), h: px(34), fontFace: 'Inter', fontSize: pt(24), color: T.muted });
    s.addText(String(options.estimatedSales), { x: px(1500), y: px(867), w: px(222), h: px(99), align: 'right', valign: 'middle', fontFace: 'Montserrat', bold: true, fontSize: pt(44), color: T.salesValue });
  }

  const buffer = await pres.write({ outputType: 'nodebuffer' });
  const safe = (x) => String(x || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
  return { buffer, fileName: `${safe(brand || campaign)}_${safe(pkg.name)}_${options.theme === 'dark' ? 'dark' : 'light'}.pptx` };
}

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { SIZE_BY_KEY } from './engine/constants.js';

// Fills the House of Marketers proposal templates (light / dark, 33 slides)
// with a package and returns the deck, a subset of it, or a PDF.
const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

// Which template slides each output keeps (1-based, template order).
export const OUTPUTS = {
  presentation: { label: 'Full presentation', slides: [1, 2, 3, 4, 5, 11, 12, 19, 26, 27, 28, 30, 33] },
  template: { label: 'Full deck template', slides: Array.from({ length: 33 }, (_, i) => i + 1) },
  pricing: { label: 'Just pricing slides', slides: [27, 28, 30] },
  pricingPdf: { label: 'PDF, just pricing', slides: [28, 30], pdf: true },
};

const SYMBOL = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', SGD: 'S$' };
const money = (n, cur, digits = 0) =>
  `${SYMBOL[cur] ?? `${cur} `}${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const int = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB');
const short = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
};
const followers = (n) => (n >= 1e6 ? `${n / 1e6}M` : `${Math.round(n / 1e3)}K`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const USAGE_TEXT = { '30d': '30 days', '3m': '3 months', '6m': '6 months', '12m': '12 months', perpetual: 'perpetuity' };

// ---- slide XML helpers -----------------------------------------------------

// Replaces whole text runs equal to `from` (the nth one, or all when nth is null).
function setText(xml, from, to, nth = null) {
  let i = 0;
  return xml.replace(/<a:t>([^<]*)<\/a:t>/g, (m, t) => {
    if (unesc(t) !== from) return m;
    i += 1;
    return nth == null || i === nth ? `<a:t>${esc(to)}</a:t>` : m;
  });
}

// Replaces a substring inside every text run.
function replaceInText(xml, from, to) {
  return xml.replace(/<a:t>([^<]*)<\/a:t>/g, (m, t) => {
    const u = unesc(t);
    return u.includes(from) ? `<a:t>${esc(u.split(from).join(to))}</a:t>` : m;
  });
}

// Removes the shapes / pictures with these ids.
function removeShapes(xml, ids) {
  const set = new Set(ids.map(String));
  return xml.replace(/<p:(sp|pic)>[\s\S]*?<\/p:\1>/g, (m) => {
    const id = m.match(/<p:cNvPr id="(\d+)"/)?.[1];
    return set.has(id) ? '' : m;
  });
}

// Moves shapes vertically by dy EMU, and optionally changes their height.
function shiftShapes(xml, ids, dy, dh = 0) {
  const set = new Set(ids.map(String));
  return xml.replace(/<p:(sp|pic)>[\s\S]*?<\/p:\1>/g, (m) => {
    const id = m.match(/<p:cNvPr id="(\d+)"/)?.[1];
    if (!set.has(id)) return m;
    return m
      .replace(/<a:off x="(\d+)" y="(\d+)"\/>/, (_, x, y) => `<a:off x="${x}" y="${Number(y) + dy}"/>`)
      .replace(/<a:ext cx="(\d+)" cy="(\d+)"\/>/, (_, cx, cy) => `<a:ext cx="${cx}" cy="${Math.max(0, Number(cy) + dh)}"/>`);
  });
}

const shapeY = (xml, id) => Number(xml.match(new RegExp(`<p:cNvPr id="${id}"[\\s\\S]*?<a:off x="\\d+" y="(\\d+)"`))?.[1] || 0);

// ---- content from the package ------------------------------------------------

function tierLines(creators) {
  const tiers = new Map();
  for (const c of creators) {
    const band = SIZE_BY_KEY[c.size];
    const t = tiers.get(band.tier) || { tier: band.tier, count: 0, max: 0 };
    t.count += c.count;
    t.max = Math.max(t.max, band.max);
    tiers.set(band.tier, t);
  }
  const list = [...tiers.values()];
  const cap = (t) => (t.max === Infinity ? '1M+' : `up to ${followers(t.max)}`);
  if (list.length === 1) {
    const t = list[0];
    return [`${int(t.count)} ${t.tier.toLowerCase()} creator${t.count === 1 ? '' : 's'} · ${cap(t)} followers`];
  }
  // Several tiers share one line: "8 micro (up to 50K) · 2 mid (up to 150K) creators"
  return [`${list.map((t) => `${int(t.count)} ${t.tier.toLowerCase()} (${cap(t)})`).join(' · ')} creators`];
}

function usageLine(usage) {
  if (!usage) return null;
  const parts = [];
  if (usage.rights && usage.rights !== 'organic') parts.push(`Usage rights: ${USAGE_TEXT[usage.rights]}`);
  if (usage.paidUsage) parts.push('paid usage / whitelisting');
  if (usage.exclusivity === 'category') parts.push('category exclusivity');
  if (usage.exclusivity === 'competitor') parts.push('competitor exclusivity');
  return parts.length ? parts.join(' · ') : 'Organic usage rights included';
}

/**
 * @param {object} p
 * @param {object} p.proposal   pc_proposals row
 * @param {object} p.pkg        pc_packages row
 * @param {object} p.options    { theme, output, badge, oneLine, proposalLine, estimatedSales, salesNote, contactName, contactTitle, contactEmail, contactPhone }
 */
export async function buildDeck({ proposal, pkg, options = {} }) {
  const theme = options.theme === 'dark' ? 'dark' : 'light';
  const output = OUTPUTS[options.output] ? options.output : 'pricing';
  const keep = OUTPUTS[output].slides;
  const fill = output !== 'template'; // the template keeps placeholders we cannot fill
  const zip = await JSZip.loadAsync(await fs.readFile(path.join(TEMPLATES, `proposal-${theme}.pptx`)));

  const r = pkg.result;
  const c = r.client;
  const i = r.internal || {};
  const inp = r.inputs || {};
  const cur = r.currency;
  const client = proposal.org_name || proposal.deal_title || 'Client';
  const CLIENT = client.toUpperCase();
  const campaign = inp.campaign || proposal.campaign_name || '';
  const month = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
  const price = c.price;
  const media = (Number(i.costs?.paidMedia) || 0) + (Number(i.costs?.boostingPassThrough) || 0);
  const mediaFees = Number(i.costs?.fees) || 0;
  const paidPart = media > 0 ? media + mediaFees : 0;
  const influencerPart = price - paidPart;
  const cpv = c.viewsPromised ? price / c.viewsPromised : null;
  const ecpm = c.viewsPromised ? (price / c.viewsPromised) * 1000 : null;

  const slideXml = async (n) => zip.file(`ppt/slides/slide${n}.xml`).async('string');
  const save = (n, xml) => zip.file(`ppt/slides/slide${n}.xml`, xml);

  for (const n of keep) {
    let x = await slideXml(n);
    // Client and date everywhere.
    x = setText(x, 'HOUSE OF MARKETERS × [CLIENT] · [MONTH YEAR]', `HOUSE OF MARKETERS × ${CLIENT} · ${month}`);
    x = setText(x, '[CLIENT NAME]', client);
    x = replaceInText(x, '[CLIENT]', CLIENT);
    x = replaceInText(x, '[Client]', client);
    if (campaign) x = setText(x, '[Campaign line, e.g. The human way]', campaign);
    if (options.proposalLine || fill) {
      x = setText(x, '[One line on what this proposal sets out to do]', options.proposalLine || `An influencer campaign that delivers guaranteed views for ${client}`);
    }

    if (n === 28) x = fillInvestment(x, { fill, cur, influencerPart, paidPart, price, gifted: c.giftedCreators > 0 });
    if (n === 30) {
      x = fillPricing(x, { c, i, inp, cur, price, cpv, ecpm, options });
    }
    if (n === 33) {
      // Contact details: filled when given; in a client-ready deck, empty ones are blanked.
      const contact = [
        ['[Name]', options.contactName],
        ['[Job title]', options.contactTitle],
        ['[name]@houseofmarketers.com', options.contactEmail],
        ['[+44 (0) 0000 000000]', options.contactPhone],
      ];
      for (const [ph, v] of contact) if (v || fill) x = setText(x, ph, v || '');
    }
    // Page numbers follow the slides that are kept. The footer number is the
    // last run equal to the slide's number (step numbers like "02" come earlier).
    const pos = keep.indexOf(n) + 1;
    if (pos !== n) {
      const num = String(n).padStart(2, '0');
      const count = [...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].filter((m) => m[1] === num).length;
      if (count) x = setText(x, num, String(pos).padStart(2, '0'), count);
    }
    save(n, x);
  }

  await dropSlides(zip, Array.from({ length: 33 }, (_, k) => k + 1).filter((n) => !keep.includes(n)));
  const pptx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const safe = (s) => String(s || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50);
  const base = `${safe(client)}_${safe(campaign || pkg.name)}_${output}_${theme}`;
  if (!OUTPUTS[output].pdf) return { buffer: pptx, fileName: `${base}.pptx`, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  return { buffer: await toPdf(pptx), fileName: `${base}.pdf`, contentType: 'application/pdf' };
}

// Slide 28: investment summary. Part 2 = influencer campaign; Part 3 = paid ads
// when the package has pass-through media. Unused rows are removed (except in
// the template, which keeps them for the team to fill).
function fillInvestment(x, { fill, cur, influencerPart, paidPart, price, gifted }) {
  x = setText(x, '[Influencer campaign & gifting]', gifted ? 'Influencer campaign & gifting' : 'Influencer campaign');
  x = setText(x, '€[00,000]', money(influencerPart, cur), 2);
  if (paidPart > 0) {
    x = setText(x, '[Paid ads]', 'Paid ads');
    // after the Part 2 replacement, the Part 3 amount is the 2nd remaining placeholder
    x = setText(x, '€[00,000]', money(paidPart, cur), 2);
  }
  // Total is the last amount on the slide.
  const amounts = [...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => unesc(m[1]));
  const lastIdx = amounts.lastIndexOf('€[00,000]');
  if (lastIdx >= 0 && amounts.slice(lastIdx + 1).every((t) => !t.startsWith('€'))) {
    let k = 0;
    x = x.replace(/<a:t>([^<]*)<\/a:t>/g, (m) => (k++ === lastIdx ? `<a:t>${esc(money(price, cur))}</a:t>` : m));
  }
  if (!fill) return x;
  // Rows: [line, PART n, name, amount] ids; keep Part 2 (and Part 3 with paid media).
  const rows = { 1: [6, 7, 8, 9], 2: [10, 11, 12, 13], 3: [14, 15, 16, 17], 4: [18, 19, 20, 21] };
  const keepRows = [2, ...(paidPart > 0 ? [3] : [])];
  const step = shapeY(x, 10) - shapeY(x, 6);
  const drop = [1, 3, 4].filter((n) => !keepRows.includes(n));
  x = removeShapes(x, drop.flatMap((n) => rows[n]));
  keepRows.forEach((n, idx) => {
    const target = idx + 1; // slot position
    x = shiftShapes(x, rows[n], (target - n) * step);
  });
  const removed = 4 - keepRows.length;
  x = shiftShapes(x, [22, 23, 24], -removed * step); // total box
  x = shiftShapes(x, [5], 0, -removed * step); // card
  return x;
}

// Slide 30: the influencer campaign pricing slide.
function fillPricing(x, { c, i, inp, cur, price, cpv, ecpm, options }) {
  x = setText(x, '[INFLUENCER CAMPAIGN & GIFTING]', c.giftedCreators > 0 ? 'INFLUENCER CAMPAIGN & GIFTING' : 'INFLUENCER CAMPAIGN');
  x = setText(x, '[MOST POPULAR]', (options.badge || 'Most popular').toUpperCase());
  x = setText(x, '€[30,000]', money(price, cur));
  // "/ campaign" goes into the price paragraph as a second, smaller run, so it always
  // sits right after the price on the same baseline whatever the digits' widths.
  const labelShape = x.match(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:cNvPr id="9"[\s\S]*?<\/p:sp>/)?.[0];
  const labelRun = labelShape?.match(/<a:r>[\s\S]*?<\/a:r>/)?.[0];
  if (labelRun) {
    const priceShape = x.match(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:cNvPr id="8"[\s\S]*?<\/p:sp>/)?.[0];
    const priceLeft = Number(priceShape.match(/<a:off x="(\d+)"/)[1]);
    const labelOff = labelShape.match(/<a:off x="(\d+)"/);
    const labelRight = Number(labelOff[1]) + Number(labelShape.match(/<a:ext cx="(\d+)"/)[1]);
    const merged = priceShape
      .replace(/(<a:ext cx=")\d+/, `$1${labelRight - priceLeft}`)
      .replace(/(<a:t>[^<]*<\/a:t><\/a:r>)/, `$1${labelRun.replace(/<a:t>[^<]*<\/a:t>/, '<a:t> / campaign</a:t>')}`);
    x = x.replace(priceShape, merged).replace(labelShape, '');
  }
  const markets = (inp.markets || []).join(', ');
  const platforms = (inp.platforms || []).join(' & ');
  x = setText(x, '[One line on the campaign goal and audience]', options.oneLine || [platforms, markets, inp.niche].filter(Boolean).join(' · '));
  const tiers = tierLines(c.creators);
  const guarantees = (c.tierGuarantees || []).filter((t) => t.tier !== 'Gifted').map((t) => `${t.tier} ${short(t.guaranteedViews)}`).join(' · ');
  const slots = [
    tiers.join(' · '),
    c.giftedCreators > 0 ? `${int(c.giftedCreators)} gifted creators · product seeding` : `Guaranteed views by tier: ${guarantees}`,
    `${inp.videosPerCreator || 1} video${(inp.videosPerCreator || 1) === 1 ? '' : 's'} per creator · organic rights included`,
    usageLine(c.usage || inp.usage),
  ];
  x = setText(x, '[18] hero creators · up to [250K] followers', slots[0]);
  x = setText(x, '[100] micro creators · up to [40K] · gifted', slots[1]);
  x = setText(x, '[1] video per creator · organic rights included', slots[2]);
  x = setText(x, 'Paid usage: [90 days] hero · [perpetuity] on [50] micro videos', slots[3]);
  x = setText(x, '[118] creators · [118] videos', `${int(c.totalCreators + (c.giftedCreators || 0))} creators · ${int(c.totalVideos)} videos`);
  x = setText(x, '[8.0M]', short(c.viewsPromised));
  // No reach data yet: the second tile shows videos delivered.
  x = setText(x, '[7.2M]', int(c.totalVideos));
  x = setText(x, 'Minimum reach', 'Videos delivered');
  x = setText(x, '€[0.009]', cpv ? money(cpv, cur, 3) : '–');
  x = setText(x, '€[9.00]', ecpm ? money(ecpm, cur, 2) : '–');
  if (options.estimatedSales) {
    x = setText(x, '[2,200]', String(options.estimatedSales));
    x = setText(x, '[Excludes repeat purchases]', options.salesNote || 'Excludes repeat purchases');
  } else {
    x = removeShapes(x, [40, 41, 42, 43]); // estimated sales box
  }
  if (c.boostedViews > 0) x = setText(x, 'Video views', `Video views (+${short(c.boostedViews)} boosted)`);
  return x;
}

// Removes slides from the package: presentation list, relationships, files, notes.
async function dropSlides(zip, numbers) {
  if (!numbers.length) return;
  let pres = await zip.file('ppt/presentation.xml').async('string');
  let rels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  let types = await zip.file('[Content_Types].xml').async('string');
  for (const n of numbers) {
    const target = `slides/slide${n}.xml`;
    const rel = rels.match(new RegExp(`<Relationship [^>]*Target="${target}"[^>]*/>`))?.[0];
    const rid = rel?.match(/Id="(rId\d+)"/)?.[1];
    if (rid) {
      pres = pres.replace(new RegExp(`<p:sldId [^>]*r:id="${rid}"/>`), '');
      rels = rels.replace(rel, '');
    }
    const slideRels = zip.file(`ppt/slides/_rels/slide${n}.xml.rels`);
    if (slideRels) {
      const sr = await slideRels.async('string');
      for (const notes of sr.match(/notesSlides\/notesSlide\d+\.xml/g) || []) {
        zip.remove(`ppt/${notes}`);
        zip.remove(`ppt/${notes.replace('notesSlides/', 'notesSlides/_rels/')}.rels`);
        types = types.replace(new RegExp(`<Override [^>]*PartName="/ppt/${notes}"[^>]*/>`), '');
      }
      zip.remove(`ppt/slides/_rels/slide${n}.xml.rels`);
    }
    zip.remove(`ppt/slides/slide${n}.xml`);
    types = types.replace(new RegExp(`<Override [^>]*PartName="/ppt/${target}"[^>]*/>`), '');
  }
  zip.file('ppt/presentation.xml', pres);
  zip.file('ppt/_rels/presentation.xml.rels', rels);
  zip.file('[Content_Types].xml', types);
}

// PDF through LibreOffice (installed in the Docker image).
async function toPdf(pptx) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-'));
  try {
    const src = path.join(dir, 'deck.pptx');
    await fs.writeFile(src, pptx);
    await new Promise((resolve, reject) => {
      execFile(
        process.env.SOFFICE_PATH || 'soffice',
        ['--headless', '--norestore', `-env:UserInstallation=file://${dir}/profile`, '--convert-to', 'pdf', '--outdir', dir, src],
        { timeout: 90_000, env: { ...process.env, HOME: dir } },
        (err, _out, stderr) => (err ? reject(Object.assign(new Error(`PDF conversion failed: ${stderr || err.message}`), { status: 500 })) : resolve()),
      );
    });
    return await fs.readFile(path.join(dir, 'deck.pdf'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

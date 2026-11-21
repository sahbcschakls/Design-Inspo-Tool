#!/usr/bin/env node
// Turns a link into a reference in _inbox: a screenshot for websites, the pin image
// for Pinterest (and any page whose og:image is the point), plus a sidecar .md with
// the URL and your instructions.
//
//   npm run capture -- https://linear.app "Take the dark UI and the type scale"
//   npm run capture -- https://pin.it/abc123 --image
//   npm run capture -- links.txt          (one URL per line, optional " | instructions")
//
// Needs Playwright for screenshots:  npm i -D playwright && npx playwright install chromium
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { INBOX } from '../server/sections.js';

const args = process.argv.slice(2);
const wantImage = args.includes('--image');
const full = args.includes('--full');
const [target, ...words] = args.filter((a) => !a.startsWith('--'));
if (!target) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}

const inbox = path.join(getConfig().libraryDir, INBOX);
fs.mkdirSync(inbox, { recursive: true });

const jobs = fs.existsSync(target)
  ? fs.readFileSync(target, 'utf8').split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l)).map((l) => {
      const [url, note = ''] = l.split('|').map((x) => x.trim());
      return { url, note };
    })
  : [{ url: target, note: words.join(' ') }];

const slug = (url) => {
  const u = new URL(url);
  return `${u.hostname.replace(/^www\./, '')}${u.pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'link';
};
const unique = (base, ext) => {
  let f = path.join(inbox, base + ext);
  for (let i = 2; fs.existsSync(f); i++) f = path.join(inbox, `${base}-${i}${ext}`);
  return f;
};

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run:  npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
for (const { url, note } of jobs) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(async (e) => {
      if (page.url().startsWith('chrome-error') || page.url() === 'about:blank') throw new Error(`could not load (${e.message.split('\n')[0]})`);
      await page.waitForTimeout(3000);
    });
    const finalUrl = page.url().startsWith('http') ? page.url() : url;
    const og = await page.locator('meta[property="og:image"]').first().getAttribute('content').catch(() => null);
    const pinterest = /pinterest\.|pin\.it/.test(finalUrl);
    let file;
    if ((wantImage || pinterest) && og) {
      const res = await fetch(og);
      const type = res.headers.get('content-type') || 'image/jpeg';
      file = unique(slug(finalUrl), type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg');
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } else {
      file = unique(slug(finalUrl), '.png');
      await page.screenshot({ path: file, fullPage: full });
    }
    fs.writeFileSync(file.replace(/\.[a-z]+$/, '.md'), `url: ${url}\n${note ? `\n${note}\n` : ''}`);
    console.log(`✓ ${path.relative(process.cwd(), file)}`);
  } catch (e) {
    console.error(`✗ ${url}: ${e.message}`);
  }
}
await browser.close();

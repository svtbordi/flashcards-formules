// Bouton « Installer… » de l'accueil : masqué une fois l'application installée et le rappel ajouté.
// node tools/installe_test.mjs (serveur lancé avant : npm run serve).
import { chromium, devices } from 'playwright';
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
const fail = m => { console.log('ÉCHEC :', m); process.exitCode = 1; };

async function open(standalone) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined, acceptDownloads: true });
  if (standalone) {
    await ctx.addInitScript(() => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = q => (q.includes('standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  return { ctx, page };
}
const label = async page => (await page.$('#go-install')) ? (await page.textContent('#go-install')).trim() : '(pas de bouton)';

// navigateur : installer et rappel, puis rappel noté
let { ctx, page } = await open(false);
await page.goto('http://localhost:8765/');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('fc-formules-matiere-v1', 'maths'); });
await page.reload();
await page.waitForSelector('#go-all');
console.log('navigateur :', await label(page));
if (await label(page) !== 'Installer l’application et les rappels') fail('libellé de départ');
await page.click('#go-install');
await page.click('#ics-done');
await page.click('#btn-back');
console.log('navigateur, rappel noté :', await label(page));
if (await label(page) !== 'Installer l’application') fail('libellé après le rappel');
const state = await ctx.storageState();
await ctx.close();

// application installée, même stockage : plus de bouton, dans les deux matières ; page toujours dans les réglages
({ ctx, page } = await open(true));
await ctx.addInitScript(s => { if (!localStorage.length) for (const { name, value } of s) localStorage.setItem(name, value); }, state.origins[0].localStorage);
await page.goto('http://localhost:8765/');
await page.waitForSelector('#go-all');
console.log('installée, rappel noté :', await label(page));
if (await page.$('#go-install')) fail('bouton encore affiché');
await page.click('#btn-settings');
await page.click('#install-page');
console.log('page d’installation :', (await page.textContent('main')).replace(/\s+/g, ' ').slice(0, 90));
await page.evaluate(() => localStorage.setItem('fc-formules-matiere-v1', 'physique'));
await page.reload();
await page.waitForSelector('#go-all');
console.log('physique-chimie :', await label(page));
if (await page.$('#go-install')) fail('bouton affiché en physique-chimie');
await page.evaluate(() => localStorage.removeItem('fc-formules-rappel-v1'));
await page.reload();
await page.waitForSelector('#go-all');
console.log('installée, sans rappel :', await label(page));
if (await label(page) !== 'Ajouter le rappel quotidien') fail('libellé installée sans rappel');
await page.click('#go-install');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ics')]);
console.log('fichier :', dl.suggestedFilename());
await page.click('#btn-back');
if (await page.$('#go-install')) fail('bouton encore affiché après le téléchargement du rappel');
console.log('erreurs :', errors);
if (errors.length) process.exitCode = 1;
await browser.close();

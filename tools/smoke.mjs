// Parcours complet dans un navigateur de téléphone simulé : node tools/smoke.mjs /tmp/captures
// (serveur lancé avant : npm run serve). Les signalements sont interceptés, rien ne part.
import { chromium, devices } from 'playwright';
const shots = process.argv[2] || '/tmp/shots';
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined });
const page = await ctx.newPage();
const errors = [];
const reports = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.route('https://script.google.com/**', r => { reports.push(JSON.parse(r.request().postData())); r.fulfill({ body: 'ok' }); });
const text = async sel => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
await page.goto('http://localhost:8765/');
await page.evaluate(() => localStorage.setItem('fc-formules-maths-v1', JSON.stringify({ settings: { newPerDay: 40 } })));
await page.reload();
await page.waitForSelector('#go-all');
await page.screenshot({ path: `${shots}/1-accueil.png` });
console.log('accueil :', await text('.hero'));

// chapitres vus en cours
await page.click('#go-vus');
await page.check('input[data-code="F-TRIG"]');
await page.check('input[data-code="A7"]');
await page.click('#save-vus');
console.log('révisions :', await text('#go-all'));

// formulaire : QCM puis flashcards
await page.click('#go-form');
await page.waitForSelector('#qcm-go');
await page.click('#qcm-go');
await page.screenshot({ path: `${shots}/2-qcm.png` });
for (let i = 0; i < 10; i++) {
  await page.click(`.opt[data-k="${i % 4}"]`);
  if (i === 0) {
    await page.screenshot({ path: `${shots}/3-qcm-corrige.png` });
    await page.click('.report-btn');
    await page.check('input[value="qcm"]');
    await page.click('#rep-send');
    await page.waitForSelector('.report-box', { state: 'detached' });
  }
  await page.click('#qcm-next');
}
console.log('score :', await text('.hero'));
await page.click('#to-cards');
await page.waitForSelector('.flash');
await page.screenshot({ path: `${shots}/4-recto-formulaire.png` });
await page.click('#reveal');
await page.screenshot({ path: `${shots}/5-verso-formulaire.png` });
for (let i = 0; i < 12; i++) {
  if (await page.$('#reveal')) await page.click('#reveal');
  const btn = await page.$(i % 3 === 0 ? '.grade .again' : '.grade .good');
  if (!btn) break;
  await btn.click();
}
await page.click('#btn-back');

// fiches d'un chapitre de BCPST 2, sans échauffement
await page.click('#go-choose');
await page.check('input[data-code="B_PR4"]');
await page.click('#start');
await page.waitForSelector('#cards-go, #reveal, #ahead, #home');
if (await page.$('#cards-go')) await page.click('#cards-go');
console.log('B_PR4 :', await text('main'));
await page.click('#reveal');
await page.screenshot({ path: `${shots}/6-verso-fiche.png` });
await page.click('.report-btn');
await page.check('input[value="programme"]');
await page.fill('#rep-text', 'test : hors programme ?');
await page.screenshot({ path: `${shots}/7-signalement.png` });
await page.click('#rep-send');
await page.waitForSelector('.report-box', { state: 'detached' });
await page.click('.grade .good');
await page.click('#btn-back');
await page.click('#btn-back');

await page.click('#go-progress');
await page.screenshot({ path: `${shots}/8-progression.png`, fullPage: true });
await page.click('#btn-back');
await page.click('#btn-search');
await page.fill('#q', 'bayes');
await page.waitForSelector('#results .term-link');
console.log('recherche « bayes » :', await text('#results'));
await page.click('#results .term-link');
await page.screenshot({ path: `${shots}/9-recherche.png` });
const st = await page.evaluate(() => JSON.parse(localStorage.getItem('fc-formules-maths-v1')));
console.log('cartes notées', Object.keys(st.cards).length, 'réponses', st.log.length, 'QCM', st.qcmLog.length, 'en attente', st.pendingReports.length);
console.log('signalements envoyés :', reports.map(r => `${r.contexte} | ${r.type} | ${r.terme}`));
// formules non rendues par KaTeX (erreurs affichées en rouge)
const bad = await page.evaluate(async () => {
  const d = await fetch('data/cartes.json').then(r => r.json());
  return d.cards.filter(c => (tex(c.recto) + tex(c.verso)).includes('katex-error')).map(c => c.id);
});
const sw = await page.evaluate(async () => ((await navigator.serviceWorker.getRegistration()) ? 'sw ok' : 'pas de sw'));
console.log('formules en erreur :', bad, sw, 'erreurs :', errors);
await browser.close();

// Parcours physique-chimie : premier lancement (choix de la matière), formulaire, ordres de grandeur, chapitre S1,
// recherche, puis retour en mathématiques sans perte de progression. node tools/smoke_physique.mjs /tmp/captures
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
await page.waitForSelector('[data-matiere]');
await page.screenshot({ path: `${shots}/p1-choix-matiere.png` });
console.log('premier lancement :', await text('main'));
await page.click('[data-matiere="physique"]');
await page.waitForSelector('#go-all');
await page.screenshot({ path: `${shots}/p2-accueil.png`, fullPage: true });
console.log('titre :', await text('#title'), '| accueil :', await text('.actions'));

await page.click('#go-og');
await page.waitForSelector('#qcm-go');
await page.click('#qcm-go');
await page.screenshot({ path: `${shots}/p3-qcm-og.png` });
await page.click('.opt[data-k="0"]');
await page.screenshot({ path: `${shots}/p4-qcm-og-corrige.png` });
await page.click('#btn-back');

await page.click('#go-choose');
await page.check('input[data-code="S1"]');
await page.screenshot({ path: `${shots}/p5-chapitres.png`, fullPage: true });
await page.click('#start');
await page.waitForSelector('#cards-go, #qcm-go');
await page.click('#cards-go');
await page.click('#reveal');
await page.screenshot({ path: `${shots}/p6-verso-fiche.png` });
await page.click('.report-btn');
await page.check('input[value="erreur"]');
await page.click('#rep-send');
await page.waitForSelector('.report-box', { state: 'detached' });
for (let i = 0; i < 5; i++) {
  if (await page.$('#reveal')) await page.click('#reveal');
  await page.click('.grade .good');
}
await page.click('#btn-back');
await page.click('#btn-back');

await page.click('#go-form');
await page.waitForSelector('#cards-go, #qcm-go');
await page.click('#cards-go');
await page.click('#reveal');
await page.screenshot({ path: `${shots}/p7-verso-formulaire.png` });
await page.click('#btn-back');

await page.click('#btn-search');
await page.fill('#q', 'snell');
await page.waitForSelector('#results .term-link');
console.log('recherche « snell » :', await text('#results'));
await page.click('#btn-back');

const phys = await page.evaluate(() => JSON.parse(localStorage.getItem('fc-formules-physique-v1')));
console.log('physique : cartes notées', Object.keys(phys.cards).length);
console.log('signalements :', reports.map(r => `${r.contexte} | ${r.terme} | ${r.version}`));

// formules non rendues par KaTeX
const bad = await page.evaluate(async () => {
  const d = await fetch('data/physique/cartes.json').then(r => r.json());
  return d.cards.filter(c => (tex(c.recto) + tex(c.verso) + tex(c.q || '') + tex(c.ctx || '')).match(/katex-error|#cc0000/)).map(c => c.id);
});

// retour en mathématiques : progression séparée
await page.screenshot({ path: `${shots}/p8-changer-matiere.png` });
await page.click('#switch [data-matiere="maths"]');
await page.waitForSelector('#go-all');
console.log('titre :', await text('#title'), '|', await text('.muted.small:last-child'));
const keys = await page.evaluate(() => Object.keys(localStorage));
console.log('clés :', keys);
await page.reload();
await page.waitForSelector('#go-all');
console.log('après rechargement :', await text('#title'));
console.log('formules en erreur :', bad, 'erreurs :', errors);
await browser.close();

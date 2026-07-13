/**
 * Drive the real app in a real browser through the whole new flow:
 *   review gate → grade → Q&A drill (typed answers) → re-grade → report.
 * Screenshots in runs/e2e/. Dev server must be up.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'runs/e2e';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [browser error]', m.text().slice(0, 140));
});

console.log('→ http://localhost:3000');
await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 60_000 });

const badge = await page.locator('button[aria-expanded]:has-text("FBLA") .mono.border-2').innerText();
console.log(`✅ FBLA badge (confirmed/total): ${badge}`);

// ── an UNREVIEWED rubric must land on the review gate, not the recorder
await page.click('nav[aria-label="Events"] button:has-text("Public Speaking")');
await page.waitForTimeout(400);
const gated = await page.locator('text=CHECK THIS BEFORE IT SCORES ANYONE.').isVisible();
console.log(`✅ unreviewed rubric hits the review gate: ${gated}`);
const rows = await page.locator('input[type="number"]').count();
console.log(`✅ review table shows ${rows} editable criteria`);
await page.screenshot({ path: `${OUT}/1-review-gate.png`, fullPage: true });

// ── confirming it unlocks grading
await page.click('button:has-text("confirm it")');
await page.waitForTimeout(1200);
const unlocked = await page.locator('text=Record now').isVisible();
console.log(`✅ confirming unlocks the recorder: ${unlocked}`);
await page.screenshot({ path: `${OUT}/2-unlocked.png` });

// ── grade a run
console.log('→ uploading fixtures/sales-pitch.wav');
await page.setInputFiles('input[type="file"]', 'fixtures/sales-pitch.wav');
await page.waitForSelector('text=Your run is with the judge', { timeout: 60_000 });
await page.waitForSelector('text=The judge’s note', { timeout: 280_000 });

const score1 = await page.locator('main header span.display').first().innerText();
console.log(`✅ first grade: ${score1}`);

// ── the Q&A criterion must be UNSCORED and offer the drill
const cta = page.locator('button:has-text("Answer the judge")');
const hasCta = await cta.isVisible();
console.log(`✅ offers the Q&A drill: ${hasCta}`);
await page.screenshot({ path: `${OUT}/3-report-before-qa.png`, fullPage: true });

if (!hasCta) {
  console.log('❌ no Q&A drill offered — nothing left to test');
  await browser.close();
  process.exit(1);
}

// ── do the drill
await cta.click();
await page.waitForSelector('text=THE JUDGE HAS QUESTIONS.', { timeout: 15_000 });
const boxes = page.locator('textarea');
const n = await boxes.count();
console.log(`✅ Q&A drill: ${n} questions to answer`);
await page.screenshot({ path: `${OUT}/4-qa-drill.png`, fullPage: true });

for (let i = 0; i < n; i++) {
  await boxes.nth(i).fill(
    'We ran a two-week pilot with thirty students and measured tray waste before and after, ' +
      'which showed a forty-one percent drop. The carbon plate and eight millimetre drop ' +
      'address the heel pain the customer described, and the runners club gives us a reason ' +
      'to follow up every six months.',
  );
}
console.log('✅ answered all questions (typed)');

await page.click('button:has-text("Send answers to the judge")');
await page.waitForSelector('text=Judging your answers', { timeout: 20_000 });
await page.waitForSelector('text=The judge’s note', { timeout: 280_000 });

const score2 = await page.locator('main header span.display').first().innerText();
console.log(`\n✅ RE-GRADED WITH ANSWERS: ${score1} → ${score2}`);
await page.screenshot({ path: `${OUT}/5-report-after-qa.png`, fullPage: true });

console.log(`\nscreenshots -> ${OUT}/`);
await browser.close();

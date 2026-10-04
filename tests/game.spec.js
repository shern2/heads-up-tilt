import { test, expect } from '@playwright/test';

// Start a round and wait until the play screen is live (countdown ~2.3s).
async function startRound(page) {
  await page.click('#btn-start');
  await expect(page.locator('#screen-countdown')).toHaveClass(/active/, { timeout: 5000 });
  await expect(page.locator('#screen-play')).toHaveClass(/active/, { timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await page.goto('/index.html');
});

test('countdown leads into play; keyboard scores correct and pass', async ({ page }) => {
  await page.click('#btn-start');
  await expect(page.locator('#screen-countdown')).toHaveClass(/active/, { timeout: 5000 });
  await expect(page.locator('#screen-play')).toHaveClass(/active/, { timeout: 10_000 });

  // a card is on screen (default Animals deck renders artwork)
  await expect(page.locator('#card-img')).toBeVisible();

  await page.keyboard.press('ArrowUp');   // correct
  await expect(page.locator('#play-score')).toHaveText('1');

  await page.keyboard.press('ArrowDown'); // pass — no score change
  await expect(page.locator('#play-score')).toHaveText('1');
});

test('round ends immediately when every card is cleared', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('hut.cardsPerRound', '5'); } catch {} });
  await page.reload();
  await expect(page.locator('#settings-summary')).toHaveText('5 cards / round');

  await startRound(page);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');

  await expect(page.locator('#screen-results')).toHaveClass(/active/);
  await expect(page.locator('#results-title')).toHaveText('Cleared!');
  await expect(page.locator('#results-score')).toHaveText('5');
  await expect(page.locator('#list-correct li')).toHaveCount(5);
});

test('end button finishes the round with Time!', async ({ page }) => {
  await startRound(page);
  await page.click('#btn-end');
  await expect(page.locator('#screen-results')).toHaveClass(/active/);
  await expect(page.locator('#results-title')).toHaveText('Time!');
});

test('play again restarts, home returns', async ({ page }) => {
  await startRound(page);
  await page.click('#btn-end');
  await expect(page.locator('#screen-results')).toHaveClass(/active/);

  await page.click('#btn-again');
  await expect(page.locator('#screen-play')).toHaveClass(/active/, { timeout: 10_000 });

  await page.click('#btn-end');
  await expect(page.locator('#screen-results')).toHaveClass(/active/);
  await page.click('#btn-home');
  await expect(page.locator('#screen-home')).toHaveClass(/active/);
});

test('passed words appear in results', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('hut.cardsPerRound', '5'); } catch {} });
  await page.reload();
  await startRound(page);
  await page.keyboard.press('ArrowDown');
  await page.click('#btn-end');
  await expect(page.locator('#screen-results')).toHaveClass(/active/);
  await expect(page.locator('#list-passed li')).toHaveCount(1);
  await expect(page.locator('#results-score')).toHaveText('0');
});

test('correct cards are unique — no double-count / false clear', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('hut.cardsPerRound', '5'); } catch {} });
  await page.reload();
  await startRound(page);
  // Clear one card per lap of the ring. A guessed card must be removed from
  // rotation, never re-shown and scored twice (the old bug produced dupes and a
  // false "Cleared!").
  for (let lap = 0; lap < 3; lap++) {
    await page.keyboard.press('ArrowUp');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
  }
  await page.click('#btn-end');
  await expect(page.locator('#screen-results')).toHaveClass(/active/);
  const texts = await page.locator('#list-correct li').allTextContents();
  expect(texts.length).toBe(3);
  expect(new Set(texts).size).toBe(texts.length); // all unique
});

test('re-entrant Play again is ignored (single countdown)', async ({ page }) => {
  await startRound(page);
  await page.click('#btn-end');
  await expect(page.locator('#screen-results')).toHaveClass(/active/);
  const again = page.locator('#btn-again');
  await again.dispatchEvent('click');
  await again.dispatchEvent('click'); // ignored: a countdown is already pending
  await expect(page.locator('#screen-play')).toHaveClass(/active/, { timeout: 10_000 });
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#play-score')).toHaveText('1');
});

test('app scores from synthetic devicemotion (tilt wired end-to-end)', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => {
    window.__feed = (x, y, z) => {
      const e = new Event('devicemotion');
      e.accelerationIncludingGravity = { x, y, z };
      window.dispatchEvent(e);
    };
    // hold neutral through the countdown so the baseline is captured
    window.__iv = setInterval(() => window.__feed(0, 9.8, 0), 20);
  });
  await page.click('#btn-start');
  await expect(page.locator('#screen-play')).toHaveClass(/active/, { timeout: 10_000 });
  await page.evaluate(() => clearInterval(window.__iv));
  // forward/down tilt -> 'correct'
  await page.evaluate(() => { for (let i = 0; i < 40; i++) window.__feed(0, 8.8, -6); });
  await expect(page.locator('#play-score')).toHaveText('1');
});

test('timer expiry ends the round with Time!', async ({ page }) => {
  await page.clock.install();
  await page.goto('/index.html');
  await page.click('#btn-start');
  await page.clock.runFor(4000); // countdown + GO
  await expect(page.locator('#screen-play')).toHaveClass(/active/, { timeout: 5000 });
  await page.clock.runFor(45_000); // exceed the 40s round timer
  await expect(page.locator('#screen-results')).toHaveClass(/active/);
  await expect(page.locator('#results-title')).toHaveText('Time!');
});

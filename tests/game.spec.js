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

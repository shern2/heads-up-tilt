import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await page.goto('/index.html');
});

test('home renders title, decks and times', async ({ page }) => {
  await expect(page.locator('#screen-home')).toHaveClass(/active/);
  await expect(page).toHaveTitle(/Heads Up Tilt/);

  const decks = page.locator('#deck-options .pill');
  await expect(decks).toHaveCount(3);
  await expect(page.locator('#deck-options')).toContainText('Animals');
  await expect(page.locator('#deck-options')).toContainText('Actions');
  await expect(page.locator('#deck-options')).toContainText('Food & Drink');

  await expect(page.locator('#time-options .pill')).toHaveCount(3);
  await expect(page.locator('#time-options')).toContainText('40s');
  await expect(page.locator('#time-options')).toContainText('70s');
  await expect(page.locator('#time-options')).toContainText('100s');
});

test('no HTML/JS skew: nothing blanks the home screen', async ({ page }) => {
  // deck + time pills must always be built, even if a control binding is missing
  await expect(page.locator('#deck-options .pill')).toHaveCount(3);
  await expect(page.locator('#time-options .pill')).toHaveCount(3);
  await expect(page.locator('#settings-summary')).toContainText('cards / round');
});

test('settings panel selects cards-per-round and persists', async ({ page }) => {
  await page.click('#btn-settings');
  await expect(page.locator('#settings')).toBeVisible();

  const opts = page.locator('#cards-options .pill');
  await expect(opts).toHaveCount(4); // 5 / 7 / 10 / 15

  await page.getByRole('button', { name: '10', exact: true }).click();
  await expect(page.locator('#settings-summary')).toHaveText('10 cards / round');

  const stored = await page.evaluate(() => localStorage.getItem('hut.cardsPerRound'));
  expect(stored).toBe('10');

  await page.click('#btn-settings-close');
  await expect(page.locator('#settings')).toBeHidden();
});

test('fullscreen button keeps a fullscreen label (never an x)', async ({ page }) => {
  await expect(page.locator('#btn-fs-home')).toContainText('Fullscreen');
});

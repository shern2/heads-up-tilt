import { test, expect } from '@playwright/test';

test('all decks are well-formed', async ({ request }) => {
  const specs = [
    { url: '/decks/animals.json', images: true },
    { url: '/decks/actions.json', images: false }, // charades: word-only
    { url: '/decks/food.json', images: true },
  ];
  for (const { url, images } of specs) {
    const res = await request.get(url);
    expect(res.ok(), `${url} should load`).toBeTruthy();
    const deck = await res.json();
    expect(typeof deck.name).toBe('string');
    expect(deck.cards.length).toBe(24);
    expect(deck.cards.every((c) => typeof c.word === 'string' && c.word.length > 0)).toBeTruthy();
    if (images) expect(deck.cards.every((c) => typeof c.image === 'string')).toBeTruthy();
    else expect(deck.cards.every((c) => !c.image)).toBeTruthy();
  }
});

test('Actions deck plays as word-only cards', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await page.goto('/index.html');

  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.click('#btn-start');
  await expect(page.locator('#screen-play')).toHaveClass(/active/, { timeout: 10_000 });

  await expect(page.locator('#card-word')).toBeVisible();
  await expect(page.locator('#card-img')).toBeHidden();
});

// Deck loading + image pre-caching.

export async function loadDeck(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`deck ${url}: HTTP ${r.status}`);
  const d = await r.json();
  if (!d || !Array.isArray(d.cards) || !d.cards.length) throw new Error('deck: missing cards[]');
  for (const c of d.cards) if (!c || typeof c.word !== 'string') throw new Error('deck: card needs a word');
  return d;
}

// Warm each card image (fetch into HTTP cache + decode) so a round never
// stalls on a decode. Resolves to the number of cards.
export async function precacheDeck(deck, onProgress) {
  const cards = deck.cards || [];
  let done = 0;
  const bump = () => { done++; if (onProgress) onProgress(done, cards.length); };

  await Promise.all(cards.map(c => new Promise(resolve => {
    if (!c.image) return bump(), resolve();
    const img = new Image();
    img.decoding = 'async';
    img.onload = async () => {
      try { if (img.decode) await img.decode(); } catch { /* decode best-effort */ }
      bump(); resolve();
    };
    img.onerror = () => { bump(); resolve(); }; // missing image -> text-only card
    img.src = c.image;
  })));

  return cards.length;
}

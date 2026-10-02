// The Games page's catalog.
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { GAMES, gameById } = await import('../public/js/games/catalog.js');

test('the games catalog has every requested game, safely addressed', () => {
  assert.deepEqual(
    GAMES.map((g) => g.name),
    [
      'Subway Surfers: San Francisco',
      'PolyTrack Pro',
      'PolyTrack (Modded)',
      'KS 2 Teams',
      'Gladihoppers',
      'BitLife',
      'Snow Rider 3D',
      'Crossy Road',
      'Bit Planes',
      'WorldGuessr',
      'Web Dashers',
      'Eaglercraft 1.8',
      'Slope',
    ]
  );
  assert.equal(new Set(GAMES.map((g) => g.id)).size, GAMES.length);
  for (const g of GAMES) {
    assert.match(g.id, /^[a-z0-9-]+$/, g.id);
    const url = new URL(g.url);
    assert.equal(url.protocol, 'https:', g.id);
    assert.match(url.hostname, /\.github\.io$|^www\.worldguessr\.com$/, g.id);
    // Gaming Escape's iframe?url= wrapper is skipped: games load directly, in one frame.
    assert.doesNotMatch(g.url, /iframe\?url=/, g.id);
    if (g.thumb) assert.equal(new URL(g.thumb).protocol, 'https:', g.id);
    assert.ok(g.blurb && g.emoji && g.colors.length === 2 && g.tags.length, g.id);
    assert.ok(['cover', 'contain'].includes(g.fit), g.id);
  }
  assert.equal(gameById('ks-2-teams').url, 'https://gaming-escape.github.io/public/assets/games/ks-2-teams/');
  assert.equal(gameById('snow-rider-3d').url, 'https://gaming-escape.github.io/public/assets/games/snow-rider-3d/');
  assert.equal(gameById('nope'), null);
});

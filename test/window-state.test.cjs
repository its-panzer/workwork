const test = require('node:test');
const assert = require('node:assert/strict');
const { windowPreferences, overlayBounds, sameBounds } = require('../src/window-state.cjs');

test('invalid saved preferences cannot create invalid native window bounds', () => {
  for (const value of [
    null,
    [],
    'settings',
    7,
    { anchor: { x: '100', y: 20 } },
    { anchor: { x: Infinity, y: 20 } },
    { anchor: { x: 2 ** 40, y: 0 } },
  ]) {
    assert.deepEqual(windowPreferences(value), {
      gemTipDismissed: false,
      connectionsTipDismissed: false,
    });
  }
  assert.deepEqual(
    windowPreferences({
      gemTipDismissed: 'yes',
      connectionsTipDismissed: true,
      anchor: { x: -135.4, y: 102.7 },
    }),
    {
      gemTipDismissed: false,
      connectionsTipDismissed: true,
      anchor: { x: -135, y: 103 },
    },
  );
});

test('clamping an expanded pane preserves its preferred collapsed jewel position', () => {
  const area = { x: -1440, y: 25, width: 1440, height: 900 };
  const anchor = { x: -1340, y: 820 };
  const collapsed = overlayBounds(anchor, false, area);
  const expanded = overlayBounds(anchor, true, area);
  assert.deepEqual(expanded, { x: -1440, y: 205, width: 680, height: 720 });
  assert.deepEqual(anchor, { x: -1340, y: 820 });
  assert.deepEqual(overlayBounds(anchor, false, area), collapsed);
  assert.equal(sameBounds(expanded, { ...expanded }), true);
  assert.equal(sameBounds(expanded, { ...expanded, x: expanded.x + 1 }), false);
  assert.equal(sameBounds(expanded, null), false);
});

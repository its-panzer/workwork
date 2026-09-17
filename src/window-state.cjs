function windowPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const preferences = {
    gemTipDismissed: source.gemTipDismissed === true,
    connectionsTipDismissed: source.connectionsTipDismissed === true,
  };
  if (
    source.anchor &&
    ['x', 'y'].every(
      (key) => Number.isFinite(source.anchor[key]) && Math.abs(source.anchor[key]) <= 1000000,
    )
  ) {
    preferences.anchor = { x: Math.round(source.anchor.x), y: Math.round(source.anchor.y) };
  }
  return preferences;
}

function overlayBounds(anchor, expanded, area) {
  const width = expanded ? Math.min(680, area.width) : Math.min(84, area.width);
  const height = expanded ? Math.min(720, area.height) : Math.min(84, area.height);
  return {
    x: Math.round(Math.max(area.x, Math.min(anchor.x - width, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(anchor.y, area.y + area.height - height))),
    width,
    height,
  };
}

function sameBounds(first, second) {
  return Boolean(
    first && second && ['x', 'y', 'width', 'height'].every((key) => first[key] === second[key]),
  );
}

module.exports = { windowPreferences, overlayBounds, sameBounds };

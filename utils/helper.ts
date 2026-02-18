export function colorNameToHSL(color: string): string {
  // Create a dummy element to convert color names to RGB
  const dummy = document.createElement("div");
  dummy.style.color = color;
  document.body.appendChild(dummy);

  const computedColor = getComputedStyle(dummy).color;
  document.body.removeChild(dummy);

  const match = computedColor.match(
    /^rgb\s*\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/
  );
  if (!match) throw new Error(`Invalid color name: ${color}`);

  const r = parseInt(match[1], 10) / 255;
  const g = parseInt(match[2], 10) / 255;
  const b = parseInt(match[3], 10) / 255;

  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(
    l * 100
  )}%`;
}

// The look plan, in one place. Every colour the game and the page use is named here:
// the six starter values, the two team hues, and the depot's steel, rust and ground.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#14161a',
  surface: '#1e2228',
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830', // amber — Vanguard, the attackers, and the game's one accent
  defender: '#35b08c', // teal — Wardens, the defenders
  danger: '#d95b4a', // red — the bomb, damage, round loss
  steel: '#4a5a68', // painted container steel
  rust: '#6b4f3a', // weathered rust
  ground: '#23262b', // depot tarmac
  rail: '#565d66', // rail steel
  wood: '#5d4a33', // crate timber
};

export function shade(name) {
  return PALETTE[name];
}

// Season Shift shop: catalog, prices and the saved profile (coins bank, owned/equipped clothes,
// power-up levels and consumable stock). Everything lives in localStorage; no real-money purchases.

export const POWERUPS = [
  { id: 'magnet', name: 'Coin Magnet', icon: '🧲', color: '#ff5a6e', timed: true,
    desc: 'Pulls nearby coins to you.', base: 8, step: 2, unit: 's' },
  { id: 'doubler', name: 'Coin Doubler', icon: '✖️2', color: '#a96bff', timed: true,
    desc: 'Every coin counts double.', base: 8, step: 2, unit: 's' },
  { id: 'shield', name: 'Shield', icon: '🛡️', color: '#3fa9ff', timed: true,
    desc: 'Absorbs one crash or missed corner.', base: 12, step: 4, unit: 's',
    stock: { price: 150, label: 'Start with a Shield' } },
  { id: 'headstart', name: 'Head Start', icon: '⚡', color: '#ffb400', timed: true,
    desc: 'Rocket ahead at top speed, untouchable.', base: 3, step: 1, unit: 's',
    stock: { price: 250, label: 'Head Start charge' } },
  { id: 'revive', name: 'Second Chance', icon: '💖', color: '#ff6fae', timed: false,
    desc: 'Continue once after a crash.', base: 2, step: 0.5, unit: 's safe',
    stock: { price: 400, label: 'Second Chance charge' } },
];
// upgrade price to reach level 2..5
export const UPGRADE_PRICES = [0, 0, 200, 450, 900, 1800];
export const MAX_LEVEL = 5;

export const SLOTS = [
  { id: 'hat', name: 'Hats' },
  { id: 'neck', name: 'Scarves' },
  { id: 'back', name: 'Backs' },
];
export const CLOTHES = [
  { id: 'beanie', slot: 'hat', name: 'Cozy Beanie', price: 300 },
  { id: 'straw', slot: 'hat', name: 'Straw Hat', price: 450 },
  { id: 'flowercrown', slot: 'hat', name: 'Flower Crown', price: 900 },
  { id: 'crown', slot: 'hat', name: 'Golden Crown', price: 3500 },
  { id: 'scarfRed', slot: 'neck', name: 'Red Scarf', price: 250 },
  { id: 'scarfStripe', slot: 'neck', name: 'Striped Scarf', price: 500 },
  { id: 'scarfRainbow', slot: 'neck', name: 'Rainbow Scarf', price: 1500 },
  { id: 'explorer', slot: 'back', name: 'Explorer Pack', price: 800 },
  { id: 'leafpack', slot: 'back', name: 'Leaf Pack', price: 1200 },
  { id: 'cape', slot: 'back', name: 'Hero Cape', price: 2500 },
  { id: 'royalcape', slot: 'back', name: 'Royal Cape', price: 5000 },
];

const KEY = 'ss_shop_v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };

export class Profile {
  constructor() {
    const d = read();
    this.owned = d.owned || {};
    this.equipped = Object.assign({ hat: null, neck: null, back: null }, d.equipped || {});
    this.levels = Object.assign({ magnet: 1, doubler: 1, shield: 1, headstart: 1, revive: 1 }, d.levels || {});
    this.stock = Object.assign({ shield: 0, headstart: 0, revive: 0 }, d.stock || {});
    this.listeners = [];
  }
  get bank() { return +localStorage.getItem('ss_coins') || 0; }
  set bank(v) { localStorage.setItem('ss_coins', Math.max(0, Math.floor(v))); }
  save() {
    localStorage.setItem(KEY, JSON.stringify({ owned: this.owned, equipped: this.equipped, levels: this.levels, stock: this.stock }));
    this.listeners.forEach((f) => f());
  }
  onChange(f) { this.listeners.push(f); }
  duration(id) {
    const p = POWERUPS.find((q) => q.id === id);
    return p.base + p.step * ((this.levels[id] || 1) - 1);
  }
  upgradePrice(id) { const l = this.levels[id] || 1; return l >= MAX_LEVEL ? null : UPGRADE_PRICES[l + 1]; }
  spend(n) { if (this.bank < n) return false; this.bank = this.bank - n; return true; }
  upgrade(id) {
    const price = this.upgradePrice(id);
    if (price == null || !this.spend(price)) return false;
    this.levels[id] = (this.levels[id] || 1) + 1;
    this.save();
    return true;
  }
  buyStock(id) {
    const p = POWERUPS.find((q) => q.id === id);
    if (!p.stock || !this.spend(p.stock.price)) return false;
    this.stock[id] = (this.stock[id] || 0) + 1;
    this.save();
    return true;
  }
  useStock(id) {
    if (!(this.stock[id] > 0)) return false;
    this.stock[id]--;
    this.save();
    return true;
  }
  buyClothing(id) {
    const c = CLOTHES.find((q) => q.id === id);
    if (!c || this.owned[id] || !this.spend(c.price)) return false;
    this.owned[id] = true;
    this.equipped[c.slot] = id;
    this.save();
    return true;
  }
  toggleEquip(id) {
    const c = CLOTHES.find((q) => q.id === id);
    if (!c || !this.owned[id]) return;
    this.equipped[c.slot] = this.equipped[c.slot] === id ? null : id;
    this.save();
  }
}

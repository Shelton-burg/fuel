// FUEL — plain foods: a small built-in table of generic, unbranded foods
// (meat, fish, eggs, dairy, grains, veg, fruit, oils, drinks) with typical
// per-100 g nutrition values. Open Food Facts only carries packaged products,
// so without this a search for "chicken breast" returns supermarket SKUs and
// never a plain ingredient. These show up FIRST in food search.
// Values are rounded typical figures (raw/cooked as named) — deterministic,
// curated here, not AI-generated.

const F = (name, hint, kcal, p, c, f, alt) => ({ name, hint, kcal, p, c, f, alt });

// The first entries are the "Common foods" shown when search opens empty.
export const PLAIN_FOODS = [
  F('Chicken breast, grilled', '1 breast ≈ 170 g', 165, 31, 0, 3.6, 'chicken chook breast grilled'),
  F('Eggs, boiled', '1 large egg ≈ 50 g', 155, 13, 1, 11, 'egg boiled'),
  F('White rice, cooked', '1 cup ≈ 180 g', 130, 2.7, 28, 0.3, 'rice white cooked'),
  F('Beef rump steak, grilled', '1 steak ≈ 200 g', 175, 27, 0, 7, 'beef steak rump porterhouse'),
  F('Milk, full cream', '1 cup ≈ 250 ml', 65, 3.4, 4.8, 3.6, 'milk full cream'),
  F('Bread, wholemeal', '1 slice ≈ 40 g', 240, 9, 40, 3, 'bread wholemeal brown slice toast'),
  F('Banana', '1 medium ≈ 118 g', 89, 1.1, 23, 0.3, 'banana fruit'),
  F('Potato, boiled', '1 medium ≈ 180 g', 77, 2, 17, 0.1, 'potato spud boiled'),
  F('Rolled oats, dry', '1/2 cup ≈ 45 g', 380, 13, 62, 7, 'oats porridge rolled'),
  F('Greek yoghurt, plain 0%', '1 tub ≈ 170 g', 59, 10, 4, 0.3, 'yoghurt yogurt greek plain'),
  F('Broccoli, steamed', '', 35, 2.4, 7, 0.4, 'broccoli'),
  F('Salmon fillet, cooked', '1 fillet ≈ 150 g', 208, 22, 0, 13, 'salmon fish'),
  // ── meat & poultry ──
  F('Chicken thigh, roasted', '1 thigh ≈ 90 g', 209, 26, 0, 11, 'chicken chook thigh'),
  F('Chicken drumstick, roasted', '1 drumstick ≈ 70 g', 190, 27, 0, 9, 'chicken chook drumstick'),
  F('Turkey breast, roasted', '', 147, 30, 0, 2, 'turkey breast'),
  F('Beef sirloin steak, grilled', '', 200, 26, 0, 10, 'beef steak sirloin'),
  F('Beef mince, cooked', 'regular', 250, 25, 0, 16, 'beef mince ground meat'),
  F('Beef mince, lean, cooked', '5% fat', 190, 29, 0, 7, 'beef mince lean ground meat'),
  F('Lamb shoulder, roasted', '', 290, 24, 0, 21, 'lamb shoulder'),
  F('Lamb leg, roasted', '', 190, 28, 0, 8.5, 'lamb leg'),
  F('Lamb chops, grilled', '1 chop ≈ 70 g', 280, 25, 0, 20, 'lamb chop cutlet'),
  F('Lamb mince, cooked', '', 250, 24, 0, 17, 'lamb mince ground meat'),
  F('Pork loin, roasted', '', 210, 28, 0, 10, 'pork loin'),
  F('Pork mince, cooked', '', 240, 24, 0, 16, 'pork mince ground meat'),
  F('Bacon, cooked', '1 rasher ≈ 20 g', 500, 35, 0, 40, 'bacon rasher'),
  F('Ham, sliced', 'deli leg ham', 105, 17, 2, 3.5, 'ham deli'),
  F('Sausages, beef, cooked', '1 sausage ≈ 70 g', 280, 14, 8, 21, 'sausage snag'),
  F('Kangaroo steak, grilled', '', 150, 33, 0, 2, 'kangaroo kanga roo'),
  // ── seafood ──
  F('Tuna, canned in springwater, drained', '1 small tin ≈ 95 g', 105, 25, 0, 0.5, 'tuna tin canned'),
  F('Prawns, cooked', '', 99, 24, 0, 0.3, 'prawn shrimp'),
  F('Barramundi, cooked', '', 125, 24, 0, 2.5, 'barramundi barra fish'),
  F('Snapper, cooked', '', 130, 26, 0, 1.5, 'snapper fish'),
  F('White fish fillets, grilled', 'hoki, basa, cod…', 125, 25, 0, 2, 'fish white fillet hoki cod basa'),
  // ── eggs & dairy ──
  F('Eggs, fried', '1 large egg ≈ 55 g', 196, 14, 0.8, 15, 'egg fried'),
  F('Egg whites', '1 white ≈ 33 g', 52, 11, 0.7, 0.2, 'egg white'),
  F('Milk, skim', '1 cup ≈ 250 ml', 36, 3.5, 5, 0.2, 'milk skim light'),
  F('Greek yoghurt, plain full fat', '', 125, 5, 5, 10, 'yoghurt yogurt greek'),
  F('Cottage cheese, light', '', 82, 12, 3, 2, 'cottage cheese'),
  F('Tasty cheese, cheddar', '2 slices ≈ 40 g', 400, 25, 1, 33, 'cheese cheddar tasty slice'),
  F('Parmesan, grated', '', 420, 35, 0, 30, 'parmesan cheese'),
  F('Butter', '1 tsp ≈ 5 g', 725, 0.5, 0.5, 81, 'butter'),
  F('Cream, thickened', '1 tbsp ≈ 20 g', 345, 2, 3, 36, 'cream thickened'),
  // ── grains & carbs ──
  F('Brown rice, cooked', '', 123, 2.7, 26, 1, 'rice brown'),
  F('Pasta, cooked', '1 cup ≈ 180 g', 145, 5, 27, 1, 'pasta spaghetti penne'),
  F('Bread, white', '1 slice ≈ 40 g', 250, 8, 47, 3, 'bread white slice toast'),
  F('Weet-Bix biscuits', '2 biscuits ≈ 30 g', 350, 11, 67, 1.5, 'weetbix weet bix cereal'),
  F('Potato, roasted', '', 150, 3, 25, 5, 'potato roast spud'),
  F('Sweet potato, roasted', '', 90, 1.6, 21, 0.2, 'sweet potato kumara'),
  F('Pumpkin, roasted', '', 50, 1.8, 8, 1, 'pumpkin butternut squash'),
  F('Corn cob, cooked', '', 96, 3.4, 21, 1.5, 'corn cob maize'),
  F('Quinoa, cooked', '', 120, 4.4, 21, 1.9, 'quinoa'),
  // ── vegetables ──
  F('Carrot, raw', '1 medium ≈ 70 g', 41, 0.9, 10, 0.2, 'carrot'),
  F('Green beans, steamed', '', 31, 1.8, 7, 0.2, 'beans green string'),
  F('Peas, cooked', '', 84, 5, 16, 0.4, 'peas'),
  F('Spinach, raw', '', 23, 2.9, 3.6, 0.4, 'spinach leaves'),
  F('Salad greens', 'lettuce, leaves', 20, 2, 3.2, 0.3, 'lettuce salad leaves greens'),
  F('Tomato', '1 medium ≈ 120 g', 18, 0.9, 3.9, 0.2, 'tomato'),
  F('Cucumber', '', 15, 0.7, 3.6, 0.1, 'cucumber'),
  F('Capsicum', '', 26, 1, 6, 0.3, 'capsicum pepper bell'),
  F('Mushrooms, cooked', '', 28, 2.2, 5, 0.5, 'mushroom'),
  F('Zucchini, cooked', '', 17, 1.2, 3.5, 0.3, 'zucchini courgette'),
  F('Cauliflower, steamed', '', 25, 1.9, 5, 0.3, 'cauliflower'),
  F('Onion, cooked', '', 44, 1.4, 10, 0.2, 'onion'),
  F('Avocado', '½ ≈ 100 g', 160, 2, 9, 15, 'avocado avo'),
  // ── fruit ──
  F('Apple', '1 medium ≈ 150 g', 52, 0.3, 14, 0.2, 'apple'),
  F('Orange', '1 medium ≈ 130 g', 47, 0.9, 12, 0.1, 'orange'),
  F('Strawberries', '', 32, 0.7, 7.7, 0.3, 'strawberry berries'),
  F('Blueberries', '', 57, 0.7, 14, 0.3, 'blueberry berries'),
  F('Mango', '', 60, 0.8, 15, 0.4, 'mango'),
  F('Grapes', '', 69, 0.7, 18, 0.2, 'grapes'),
  F('Watermelon', '', 30, 0.6, 8, 0.2, 'watermelon'),
  // ── legumes & nuts ──
  F('Baked beans, canned', '', 90, 5, 15, 0.5, 'baked beans tin'),
  F('Chickpeas, cooked', '', 120, 6.5, 20, 2, 'chickpea garbanzo'),
  F('Lentils, cooked', '', 115, 9, 20, 0.4, 'lentil'),
  F('Hummus', '', 275, 8, 15, 20, 'hummus dip'),
  F('Almonds', '1 handful ≈ 30 g', 580, 21, 22, 50, 'almond nuts'),
  F('Cashews', '', 550, 18, 30, 44, 'cashew nuts'),
  F('Peanuts', '', 570, 26, 16, 49, 'peanut nuts'),
  F('Peanut butter', '1 tbsp ≈ 20 g', 590, 25, 20, 50, 'peanut butter pb'),
  F('Walnuts', '', 650, 15, 14, 65, 'walnut nuts'),
  // ── oils & condiments ──
  F('Olive oil', '1 tbsp ≈ 13 g', 884, 0, 0, 100, 'olive oil'),
  F('Canola oil', '', 884, 0, 0, 100, 'canola vegetable oil'),
  F('Mayonnaise', '1 tbsp ≈ 20 g', 680, 1, 1, 75, 'mayo mayonnaise'),
  F('Tomato sauce', '1 tbsp ≈ 15 g', 100, 1.2, 24, 0.1, 'tomato sauce ketchup'),
  F('Honey', '1 tbsp ≈ 21 g', 300, 0.3, 82, 0, 'honey'),
  F('Jam', '', 250, 0.4, 62, 0.1, 'jam conserve'),
  F('Sugar, white', '1 tsp ≈ 4 g', 400, 0, 100, 0, 'sugar'),
  F('Chocolate, milk', '', 540, 7, 57, 31, 'chocolate choc'),
  F('Ice cream, vanilla', '', 200, 3.5, 24, 11, 'ice cream vanilla'),
  // ── drinks ──
  F('Orange juice', '1 glass ≈ 250 ml', 45, 0.7, 10, 0.2, 'juice orange oj'),
  F('Soft drink, cola', '1 can ≈ 375 ml', 42, 0, 10.6, 0, 'coke cola soft drink fizzy'),
  F('Beer, full strength', '1 stubby ≈ 375 ml', 40, 0.4, 3, 0, 'beer stubby lager'),
  F('Red wine', '1 glass ≈ 150 ml', 85, 0.1, 2.6, 0, 'wine red'),
  F('Coffee, latte', '1 regular ≈ 300 ml', 55, 3, 5, 2.8, 'coffee latte flat white milk'),
];

const toFood = (b) => ({
  name: b.name,
  brand: b.hint ? `Plain food · ${b.hint}` : 'Plain food · per 100 g',
  basis: '100g',
  kcal: b.kcal, p: b.p, c: b.c, f: b.f,
  kcal100: b.kcal,
  source: 'basic',
  image: null,
  barcode: null,
});

/** Match plain foods by name/aliases. Every typed word must appear. */
export function searchBasics(q, limit = 6) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const out = [];
  for (const b of PLAIN_FOODS) {
    const hay = (b.name + ' ' + (b.alt || '')).toLowerCase();
    if (words.every((w) => hay.includes(w))) out.push(toFood(b));
    if (out.length >= limit) break;
  }
  return out;
}

/** The Common-foods shortlist shown when the search box is empty. */
export function commonBasics(limit = 10) {
  return PLAIN_FOODS.slice(0, limit).map(toFood);
}

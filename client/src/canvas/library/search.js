// Search over library items ({ name, slug?, tags?, aka? }). Pure, so ranking is unit tested.
//
// A query is split into words; every word must match (as a word start, or inside a longer name when
// it has 3+ letters). Short names people actually type are expanded first (fb -> facebook).

const ALIASES = {
  fb: ['facebook'], insta: ['instagram'], ig: ['instagram'], yt: ['youtube'], tw: ['twitter', 'x'], x: ['x', 'twitter'],
  wa: ['whatsapp'], gh: ['github'], gl: ['gitlab'], js: ['javascript'], ts: ['typescript'], py: ['python'],
  node: ['node', 'nodejs', 'nodedotjs'], nodejs: ['nodedotjs', 'node'], tailwind: ['tailwindcss'], mongo: ['mongodb'],
  postgres: ['postgresql'], k8s: ['kubernetes'], vue: ['vuedotjs', 'vue'], next: ['nextdotjs', 'next'], nuxt: ['nuxtdotjs', 'nuxt'],
  pc: ['computer', 'desktop', 'monitor'], computer: ['computer', 'monitor', 'desktop', 'laptop'], desktop: ['monitor', 'computer'],
  laptop: ['laptop', 'notebook'], notebook: ['laptop'], mobile: ['smartphone', 'phone'], phone: ['smartphone', 'phone'], tablet: ['tablet'],
  db: ['database'], server: ['server', 'rack'], router: ['router', 'wifi', 'network'], network: ['network', 'router', 'wifi', 'globe'],
  modem: ['router'], switch: ['network', 'router'], storage: ['hard-drive', 'database', 'harddrive'], disk: ['hard-drive', 'harddrive'],
  api: ['webhook', 'plug', 'api'], web: ['globe', 'browser'], internet: ['globe', 'cloud', 'wifi'], aws: ['amazonaws', 'cloud'],
};

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const squash = (s) => norm(s).replace(/ /g, '');

function expand(word) {
  return [...new Set([word, ...(ALIASES[word] ?? [])])];
}

function scoreWord(item, word) {
  const key = item._key ?? (item._key = prepare(item));
  let best = 0;
  for (const alt of expand(word)) {
    const sq = squash(alt);
    if (key.squashed === sq) best = Math.max(best, 100);
    else if (key.squashed.startsWith(sq)) best = Math.max(best, 80);
    else if (key.words.some((w) => w === alt)) best = Math.max(best, 70);
    else if (key.words.some((w) => w.startsWith(alt))) best = Math.max(best, 60);
    else if (key.tags.some((t) => t === alt || t.startsWith(alt))) best = Math.max(best, 40);
    else if (sq.length >= 3 && key.squashed.includes(sq)) best = Math.max(best, 20);
    else if (sq.length >= 3 && key.tags.some((t) => t.includes(sq))) best = Math.max(best, 10);
  }
  return best;
}

function prepare(item) {
  const words = [...new Set([...norm(item.name).split(' '), ...(item.slug ? norm(item.slug).split(' ') : []), ...((item.aka ?? []).flatMap((a) => norm(a).split(' ')))])].filter(Boolean);
  return {
    squashed: squash(item.name),
    words: [...words, squash(item.slug ?? ''), ...(item.aka ?? []).map(squash)].filter(Boolean),
    tags: (item.tags ?? []).map((t) => norm(t)),
  };
}

/** Best matches first. Items with no match for any word are dropped. */
export function searchItems(items, query, { limit = 120 } = {}) {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return items.slice(0, limit);
  const scored = [];
  for (const item of items) {
    let total = 0;
    let ok = true;
    for (const word of words) {
      const s = scoreWord(item, word);
      if (!s) { ok = false; break; }
      total += s;
    }
    if (ok) scored.push([total, item]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length || (a[1].name < b[1].name ? -1 : 1));
  return scored.slice(0, limit).map(([, item]) => item);
}

'use strict';

const CYRILLIC_TRANSLITERATION = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye', ё: 'yo', ж: 'zh', з: 'z',
  и: 'y', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '',
  ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function toAsciiSlug(value, fallback = '') {
  const source = String(value || '').trim().toLowerCase();
  const transliterated = Array.from(source)
    .map(ch => CYRILLIC_TRANSLITERATION[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  const cleaned = transliterated
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return cleaned || String(fallback || '');
}

function categoryHandle(name, cid = '') {
  return toAsciiSlug(name, cid ? `category-${cid}` : 'category');
}

module.exports = { CYRILLIC_TRANSLITERATION, toAsciiSlug, categoryHandle };

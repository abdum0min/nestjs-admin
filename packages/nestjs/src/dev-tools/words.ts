/**
 * The words the built-in generator draws on.
 *
 * Deliberately small - a few kilobytes, in the dev-tools chunk, which no
 * production import reaches. `@faker-js/faker` is far better at this and is
 * used when it is installed; these lists are what makes the tools work without
 * it. "Install a ten-megabyte package before you can see any data" is the kind
 * of first step that ends an evaluation.
 *
 * Names are drawn from computing history, which is a small joke and also the
 * reason they read as real people rather than as `User 41`.
 */

export const FIRST_NAMES = [
  'Ada',
  'Alan',
  'Grace',
  'Edsger',
  'Barbara',
  'Donald',
  'Margaret',
  'Ken',
  'Radia',
  'Dennis',
  'Frances',
  'Tim',
  'Katherine',
  'Linus',
  'Anita',
  'John',
  'Shafi',
  'Vint',
  'Karen',
  'Bjarne',
  'Sophie',
  'Guido',
  'Jean',
  'Yukihiro',
  'Adele',
  'Rasmus',
  'Carol',
  'Brendan',
  'Erna',
  'Niklaus',
] as const

export const LAST_NAMES = [
  'Lovelace',
  'Turing',
  'Hopper',
  'Dijkstra',
  'Liskov',
  'Knuth',
  'Hamilton',
  'Thompson',
  'Perlman',
  'Ritchie',
  'Allen',
  'Berners-Lee',
  'Johnson',
  'Torvalds',
  'Borg',
  'Backus',
  'Goldwasser',
  'Cerf',
  'Spärck Jones',
  'Stroustrup',
  'Wilkes',
  'Rossum',
  'Bartik',
  'Matsumoto',
  'Goldberg',
  'Lerdorf',
  'Shaw',
  'Eich',
  'Hoare',
  'Wirth',
] as const

export const COMPANIES = [
  'Northwind',
  'Acme Supply',
  'Blue Harbour',
  'Contoso',
  'Redwood Labs',
  'Fabrikam',
  'Stone & Sons',
  'Meridian',
  'Kestrel Works',
  'Lantern Group',
  'Vertex Trading',
  'Ironwood',
  'Silver Pine',
  'Halcyon',
  'Bright Anvil',
] as const

export const CITIES = [
  'Tashkent',
  'Samarkand',
  'Istanbul',
  'Lisbon',
  'Warsaw',
  'Nairobi',
  'Osaka',
  'Bogotá',
  'Toronto',
  'Manchester',
  'Rotterdam',
  'Chennai',
  'Seville',
  'Helsinki',
  'Da Nang',
] as const

export const COUNTRIES = [
  'Uzbekistan',
  'Türkiye',
  'Portugal',
  'Poland',
  'Kenya',
  'Japan',
  'Colombia',
  'Canada',
  'United Kingdom',
  'Netherlands',
  'India',
  'Spain',
  'Finland',
  'Vietnam',
] as const

export const STREETS = [
  'Amir Temur',
  'Mirabad',
  'High Street',
  'Rua Augusta',
  'Nowy Świat',
  'Kenyatta Avenue',
  'Dotonbori',
  'King Street',
  'Prinsengracht',
  'Calle Sierpes',
] as const

/** Nouns and adjectives, paired to make titles that read like something. */
export const ADJECTIVES = [
  'quiet',
  'copper',
  'northern',
  'shallow',
  'clever',
  'winter',
  'amber',
  'hidden',
  'restless',
  'patient',
  'crimson',
  'gentle',
  'narrow',
  'ancient',
  'silver',
] as const

export const NOUNS = [
  'harbour',
  'lantern',
  'anvil',
  'meadow',
  'signal',
  'compass',
  'ledger',
  'orchard',
  'beacon',
  'cavern',
  'thicket',
  'current',
  'summit',
  'quarry',
  'lattice',
] as const

/**
 * Sentence fragments, joined into paragraphs.
 *
 * Not lorem ipsum. Placeholder Latin in a demo tells a viewer they are looking
 * at a placeholder; ordinary English sentences let them read the screen as a
 * product, which is the entire point of generating data at all.
 */
export const SENTENCES = [
  'The order was placed late in the afternoon and confirmed the same evening',
  'Stock levels are checked twice a week against the warehouse count',
  'This entry was migrated from the previous system and has not been reviewed',
  'Delivery is arranged through the regional partner rather than directly',
  'A short note was added by the support team after the second call',
  'The price shown includes handling but excludes any regional tax',
  'Approval is still pending with the finance team as of this morning',
  'Two earlier attempts failed before the details were corrected',
  'The customer asked for the invoice to be split across two addresses',
  'Nothing further is expected on this until the next reporting period',
  'Weights were estimated from the packaging rather than measured',
  'This record exists mainly to keep the numbering continuous',
] as const

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'UZS', 'TRY', 'JPY'] as const

/** Readable on both a light and a dark background, which random hex is not. */
export const COLOURS = [
  '#2563eb',
  '#0891b2',
  '#059669',
  '#65a30d',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#9333ea',
  '#4f46e5',
  '#475569',
  '#0f766e',
] as const

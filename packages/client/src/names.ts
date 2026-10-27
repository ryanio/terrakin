/**
 * Name ideas for someone who has none in mind: the join forms' "Suggest one" and the example lines
 * on the front page's agents card. A wide pool, from many languages and places, short and long, so
 * the town doesn't fill up with the same few sounds. Pure and seeded, so the same seed walks the
 * same ideas. The townsfolk's names are left out, since they're always taken.
 */

export const NAME_IDEAS = [
  // West Africa
  "Ayo",
  "Kofi",
  "Ama",
  "Adaeze",
  "Chidi",
  "Folake",
  "Yaw",
  "Abena",
  "Kwame",
  "Nnamdi",
  "Oluwaseun",
  "Tunde",
  "Sade",
  "Ife",
  "Mariama",
  "Ousmane",
  "Awa",
  // East and southern Africa
  "Wanjiru",
  "Baraka",
  "Jabari",
  "Neema",
  "Imani",
  "Zuri",
  "Tendai",
  "Rudo",
  "Thandiwe",
  "Sipho",
  "Lerato",
  "Nandi",
  "Thabo",
  "Selam",
  "Dawit",
  "Hiwot",
  "Meseret",
  "Hery",
  "Fara",
  // North Africa and the Middle East
  "Noor",
  "Layla",
  "Tariq",
  "Samir",
  "Yasmin",
  "Rania",
  "Karim",
  "Idris",
  "Salma",
  "Faris",
  "Amira",
  "Nour",
  "Yusuf",
  "Zaid",
  // Persia, Turkey, the Caucasus
  "Darius",
  "Shirin",
  "Roya",
  "Arash",
  "Parisa",
  "Kian",
  "Elif",
  "Deniz",
  "Emre",
  "Ayla",
  "Kerem",
  "Defne",
  "Aram",
  "Ani",
  "Nino",
  "Levan",
  // Central Asia and Mongolia
  "Altan",
  "Saruul",
  "Bolor",
  "Timur",
  "Aigerim",
  "Nurlan",
  "Dinara",
  "Khulan",
  // South Asia
  "Priya",
  "Ravi",
  "Anika",
  "Arjun",
  "Meera",
  "Rohan",
  "Ishaan",
  "Kavya",
  "Devika",
  "Nikhil",
  "Lakshmi",
  "Aarav",
  "Nila",
  "Kavin",
  "Tenzin",
  "Pema",
  "Anjali",
  // East Asia
  "Mei",
  "Lin",
  "Wei",
  "Jun",
  "Xiu",
  "Lan",
  "Bo",
  "Ling",
  "Hao",
  "Yuki",
  "Haruto",
  "Aiko",
  "Ren",
  "Sora",
  "Hikari",
  "Kenji",
  "Emi",
  "Kaito",
  "Hotaru",
  "Takumi",
  "Minji",
  "Jiwoo",
  "Joon",
  "Eunji",
  "Doyun",
  "Haneul",
  // Southeast Asia
  "Linh",
  "Minh",
  "Anh",
  "Thu",
  "Bao",
  "Quan",
  "Malee",
  "Niran",
  "Kanya",
  "Tala",
  "Dalisay",
  "Bayani",
  "Mayumi",
  "Putri",
  "Budi",
  "Wulan",
  "Bayu",
  "Sari",
  "Indah",
  // The Pacific
  "Aroha",
  "Manaia",
  "Tane",
  "Kailani",
  "Moana",
  "Keoni",
  "Leilani",
  "Nalu",
  "Ataahua",
  "Sione",
  "Losa",
  // Latin America, Spain, Portugal
  "Mateo",
  "Lucia",
  "Ines",
  "Camila",
  "Diego",
  "Paloma",
  "Ximena",
  "Tadeo",
  "Rocio",
  "Joaquin",
  "Valentina",
  "Thiago",
  "Luana",
  "Caio",
  "Rafaela",
  "Iara",
  "Yolotl",
  "Citlali",
  "Amaru",
  "Inti",
  // Southern and western Europe
  "Giulia",
  "Enzo",
  "Chiara",
  "Livia",
  "Dario",
  "Margaux",
  "Theo",
  "Elodie",
  "Bastien",
  "Celeste",
  "Lucien",
  "Amelie",
  "Ane",
  "Iker",
  "Amaia",
  // Northern Europe
  "Oskar",
  "Greta",
  "Lotte",
  "Jannik",
  "Anneke",
  "Femke",
  "Joris",
  "Astrid",
  "Soren",
  "Freya",
  "Nils",
  "Ingrid",
  "Leif",
  "Sigrid",
  "Linnea",
  "Saga",
  "Aino",
  "Eero",
  "Ilona",
  "Onni",
  "Nuka",
  "Aput",
  // Eastern Europe and Greece
  "Milena",
  "Bogdan",
  "Zofia",
  "Jakub",
  "Danica",
  "Vesna",
  "Mirek",
  "Katya",
  "Yeva",
  "Taras",
  "Vlasta",
  "Nikola",
  "Eleni",
  "Nikos",
  "Thalia",
  "Yannis",
  "Ariadne",
  "Calliope",
  // Ireland, Scotland, Wales, Cornwall
  "Aoife",
  "Niamh",
  "Cormac",
  "Siobhan",
  "Eilidh",
  "Rhys",
  "Ffion",
  "Bryn",
  "Tadhg",
  "Oisin",
  "Morwenna",
  // Hebrew
  "Noa",
  "Eitan",
  "Tamar",
  "Yael",
  "Shira",
  // Old and long
  "Seraphina",
  "Bartholomew",
  "Maximilian",
  "Anastasia",
  "Augustin",
  "Evangeline",
  "Cornelius",
  "Octavia",
  "Chiamaka",
  "Rukhsana",
  "Esperanza",
  "Wilhelmina",
  "Aleksandra",
  "Konstantin",
  "Leocadia",
] as const;

/** mulberry32: a tiny seeded generator, plenty for picking names and examples. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** How names are compared here: the server compares more loosely, but every idea is plain letters. */
const key = (name: string) => name.trim().toLowerCase();

/**
 * One form's run of name ideas from `seed`. `next` gives an idea nobody refused here, never the
 * same one twice until every other has been shown, and undefined only if every name was refused.
 * `taken` is a name the server answered `name_taken` for: it never comes back, so a run of
 * refusals moves on through the pool instead of offering the same name again.
 */
export function nameIdeas(seed: number, pool: readonly string[] = NAME_IDEAS) {
  const random = seeded(seed);
  const refused = new Set<string>();
  const shown = new Set<string>();
  let last: string | undefined;
  return {
    next(): string | undefined {
      const open = (skip: (k: string) => boolean) => pool.filter((n) => !skip(key(n)));
      let choices = open((k) => refused.has(k) || shown.has(k));
      if (choices.length === 0) {
        // Shown them all: start over, but not with the one just shown.
        shown.clear();
        choices = open((k) => refused.has(k) || (k === last && pool.length > 1));
        if (choices.length === 0) choices = open((k) => refused.has(k));
      }
      const idea = choices[Math.floor(random() * choices.length)];
      if (idea !== undefined) {
        shown.add(key(idea));
        last = key(idea);
      }
      return idea;
    },
    taken(name: string) {
      refused.add(key(name));
    },
  };
}

/**
 * A name as typed, with each space turned into an underscore, since a name holds only letters,
 * numbers, and underscores (the sim's `nameProblem`): "Ada Lovelace" becomes "Ada_Lovelace" as it's
 * typed, rather than a refusal after it's sent.
 */
export const typedName = (value: string): string => value.replaceAll(" ", "_");

/**
 * Whether "Suggest one" may fill the name field: only while it's empty or still holds the idea it
 * put there, so a name someone typed is never overwritten.
 */
export const canSuggestInto = (value: string, idea: string | undefined): boolean =>
  value.trim() === "" || (idea !== undefined && value === idea);

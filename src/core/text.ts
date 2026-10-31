/** Normalização e tokenização para português, compartilhadas por todas as abordagens. */

const STOPWORDS = new Set(
  ('a o as os um uma uns umas de do da dos das no na nos nas em por para pelo pela pelos pelas com sem sob ' +
   'e ou que se ao aos à às é foi ser são era há ter tem tinha qual quais quando como onde quanto quantos ' +
   'quantas quem cujo cuja isso este esta esse essa aquele aquela seu sua seus suas meu minha nosso nossa ' +
   'eu ele ela eles elas voce voces lhe me te mais menos muito ja nao sim depois antes entre ate sobre mesmo')
    .split(/\s+/)
    .map((w) => normalize(w)),
);

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Tokens alfanuméricos normalizados, sem stopwords. Mantém números e termos técnicos. */
export function tokenize(text: string): string[] {
  return (normalize(text).match(/[a-z0-9]+/g) ?? []).filter((t) => !STOPWORDS.has(t));
}

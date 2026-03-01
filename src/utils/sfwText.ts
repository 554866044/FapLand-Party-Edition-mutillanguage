const NSFW_WORDS = [
  "cumming",
  "cumload",
  "cum",
  "cums",
  "came",
  "orgasmic",
  "orgasms",
  "orgasm",
  "fapping",
  "fapped",
  "fap",
  "faps",
] as const;

const NSFW_WORD_PATTERN = new RegExp(`\\b(?:${NSFW_WORDS.join("|")})\\b`, "giu");

export function abbreviateNsfwText(text: string, enabled: boolean): string {
  if (!enabled || text.length === 0) return text;

  return text.replace(NSFW_WORD_PATTERN, (match) => match[0] ?? match);
}

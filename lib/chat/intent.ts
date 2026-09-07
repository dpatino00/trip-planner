const savedPlaceWords =
  /\b(?:saved|ideas?)\b[\s\S]{0,50}\b(?:place|places|idea|ideas|trip)\b|\b(?:already saved|already in (?:my|the) (?:trip|ideas)|in (?:my|the) (?:trip|ideas)|current trip|what (?:do|have) I have saved)\b/i;
const directAddWords = /\b(?:add|import)\b/i;
const ambiguousAddWords = /\b(?:save|include|keep)\b/i;
const placeObjectWords =
  /\b(?:place|places|restaurant|restaurants|bar|bars|cafe|cafes|venue|venues|these|this|them|trip|ideas)\b/i;
const structuredPlaceList = /[\n|—–]|,\s*\S/;
const titledPlaceName =
  /\b[A-Z][A-Za-z0-9'&.+-]*(?:\s+(?:[A-Z][A-Za-z0-9'&.+-]*|of|the|and)){1,}\b/;

// @spec CHAT-BE-010, CHAT-BE-020
export function hasExplicitSavedPlaceLookupIntent(message: string) {
  return savedPlaceWords.test(message);
}

// @spec CHAT-BE-021
export function hasExplicitAdditionIntent(message: string) {
  if (directAddWords.test(message)) return true;
  const match = ambiguousAddWords.exec(message);
  if (!match) return false;
  const requested = message.slice(match.index + match[0].length);
  return (
    placeObjectWords.test(requested) ||
    structuredPlaceList.test(requested) ||
    titledPlaceName.test(requested)
  );
}

export function hasExplicitSavedPlaceIntent(message: string) {
  return (
    hasExplicitSavedPlaceLookupIntent(message) ||
    hasExplicitAdditionIntent(message)
  );
}

export function normalizedPlaceKey(
  name: string | null | undefined,
  locality: string | null | undefined,
) {
  const normalize = (value: string | null | undefined) =>
    (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return `${normalize(name)}|${normalize(locality)}`;
}

const savedPlaceWords =
  /\b(?:saved|ideas?)\b[\s\S]{0,50}\b(?:place|places|idea|ideas|trip)\b|\b(?:already saved|already in (?:my|the) (?:trip|ideas)|in (?:my|the) (?:trip|ideas)|current trip|what (?:do|have) I have saved)\b/i;
const addPlaceWords =
  /\b(?:add|save|include|keep)\b[\s\S]{0,80}\b(?:place|places|restaurant|restaurants|these|this|them|trip|ideas)\b/i;

// @spec CHAT-BE-020
export function hasExplicitSavedPlaceIntent(message: string) {
  return savedPlaceWords.test(message) || addPlaceWords.test(message);
}

export function normalizedPlaceKey(
  name: string | null | undefined,
  locality: string | null | undefined,
) {
  const normalize = (value: string | null | undefined) =>
    (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return `${normalize(name)}|${normalize(locality)}`;
}

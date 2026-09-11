const savedPlaceWords =
  /\b(?:saved|ideas?)\b[\s\S]{0,50}\b(?:place|places|idea|ideas|trip)\b|\b(?:already saved|already in (?:my|the) (?:trip|ideas)|in (?:my|the) (?:trip|ideas)|current trip|what (?:do|have) I have saved)\b/i;
const directAddWords = /\b(?:add|import)\b/i;
const ambiguousAddWords = /\b(?:save|include|keep)\b/i;
const placeObjectWords =
  /\b(?:place|places|restaurant|restaurants|bar|bars|cafe|cafes|venue|venues|these|this|them|trip|ideas)\b/i;
const structuredPlaceList = /[\n|—–]|,\s*\S/;
const titledPlaceName =
  /\b[A-Z][A-Za-z0-9'&.+-]*(?:\s+(?:[A-Z][A-Za-z0-9'&.+-]*|of|the|and)){1,}\b/;
const requestedReference =
  /\b(?:find|add|attach|get|provide|give|show|look\s*up)\b[\s\S]{0,50}\b(?:link|url|website|source)\b|\b(?:what|where)(?:'s|\s+is)\b[\s\S]{0,50}\b(?:link|url|website|source)\b|\b(?:link|url|website|source)\b[\s\S]{0,30}\bfor\b/i;
const scheduleRequest =
  /\b(?:schedule|put)\b|\badd\b[\s\S]{0,60}\b(?:to|into)\s+(?:my\s+|the\s+)?(?:plan|itinerary)\b/i;
const addToTripRequest =
  /\badd\b[\s\S]{0,60}\b(?:to|into)\s+(?:my\s+|the\s+)?trip\b/i;
const scheduleDateDetail =
  /\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|\d{4}-\d{2}-\d{2})\b/i;
const scheduleTimeDetail =
  /\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b(?:[01]\d|2[0-3]):[0-5]\d\b/i;
const scheduleDetail = new RegExp(
  `${scheduleDateDetail.source}|${scheduleTimeDetail.source}`,
  "i",
);
const scheduleFollowUpDetail =
  /\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b|\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?)\b|\b(?:confirm|confirmed|yes|yep|correct|do it|please do|try again)\b|\b(?:idea|place)\b[\s\S]{0,40}\b(?:already\s+)?(?:exists|saved)\b|\b(?:that(?:'s| is) what i meant|i don'?t see it)\b/i;
const unresolvedScheduleReply =
  /\b(?:schedule|scheduled|scheduling|schedule card|plan confirmation|reviewable card|planner|plan workflow|itinerary|slot)\b[\s\S]{0,200}\b(?:date|time|duration|hours?|name|idea|confirm|finish|need|meant|prepare|place|add|save)\b|\b(?:date|time|duration|start time|saved idea|idea name)\b[\s\S]{0,200}\b(?:schedule|card|place|finish|need|use|prepare|add|save)\b/i;

type IntentHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

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

// @spec CHAT-BE-031, CHAT-BE-032
export function hasExplicitLinkEnrichmentIntent(message: string) {
  return requestedReference.test(message);
}

// @spec CHAT-BE-033, CHAT-BE-037
export function hasExplicitScheduleIntent(message: string) {
  return (
    scheduleRequest.test(message) ||
    (addToTripRequest.test(message) && scheduleDetail.test(message)) ||
    (directAddWords.test(message) &&
      scheduleDateDetail.test(message) &&
      scheduleTimeDetail.test(message))
  );
}

// @spec CHAT-UI-024
export function hasScheduleConfirmationIntent(message: string) {
  const normalized = message
    .trim()
    .toLocaleLowerCase()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ");
  return new Set([
    "confirm",
    "confirm it",
    "yes",
    "yep",
    "do it",
    "please do",
    "yes please",
    "add it",
    "looks good",
    "that works",
  ]).has(normalized);
}

// @spec CHAT-BE-041
export function hasScheduleIntent(
  message: string,
  history: IntentHistoryItem[] = [],
) {
  if (hasExplicitScheduleIntent(message)) return true;
  const latestAssistant = history
    .slice()
    .reverse()
    .find((item) => item.role === "assistant");
  if (
    !latestAssistant ||
    !unresolvedScheduleReply.test(latestAssistant.content)
  )
    return false;
  return (
    scheduleFollowUpDetail.test(message) ||
    scheduleDetail.test(message) ||
    titledPlaceName.test(message)
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

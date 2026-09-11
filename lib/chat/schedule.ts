import type { TripChatRequest } from "@/lib/chat/schema";
import type { TripDocument } from "@/lib/types";

function normalizedWords(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function exactMentionedPlace(places: TripDocument["places"], text: string) {
  const searchable = ` ${normalizedWords(text)} `;
  const matches = places
    .map((place) => ({ place, name: normalizedWords(place.name) }))
    .filter(
      (candidate) =>
        candidate.name.length > 0 && searchable.includes(` ${candidate.name} `),
    )
    .sort((left, right) => right.name.length - left.name.length);
  if (matches.length > 0) {
    const longest = matches[0];
    if (matches.every((candidate) => longest.name.includes(candidate.name))) {
      return longest.place;
    }
  }

  // Accept a clear conversational shorthand when the first and last
  // meaningful name tokens identify exactly one saved place (for example,
  // “Ironside oyster” for “Ironside Fish & Oyster”).
  const searchableTokens = new Set(normalizedWords(text).split(" "));
  const aliases = places.filter((place) => {
    const tokens = normalizedWords(place.name).split(" ");
    return (
      tokens.length >= 2 &&
      searchableTokens.has(tokens[0]) &&
      searchableTokens.has(tokens.at(-1) ?? "")
    );
  });
  return aliases.length === 1 ? aliases[0] : null;
}

function dateAtOffset(today: string, offset: number) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function scheduleDate(
  text: string,
  today: string,
  tripStartDate: string,
  tripEndDate: string,
) {
  const isoDates = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)];
  if (isoDates.length > 0) return isoDates.at(-1)?.[0] ?? null;

  const months = new Map([
    ["january", 1],
    ["jan", 1],
    ["february", 2],
    ["feb", 2],
    ["march", 3],
    ["mar", 3],
    ["april", 4],
    ["apr", 4],
    ["may", 5],
    ["june", 6],
    ["jun", 6],
    ["july", 7],
    ["jul", 7],
    ["august", 8],
    ["aug", 8],
    ["september", 9],
    ["sep", 9],
    ["sept", 9],
    ["october", 10],
    ["oct", 10],
    ["november", 11],
    ["nov", 11],
    ["december", 12],
    ["dec", 12],
  ]);
  const monthDates = [
    ...text.matchAll(
      /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/gi,
    ),
  ];
  const monthMatch = monthDates.at(-1);
  if (monthMatch) {
    const month = months.get(monthMatch[1].toLocaleLowerCase());
    const day = Number(monthMatch[2]);
    if (month && day >= 1 && day <= 31) {
      const years = monthMatch[3]
        ? [Number(monthMatch[3])]
        : [
            Number(tripStartDate.slice(0, 4)),
            Number(tripStartDate.slice(0, 4)) + 1,
            Number(today.slice(0, 4)),
          ];
      for (const year of years) {
        const candidate: string = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const parsed: Date = new Date(`${candidate}T00:00:00Z`);
        if (
          parsed.getUTCFullYear() === year &&
          parsed.getUTCMonth() + 1 === month &&
          parsed.getUTCDate() === day
        ) {
          if (
            monthMatch[3] ||
            (candidate >= tripStartDate && candidate <= tripEndDate)
          )
            return candidate;
        }
      }
    }
  }

  const relativeDays = [...text.matchAll(/\b(today|tomorrow)\b/gi)];
  if (relativeDays.length > 0)
    return dateAtOffset(
      today,
      relativeDays.at(-1)?.[1].toLocaleLowerCase() === "tomorrow" ? 1 : 0,
    );

  const weekdays = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const weekdayMatches = [
    ...text.matchAll(
      /\b(?:(next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi,
    ),
  ];
  const match = weekdayMatches.at(-1);
  if (!match) return null;
  const targetDay = weekdays.indexOf(match[2].toLocaleLowerCase());
  if (!match[1]) {
    const anchor = today > tripStartDate ? today : tripStartDate;
    const anchorDay = new Date(`${anchor}T00:00:00Z`).getUTCDay();
    return dateAtOffset(anchor, (targetDay - anchorDay + 7) % 7);
  }
  const currentDay = new Date(`${today}T00:00:00Z`).getUTCDay();
  const baseOffset = (targetDay - currentDay + 7) % 7;
  return dateAtOffset(today, baseOffset + 7);
}

function scheduleStartTime(text: string) {
  const candidates: Array<{ index: number; value: string }> = [];
  for (const match of text.matchAll(
    /\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/gi,
  )) {
    let hour = Number(match[1]);
    if (hour < 1 || hour > 12) continue;
    const period = match[3].toLocaleLowerCase().startsWith("p") ? "pm" : "am";
    if (hour === 12) hour = 0;
    if (period === "pm") hour += 12;
    candidates.push({
      index: match.index,
      value: `${String(hour).padStart(2, "0")}:${match[2] ?? "00"}`,
    });
  }
  for (const match of text.matchAll(/\b([01]\d|2[0-3]):([0-5]\d)\b/g)) {
    candidates.push({ index: match.index, value: `${match[1]}:${match[2]}` });
  }
  return candidates.sort((left, right) => left.index - right.index).at(-1)
    ?.value;
}

function scheduleDuration(text: string) {
  const matches = [
    ...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/gi),
  ];
  const match = matches.at(-1);
  if (!match) return 120;
  const amount = Number(match[1]);
  const minutes = match[2].toLocaleLowerCase().startsWith("h")
    ? amount * 60
    : amount;
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440
    ? minutes
    : null;
}

// @spec CHAT-BE-043
export function resolveSavedScheduleFromConversation(options: {
  trip: TripDocument;
  today: string;
  message: string;
  history: TripChatRequest["history"];
}) {
  const travelerText = [
    ...options.history
      .filter((item) => item.role === "user")
      .map((item) => item.content),
    options.message,
  ].join("\n");
  const conversationText = [
    ...options.history.map((item) => item.content),
    options.message,
  ].join("\n");
  const place =
    exactMentionedPlace(options.trip.places, travelerText) ??
    exactMentionedPlace(options.trip.places, conversationText);
  const date = scheduleDate(
    travelerText,
    options.today,
    options.trip.startDate,
    options.trip.endDate,
  );
  const startTime = scheduleStartTime(travelerText);
  const durationMinutes = scheduleDuration(travelerText);
  if (!place || !date || !startTime || durationMinutes === null) return null;
  if (date < options.trip.startDate || date > options.trip.endDate) return null;
  return {
    savedPlaceId: place.id,
    suggestion: null,
    date,
    startTime,
    durationMinutes,
  };
}

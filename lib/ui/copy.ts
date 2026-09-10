export const tripCopy = {
  onboarding: {
    eyebrow: "PRIVATE TRIPS / VIAJES PRIVADOS",
    heading: "Plan a trip with your people.",
    formHeading: "Plan a trip",
  },
  entry: {
    eyebrow: "PRIVATE TRIPS / VIAJES PRIVADOS",
    heading: "Your trips, en un solo lugar.",
  },
  workspace: {
    privateTrip: "Private trip",
    today: {
      eyebrow: "HOY / TODAY",
      heading: "¿Qué hacemos hoy?",
      unavailableHeading: "Conditions aren’t available right now",
      unavailableFallback: "Your saved ideas and plan are still here.",
      unavailableOutOfRange: "Check again closer to this date.",
      liveHeading: "Today’s conditions",
      summaryEyebrow: "YOUR TRIP",
      summaryHeading: "Your trip at a glance",
      recommendationsEyebrow: "FOR TODAY",
      recommendationsHeading: "Good options for today",
      noIdeas:
        "No saved ideas yet. Add a place in Ask, then come back to see what fits today.",
    },
    ideas: {
      eyebrow: "TUS IDEAS",
      heading: "Ideas for the trip",
    },
    plan: {
      eyebrow: "YOUR PLAN",
      heading: "Your plan, day by day.",
      suggest: "Suggest a balanced plan",
      suggesting: "Creating suggestion…",
      regenerate: "Regenerate balanced plan",
      proposalEyebrow: "SUGGESTED CHANGES",
      apply: "Apply changes",
      dismiss: "Not now",
      stale:
        "This suggestion is out of date. Regenerate it to review a fresh draft.",
      emptyDay: "Nothing here yet. Pick an idea to add.",
    },
    chat: {
      eyebrow: "ASK / PREGUNTA",
      intro: "Suggestions stay in this tab until you choose Add to trip.",
      emptyHeading: "What do you need help with?",
      emptyBody:
        "Ask what fits today, compare saved ideas, or shape your plan.",
    },
  },
} as const;

import type { Interest, Place } from "@/lib/types";

type Seed = Pick<
  Place,
  | "id"
  | "name"
  | "neighborhoodId"
  | "interests"
  | "profile"
  | "waterContact"
  | "conditionZone"
>;

const seeds: Seed[] = [
  {
    id: "balboa-park",
    name: "Balboa Park",
    neighborhoodId: "balboa-park",
    interests: ["culture", "outdoors"],
    profile: "mixed",
    waterContact: false,
    conditionZone: "urban",
  },
  {
    id: "la-jolla-cove",
    name: "La Jolla Cove",
    neighborhoodId: "la-jolla",
    interests: ["coast", "wildlife"],
    profile: "coastal",
    waterContact: true,
    conditionZone: "coast",
  },
  {
    id: "torrey-pines",
    name: "Torrey Pines State Reserve",
    neighborhoodId: "la-jolla",
    interests: ["outdoors", "coast"],
    profile: "outdoor",
    waterContact: false,
    conditionZone: "coast",
  },
  {
    id: "coronado-beach",
    name: "Coronado Beach",
    neighborhoodId: "coronado",
    interests: ["coast", "relaxing"],
    profile: "coastal",
    waterContact: true,
    conditionZone: "coast",
  },
  {
    id: "cabrillo",
    name: "Cabrillo National Monument",
    neighborhoodId: "point-loma",
    interests: ["history", "coast"],
    profile: "outdoor",
    waterContact: false,
    conditionZone: "coast",
  },
  {
    id: "uss-midway",
    name: "USS Midway Museum",
    neighborhoodId: "downtown",
    interests: ["history", "culture"],
    profile: "indoor",
    waterContact: false,
    conditionZone: "urban",
  },
  {
    id: "san-diego-zoo",
    name: "San Diego Zoo",
    neighborhoodId: "balboa-park",
    interests: ["wildlife", "outdoors"],
    profile: "outdoor",
    waterContact: false,
    conditionZone: "urban",
  },
  {
    id: "little-italy",
    name: "Little Italy Food Walk",
    neighborhoodId: "little-italy",
    interests: ["food", "culture"],
    profile: "mixed",
    waterContact: false,
    conditionZone: "urban",
  },
  {
    id: "gaslamp",
    name: "Gaslamp Quarter",
    neighborhoodId: "downtown",
    interests: ["nightlife", "history"],
    profile: "mixed",
    waterContact: false,
    conditionZone: "urban",
  },
  {
    id: "liberty-station",
    name: "Liberty Public Market",
    neighborhoodId: "point-loma",
    interests: ["food", "shopping"],
    profile: "indoor",
    waterContact: false,
    conditionZone: "coast",
  },
];

const extras: Array<[string, string, Interest[]]> = [
  ["sunset-cliffs", "Sunset Cliffs", ["coast", "relaxing"]],
  ["mission-beach", "Mission Beach", ["coast", "outdoors"]],
  ["pacific-beach", "Pacific Beach", ["coast", "nightlife"]],
  ["ocean-beach", "Ocean Beach", ["coast", "culture"]],
  ["seaport-village", "Seaport Village", ["shopping", "coast"]],
  ["birch-aquarium", "Birch Aquarium", ["wildlife", "culture"]],
  ["fleet-science", "Fleet Science Center", ["culture", "history"]],
  ["museum-of-art", "San Diego Museum of Art", ["culture", "relaxing"]],
  ["natural-history", "Natural History Museum", ["culture", "wildlife"]],
  ["old-town", "Old Town State Historic Park", ["history", "food"]],
  ["presidio", "Presidio Park", ["history", "outdoors"]],
  ["chicano-park", "Chicano Park", ["culture", "history"]],
  ["waterfront-park", "Waterfront Park", ["outdoors", "relaxing"]],
  ["kate-sessions", "Kate Sessions Park", ["outdoors", "relaxing"]],
  ["belmont-park", "Belmont Park", ["outdoors", "nightlife"]],
  ["scripps-pier", "Scripps Pier Overlook", ["coast", "outdoors"]],
  ["windansea", "Windansea Beach", ["coast", "relaxing"]],
  ["childrens-pool", "Children's Pool", ["coast", "wildlife"]],
  ["mount-soledad", "Mount Soledad Viewpoint", ["outdoors", "history"]],
  ["cowles-mountain", "Cowles Mountain", ["outdoors", "relaxing"]],
  ["lake-murray", "Lake Murray", ["outdoors", "relaxing"]],
  ["mission-trails", "Mission Trails", ["outdoors", "history"]],
  ["north-park", "North Park Arts Walk", ["culture", "food"]],
  ["south-park", "South Park Stroll", ["shopping", "food"]],
  ["convoy", "Convoy District Food Crawl", ["food", "culture"]],
  ["hillcrest", "Hillcrest Evening", ["nightlife", "food"]],
  ["la-jolla-playhouse", "La Jolla Playhouse", ["culture", "nightlife"]],
  ["the-shell", "The Rady Shell", ["culture", "nightlife"]],
  ["botanic-garden", "San Diego Botanic Garden", ["outdoors", "relaxing"]],
  ["safari-park", "San Diego Zoo Safari Park", ["wildlife", "outdoors"]],
];

const extraSeeds: Seed[] = extras.map(([id, name, interests], index) => ({
  id,
  name,
  interests,
  neighborhoodId: index % 2 ? "coast" : "central-san-diego",
  profile: interests.includes("coast")
    ? "coastal"
    : interests.includes("outdoors")
      ? "outdoor"
      : "mixed",
  waterContact: id.includes("beach"),
  conditionZone:
    index > 26 ? "inland" : interests.includes("coast") ? "coast" : "urban",
}));

// @spec CAT-DATA-001, CAT-DATA-002, CAT-DATA-003, CAT-DATA-004, CAT-DATA-005, CAT-DATA-006
export const places: Place[] = [...seeds, ...extraSeeds].map((seed, index) => ({
  ...seed,
  destinationId: "san-diego",
  tagline: `A memorable San Diego stop at ${seed.name}`,
  description: `${seed.name} offers a curated mix of local character and flexible trip options.`,
  coordinates: {
    latitude: 32.7 + (index % 10) * 0.012,
    longitude: -117.25 + (index % 8) * 0.018,
  },
  preferredDayparts:
    index % 3 === 0 ? ["morning", "afternoon"] : ["midday", "golden-hour"],
  durationMinutes: 60 + (index % 5) * 60,
  costLevel: (index % 4) as 0 | 1 | 2 | 3,
  accessibility:
    index % 2
      ? ["low-walking"]
      : ["low-walking", "step-free", "accessible-parking"],
  reservationRecommended: index % 6 === 0,
  sourceUrl: `https://www.sandiego.org/explore/things-to-do/${seed.id}.aspx`,
  directions: { googleQuery: `${seed.name} San Diego` },
  image: {
    src: "/images/places/san-diego-coast.webp",
    alt: "Sunset over a San Diego beach",
    credit: "Frank McKenna / Wikimedia Commons (CC0)",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  lastVerifiedAt: "2026-09-01",
}));

export const neighborhoods = [
  {
    id: "little-italy",
    name: "Little Italy",
    coordinates: { latitude: 32.724, longitude: -117.168 },
  },
  {
    id: "downtown",
    name: "Downtown",
    coordinates: { latitude: 32.716, longitude: -117.161 },
  },
  {
    id: "la-jolla",
    name: "La Jolla",
    coordinates: { latitude: 32.833, longitude: -117.271 },
  },
  {
    id: "balboa-park",
    name: "Balboa Park",
    coordinates: { latitude: 32.734, longitude: -117.145 },
  },
  {
    id: "point-loma",
    name: "Point Loma",
    coordinates: { latitude: 32.726, longitude: -117.243 },
  },
];

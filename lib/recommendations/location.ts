import type { Coordinates } from "@/lib/types";

let failedGesture = false;
interface Options {
  requestedByUser: boolean;
  geolocation?: {
    getCurrentPosition: (
      success: (position: { coords: Coordinates }) => void,
      failure: (error: unknown) => void,
      options?: PositionOptions,
    ) => void;
  };
  homeBase: Coordinates | null;
}

// @spec REC-UI-001, REC-UI-002, REC-UI-003, REC-UI-004, SEC-DATA-002
export async function resolveRankingLocation({
  requestedByUser,
  geolocation,
  homeBase,
}: Options) {
  if (requestedByUser && geolocation && !failedGesture) {
    try {
      const coordinates = await new Promise<Coordinates>((resolve, reject) =>
        geolocation.getCurrentPosition(
          (position) =>
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }),
          reject,
          { timeout: 7000 },
        ),
      );
      return { ...coordinates, source: "device" as const };
    } catch {
      failedGesture = true;
    }
  }
  return homeBase
    ? { ...homeBase, source: "home-base" as const }
    : { latitude: null, longitude: null, source: "neutral" as const };
}

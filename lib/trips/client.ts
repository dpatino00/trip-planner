import type {
  TripApiMutation,
  TripDocument,
  TripMutationRequest,
} from "@/lib/types";

type RequestResult = {
  status: number;
  trip: TripDocument;
  duplicate?: boolean;
};
interface MutationOptions {
  trip: TripDocument;
  mutationId: string;
  mutation: TripApiMutation;
  request: (body: TripMutationRequest) => Promise<RequestResult>;
  draft?: unknown;
}

// @spec TRIP-BE-006, TRIP-BE-007
export async function mutateTripWithRetry({
  trip,
  mutationId,
  mutation,
  request,
  draft,
}: MutationOptions) {
  let current = trip;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request({
      baseVersion: current.version,
      mutationId,
      mutation,
    });
    if (response.status !== 409)
      return {
        status: "success" as const,
        trip: response.trip,
        duplicate: response.duplicate ?? false,
      };
    current = response.trip;
  }
  return { status: "conflict" as const, trip: current, draft };
}

// @spec PWA-PROC-005, PWA-PROC-006, PWA-UI-005
export function createTripRefreshPolicy() {
  return {
    refreshInterval: 15_000,
    refreshWhenHidden: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  };
}
export function createConditionRefreshPolicy() {
  return {
    refreshInterval: 900_000,
    refreshWhenHidden: false,
    revalidateOnReconnect: true,
  };
}

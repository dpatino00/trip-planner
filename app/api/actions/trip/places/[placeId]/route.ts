import {
  actionConfigError,
  getActionHandlers,
} from "@/lib/actions/runtime";

export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ placeId: string }> },
) {
  try {
    return getActionHandlers().updatePlace(request, await context.params);
  } catch {
    return actionConfigError();
  }
}

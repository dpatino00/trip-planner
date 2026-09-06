import { actionConfigError, getActionHandlers } from "@/lib/actions/runtime";

export const runtime = "nodejs";
export function POST(request: Request) {
  try {
    return getActionHandlers().setTripPreferences(request);
  } catch {
    return actionConfigError();
  }
}

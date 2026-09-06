import { actionConfigError, getActionHandlers } from "@/lib/actions/runtime";

export const runtime = "nodejs";
export function POST(request: Request) {
  try {
    return getActionHandlers().addPlace(request);
  } catch {
    return actionConfigError();
  }
}

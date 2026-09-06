import { actionConfigError, getActionHandlers } from "@/lib/actions/runtime";

export const runtime = "nodejs";
export function GET(request: Request) {
  try {
    return getActionHandlers().getTripContext(request);
  } catch {
    return actionConfigError();
  }
}

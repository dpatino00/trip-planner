import { actionConfigError, getActionHandlers } from "@/lib/actions/runtime";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ proposalId: string }> },
) {
  try {
    return getActionHandlers().applyPlanProposal(request, await context.params);
  } catch {
    return actionConfigError();
  }
}

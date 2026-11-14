import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/session";
import { signState } from "@/lib/auth/oauth-state";
import { env } from "@/lib/env";
import { GOOGLE_SCOPES } from "@/lib/mail/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireContext("owner");
  const clientId = env.googleClientId();
  if (!clientId) redirect("/settings?error=Google%20OAuth%20is%20not%20configured");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${env.appUrl()}/api/mail/google/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: await signState({ tenantId: ctx.tenant.id, userId: ctx.user.id }),
  });
  redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

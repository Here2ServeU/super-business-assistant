import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { readState } from "@/lib/auth/oauth-state";
import { tenantDb } from "@/lib/dal";
import { env } from "@/lib/env";
import { encryptGoogleTokens } from "@/lib/mail/providers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (msg: string) => redirect(`/settings?error=${encodeURIComponent(msg)}`);
  if (url.searchParams.get("error")) fail(url.searchParams.get("error") ?? "denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) fail("missing code");

  let st: { tenantId: string; userId: string };
  try {
    st = await readState(state!);
  } catch {
    return fail("link expired, try again");
  }
  const user = await currentUser();
  if (!user || user.id !== st.userId) fail("sign in as the same owner and try again");
  const db = tenantDb(st.tenantId);
  if ((await db.memberRole(st.userId)) !== "owner") fail("only owners can connect a mailbox");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: code!,
      client_id: env.googleClientId() ?? "",
      client_secret: env.googleClientSecret() ?? "",
      redirect_uri: `${env.appUrl()}/api/mail/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) fail(`token exchange failed (${res.status})`);
  const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string };
  let email = "";
  if (tok.id_token) {
    try {
      email = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString("utf8")).email ?? "";
    } catch {
      /* ignore */
    }
  }
  await db.upsertConnection({ provider: "gmail", accountEmail: email, tokenCiphertext: encryptGoogleTokens(tok), scopes: tok.scope ?? "" });
  await db.audit(user!.email, "mailbox_connected", null, `gmail ${email}`);
  redirect("/settings?connected=1");
}

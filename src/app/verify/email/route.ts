import { redirect } from "next/navigation";
import { confirmEmailLink, sendPhoneCode } from "@/lib/verify";

export const dynamic = "force-dynamic";

// The one-tap link in the verification email.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const r = await confirmEmailLink(token);
  if (!r.ok) redirect(`/verify?err=${encodeURIComponent(r.error)}`);
  const sent = await sendPhoneCode(r.userId);
  redirect(sent.ok ? "/verify?sent=phone&confirmed=email" : `/verify?confirmed=email&err=${encodeURIComponent(sent.error)}`);
}

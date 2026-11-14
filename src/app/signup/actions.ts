"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, TENANT_COOKIE } from "@/lib/auth/session";
import { signUp } from "@/lib/signup";

export interface SignupState {
  errors?: Record<string, string>;
  values?: Record<string, string>;
}

export async function signup(_prev: SignupState | undefined, form: FormData): Promise<SignupState> {
  const get = (k: string) => String(form.get(k) ?? "");
  const input = {
    name: get("name"), email: get("email"), password: get("password"), businessName: get("businessName"),
    businessType: get("businessType"), timezone: get("timezone"), phone: get("phone"), website: get("website"),
    accessCode: get("accessCode"), agree: get("agree") as "on",
  };
  const r = await signUp(input);
  if (!r.ok) {
    // Echo back what they typed (never the password) so they don't lose their work.
    const { password: _pw, ...values } = input;
    void _pw;
    return { errors: r.errors, values };
  }
  await createSession(r.userId);
  (await cookies()).set(TENANT_COOKIE, r.tenantId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  redirect("/welcome");
}

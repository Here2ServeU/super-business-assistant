"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { changeEmail, changePhone, confirmEmailCode, confirmPhoneCode, sendEmailCode, sendPhoneCode } from "@/lib/verify";

export interface VerifyState {
  error?: string;
  notice?: string;
}

async function me() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export async function submitEmailCode(_p: VerifyState | undefined, form: FormData): Promise<VerifyState> {
  const u = await me();
  const r = await confirmEmailCode(u.id, String(form.get("code") ?? ""));
  if (!r.ok) return { error: r.error };
  const sent = await sendPhoneCode(u.id); // straight on to the text message
  redirect(sent.ok ? "/verify?sent=phone" : `/verify?err=${encodeURIComponent(sent.error)}`);
}

export async function resendEmail(): Promise<VerifyState> {
  const u = await me();
  const r = await sendEmailCode(u.id);
  return r.ok ? { notice: "We sent a new code. Check your inbox (and spam folder)." } : { error: r.error };
}

export async function updateEmail(_p: VerifyState | undefined, form: FormData): Promise<VerifyState> {
  const u = await me();
  const r = await changeEmail(u.id, String(form.get("email") ?? ""));
  if (!r.ok) return { error: r.error };
  redirect("/verify?sent=email");
}

export async function submitPhoneCode(_p: VerifyState | undefined, form: FormData): Promise<VerifyState> {
  const u = await me();
  const r = await confirmPhoneCode(u.id, String(form.get("code") ?? ""));
  if (!r.ok) return { error: r.error };
  redirect("/welcome");
}

export async function resendPhone(): Promise<VerifyState> {
  const u = await me();
  const r = await sendPhoneCode(u.id);
  return r.ok ? { notice: "We texted you a new code." } : { error: r.error };
}

export async function updatePhone(_p: VerifyState | undefined, form: FormData): Promise<VerifyState> {
  const u = await me();
  const r = await changePhone(u.id, String(form.get("phone") ?? ""));
  if (!r.ok) return { error: r.error };
  redirect("/verify?sent=phone");
}

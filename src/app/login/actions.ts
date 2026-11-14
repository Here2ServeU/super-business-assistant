"use server";

import { redirect } from "next/navigation";
import { systemDb } from "@/lib/dal";
import { createSession, destroySession, verifyPassword } from "@/lib/auth/session";

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const user = await systemDb.userByEmail(email);
  // Same message either way, so the form doesn't reveal which emails exist.
  if (!user || !(await verifyPassword(password, user.password_hash))) return { error: "That email and password don't match." };
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

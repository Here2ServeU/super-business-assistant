import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

const key = () => new TextEncoder().encode(env.authSecret());

export async function signState(p: { tenantId: string; userId: string }) {
  return new SignJWT({ ...p, purpose: "gmail-connect" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(key());
}

export async function readState(state: string) {
  const { payload } = await jwtVerify(state, key());
  if (payload.purpose !== "gmail-connect") throw new Error("bad state");
  return { tenantId: String(payload.tenantId), userId: String(payload.userId) };
}

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";
import { systemDb, tenantDb, type Role, type TenantDb } from "@/lib/dal";

export const SESSION_COOKIE = "sba_session";
export const TENANT_COOKIE = "sba_tenant";
const MAX_AGE = 60 * 60 * 24 * 7;

const key = () => new TextEncoder().encode(env.authSecret());

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 11);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MAX_AGE });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(TENANT_COOKIE);
}

export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (!payload.sub) return null;
    return await systemDb.userById(payload.sub);
  } catch {
    return null;
  }
}

const RANK: Record<Role, number> = { viewer: 0, approver: 1, owner: 2 };

export interface AppContext {
  user: { id: string; email: string; name: string };
  tenant: { id: string; slug: string; name: string };
  role: Role;
  tenants: { id: string; slug: string; name: string; role: Role }[];
  db: TenantDb;
}

/**
 * Resolve the signed-in user and the active tenant. Membership is verified on
 * every call, so a tenant id in a cookie can never grant access on its own.
 */
export async function requireContext(minRole: Role = "viewer"): Promise<AppContext> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const tenants = await systemDb.tenantsForUser(user.id);
  if (!tenants.length) redirect("/login?error=no-tenant");
  const jar = await cookies();
  const wanted = jar.get(TENANT_COOKIE)?.value;
  const tenant = tenants.find((t) => t.id === wanted) ?? tenants[0];
  if (RANK[tenant.role] < RANK[minRole]) throw new Error(`This action needs the ${minRole} role.`);
  return { user, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, role: tenant.role, tenants, db: tenantDb(tenant.id) };
}

export function hasRole(role: Role, min: Role) {
  return RANK[role] >= RANK[min];
}

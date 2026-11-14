"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireContext, TENANT_COOKIE } from "@/lib/auth/session";
import { decide, type Decision } from "@/lib/approvals";
import { pause, resume, runCommand } from "@/lib/control";
import { ingestDocument } from "@/lib/kb";
import { providerFor } from "@/lib/mail/providers";
import { processTenant } from "@/lib/pipeline";
import { buildBrief } from "@/lib/briefs";
import { localDate } from "@/lib/scheduling";
import { ProfileSchema, type Profile } from "@/lib/settings";

export async function switchTenant(form: FormData) {
  const ctx = await requireContext();
  const id = String(form.get("tenantId") ?? "");
  if (ctx.tenants.some((t) => t.id === id)) {
    (await cookies()).set(TENANT_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  }
  revalidatePath("/", "layout");
}

export async function decideDraft(_prev: { message?: string; ok?: boolean } | undefined, form: FormData) {
  const ctx = await requireContext("approver");
  const draftId = String(form.get("draftId") ?? "");
  const kind = String(form.get("kind") ?? "");
  let decision: Decision;
  if (kind === "approve") decision = { kind: "approve" };
  else if (kind === "edit_approve") decision = { kind: "edit_approve", body: String(form.get("body") ?? "") };
  else if (kind === "escalate") decision = { kind: "escalate", note: String(form.get("note") ?? "") };
  else if (kind === "reject") decision = { kind: "reject", note: String(form.get("note") ?? "") };
  else return { ok: false, message: "Unknown action." };
  const provider = await providerFor(ctx.db);
  const r = await decide(ctx.db, provider, { userId: ctx.user.id, email: ctx.user.email, role: ctx.role }, draftId, decision);
  revalidatePath("/", "layout");
  return { ok: r.ok, message: r.message };
}

export async function togglePause(form: FormData) {
  const ctx = await requireContext("approver");
  if (form.get("pause") === "1") await pause(ctx.db, ctx.user.email);
  else await resume(ctx.db, ctx.user.email);
  revalidatePath("/", "layout");
}

export async function command(_prev: { message?: string } | undefined, form: FormData) {
  const ctx = await requireContext("approver");
  const message = await runCommand(ctx.db, ctx.user.email, String(form.get("cmd") ?? ""));
  revalidatePath("/", "layout");
  return { message };
}

export async function syncNow() {
  const ctx = await requireContext("approver");
  const provider = await providerFor(ctx.db);
  await ctx.db.audit(ctx.user.email, "sync_requested", null, provider ? provider.name : "no mailbox connected");
  await processTenant(ctx.db, provider);
  revalidatePath("/", "layout");
}

export async function makeBriefNow() {
  const ctx = await requireContext("approver");
  const { profile } = await ctx.db.settings();
  const date = localDate(profile.company.timezone);
  const content = await buildBrief(ctx.db, { radar: new Date().getDay() === profile.brief.radarWeekday });
  await ctx.db.upsertBrief("daily", date, content);
  await ctx.db.audit(ctx.user.email, "brief_created", null, `on-demand brief ${date}`);
  revalidatePath("/briefs");
}

export async function setShadowMode(form: FormData) {
  const ctx = await requireContext("owner");
  const on = form.get("on") === "1";
  await ctx.db.setShadowMode(on);
  await ctx.db.audit(ctx.user.email, on ? "shadow_on" : "shadow_off", null, on ? "sending disabled; drafts still created" : "sending enabled (each send still needs approval)");
  revalidatePath("/", "layout");
}

const lines = (v: FormDataEntryValue | null) => String(v ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
const pairs = (v: FormDataEntryValue | null) => lines(v).map((l) => l.split("|").map((s) => s.trim()));

export async function saveSettings(_prev: { message?: string; ok?: boolean } | undefined, form: FormData) {
  const ctx = await requireContext("owner");
  const { profile: current } = await ctx.db.settings();
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const hours = Object.fromEntries(
    days.map((d) => {
      const open = String(form.get(`${d}_open`) ?? "");
      const close = String(form.get(`${d}_close`) ?? "");
      return [d, form.get(`${d}_closed`) === "on" || !open || !close ? null : { open, close }];
    }),
  ) as Profile["hours"];
  const draft = {
    ...current,
    company: {
      name: String(form.get("name") ?? ""),
      ownerName: String(form.get("ownerName") ?? ""),
      timezone: String(form.get("timezone") ?? "America/Chicago"),
      website: String(form.get("website") ?? ""),
      phone: String(form.get("phone") ?? ""),
      voice: String(form.get("voice") ?? ""),
    },
    hours,
    categories: pairs(form.get("categories")).map(([name, kw = "", reply = "yes", sched = "no"]) => ({
      name,
      keywords: kw.split(",").map((k) => k.trim()).filter(Boolean),
      reply: !/^n/i.test(reply),
      scheduling: /^y/i.test(sched),
    })),
    urgentKeywords: lines(form.get("urgentKeywords")),
    guardList: ["card", "ssn", "password", "bank_account"].filter((g) => form.get(`guard_${g}`) === "on"),
    alwaysEscalate: lines(form.get("alwaysEscalate")),
    approvers: pairs(form.get("approvers")).map(([name, email = ""]) => ({ name, email })).filter((a) => a.email.includes("@")),
    budget: { monthlyCapUsd: Number(form.get("cap")), alertPercent: Number(form.get("alertPercent")) },
    brief: { time: String(form.get("briefTime") ?? "07:00"), radarWeekday: Number(form.get("radarWeekday") ?? 1) },
    news: {
      keywords: lines(form.get("newsKeywords")),
      competitors: pairs(form.get("competitors")).map(([name, url = ""]) => ({ name, url })).filter((c) => c.url),
    },
    signature: String(form.get("signature") ?? "").replace(/\r\n/g, "\n"),
  };
  const parsed = ProfileSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, message: `Not saved: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  await ctx.db.saveProfile(parsed.data);
  await ctx.db.audit(ctx.user.email, "settings_saved", null, "client profile updated");
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}

export async function addKnowledge(_prev: { message?: string; ok?: boolean } | undefined, form: FormData) {
  const ctx = await requireContext("owner");
  const file = form.get("file");
  let title = String(form.get("title") ?? "").trim();
  let content = String(form.get("content") ?? "");
  if (file instanceof File && file.size > 0) {
    if (file.size > 1_000_000) return { ok: false, message: "Files up to 1 MB of plain text, please." };
    if (!/\.(txt|md|csv)$/i.test(file.name)) return { ok: false, message: "Upload .txt, .md or .csv files." };
    content = await file.text();
    title = title || file.name;
  }
  if (!title || !content.trim()) return { ok: false, message: "Add a title and some text." };
  await ingestDocument(ctx.db, title, content, ctx.user.email);
  revalidatePath("/cabinet");
  return { ok: true, message: `Added "${title}".` };
}

export async function deleteKnowledge(form: FormData) {
  const ctx = await requireContext("owner");
  const id = String(form.get("id") ?? "");
  await ctx.db.deleteDocument(id);
  await ctx.db.audit(ctx.user.email, "kb_delete", id, "");
  revalidatePath("/cabinet");
}

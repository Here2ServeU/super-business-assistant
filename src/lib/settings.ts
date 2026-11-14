import { z } from "zod";

// The client profile. Mirrors onboarding/template.json and is stored in tenant_settings.profile.

const DayHours = z.object({ open: z.string(), close: z.string() }).nullable();

export const CategorySchema = z.object({
  name: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  // Junk/personal-style categories never get a drafted reply.
  reply: z.boolean().default(true),
  // Booking-style categories get open calendar times offered in the draft.
  scheduling: z.boolean().default(false),
});

export const ProfileSchema = z.object({
  company: z.object({
    name: z.string().min(1),
    ownerName: z.string().default(""),
    timezone: z.string().default("America/Chicago"),
    website: z.string().default(""),
    phone: z.string().default(""),
    voice: z.string().default("warm, clear, brief, never pushy"),
  }),
  hours: z.object({
    mon: DayHours, tue: DayHours, wed: DayHours, thu: DayHours, fri: DayHours, sat: DayHours, sun: DayHours,
  }),
  scheduling: z.object({
    slotMinutes: z.number().int().min(15).max(240).default(30),
    daysAhead: z.number().int().min(1).max(30).default(5),
    offer: z.number().int().min(1).max(5).default(3),
  }).default({ slotMinutes: 30, daysAhead: 5, offer: 3 }),
  categories: z.array(CategorySchema).min(1),
  urgentKeywords: z.array(z.string()).default([]),
  guardList: z.array(z.string()).default(["card", "ssn", "password", "bank_account"]),
  alwaysEscalate: z.array(z.string()).default([]),
  approvers: z.array(z.object({ name: z.string(), email: z.string() })).default([]),
  budget: z.object({
    monthlyCapUsd: z.number().positive(),
    alertPercent: z.number().int().min(1).max(99).default(80),
  }),
  brief: z.object({
    time: z.string().regex(/^\d{2}:\d{2}$/).default("07:00"),
    radarWeekday: z.number().int().min(0).max(6).default(1), // 1 = Monday
  }),
  news: z.object({
    keywords: z.array(z.string()).default([]),
    competitors: z.array(z.object({ name: z.string(), url: z.string() })).default([]),
  }),
  signature: z.string().default(""),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Category = z.infer<typeof CategorySchema>;

export interface TenantSettings {
  profile: Profile;
  paused: boolean;
  shadowMode: boolean;
}

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

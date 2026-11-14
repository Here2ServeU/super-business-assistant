// Every secret comes from the environment (Vercel project settings in production).
// Nothing secret is ever hard-coded. See .env.example for the full list.

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export function requireEnv(name: string): string {
  const v = read(name);
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  databaseUrl: () => requireEnv("DATABASE_URL"),
  authSecret: () => requireEnv("AUTH_SECRET"),
  encryptionKey: () => requireEnv("ENCRYPTION_KEY"),
  cronSecret: () => read("CRON_SECRET"),
  openaiKey: () => read("OPENAI_API_KEY"),
  aiProvider: (): "openai" | "offline" => {
    const forced = read("AI_PROVIDER");
    if (forced === "offline" || forced === "openai") return forced;
    return read("OPENAI_API_KEY") ? "openai" : "offline";
  },
  modelSmall: () => read("MODEL_SMALL") ?? "gpt-6-luna",
  modelLarge: () => read("MODEL_LARGE") ?? "gpt-6.1-sol",
  googleClientId: () => read("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => read("GOOGLE_CLIENT_SECRET"),
  appUrl: () => read("APP_URL") ?? (read("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${read("VERCEL_PROJECT_PRODUCTION_URL")}` : "http://localhost:3000"),
  resendKey: () => read("RESEND_API_KEY"),
  notifyFrom: () => read("NOTIFY_FROM_EMAIL"),
};

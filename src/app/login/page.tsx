import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="bg-navy px-4 py-6 text-white">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <Logo />
          <div>
            <p className="font-bold leading-tight">Super Business Assistant</p>
            <p className="text-sm text-white/70">Secure AI. Lower cost.</p>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        <div className="card p-6">
          <h1 className="mb-1 text-xl font-bold">Sign in</h1>
          <p className="mb-6 text-sm text-muted">Nothing is ever sent without your approval.</p>
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-sm text-muted">
          New customer? <a href="/signup" className="font-medium text-navy underline decoration-orange">Create your account</a>
        </p>
      </div>
    </main>
  );
}

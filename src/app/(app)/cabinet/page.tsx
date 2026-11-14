import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/session";
import { deleteKnowledge } from "../actions";
import { AddKnowledge } from "./AddKnowledge";

export const metadata: Metadata = { title: "Cabinet" };

export default async function CabinetPage() {
  const ctx = await requireContext();
  const docs = await ctx.db.listDocuments();
  const owner = ctx.role === "owner";
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold">Cabinet</h1>
          <p className="text-sm text-muted">Your private knowledge base. Drafts may only state facts found here. If the answer isn&apos;t here, the draft says &ldquo;let me check&rdquo; and comes to you.</p>
        </div>
        <ul className="card divide-y divide-line">
          {docs.length === 0 && <li className="p-4 text-sm text-muted">Empty. Add your services, prices and policies.</li>}
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 p-4">
              <div className="flex-1">
                <p className="font-medium">{d.title}</p>
                <p className="text-xs text-muted">{d.chunks} passage(s) · {d.chars.toLocaleString()} characters</p>
              </div>
              {owner && (
                <form action={deleteKnowledge}>
                  <input type="hidden" name="id" value={d.id} />
                  <button className="btn btn-quiet text-sm">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
      {owner && (
        <section className="card h-fit p-5">
          <h2 className="mb-3 font-bold">Add knowledge</h2>
          <AddKnowledge />
        </section>
      )}
    </div>
  );
}

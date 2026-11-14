"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/tray", label: "Approval tray" },
  { href: "/inbox", label: "Inbox" },
  { href: "/briefs", label: "Briefs" },
  { href: "/cabinet", label: "Cabinet" },
  { href: "/logbook", label: "Logbook" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ waiting }: { waiting: number }) {
  const path = usePathname();
  return (
    <nav className="border-b border-line bg-white" aria-label="Main">
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 text-sm">
        {LINKS.map((l) => {
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-3 font-medium ${active ? "border-orange text-navy" : "border-transparent text-muted hover:text-navy"}`}
                aria-current={active ? "page" : undefined}
              >
                {l.label}
                {l.href === "/tray" && waiting > 0 && <span className="rounded-full bg-orange px-1.5 text-xs text-white">{waiting}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

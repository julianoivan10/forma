"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { ConnectWallet } from "./ConnectWallet";
import { FormaMark } from "./FormaMark";
import { NetworkStatus } from "./NetworkStatus";

const NAV = [
  { href: "/stake", label: "Stake" },
  { href: "/positions", label: "Positions" },
  { href: "/earn", label: "Earn" },
  { href: "/liquid", label: "Liquid" },
  { href: "/activity", label: "Activity" },
  { href: "/docs", label: "Docs" },
  { href: "/settings", label: "Settings" },
] as const;

export function Header() {
  const pathname = usePathname();
  // The menu is open only on the path where it was opened, so navigating closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="rule-b bg-ivory/90 backdrop-blur-[2px]">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-4 sm:gap-6 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Forma home">
          <FormaMark className="size-7" />
          <span className="display hidden text-[22px] tracking-tight min-[420px]:inline">FORMA</span>
        </Link>

        <nav aria-label="Primary" className="hidden flex-1 lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className="mono block px-2.5 py-2 text-[11px] font-medium tracking-[0.14em] uppercase text-ink-2 hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-ivory"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <NetworkStatus layout="inline" />
          <ConnectWallet compact />
          <button
            type="button"
            className="btn btn-ghost px-2.5 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpenedOn(open ? null : pathname)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      <NetworkStatus layout="strip" />

      {open && (
        <nav id="mobile-nav" aria-label="Primary mobile" className="rule-t lg:hidden">
          <ul className="mx-auto grid max-w-[1440px] grid-cols-2 px-4 py-2 sm:px-8">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className="mono block py-3 text-xs tracking-[0.14em] uppercase aria-[current=page]:underline"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}

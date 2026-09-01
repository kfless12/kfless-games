'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/*
 * SPEC.md §11: bottom nav, four items — Queue · Games & Standings ·
 * Draft & Rosters · Me. Admin is deliberately absent: it is a separate gated
 * route, not a nav item.
 *
 * Fixed to the bottom because that is where a thumb is on a phone. Every target
 * is well over the 44px §11 asks for, since this is being tapped one-handed,
 * outdoors, by someone holding a drink.
 */

/*
 * SPEC.md §11 originally fixed this at four items with "Games & Standings" as
 * one slot. Split in two: "who is winning" and "what is being played" are
 * different questions, and pairing them buried the games list under the
 * leaderboard. §11 was amended rather than overridden.
 *
 * Five items still clears §11's 44px tap target at 390px — 78px each.
 */
const ITEMS = [
  { href: '/queue', label: 'Queue', glyph: '🍺' },
  { href: '/games', label: 'Games', glyph: '🏆' },
  { href: '/standings', label: 'Standings', glyph: '📊' },
  { href: '/draft', label: 'Draft', glyph: '📋' },
  { href: '/me', label: 'Me', glyph: '🙂' },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-50 border-t-[3px] border-ink bg-paper"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex w-full max-w-lg">
        {ITEMS.map((item) => {
          // /games/<id> should still light up Games.
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 border-t-4 text-xs font-black uppercase tracking-wide ${
                  active ? 'border-amber-bright bg-foam' : 'border-transparent text-muted'
                }`}
              >
                <span aria-hidden className="text-lg leading-none">
                  {item.glyph}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

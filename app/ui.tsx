import Link from 'next/link';

/*
 * Shared presentation pieces, so every page shows a team, a placement or an
 * empty list the same way. SPEC.md §11: every team appears with its logo and
 * colour wherever it is named.
 *
 * Server components — none of this needs interactivity.
 */

export function EventMark({ size = 40 }: { size?: number }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/logo.svg"
      alt=""
      width={size}
      height={size}
      className="shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

export function PageHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        {/*
          SPEC.md §11 fixes the bottom nav at four items and none of them is the
          dashboard, so the mark is the way back to it. Sized well past the 44px
          §11 asks for.
        */}
        <Link href="/" aria-label="Dashboard" className="flex size-11 shrink-0 items-center">
          <EventMark size={44} />
        </Link>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="display mt-0.5 text-[2rem]">{title}</h1>
        </div>
      </div>
      {action}
    </header>
  );
}

export function SectionHeading({
  title,
  aside,
}: {
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="section-title">{title}</h2>
      {aside}
    </div>
  );
}

/** SPEC.md §14 asks for empty states; a blank list reads as a broken page. */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="card-quiet border-dashed text-base text-muted">{children}</p>
  );
}

export function TeamMark({
  colorHex,
  logoUrl,
  size = 36,
}: {
  colorHex: string | null;
  logoUrl?: string | null;
  size?: number;
}) {
  if (logoUrl) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={logoUrl}
        alt=""
        className="team-logo"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="swatch"
      style={{ backgroundColor: colorHex ?? 'transparent', width: size / 2.4, height: size / 2.4 }}
    />
  );
}

/** 1st, 2nd and 3rd get their medal colour; everything else stays ink. */
export function PlacementBadge({ placement }: { placement: number }) {
  const medal =
    placement === 1
      ? 'var(--gold)'
      : placement === 2
        ? 'var(--silver)'
        : placement === 3
          ? 'var(--bronze)'
          : null;

  return (
    <span
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-ink text-sm font-black tabular-nums"
      style={medal ? { backgroundColor: medal, color: 'var(--ink)' } : undefined}
    >
      {placement}
    </span>
  );
}

export function NavButton({
  href,
  children,
  variant = 'quiet',
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'quiet' | 'primary' | 'shout';
}) {
  const cls =
    variant === 'primary' ? 'btn btn-primary' : variant === 'shout' ? 'btn btn-shout' : 'btn';
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

'use client';

/*
 * Renders a timestamp in the viewer's own timezone. The server does not know
 * where the phone is, so it would render in the container's zone (usually UTC)
 * and the admin would be doing arithmetic in the yard. suppressHydrationWarning
 * because the server-rendered text is expected to differ from the client's.
 */
export function LocalTime({ iso }: { iso: string }) {
  const date = new Date(iso);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {date.toLocaleString(undefined, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      })}
    </time>
  );
}

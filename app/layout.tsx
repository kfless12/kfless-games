import type { Metadata, Viewport } from 'next';

import { BottomNav } from './bottom-nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'kfless games',
  description: 'Three days. Four teams. Seventeen players.',
  icons: { icon: '/logo.svg' },
};

// Mobile-first, designed at 390px. SPEC.md §11.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#fffcf5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full font-sans antialiased">
      <body className="with-nav flex min-h-full flex-col">
        {children}
        <BottomNav />
      </body>
    </html>
  );
}

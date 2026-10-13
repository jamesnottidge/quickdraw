import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist, Source_Serif_4 } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import './globals.css';
import { AppShell } from '@/components/app-shell';
import { cn } from '@/lib/utils';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist' });
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--font-source-serif' });

export const metadata: Metadata = {
  title: 'CDM Research Agent',
  description: 'A research agent that pairs a general LLM with small task-specific models.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(sans.variable, serif.variable)}>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}

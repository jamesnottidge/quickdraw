import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'CDM Research Agent',
  description: 'A research agent that pairs a general LLM with small task-specific models.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

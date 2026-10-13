import { cn } from '@/lib/utils';

/** A cowboy hat, drawn as an outline so it takes the text colour. */
export function HatLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('size-5', className)}
    >
      <path d="M6.6 13.2C6.3 9 7.3 5.6 9 4.7c1-.5 2 .5 3 .5s2-1 3-.5c1.7.9 2.7 4.3 2.4 8.5" />
      <path d="M6.7 11.4c3.4 1 7.2 1 10.6 0" />
      <path d="M2 9.8c.9 4.4 5.2 6.9 10 6.9s9.1-2.5 10-6.9" />
      <path d="M2 9.8c1.3 1.9 2.8 2.9 4.6 3.4M22 9.8c-1.3 1.9-2.8 2.9-4.6 3.4" />
    </svg>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { useSessions } from '@/hooks/useSessions';
import { timeAgo } from '@/lib/ui/time-ago';
import { truncate } from '@/lib/ui/format';
import { cn } from '@/lib/utils';
import { HatLogo } from './brand';
import { ThemeToggle } from './theme-toggle';

const DOT: Record<string, string> = {
  running: 'bg-amber-500 animate-pulse',
  finished: 'bg-emerald-500',
  failed: 'bg-red-500',
};

export function AppSidebar() {
  const pathname = usePathname();
  const { sessions } = useSessions();

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 p-3">
        <Link href="/" aria-label="Quickdraw" className="flex items-center gap-2 px-1 text-sm font-semibold tracking-tight">
          <HatLogo className="size-5" />
          <span>Quickdraw</span>
        </Link>
        <SidebarMenuButton asChild variant="outline" className="justify-start gap-2">
          <Link href="/">
            <Plus className="size-4" />
            <span>New research</span>
          </Link>
        </SidebarMenuButton>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Your sessions</SidebarGroupLabel>
          <SidebarGroupContent>
            {sessions.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">Research you run in this browser appears here.</p>
            ) : (
              <SidebarMenu>
                {sessions.map((s) => (
                  <SidebarMenuItem key={s.id}>
                    <SidebarMenuButton asChild isActive={pathname === `/run/${s.id}`} className="h-auto items-start gap-2 py-2">
                      <Link href={`/run/${s.id}`} title={s.prompt}>
                        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[s.status])} aria-label={s.status} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm">{truncate(s.prompt, 60)}</span>
                          <span className="text-xs text-muted-foreground">{timeAgo(s.startedAt)}</span>
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 p-3">
        <p className="text-[11px] leading-snug text-muted-foreground">
          A research experiment. Your request and the results are stored for evaluation, and a Meta model on its contributor
          tier processes them, so prompts and outputs may be used to improve Meta&rsquo;s products. Don&rsquo;t enter anything
          private.
        </p>
        <div className="flex justify-end">
          <ThemeToggle />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

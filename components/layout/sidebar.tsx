"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Mic2,
  Disc3,
  FileText,
  BarChart3,
  Settings,
  Music2,
  FlaskConical,
  Gift,
  LineChart,
  Activity,
  Route,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";

const navItems = [
  { href: "/dashboard",    label: "Dashboard",   icon: LayoutDashboard },
  { href: "/artists",      label: "Artists",      icon: Mic2 },
  { href: "/releases",     label: "Releases",     icon: Disc3 },
  { href: "/content",      label: "Content",      icon: FileText },
  { href: "/analytics",    label: "Analytics",    icon: BarChart3 },
  { href: "/referrals",    label: "Referrals",    icon: Gift },
  { href: "/settings",     label: "Settings",     icon: Settings },
  { href: "/admin/agents",     label: "Agent Lab",    icon: FlaskConical },
  { href: "/admin/evals",      label: "Agent Evals",  icon: LineChart },
  { href: "/admin/monitoring", label: "Monitoring",   icon: Activity },
  { href: "/admin/events",     label: "Event Debugger", icon: Route },
] as const;

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-6 py-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Music2 className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold tracking-tight">
            ReleaseFlow
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 py-4">
        <SidebarMenu>
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton asChild isActive={isActive}>
                  <Link href={href}>
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="border-t px-6 py-4">
        <p className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} ReleaseFlow
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}

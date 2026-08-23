import {
  LayoutDashboard,
  Users,
  FileText,
  FolderOpen,
  ShieldAlert,
  Settings,
  MessageCircle,
  Mail,
  type LucideIcon,
} from "lucide-react";

export type NavKey =
  | "dashboard"
  | "clients"
  | "applications"
  | "documents"
  | "chat"
  | "email"
  | "alerts"
  | "settings";

import type { Capability } from "@/lib/auth/capabilities";

export interface NavItem {
  key: NavKey;
  href: string;
  icon: LucideIcon;
  /**
   * MILESTONE 26B-9A — hide this entry unless the viewer holds the capability.
   *
   * Optional, and absent on every pre-existing item: those surfaces are open
   * to any authenticated profile and their own pages enforce whatever narrower
   * rules apply. Hiding a link is a COURTESY — the page and its Server Actions
   * remain the enforcement, exactly as with every other control in this app.
   */
  capability?: Capability;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "clients", href: "/clientes", icon: Users },
  { key: "applications", href: "/solicitudes", icon: FileText },
  { key: "documents", href: "/documentos", icon: FolderOpen },
  { key: "chat", href: "/chat", icon: MessageCircle },
  // The operational mailbox. Management-only because the unlinked queue
  // carries mail from people who are not customers and cannot be branch
  // scoped — see the `email:manage` capability note.
  { key: "email", href: "/correo", icon: Mail, capability: "email:manage" },
  { key: "alerts", href: "/alertas", icon: ShieldAlert },
  // Milestone 18: "reports" was removed. /reportes rendered entirely
  // fabricated operational metrics — including invented productivity
  // figures attributed to real ODL employees — and the database holds
  // none of the history (rejection reasons, status transitions, advisor
  // closure times) needed to compute them honestly. Deliberately deleted
  // rather than left as a placeholder; a real reporting surface is a
  // later milestone with its own schema work.
  { key: "settings", href: "/configuracion", icon: Settings },
];

export function getSectionTitleKey(pathname: string): string {
  if (pathname.startsWith("/expedientes")) return "navigation.dossierTitle";
  const match = NAV_ITEMS.find((item) => pathname.startsWith(item.href));
  return match ? `navigation.${match.key}` : "common.brand.name";
}

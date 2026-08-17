import {
  LayoutDashboard,
  Users,
  FileText,
  FolderOpen,
  ShieldAlert,
  Settings,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";

export type NavKey =
  | "dashboard"
  | "clients"
  | "applications"
  | "documents"
  | "chat"
  | "alerts"
  | "settings";

export interface NavItem {
  key: NavKey;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "clients", href: "/clientes", icon: Users },
  { key: "applications", href: "/solicitudes", icon: FileText },
  { key: "documents", href: "/documentos", icon: FolderOpen },
  { key: "chat", href: "/chat", icon: MessageCircle },
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

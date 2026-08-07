import {
  LayoutDashboard,
  Users,
  FileText,
  FolderOpen,
  ShieldAlert,
  BarChart3,
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
  | "reports"
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
  { key: "reports", href: "/reportes", icon: BarChart3 },
  { key: "settings", href: "/configuracion", icon: Settings },
];

export function getSectionTitleKey(pathname: string): string {
  if (pathname.startsWith("/expedientes")) return "navigation.dossierTitle";
  const match = NAV_ITEMS.find((item) => pathname.startsWith(item.href));
  return match ? `navigation.${match.key}` : "common.brand.name";
}

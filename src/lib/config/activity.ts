import type { ActivityType } from "@/types";
import {
  UserPlus,
  FileText,
  FileCheck2,
  StickyNote,
  RefreshCcw,
  ShieldAlert,
  BadgeCheck,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";

export const ACTIVITY_TYPE_ICON: Record<ActivityType, LucideIcon> = {
  cliente_creado: UserPlus,
  solicitud_iniciada: FileText,
  documento_recibido: FileCheck2,
  nota_agregada: StickyNote,
  estado_modificado: RefreshCcw,
  alerta_registrada: ShieldAlert,
  documento_verificado: BadgeCheck,
  solicitud_aprobada: CheckCircle2,
};

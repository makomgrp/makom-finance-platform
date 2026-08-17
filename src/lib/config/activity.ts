import type { ActivityType } from "@/types";
import {
  UserPlus,
  FileText,
  FileCheck2,
  FileUp,
  StickyNote,
  RefreshCcw,
  ListChecks,
  UserCog,
  PencilLine,
  ShieldAlert,
  ShieldCheck,
  BadgeCheck,
  type LucideIcon,
} from "lucide-react";

/**
 * The canonical icon for each Activity vocabulary value (Milestone 19 —
 * see src/types/activity-event.ts, which is the single source of that
 * vocabulary). Exhaustive by construction: `Record<ActivityType, …>` makes
 * adding a value to the enum without an icon a compile error.
 *
 * Paired icons make the two halves of a workflow visually distinguishable
 * at a glance: raised vs resolved for alerts, received vs replaced vs
 * verified for evidence.
 */
export const ACTIVITY_TYPE_ICON: Record<ActivityType, LucideIcon> = {
  cliente_creado: UserPlus,
  solicitud_iniciada: FileText,
  nota_agregada: StickyNote,
  alerta_registrada: ShieldAlert,
  alerta_resuelta: ShieldCheck,
  documento_recibido: FileCheck2,
  documento_reemplazado: FileUp,
  documento_verificado: BadgeCheck,
  estado_modificado: RefreshCcw,
  requisito_actualizado: ListChecks,
  // Milestone 20 — audit-trail-backed counterparts. Same icons as their
  // latest-state siblings on purpose: the event is the same KIND of thing,
  // only its completeness differs, and that difference is carried by the
  // wording rather than by a second visual language.
  estado_cambiado: RefreshCcw,
  requisito_cambiado: ListChecks,
  alerta_reactivada: ShieldAlert,
  cliente_estado_cambiado: UserCog,
  cliente_perfil_actualizado: PencilLine,
};

/**
 * Which canonical `statuses.*` message namespace resolves an item's raw
 * `code`. Kept here rather than in the tab component so the vocabulary and
 * its translation source stay described in one place; values with no code
 * are simply absent.
 *
 * This deliberately points at the EXISTING status catalogues instead of
 * introducing activity-specific duplicates of labels the app already
 * translates everywhere else.
 */
export const ACTIVITY_CODE_NAMESPACE: Partial<Record<ActivityType, string>> = {
  estado_modificado: "statuses.applicationStatus",
  requisito_actualizado: "statuses.requirementSlotStatus",
  nota_agregada: "statuses.noteType",
  alerta_registrada: "statuses.alertType",
  alerta_resuelta: "statuses.alertType",
  // Milestone 20 — the audit-trail types resolve BOTH `code` and
  // `previousCode` through the same catalogue.
  estado_cambiado: "statuses.applicationStatus",
  requisito_cambiado: "statuses.requirementSlotStatus",
  alerta_reactivada: "statuses.alertType",
  cliente_estado_cambiado: "statuses.client",
};

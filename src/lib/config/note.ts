import type { NotePriority, NoteType } from "@/types";

export const NOTE_TYPE_VALUES: NoteType[] = [
  "general",
  "seguimiento",
  "documentacion",
  "evaluacion",
  "llamada",
  "importante",
];

export const NOTE_PRIORITY_BADGE_CLASS: Record<NotePriority, string> = {
  baja: "bg-muted text-muted-foreground border-border",
  media: "bg-warning/10 text-warning border-warning/20",
  alta: "bg-destructive/10 text-destructive border-destructive/20",
};

export const NOTE_PRIORITY_VALUES: NotePriority[] = ["baja", "media", "alta"];

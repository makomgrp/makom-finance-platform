export type NoteType =
  | "general"
  | "seguimiento"
  | "documentacion"
  | "evaluacion"
  | "llamada"
  | "importante";

export type NotePriority = "baja" | "media" | "alta";

export interface InternalNote {
  id: string;
  clientId: string;
  text: string;
  authorId: string;
  /** Resolved server-side (joined from profiles) — never guessed client-side. */
  authorFullName: string;
  createdAt: string;
  type: NoteType;
  priority: NotePriority;
}

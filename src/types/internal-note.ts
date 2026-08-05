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
  applicationId?: string;
  text: string;
  authorId: string;
  createdAt: string;
  type: NoteType;
  priority: NotePriority;
}

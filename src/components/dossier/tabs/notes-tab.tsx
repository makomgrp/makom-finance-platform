"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { StickyNote, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { NOTE_PRIORITY_BADGE_CLASS, NOTE_PRIORITY_VALUES, NOTE_TYPE_VALUES } from "@/lib/config/note";
import { CURRENT_USER, getUserById } from "@/lib/demo-data";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { ActivityEvent, InternalNote, NotePriority, NoteType } from "@/types";

interface NotesTabProps {
  clientId: string;
  applicationId?: string;
  notes: InternalNote[];
  onNotesChange: (notes: InternalNote[]) => void;
  onActivity: (
    descriptionKey: string,
    params: Record<string, string> | undefined,
    type: ActivityEvent["type"]
  ) => void;
}

export function NotesTab({ clientId, applicationId, notes, onNotesChange, onActivity }: NotesTabProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [type, setType] = useState<NoteType>("general");
  const [priority, setPriority] = useState<NotePriority>("media");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const note: InternalNote = {
      id: `note-demo-${Date.now()}`,
      clientId,
      applicationId,
      text,
      authorId: CURRENT_USER.id,
      createdAt: new Date().toISOString(),
      type,
      priority,
    };
    onNotesChange([note, ...notes]);
    onActivity("noteAdded", undefined, "nota_agregada");
    toast.success(t("dossier.notes.toastAdded"));
    setText("");
    setType("general");
    setPriority("media");
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button size="sm">
                <Plus className="size-4" />
                {t("dossier.notes.addNote")}
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("dossier.notes.dialogTitle")}</DialogTitle>
              <DialogDescription>{t("dossier.notes.dialogDescription")}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="note-text">{t("dossier.notes.noteLabel")}</Label>
                <Textarea
                  id="note-text"
                  required
                  rows={4}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="note-type">{t("dossier.notes.type")}</Label>
                  <Select value={type} onValueChange={(value) => value && setType(value as NoteType)}>
                    <SelectTrigger id="note-type" className="w-full">
                      <SelectValue>
                        {(value: string) => t(`statuses.noteType.${value as NoteType}`)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {NOTE_TYPE_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`statuses.noteType.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="note-priority">{t("dossier.notes.priority")}</Label>
                  <Select
                    value={priority}
                    onValueChange={(value) => value && setPriority(value as NotePriority)}
                  >
                    <SelectTrigger id="note-priority" className="w-full">
                      <SelectValue>
                        {(value: string) => t(`statuses.notePriority.${value as NotePriority}`)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {NOTE_PRIORITY_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`statuses.notePriority.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t("dossier.notes.cancel")}
                </Button>
                <Button type="submit">{t("dossier.notes.save")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {notes.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title={t("dossier.notes.emptyTitle")}
          description={t("dossier.notes.emptyDescription")}
        />
      ) : (
        <div className="space-y-3">
          {notes.map((note) => {
            const author = getUserById(note.authorId);

            return (
              <Card key={note.id}>
                <CardContent>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={t(`statuses.noteType.${note.type}`)}
                      className="bg-secondary text-secondary-foreground border-border"
                    />
                    <StatusBadge
                      label={t(`statuses.notePriority.${note.priority}`)}
                      className={NOTE_PRIORITY_BADGE_CLASS[note.priority]}
                    />
                  </div>
                  <p className="text-sm text-foreground">{note.text}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {author?.fullName ?? "—"} · {formatDateTime(note.createdAt, locale)}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

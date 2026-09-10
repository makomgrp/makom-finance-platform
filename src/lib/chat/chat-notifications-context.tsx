"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { ConversationUnread } from "@/lib/services/chat";

/**
 * ============================================================================
 * MILESTONE 26B-13 — QUE UN MENSAJE SE NOTE FUERA DEL CHAT
 * ============================================================================
 *
 * Hasta ahora el chat sólo avisaba desde dentro del propio módulo: si alguien
 * escribía mientras el usuario estaba en Dashboard o en Solicitudes, no pasaba
 * absolutamente nada. Esta capa vive por encima de los módulos, en el layout
 * autenticado, y sobrevive a la navegación entre ellos.
 *
 * ----------------------------------------------------------------------------
 * UNA SUSCRIPCIÓN POR PERSONA, NO UNA POR CONVERSACIÓN
 * ----------------------------------------------------------------------------
 * El servidor emite un aviso al canal `chat:user:{profileId}` del destinatario.
 * Suscribirse aquí a los canales por conversación habría significado abrir
 * tantos websockets como colegas tenga el usuario y reabrirlos cada vez que
 * apareciera una conversación nueva. Un canal propio es constante: uno, vivo
 * mientras la sesión esté abierta.
 *
 * Además el reparto lo decide el SERVIDOR — cada aviso se manda al canal de
 * quien debe recibirlo — en vez de que el cliente filtre lo que le llega.
 *
 * ----------------------------------------------------------------------------
 * NO DUPLICA EL LISTENER DEL CHAT
 * ----------------------------------------------------------------------------
 * `chat-view` sigue con su canal por conversación y su evento
 * `chat.message.created`, que es lo que pinta el mensaje en el hilo. Este
 * provider escucha un evento DISTINTO (`chat.notification`) en un canal
 * DISTINTO, así que un mensaje nunca se procesa dos veces por la misma vía.
 * Cuando la conversación afectada es la que el usuario está mirando, este
 * provider se calla y deja que el hilo haga su trabajo.
 *
 * ----------------------------------------------------------------------------
 * POR QUÉ NO SUENA CON MENSAJES VIEJOS
 * ----------------------------------------------------------------------------
 * Los broadcasts de Supabase son efímeros: no se reproducen al suscribirse ni
 * al reconectar. Montar la app no dispara nada, y un refresco tampoco, porque
 * aquí no se lee historial — el contador inicial llega ya calculado del
 * servidor. Encima hay deduplicación explícita por `messageId`, que cubre el
 * caso de recibir el mismo aviso dos veces.
 */

interface ChatNotificationPayload {
  messageId: string;
  conversationId: string;
  senderProfileId: string;
  senderName: string;
  preview: string;
  createdAt: string;
}

/**
 * MILESTONE 2.2 — un aviso DISTINTO en el MISMO canal por-persona.
 *
 * No es chat, pero el canal `chat:user:{profileId}` ya es exactamente lo que
 * este recordatorio necesita: una suscripción por persona, viva mientras dure
 * la sesión, que sobrevive a la navegación entre módulos. Abrir un segundo
 * canal solo para esto repetiría la razón por la que este ya existe. Vive con
 * su propio evento (`followup.reminder`) y su propia deduplicación
 * (`seenFollowUpIds`), separada de la de chat, para que un aviso nunca
 * interfiera con el otro.
 */
interface FollowUpReminderPayload {
  followUpId: string;
  applicationId: string;
  applicationNumber?: string;
  clientFullName: string;
  nextAction: string;
  nextActionAt: string;
}

interface ChatNotificationsValue {
  /** Suma de no leídos de todas las conversaciones. 0 => sin badge. */
  unreadTotal: number;
  /** El chat declara qué conversación está mirando; null al salir del módulo. */
  setActiveConversation: (conversationRealId: string | null) => void;
  /** El chat avisa de que ya leyó una conversación concreta. */
  clearConversation: (conversationRealId: string) => void;
}

const ChatNotificationsContext = createContext<ChatNotificationsValue | null>(null);

/** Longitud del adelanto en el toast: suficiente para saber de qué va, corto
 * para no convertir la notificación en el mensaje entero. */
const PREVIEW_MAX = 100;

function truncate(text: string): string {
  const clean = text.trim();
  return clean.length <= PREVIEW_MAX ? clean : `${clean.slice(0, PREVIEW_MAX - 1)}…`;
}

/**
 * Un blip corto con Web Audio.
 *
 * SIN ARCHIVO Y SIN LIBRERÍA: no hay asset que servir, ni descarga, ni una
 * cuestión de licencia sobre un sonido de terceros. Son dos osciladores de
 * medio segundo generados en el momento.
 *
 * EL AUTOPLAY BLOQUEADO NO ES UN ERROR: hasta que el usuario interactúe con la
 * página, el navegador puede rechazar el audio. Eso se traga en silencio —
 * avisar de que "no se pudo reproducir un sonido" sería más molesto que el
 * propio silencio.
 */
function playNotificationSound(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    // Discreto a propósito: esto suena en una oficina, no en un juego.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    gain.connect(ctx.destination);

    for (const [frequency, offset] of [
      [660, 0],
      [880, 0.09],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, now + offset);
      osc.connect(gain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    }

    window.setTimeout(() => void ctx.close().catch(() => {}), 600);
  } catch {
    /* silencio deliberado — ver el comentario de arriba */
  }
}

export function ChatNotificationsProvider({
  profileId,
  initialUnread,
  children,
}: {
  profileId: string;
  initialUnread: ConversationUnread[];
  children: ReactNode;
}) {
  const t = useTranslations();
  const router = useRouter();

  // Por conversación, no un total suelto: al leer UNA hay que descontar sólo
  // esa, y un único número no permitiría distinguirlas.
  const [unreadByConversation, setUnreadByConversation] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialUnread.map((row) => [row.conversationId, row.unread]))
  );

  const [colleagueByConversation] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialUnread.map((row) => [row.conversationId, row.colleagueProfileId]))
  );

  // Refs y no estado: los lee el callback de la suscripción, y no deben
  // provocar que el canal se cierre y se vuelva a abrir al cambiar.
  const activeConversationRef = useRef<string | null>(null);
  const seenMessageIds = useRef<Set<string>>(new Set());
  const seenFollowUpIds = useRef<Set<string>>(new Set());
  const colleagueRef = useRef<Record<string, string>>(colleagueByConversation);

  const setActiveConversation = useCallback((conversationRealId: string | null) => {
    activeConversationRef.current = conversationRealId;
  }, []);

  const clearConversation = useCallback((conversationRealId: string) => {
    setUnreadByConversation((prev) => {
      if (!prev[conversationRealId]) return prev;
      const next = { ...prev };
      delete next[conversationRealId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!profileId) return;

    const supabase = getSupabaseClient();
    const channel = supabase.channel(`chat:user:${profileId}`);

    channel
      .on("broadcast", { event: "chat.notification" }, ({ payload }) => {
        const data = payload as ChatNotificationPayload;

        // Deduplicación: un mismo aviso no notifica dos veces.
        if (seenMessageIds.current.has(data.messageId)) return;
        seenMessageIds.current.add(data.messageId);

        // Nunca por lo que uno mismo escribe. El servidor sólo manda esto al
        // canal del destinatario, así que no debería ocurrir; se comprueba
        // igualmente porque el coste es nulo y la garantía no es del cliente.
        if (data.senderProfileId === profileId) return;

        colleagueRef.current[data.conversationId] = data.senderProfileId;

        // La conversación abierta ya muestra el mensaje en el hilo y lo marca
        // leído: notificarla otra vez sería ruido sobre algo que el usuario
        // está viendo. Los mensajes de CUALQUIER otra conversación sí avisan.
        if (activeConversationRef.current === data.conversationId) return;

        setUnreadByConversation((prev) => ({
          ...prev,
          [data.conversationId]: (prev[data.conversationId] ?? 0) + 1,
        }));

        playNotificationSound();

        toast(t("chat.notifications.newMessageFrom", { name: data.senderName }), {
          description: truncate(data.preview),
          action: {
            label: t("chat.notifications.open"),
            // Navegación interna, misma pestaña. El chat lee este parámetro
            // para abrir directamente la conversación correspondiente.
            onClick: () => router.push(`/chat?con=${data.senderProfileId}`),
          },
        });
      })
      .on("broadcast", { event: "followup.reminder" }, ({ payload }) => {
        const data = payload as FollowUpReminderPayload;

        // Misma deduplicación que chat, pero en su propio set: un mensaje de
        // chat y un recordatorio de seguimiento nunca comparten identificador,
        // pero tampoco deben compartir el mismo Set por si alguna vez lo
        // hicieran por coincidencia.
        if (seenFollowUpIds.current.has(data.followUpId)) return;
        seenFollowUpIds.current.add(data.followUpId);

        playNotificationSound();

        toast(t("dashboard.myFollowUps.reminderToast", { name: data.clientFullName }), {
          description: data.nextAction,
          action: {
            label: t("chat.notifications.open"),
            onClick: () => router.push(`/solicitudes/${data.applicationId}`),
          },
        });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileId, router, t]);

  const unreadTotal = useMemo(
    () => Object.values(unreadByConversation).reduce((sum, n) => sum + n, 0),
    [unreadByConversation]
  );

  const value = useMemo<ChatNotificationsValue>(
    () => ({ unreadTotal, setActiveConversation, clearConversation }),
    [unreadTotal, setActiveConversation, clearConversation]
  );

  return (
    <ChatNotificationsContext.Provider value={value}>{children}</ChatNotificationsContext.Provider>
  );
}

/**
 * Devuelve un valor inerte fuera del provider en lugar de lanzar, para que el
 * sidebar y el chat puedan consumirlo sin condicionar su render a que exista.
 */
export function useChatNotifications(): ChatNotificationsValue {
  return (
    useContext(ChatNotificationsContext) ?? {
      unreadTotal: 0,
      setActiveConversation: () => {},
      clearConversation: () => {},
    }
  );
}

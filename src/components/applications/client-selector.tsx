"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, UserPlus, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Client } from "@/types";

/**
 * Searchable existing-Client picker for the application-creation flow
 * (Milestone 17). Presentation only — it owns no data fetching and no
 * mutation: the Client list is handed down from the Server Component that
 * already loads it (src/app/(app)/solicitudes/page.tsx,
 * src/app/(app)/clientes/page.tsx via ClientsTable), and creating a Client
 * is delegated back to the parent through onRequestCreateClient so that
 * the ONE existing RealClientFormDialog stays the only client form in the
 * app. This component deliberately knows nothing about client:create,
 * client validation rules, or the client Server Actions.
 *
 * Extracted from new-application-dialog.tsx rather than inlined because
 * the search-and-select interaction is self-contained and independently
 * reusable — the dialog stays about the application, this stays about
 * finding a person.
 */

/** Bounded result rendering — the Client list is small today (17 rows)
 * but grows without limit, and an unbounded list inside a dialog is a
 * scrolling problem, not a feature. Callers see a count hint instead. */
const MAX_VISIBLE_RESULTS = 8;

interface ClientSelectorProps {
  clients: Client[];
  selectedClientId: string | null;
  onSelect: (clientId: string) => void;
  /**
   * Provided ONLY when the current user holds client:create — the parent
   * decides that, via useCapability. When undefined, no creation
   * affordance is rendered at all and this component behaves as a pure
   * picker over existing clients.
   */
  onRequestCreateClient?: () => void;
  disabled?: boolean;
}

function matchesQuery(client: Client, query: string): boolean {
  return (
    client.fullName.toLowerCase().includes(query) ||
    client.identificationNumber.toLowerCase().includes(query) ||
    client.email.toLowerCase().includes(query) ||
    client.phone.toLowerCase().includes(query)
  );
}

export function ClientSelector({
  clients,
  selectedClientId,
  onSelect,
  onRequestCreateClient,
  disabled = false,
}: ClientSelectorProps) {
  const t = useTranslations();
  const [search, setSearch] = useState("");

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) => matchesQuery(client, query));
  }, [clients, search]);

  const visible = matches.slice(0, MAX_VISIBLE_RESULTS);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="application-client-search">
          {t("applications.create.client.searchLabel")}
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="application-client-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("applications.create.client.searchPlaceholder")}
            className="pl-9"
            disabled={disabled}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center">
          <p className="text-sm text-foreground">{t("applications.create.client.empty")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("applications.create.client.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
          {visible.map((client) => {
            const isSelected = client.id === selectedClientId;
            return (
              <button
                key={client.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(client.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors",
                  "hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
                  isSelected && "bg-accent"
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {client.fullName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {client.identificationNumber} · {client.email}
                  </span>
                </span>
                {isSelected && <Check className="size-4 shrink-0 text-foreground" />}
              </button>
            );
          })}
        </div>
      )}

      {matches.length > visible.length && (
        <p className="text-xs text-muted-foreground">
          {t("applications.create.client.moreResults", {
            shown: visible.length,
            total: matches.length,
          })}
        </p>
      )}

      {onRequestCreateClient && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onRequestCreateClient}
        >
          <UserPlus className="size-4" />
          {t("applications.create.client.newClient")}
        </Button>
      )}
    </div>
  );
}

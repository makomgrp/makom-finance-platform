"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClientSelector } from "@/components/applications/client-selector";
import { RealClientFormDialog } from "@/components/clients/real-client-form-dialog";
import { createSolicitudApplication } from "@/app/(app)/solicitudes/actions";
import { useCapability } from "@/lib/auth/use-capability";
import type { Locale } from "@/i18n/config";
import type { Client, Product } from "@/types";

/**
 * THE application-creation flow (Milestone 17). One component, one Server
 * Action, two entry points:
 *
 *   - /solicitudes  -> "Nueva solicitud" in the PageHeader, no locked
 *                      client, so the operator searches for one.
 *   - /clientes     -> the row action, which passes lockedClient, so the
 *                      client step is already resolved and displayed
 *                      read-only instead of being searched for again.
 *
 * There is deliberately no second implementation of either the form or
 * the submit path. Both entry points call
 * src/app/(app)/solicitudes/actions.ts#createSolicitudApplication, which
 * in turn delegates to the unmodified createApplication() service shared
 * with the Application Intake pipeline.
 *
 * FULLY CONTROLLED (open/onOpenChange): the two entry points open this
 * from very different places — a header button and a dropdown menu item —
 * so it renders no trigger of its own and lets each caller own that.
 *
 * NEW-CLIENT SUB-FLOW, WITHOUT NESTING DIALOGS: clicking "Nuevo cliente"
 * hides THIS dialog and opens the existing RealClientFormDialog beside it
 * rather than inside it — nested modals fight over focus trapping, and
 * this component stays mounted either way, so the half-filled application
 * form is preserved. On a successful save the new client is selected
 * automatically and this dialog comes back. `isDelegatingToClientForm`
 * exists purely so that programmatic close does NOT reset the form the
 * way a real user-initiated close does.
 *
 * A THREE-SECTION FORM, NOT A WIZARD: client, product, and terms are
 * labelled as steps and validated together on submit. A multi-page wizard
 * would add navigation state for three short sections that fit on one
 * screen, and would be worse on mobile, not better.
 *
 * PRODUCT LIST: rendered from what the Server Component resolved through
 * getApplicationCreatableProducts() — active AND holding at least one
 * active requirement template. This is a convenience filter only; the
 * Server Action re-checks the exact same rule, so hiding a product here
 * is never what stops it being used.
 */

interface NewApplicationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Products the server already determined are eligible for origination.
   * Empty is a legitimate state (no product is configured yet) and is
   * surfaced to the operator, not hidden. */
  products: Product[];
  /** Selectable clients. Ignored — and not required to be complete — when
   * lockedClient is provided. */
  clients: Client[];
  /** Entry point 2: the client is already known, so the search step is
   * replaced by a read-only confirmation of who this is for. */
  lockedClient?: Client;
  /** True when the page could not load the eligible-product list at all —
   * distinct from "loaded successfully, and none qualify". */
  productsLoadError?: boolean;
}

export function NewApplicationDialog({
  open,
  onOpenChange,
  products,
  clients,
  lockedClient,
  productsLoadError = false,
}: NewApplicationDialogProps) {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale() as Locale;
  // The new-client escape hatch is an independent mutation and keeps its
  // own Milestone 16 capability — a user may hold application:create
  // without client:create, in which case no creation affordance appears
  // and they may only file against an existing client.
  const canCreateClient = useCapability("client:create");

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [isDelegatingToClientForm, setIsDelegatingToClientForm] = useState(false);
  // Clients created inside this flow, so the selector can show one that
  // the server-rendered list predates. Never a replacement for that list.
  const [createdClients, setCreatedClients] = useState<Client[]>([]);

  const effectiveClientId = lockedClient?.id ?? selectedClientId;
  const selectableClients = useMemo(
    () => [...createdClients, ...clients],
    [createdClients, clients]
  );

  const resetForm = () => {
    setSelectedClientId(null);
    setProductId("");
    setAmount("");
    setTermMonths("");
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    // Suppress the reset when WE closed the dialog to show the client
    // form — the operator has not abandoned anything.
    if (!nextOpen && !isDelegatingToClientForm) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const handleRequestCreateClient = () => {
    setIsDelegatingToClientForm(true);
    setClientFormOpen(true);
    onOpenChange(false);
  };

  const handleClientFormOpenChange = (nextOpen: boolean) => {
    setClientFormOpen(nextOpen);
    if (!nextOpen) {
      // Whether the client was saved or the operator backed out, return
      // to the application form exactly as they left it.
      setIsDelegatingToClientForm(false);
      onOpenChange(true);
    }
  };

  const handleClientCreated = (client: Client) => {
    setCreatedClients((prev) => [client, ...prev]);
    setSelectedClientId(client.id);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    // Client-side validation mirrors the Server Action's own checks so the
    // operator gets an immediate, field-specific message. The action's
    // checks remain the enforcement — these only save a round trip.
    if (!effectiveClientId) {
      setError(t("applications.create.validation.clientRequired"));
      return;
    }
    if (!productId) {
      setError(t("applications.create.validation.productRequired"));
      return;
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError(t("applications.create.validation.amountInvalid"));
      return;
    }
    const parsedTerm = Number(termMonths);
    if (!Number.isInteger(parsedTerm) || parsedTerm < 1 || parsedTerm > 360) {
      setError(t("applications.create.validation.termInvalid"));
      return;
    }

    setError(null);
    setIsSubmitting(true);
    const result = await createSolicitudApplication({
      clientId: effectiveClientId,
      productId,
      requestedAmount: parsedAmount,
      requestedTermMonths: parsedTerm,
    });
    setIsSubmitting(false);

    if (result.status === "error") {
      const messageKey =
        result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED"
          ? "applications.create.toasts.errorForbidden"
          : result.code === "CLIENT_NOT_FOUND"
            ? "applications.create.toasts.errorClientNotFound"
            : result.code === "PRODUCT_NOT_AVAILABLE"
              ? "applications.create.toasts.errorProductNotAvailable"
              : "applications.create.toasts.errorGeneric";
      // The dialog deliberately stays open on failure — nothing the
      // operator typed is discarded.
      setError(t(messageKey));
      return;
    }

    const application = result.application;

    if (result.status === "partial") {
      // SLOT_SNAPSHOT_FAILED. The application EXISTS and is valid; only
      // its Requirement Slot snapshot did not complete. Never reported as
      // a plain success, and never rolled back.
      toast.warning(
        t("applications.create.toasts.partial", { number: application.applicationNumber })
      );
    } else {
      toast.success(
        t("applications.create.toasts.created", { number: application.applicationNumber })
      );
    }

    resetForm();
    onOpenChange(false);
    // Milestone 17 decision P3 — the new application opens straight into
    // its client's dossier on the Documents tab, which is where the
    // requirements just snapshotted for it are worked. No dossier record
    // is created; /expedientes/[clientId] already resolves one.
    router.push(
      `/expedientes/${application.clientId}?solicitud=${application.id}&tab=documentos`
    );
  };

  const hasProducts = products.length > 0;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("applications.create.title")}</DialogTitle>
            <DialogDescription>{t("applications.create.description")}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                {t("applications.create.steps.client")}
              </h3>
              {lockedClient ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="text-sm font-medium text-foreground">{lockedClient.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {lockedClient.identificationNumber} · {lockedClient.email}
                  </p>
                </div>
              ) : (
                <ClientSelector
                  clients={selectableClients}
                  selectedClientId={selectedClientId}
                  onSelect={setSelectedClientId}
                  onRequestCreateClient={canCreateClient ? handleRequestCreateClient : undefined}
                  disabled={isSubmitting}
                />
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                {t("applications.create.steps.product")}
              </h3>
              {productsLoadError ? (
                <p className="text-sm text-destructive">
                  {t("applications.create.product.loadError")}
                </p>
              ) : hasProducts ? (
                <div className="space-y-2">
                  <Label htmlFor="application-product">
                    {t("applications.create.product.label")}
                  </Label>
                  <Select
                    value={productId}
                    onValueChange={(value) => setProductId(value ?? "")}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id="application-product">
                      <SelectValue placeholder={t("applications.create.product.placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name[locale]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-4">
                  <p className="text-sm text-foreground">
                    {t("applications.create.product.noneAvailable")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("applications.create.product.noneAvailableHint")}
                  </p>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                {t("applications.create.steps.terms")}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="application-amount">
                    {t("applications.create.terms.amountLabel")}
                  </Label>
                  <Input
                    id="application-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder={t("applications.create.terms.amountPlaceholder")}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="application-term">
                    {t("applications.create.terms.termLabel")}
                  </Label>
                  <Input
                    id="application-term"
                    type="number"
                    min="1"
                    max="360"
                    step="1"
                    inputMode="numeric"
                    value={termMonths}
                    onChange={(event) => setTermMonths(event.target.value)}
                    placeholder={t("applications.create.terms.termPlaceholder")}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </section>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
              >
                {t("applications.create.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting || !hasProducts}>
                {isSubmitting
                  ? t("applications.create.submitting")
                  : t("applications.create.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* The ONE client form in this app, reused verbatim — same fields,
          same validation, same createClientAction. Rendered only when the
          caller holds client:create. */}
      {canCreateClient && !lockedClient && (
        <RealClientFormDialog
          open={clientFormOpen}
          onOpenChange={handleClientFormOpenChange}
          onSaved={handleClientCreated}
        />
      )}
    </>
  );
}

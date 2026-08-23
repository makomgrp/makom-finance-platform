"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Package, Plus, Pencil, ArrowUp, ArrowDown, Power, RotateCcw, AlertTriangle, ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { PRODUCT_STATUS_BADGE_CLASS, PRODUCT_STATUS_TRANSITIONS } from "@/lib/config/product";
import { createProduct, updateProductDetails, setProductStatus, moveProduct } from "@/app/(app)/configuracion/actions";
import { useCapability } from "@/lib/auth/use-capability";
import type { Locale } from "@/i18n/config";
import type { LocalizedText, Product } from "@/types";

interface ProductsSectionProps {
  products: Product[];
  hasError: boolean;
}

interface FormState {
  code: string;
  nameEs: string;
  nameEn: string;
  descriptionEs: string;
  descriptionEn: string;
}

const EMPTY_FORM: FormState = { code: "", nameEs: "", nameEn: "", descriptionEs: "", descriptionEn: "" };

function productToForm(product: Product): FormState {
  return {
    code: product.code,
    nameEs: product.name.es,
    nameEn: product.name.en,
    descriptionEs: product.shortDescription?.es ?? "",
    descriptionEn: product.shortDescription?.en ?? "",
  };
}

export function ProductsSection({ products: initialProducts, hasError }: ProductsSectionProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  // Milestone 16 — administrador-only. Every mutation below is additionally
  // enforced server-side by requireCapability("product:manage"); this only
  // avoids showing controls that would come back FORBIDDEN. The product
  // LIST itself, and the link into each product's requirements, stay
  // visible to every role — reading the catalogue is not configuring it.
  const canManageProducts = useCapability("product:manage");
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);

  const openCreateDialog = () => {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (product: Product) => {
    setEditingProduct(product);
    setForm(productToForm(product));
    setDialogOpen(true);
  };

  const buildNameAndDescription = (): { name: LocalizedText; shortDescription?: LocalizedText } | null => {
    const nameEs = form.nameEs.trim();
    const nameEn = form.nameEn.trim();
    if (!nameEs || !nameEn) return null;

    const descriptionEs = form.descriptionEs.trim();
    const descriptionEn = form.descriptionEn.trim();
    // All-or-nothing: either both locales are filled, or neither is —
    // mirrors products_short_description_locales_check.
    if ((descriptionEs.length > 0) !== (descriptionEn.length > 0)) {
      return null;
    }

    return {
      name: { es: nameEs, en: nameEn },
      shortDescription: descriptionEs && descriptionEn ? { es: descriptionEs, en: descriptionEn } : undefined,
    };
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const details = buildNameAndDescription();
    if (!details) {
      toast.error(t("settings.products.toasts.invalidForm"));
      return;
    }

    setSubmitting(true);

    if (editingProduct) {
      const result = await updateProductDetails({
        productId: editingProduct.id,
        name: details.name,
        shortDescription: details.shortDescription,
      });
      setSubmitting(false);

      if (result.status !== "success") {
        toast.error(t("settings.products.toasts.updateError"));
        return;
      }

      setProducts((current) => current.map((p) => (p.id === result.product.id ? result.product : p)));
      toast.success(t("settings.products.toasts.updated", { name: result.product.name[locale] }));
      setDialogOpen(false);
      return;
    }

    const code = form.code.trim();
    if (!/^[a-z][a-z0-9_]{1,59}$/.test(code)) {
      setSubmitting(false);
      toast.error(t("settings.products.toasts.invalidCode"));
      return;
    }

    const result = await createProduct({ code, name: details.name, shortDescription: details.shortDescription });
    setSubmitting(false);

    if (result.status !== "success") {
      toast.error(
        result.status === "error" && result.code === "DUPLICATE_CODE"
          ? t("settings.products.toasts.duplicateCode")
          : t("settings.products.toasts.createError")
      );
      return;
    }

    setProducts((current) => [...current, result.product].sort((a, b) => a.displayOrder - b.displayOrder));
    toast.success(t("settings.products.toasts.created", { name: result.product.name[locale] }));
    setDialogOpen(false);
  };

  const handleStatusChange = async (product: Product, targetStatus: Product["status"]) => {
    setBusyProductId(product.id);
    const result = await setProductStatus({ productId: product.id, status: targetStatus });
    setBusyProductId(null);

    if (result.status !== "success") {
      toast.error(t("settings.products.toasts.statusChangeError"));
      return;
    }

    setProducts((current) => current.map((p) => (p.id === result.product.id ? result.product : p)));
    toast.success(
      t("settings.products.toasts.statusUpdated", {
        name: result.product.name[locale],
        status: t(`statuses.productStatus.${targetStatus}`),
      })
    );
  };

  const handleMove = async (product: Product, direction: "up" | "down") => {
    setBusyProductId(product.id);
    const result = await moveProduct({ productId: product.id, direction });
    setBusyProductId(null);

    if (result.status !== "success") {
      toast.error(t("settings.products.toasts.reorderError"));
      return;
    }

    setProducts(result.products);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>{t("settings.products.title")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.products.description")}</p>
        </div>
        {canManageProducts && (
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setEditingProduct(null);
              setForm(EMPTY_FORM);
            }
          }}
        >
          <DialogTrigger
            render={
              <Button size="sm" onClick={openCreateDialog}>
                <Plus className="size-4" />
                {t("settings.products.newProduct")}
              </Button>
            }
          />
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingProduct ? t("settings.products.editDialogTitle") : t("settings.products.createDialogTitle")}
              </DialogTitle>
              <DialogDescription>{t("settings.products.dialogDescription")}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="product-code">{t("settings.products.code")}</Label>
                <Input
                  id="product-code"
                  required
                  disabled={!!editingProduct}
                  placeholder="personal_loan"
                  value={form.code}
                  onChange={(event) => setForm((f) => ({ ...f, code: event.target.value }))}
                />
                {!editingProduct && (
                  <p className="text-xs text-muted-foreground">{t("settings.products.codeHint")}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="product-name-es">{t("settings.products.nameEs")}</Label>
                  <Input
                    id="product-name-es"
                    required
                    value={form.nameEs}
                    onChange={(event) => setForm((f) => ({ ...f, nameEs: event.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="product-name-en">{t("settings.products.nameEn")}</Label>
                  <Input
                    id="product-name-en"
                    required
                    value={form.nameEn}
                    onChange={(event) => setForm((f) => ({ ...f, nameEn: event.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="product-description-es">{t("settings.products.descriptionEs")}</Label>
                  <Textarea
                    id="product-description-es"
                    rows={2}
                    value={form.descriptionEs}
                    onChange={(event) => setForm((f) => ({ ...f, descriptionEs: event.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="product-description-en">{t("settings.products.descriptionEn")}</Label>
                  <Textarea
                    id="product-description-en"
                    rows={2}
                    value={form.descriptionEn}
                    onChange={(event) => setForm((f) => ({ ...f, descriptionEn: event.target.value }))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  {t("settings.products.cancel")}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {editingProduct ? t("settings.products.saveChanges") : t("settings.products.createProduct")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {hasError ? (
          <EmptyState
            icon={AlertTriangle}
            title={t("settings.products.loadErrorTitle")}
            description={t("settings.products.loadErrorDescription")}
          />
        ) : products.length === 0 ? (
          <EmptyState
            icon={Package}
            title={t("settings.products.emptyTitle")}
            description={t("settings.products.emptyDescription")}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.products.columns.name")}</TableHead>
                  <TableHead>{t("settings.products.columns.status")}</TableHead>
                  <TableHead>{t("settings.products.columns.order")}</TableHead>
                  <TableHead className="text-right">{t("settings.products.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product, index) => {
                  const isBusy = busyProductId === product.id;
                  const nextStatus = PRODUCT_STATUS_TRANSITIONS[product.status][0];

                  return (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium text-foreground">{product.name[locale]}</TableCell>
                      <TableCell>
                        <StatusBadge
                          label={t(`statuses.productStatus.${product.status}`)}
                          className={PRODUCT_STATUS_BADGE_CLASS[product.status]}
                        />
                      </TableCell>
                      <TableCell>
                        {canManageProducts && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={isBusy || index === 0}
                              onClick={() => handleMove(product, "up")}
                            >
                              <ArrowUp className="size-3.5" />
                              <span className="sr-only">{t("settings.products.moveUp")}</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={isBusy || index === products.length - 1}
                              onClick={() => handleMove(product, "down")}
                            >
                              <ArrowDown className="size-3.5" />
                              <span className="sr-only">{t("settings.products.moveDown")}</span>
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            render={<Link href={`/configuracion/productos/${product.id}`} />}
                          >
                            <ListChecks className="size-3.5" />
                            {t("settings.products.viewRequirements")}
                          </Button>
                          {canManageProducts && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => openEditDialog(product)}
                              >
                                <Pencil className="size-3.5" />
                                {t("settings.products.edit")}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => handleStatusChange(product, nextStatus)}
                              >
                                {nextStatus === "active" ? (
                                  <>
                                    {product.status === "inactive" ? (
                                      <RotateCcw className="size-3.5" />
                                    ) : (
                                      <Power className="size-3.5" />
                                    )}
                                    {product.status === "inactive"
                                      ? t("settings.products.reactivate")
                                      : t("settings.products.activate")}
                                  </>
                                ) : (
                                  <>
                                    <Power className="size-3.5" />
                                    {t("settings.products.deactivate")}
                                  </>
                                )}
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

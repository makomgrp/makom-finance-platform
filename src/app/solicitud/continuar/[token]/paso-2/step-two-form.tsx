"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PortalProgress } from "@/components/portal/portal-progress";
import { submitPortalStepTwo } from "./actions";
import type { Step2Errors, Step2Mode } from "@/lib/validation/portal-step-two";
import type { LocalizedText } from "@/types";

/**
 * ============================================================================
 * STEP 2 — ONE FORM, FOUR SHAPES (26B-2)
 * ============================================================================
 *
 * The product decides which sections exist. A payroll applicant never sees a
 * vehicle question; a business applicant never sees a guarantor question. The
 * product code arrives from the server, so the shape of the form is not
 * something the browser can talk itself into.
 *
 * STILL A GUIDED FORM, NOT A QUESTIONNAIRE. Sections are short and titled, the
 * conditional parts stay hidden until the answer that needs them, and nothing
 * asks the customer to fill a table.
 *
 * TWO WAYS OUT, DELIBERATELY DIFFERENT:
 *   Continuar                    — validates everything the product needs.
 *   Guardar y continuar después  — persists whatever is well-formed and lets
 *                                  the customer leave.
 * A nullable column is not an optional question; the server decides which is
 * which, and this component only renders what it says.
 */

export interface StepTwoInitialValues {
  employmentStatus: string;
  employerName: string;
  jobTitle: string;
  contractType: string;
  selfEmployedActivity: string;
  startDate: string;
  monthlyIncome: string;
  payrollDeductionAvailable: string;
  monthlyExpenses: string;
  hasObligations: string;
  obligations: Array<{
    /** Database id. Present only for a row that already exists. */
    id?: string;
    lenderName: string;
    outstandingBalance: string;
    monthlyPayment: string;
  }>;
  hasGuarantor: string;
  guarantorFullName: string;
  guarantorEmail: string;
  guarantorPhone: string;
  bankName: string;
  accountType: string;
  /** Mask only. The stored number never reaches the browser. */
  accountNumberLast4: string;
  /**
   * Always starts EMPTY, even on resume. A value here means the customer typed
   * a replacement; blank means "keep whatever is stored".
   */
  accountNumber: string;
  receivesSalary: string;
  collateralType: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  vehiclePlate: string;
  ownedByApplicant: string;
  lienStatus: string;
  lienBalance: string;
  propertyType: string;
  propertyLocation: string;
  legalName: string;
  tradeName: string;
  economicActivity: string;
  operationsStartDate: string;
  registrationNumber: string;
  averageMonthlyRevenue: string;
  averageMonthlyExpenses: string;
  loanPurpose: string;
  purposeDescription: string;
  applicantRelationship: string;
}

interface StepTwoFormProps {
  productCode: string;
  productName: LocalizedText;
  applicationNumber: string;
  continuationToken: string;
  initialValues: StepTwoInitialValues;
}

/**
 * The form's own row shape adds `key`, a CLIENT-ONLY identity.
 *
 * React needs a key that survives reordering, and the array index will not do:
 * removing the middle obligation would make React reuse the wrong input state,
 * so the customer would watch a different loan's numbers appear in the row they
 * kept. The database id cannot serve either — a row the customer just added
 * does not have one yet.
 *
 * It lives in STATE rather than a ref because it is read during render, and a
 * ref read during render is exactly the bug the lint rule exists to catch: the
 * value React renders would not be the value React tracked.
 *
 * Stripped before the payload is sent; the server never sees it.
 */
interface ObligationRow {
  key: string;
  id?: string;
  lenderName: string;
  outstandingBalance: string;
  monthlyPayment: string;
}

type Values = Omit<StepTwoInitialValues, "obligations"> & { obligations: ObligationRow[] };

export function StepTwoForm({
  productCode,
  productName,
  applicationNumber,
  continuationToken,
  initialValues,
}: StepTwoFormProps) {
  const t = useTranslations("portal.step2");
  const tErrors = useTranslations("portal.errors");
  const locale = useLocale() as keyof LocalizedText;
  const router = useRouter();

  const [values, setValues] = useState<Values>(() => ({
    ...initialValues,
    obligations: initialValues.obligations.map((row) => ({ ...row, key: crypto.randomUUID() })),
  }));
  const [errors, setErrors] = useState<Step2Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<Step2Mode | null>(null);
  const shouldFocusErrorsRef = useRef(false);
  const baseId = useId();

  const set = <K extends keyof Values>(field: K, value: Values[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field as string];
      return next;
    });
  };

  const errorFor = (key: string): string | undefined => {
    const code = errors[key];
    return code ? tErrors(code) : undefined;
  };

  const setObligation = (index: number, field: "lenderName" | "outstandingBalance" | "monthlyPayment", value: string) => {
    setValues((prev) => {
      const next = [...prev.obligations];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, obligations: next };
    });
    setErrors((prev) => {
      const key = `obligations.${index}.${field}`;
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const addObligation = () => {
    setValues((prev) => ({
      ...prev,
      obligations: [
        ...prev.obligations,
        { key: crypto.randomUUID(), lenderName: "", outstandingBalance: "", monthlyPayment: "" },
      ],
    }));
  };

  const removeObligation = (index: number) => {
    setValues((prev) => ({ ...prev, obligations: prev.obligations.filter((_, i) => i !== index) }));
    // Row indexes shift when one is removed, so stale keyed errors would point
    // at the wrong row. Clearing them is more honest than re-indexing guesses.
    setErrors((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith("obligations.")))
    );
  };

  const submit = async (mode: Step2Mode) => {
    if (pending) return;
    setPending(mode);
    setFormError(null);

    try {
      const result = await submitPortalStepTwo({
        continuationToken,
        mode,
        payload: {
          ...values,
          // Blank means "leave the stored account alone". The mask is display
          // only and is never sent as if it were the number.
          accountNumber: values.accountNumber || undefined,
          // `key` is the client's own render identity and means nothing to the
          // server, so it is dropped here rather than sent and ignored.
          obligations: values.obligations.map((row) => ({
            id: row.id,
            lenderName: row.lenderName,
            outstandingBalance: row.outstandingBalance,
            monthlyPayment: row.monthlyPayment,
          })),
        },
      });

      if (result.status === "invalid") {
        shouldFocusErrorsRef.current = true;
        setErrors(result.fieldErrors);
        setPending(null);
        return;
      }
      if (result.status === "error") {
        shouldFocusErrorsRef.current = true;
        setFormError(tErrors(result.code));
        setPending(null);
        return;
      }

      if (mode === "draft") {
        setPending(null);
        setSaved(true);
        return;
      }
      // Step 3 does not exist yet; the route is ready and the boundary is
      // dev-only, so nothing half-finished can reach a customer.
      router.push(`/solicitud/continuar/${continuationToken}/paso-3`);
    } catch {
      shouldFocusErrorsRef.current = true;
      setFormError(tErrors("SAVE_FAILED"));
      setPending(null);
    }
  };

  const [saved, setSaved] = useState(false);
  const hasErrors = Object.keys(errors).length > 0 || formError !== null;

  const showEmployment = productCode !== "E";
  const showSelfEmployedChoice = productCode === "V";
  const isSelfEmployed = showSelfEmployedChoice && values.employmentStatus === "self_employed";

  return (
    <div className="flex flex-col gap-7 sm:gap-8">
      <PortalProgress currentStep={2} />

      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
          {t("title")}
        </h1>
        <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
          {t("subtitle", { product: productName[locale] ?? productName.es })}
        </p>
        {/* Subtle by design — the customer's reference if they call, not a badge. */}
        <p className="text-xs text-muted-foreground">
          {t("applicationRef", { number: applicationNumber })}
        </p>
      </header>

      {hasErrors && (
        <div
          ref={(node) => {
            if (node && shouldFocusErrorsRef.current) {
              shouldFocusErrorsRef.current = false;
              node.focus();
            }
          }}
          tabIndex={-1}
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/[0.06] p-4 outline-none"
        >
          <p className="text-sm font-medium text-destructive">{formError ?? t("errorSummary")}</p>
        </div>
      )}

      {saved && !hasErrors && (
        <div role="status" className="rounded-xl border border-success/30 bg-success/[0.06] p-4">
          <p className="text-sm font-medium text-foreground">{t("savedTitle")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("savedBody")}</p>
        </div>
      )}

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submit("complete");
        }}
        noValidate
        className="flex flex-col gap-7 sm:gap-8"
      >
        {/* ---- Employment / work situation (N, D, V) --------------------- */}
        {showEmployment && (
          <Section title={showSelfEmployedChoice ? t("workLegend") : t("employmentLegend")}>
            {showSelfEmployedChoice && (
              <ChoiceGroup
                legend={t("employmentStatusQuestion")}
                name={`${baseId}-employmentStatus`}
                value={values.employmentStatus}
                onChange={(v) => set("employmentStatus", v)}
                options={[
                  { value: "employee", label: t("employee") },
                  { value: "self_employed", label: t("selfEmployed") },
                ]}
              />
            )}

            {isSelfEmployed ? (
              <>
                <Field id={`${baseId}-activity`} label={t("selfEmployedActivity")} error={errorFor("selfEmployedActivity")}>
                  {(p) => (
                    <Input {...p} value={values.selfEmployedActivity}
                      onChange={(e) => set("selfEmployedActivity", e.target.value)} className="h-11" />
                  )}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${baseId}-startDate`} label={t("activityStartDate")} error={errorFor("startDate")}>
                    {(p) => (
                      <Input {...p} type="date" value={values.startDate}
                        onChange={(e) => set("startDate", e.target.value)} className="h-11" />
                    )}
                  </Field>
                  <MoneyField id={`${baseId}-income`} label={t("monthlyIncome")}
                    error={errorFor("monthlyIncome")} value={values.monthlyIncome}
                    onChange={(v) => set("monthlyIncome", v)} />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${baseId}-employer`} label={t("employerName")} error={errorFor("employerName")}>
                    {(p) => (
                      <Input {...p} value={values.employerName}
                        onChange={(e) => set("employerName", e.target.value)} className="h-11" />
                    )}
                  </Field>
                  <Field id={`${baseId}-jobTitle`} label={t("jobTitle")} error={errorFor("jobTitle")}>
                    {(p) => (
                      <Input {...p} value={values.jobTitle}
                        onChange={(e) => set("jobTitle", e.target.value)} className="h-11" />
                    )}
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${baseId}-startDate`} label={t("employmentStartDate")} error={errorFor("startDate")}>
                    {(p) => (
                      <Input {...p} type="date" value={values.startDate}
                        onChange={(e) => set("startDate", e.target.value)} className="h-11" />
                    )}
                  </Field>
                  <Field id={`${baseId}-contract`} label={t("contractType")} error={errorFor("contractType")}>
                    {(p) => (
                      <NativeSelect {...p} value={values.contractType}
                        onChange={(e) => set("contractType", e.target.value)}>
                        <option value="">{t("chooseOption")}</option>
                        <option value="permanent">{t("contractPermanent")}</option>
                        <option value="temporary">{t("contractTemporary")}</option>
                        <option value="contractor">{t("contractContractor")}</option>
                        <option value="other">{t("contractOther")}</option>
                      </NativeSelect>
                    )}
                  </Field>
                </div>
                <MoneyField id={`${baseId}-income`} label={t("monthlySalary")}
                  error={errorFor("monthlyIncome")} value={values.monthlyIncome}
                  onChange={(v) => set("monthlyIncome", v)} />
              </>
            )}

            {productCode === "N" && (
              <ChoiceGroup
                legend={t("payrollQuestion")}
                name={`${baseId}-payroll`}
                value={values.payrollDeductionAvailable}
                onChange={(v) => set("payrollDeductionAvailable", v)}
                error={errorFor("payrollDeductionAvailable")}
                options={[
                  { value: "yes", label: t("yes") },
                  { value: "no", label: t("no") },
                  { value: "unsure", label: t("unsure") },
                ]}
              />
            )}
          </Section>
        )}

        {/* ---- Banking (D) ---------------------------------------------- */}
        {productCode === "D" && (
          <Section title={t("bankingLegend")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={`${baseId}-bankName`} label={t("bankName")} error={errorFor("bankName")}>
                {(p) => (
                  <Input {...p} value={values.bankName}
                    onChange={(e) => set("bankName", e.target.value)} className="h-11" />
                )}
              </Field>
              <Field id={`${baseId}-accountType`} label={t("accountType")} error={errorFor("accountType")}>
                {(p) => (
                  <NativeSelect {...p} value={values.accountType}
                    onChange={(e) => set("accountType", e.target.value)}>
                    <option value="">{t("chooseOption")}</option>
                    <option value="savings">{t("accountSavings")}</option>
                    <option value="checking">{t("accountChecking")}</option>
                    <option value="other">{t("accountOther")}</option>
                  </NativeSelect>
                )}
              </Field>
            </div>

            <BankAccountNumber
              id={`${baseId}-accountNumber`}
              label={t("accountNumber")}
              storedMask={initialValues.accountNumberLast4}
              maskedLabel={t("accountStored", { last4: initialValues.accountNumberLast4 })}
              replaceLabel={t("accountReplace")}
              hint={t("accountHint")}
              error={errorFor("accountNumber")}
              value={values.accountNumber}
              onChange={(v) => set("accountNumber", v)}
            />

            <ChoiceGroup
              legend={t("receivesSalaryQuestion")}
              name={`${baseId}-receivesSalary`}
              value={values.receivesSalary}
              onChange={(v) => set("receivesSalary", v)}
              options={[
                { value: "yes", label: t("yes") },
                { value: "no", label: t("no") },
              ]}
            />
          </Section>
        )}

        {/* ---- Vehicle collateral (V) ----------------------------------- */}
        {productCode === "V" && (
          <Section title={t("vehicleLegend")} description={t("vehicleHelp")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={`${baseId}-make`} label={t("vehicleMake")} error={errorFor("vehicleMake")}>
                {(p) => <Input {...p} value={values.vehicleMake} onChange={(e) => set("vehicleMake", e.target.value)} className="h-11" />}
              </Field>
              <Field id={`${baseId}-model`} label={t("vehicleModel")} error={errorFor("vehicleModel")}>
                {(p) => <Input {...p} value={values.vehicleModel} onChange={(e) => set("vehicleModel", e.target.value)} className="h-11" />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={`${baseId}-year`} label={t("vehicleYear")} error={errorFor("vehicleYear")}>
                {(p) => <Input {...p} inputMode="numeric" value={values.vehicleYear} onChange={(e) => set("vehicleYear", e.target.value)} className="h-11" />}
              </Field>
              <Field id={`${baseId}-plate`} label={t("vehiclePlate")} error={errorFor("vehiclePlate")}>
                {(p) => <Input {...p} autoCapitalize="characters" value={values.vehiclePlate} onChange={(e) => set("vehiclePlate", e.target.value)} className="h-11" />}
              </Field>
            </div>
            <ChoiceGroup
              legend={t("ownedQuestion")}
              name={`${baseId}-owned`}
              value={values.ownedByApplicant}
              onChange={(v) => set("ownedByApplicant", v)}
              options={[{ value: "yes", label: t("yes") }, { value: "no", label: t("no") }]}
            />
            <ChoiceGroup
              legend={t("lienQuestion")}
              name={`${baseId}-lien`}
              value={values.lienStatus}
              onChange={(v) => set("lienStatus", v)}
              error={errorFor("lienStatus")}
              options={[
                { value: "yes", label: t("yes") },
                { value: "no", label: t("no") },
                { value: "unsure", label: t("unsure") },
              ]}
            />
            {values.lienStatus === "yes" && (
              <MoneyField id={`${baseId}-lienBalance`} label={t("lienBalance")}
                error={errorFor("lienBalance")} value={values.lienBalance}
                onChange={(v) => set("lienBalance", v)} />
            )}
          </Section>
        )}

        {/* ---- Business (E) --------------------------------------------- */}
        {productCode === "E" && (
          <>
            <Section title={t("businessLegend")}>
              <Field id={`${baseId}-legalName`} label={t("legalName")} error={errorFor("legalName")}>
                {(p) => <Input {...p} value={values.legalName} onChange={(e) => set("legalName", e.target.value)} className="h-11" />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={`${baseId}-tradeName`} label={t("tradeName")} hint={t("optional")} error={errorFor("tradeName")}>
                  {(p) => <Input {...p} value={values.tradeName} onChange={(e) => set("tradeName", e.target.value)} className="h-11" />}
                </Field>
                <Field id={`${baseId}-activityE`} label={t("economicActivity")} error={errorFor("economicActivity")}>
                  {(p) => <Input {...p} value={values.economicActivity} onChange={(e) => set("economicActivity", e.target.value)} className="h-11" />}
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={`${baseId}-opsStart`} label={t("operationsStartDate")} error={errorFor("operationsStartDate")}>
                  {(p) => <Input {...p} type="date" value={values.operationsStartDate} onChange={(e) => set("operationsStartDate", e.target.value)} className="h-11" />}
                </Field>
                <Field id={`${baseId}-ruc`} label={t("registrationNumber")} error={errorFor("registrationNumber")}>
                  {(p) => <Input {...p} value={values.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} className="h-11" />}
                </Field>
              </div>
              <ChoiceGroup
                legend={t("relationshipQuestion")}
                name={`${baseId}-relationship`}
                value={values.applicantRelationship}
                onChange={(v) => set("applicantRelationship", v)}
                error={errorFor("applicantRelationship")}
                options={[
                  { value: "owner", label: t("relOwner") },
                  { value: "partner", label: t("relPartner") },
                  { value: "director", label: t("relDirector") },
                  { value: "authorized_representative", label: t("relRepresentative") },
                  { value: "other", label: t("relOther") },
                ]}
              />
            </Section>

            <Section title={t("businessFinancesLegend")}>
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField id={`${baseId}-revenue`} label={t("averageMonthlyRevenue")}
                  error={errorFor("averageMonthlyRevenue")} value={values.averageMonthlyRevenue}
                  onChange={(v) => set("averageMonthlyRevenue", v)} />
                <MoneyField id={`${baseId}-bexpenses`} label={t("averageMonthlyExpenses")}
                  error={errorFor("averageMonthlyExpenses")} value={values.averageMonthlyExpenses}
                  onChange={(v) => set("averageMonthlyExpenses", v)} />
              </div>
            </Section>

            <Section title={t("purposeLegend")}>
              <ChoiceGroup
                legend={t("purposeQuestion")}
                name={`${baseId}-purpose`}
                value={values.loanPurpose}
                onChange={(v) => set("loanPurpose", v)}
                error={errorFor("loanPurpose")}
                options={[
                  { value: "working_capital", label: t("purposeWorkingCapital") },
                  { value: "inventory", label: t("purposeInventory") },
                  { value: "equipment", label: t("purposeEquipment") },
                  { value: "expansion", label: t("purposeExpansion") },
                  { value: "other", label: t("purposeOther") },
                ]}
              />
              <Field id={`${baseId}-purposeDesc`} label={t("purposeDescription")} error={errorFor("purposeDescription")}>
                {(p) => (
                  <textarea {...p} rows={3} value={values.purposeDescription}
                    onChange={(e) => set("purposeDescription", e.target.value)}
                    className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive" />
                )}
              </Field>
            </Section>

            <Section title={t("collateralLegend")}>
              <ChoiceGroup
                legend={t("collateralQuestion")}
                name={`${baseId}-collateralType`}
                value={values.collateralType}
                onChange={(v) => set("collateralType", v)}
                error={errorFor("collateralType")}
                options={[
                  { value: "vehicle", label: t("collateralVehicle") },
                  { value: "property", label: t("collateralProperty") },
                ]}
              />
              {values.collateralType === "vehicle" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id={`${baseId}-emake`} label={t("vehicleMake")} error={errorFor("vehicleMake")}>
                      {(p) => <Input {...p} value={values.vehicleMake} onChange={(e) => set("vehicleMake", e.target.value)} className="h-11" />}
                    </Field>
                    <Field id={`${baseId}-emodel`} label={t("vehicleModel")} error={errorFor("vehicleModel")}>
                      {(p) => <Input {...p} value={values.vehicleModel} onChange={(e) => set("vehicleModel", e.target.value)} className="h-11" />}
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id={`${baseId}-eyear`} label={t("vehicleYear")} error={errorFor("vehicleYear")}>
                      {(p) => <Input {...p} inputMode="numeric" value={values.vehicleYear} onChange={(e) => set("vehicleYear", e.target.value)} className="h-11" />}
                    </Field>
                    <Field id={`${baseId}-eplate`} label={t("vehiclePlate")} error={errorFor("vehiclePlate")}>
                      {(p) => <Input {...p} autoCapitalize="characters" value={values.vehiclePlate} onChange={(e) => set("vehiclePlate", e.target.value)} className="h-11" />}
                    </Field>
                  </div>
                </>
              )}
              {values.collateralType === "property" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${baseId}-propType`} label={t("propertyType")} error={errorFor("propertyType")}>
                    {(p) => <Input {...p} value={values.propertyType} onChange={(e) => set("propertyType", e.target.value)} className="h-11" />}
                  </Field>
                  <Field id={`${baseId}-propLoc`} label={t("propertyLocation")} error={errorFor("propertyLocation")}>
                    {(p) => <Input {...p} value={values.propertyLocation} onChange={(e) => set("propertyLocation", e.target.value)} className="h-11" />}
                  </Field>
                </div>
              )}
            </Section>
          </>
        )}

        {/* ---- Monthly expenses (N, D, V) -------------------------------- */}
        {showEmployment && (
          <Section title={t("expensesLegend")}>
            <MoneyField id={`${baseId}-expenses`} label={t("monthlyExpenses")}
              hint={t("monthlyExpensesHint")} error={errorFor("monthlyExpenses")}
              value={values.monthlyExpenses} onChange={(v) => set("monthlyExpenses", v)} />
          </Section>
        )}

        {/* ---- Obligations (all products) -------------------------------- */}
        <Section title={t("obligationsLegend")}>
          <ChoiceGroup
            legend={productCode === "E" ? t("obligationsQuestionBusiness") : t("obligationsQuestion")}
            name={`${baseId}-hasObligations`}
            value={values.hasObligations}
            onChange={(v) => {
              set("hasObligations", v);
              // Opening the section with one empty card beats presenting a
              // blank area and making the customer hunt for "add".
              if (v === "yes" && values.obligations.length === 0) addObligation();
            }}
            options={[{ value: "no", label: t("no") }, { value: "yes", label: t("yes") }]}
          />

          {values.hasObligations === "yes" && (
            <div className="flex flex-col gap-3">
              {values.obligations.map((row, index) => (
                <div key={row.key}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">
                      {t("obligationNumber", { number: index + 1 })}
                    </p>
                    <Button type="button" variant="ghost" size="sm"
                      onClick={() => removeObligation(index)}
                      className="h-8 gap-1 px-2 text-muted-foreground hover:text-destructive">
                      <X className="size-3.5" aria-hidden="true" />
                      {t("removeObligation")}
                    </Button>
                  </div>
                  <Field id={`${baseId}-ob-${index}-lender`} label={t("lenderName")}
                    error={errorFor(`obligations.${index}.lenderName`)}>
                    {(p) => (
                      <Input {...p} value={row.lenderName}
                        onChange={(e) => setObligation(index, "lenderName", e.target.value)} className="h-11" />
                    )}
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MoneyField id={`${baseId}-ob-${index}-balance`} label={t("outstandingBalance")}
                      error={errorFor(`obligations.${index}.outstandingBalance`)}
                      value={row.outstandingBalance}
                      onChange={(v) => setObligation(index, "outstandingBalance", v)} />
                    <MoneyField id={`${baseId}-ob-${index}-payment`} label={t("monthlyPayment")}
                      error={errorFor(`obligations.${index}.monthlyPayment`)}
                      value={row.monthlyPayment}
                      onChange={(v) => setObligation(index, "monthlyPayment", v)} />
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={addObligation}
                className="h-11 gap-1.5 self-start px-4">
                <Plus className="size-4" aria-hidden="true" />
                {t("addObligation")}
              </Button>
            </div>
          )}
        </Section>

        {/* ---- Guarantor (N, D, V) --------------------------------------- */}
        {productCode !== "E" && (
          <Section title={t("guarantorLegend")}>
            <ChoiceGroup
              legend={t("guarantorQuestion")}
              name={`${baseId}-hasGuarantor`}
              value={values.hasGuarantor}
              onChange={(v) => set("hasGuarantor", v)}
              options={[{ value: "no", label: t("no") }, { value: "yes", label: t("yes") }]}
            />
            {values.hasGuarantor === "yes" && (
              <>
                <Field id={`${baseId}-gName`} label={t("guarantorFullName")} error={errorFor("guarantorFullName")}>
                  {(p) => <Input {...p} value={values.guarantorFullName} onChange={(e) => set("guarantorFullName", e.target.value)} className="h-11" />}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${baseId}-gEmail`} label={t("guarantorEmail")} error={errorFor("guarantorEmail")}>
                    {(p) => <Input {...p} type="email" inputMode="email" autoCapitalize="none" value={values.guarantorEmail} onChange={(e) => set("guarantorEmail", e.target.value)} className="h-11" />}
                  </Field>
                  <Field id={`${baseId}-gPhone`} label={t("guarantorPhone")} error={errorFor("guarantorPhone")}>
                    {(p) => <Input {...p} type="tel" inputMode="tel" value={values.guarantorPhone} onChange={(e) => set("guarantorPhone", e.target.value)} className="h-11" />}
                  </Field>
                </div>
              </>
            )}
          </Section>
        )}

        {/* ---- Actions --------------------------------------------------- */}
        <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" nativeButton={false}
            className="h-11 self-start px-3 text-muted-foreground hover:text-foreground"
            render={<a href={`/solicitud/continuar/${continuationToken}`} />}>
            {t("back")}
          </Button>

          <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-center">
            <Button type="submit" disabled={pending !== null}
              className="h-12 w-full px-8 text-[0.9375rem] font-semibold sm:w-auto">
              {pending === "complete" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {pending === "complete" ? t("continueSaving") : t("continue")}
            </Button>
            <Button type="button" variant="outline" disabled={pending !== null}
              onClick={() => void submit("draft")}
              className="h-12 w-full px-6 text-[0.9375rem] sm:w-auto">
              {pending === "draft" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("saveForLater")}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Small building blocks                                                      */
/* ------------------------------------------------------------------------- */

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4">
      <legend className="mb-1 text-base font-semibold text-foreground">{title}</legend>
      {description && <p className="-mt-1 text-sm text-muted-foreground">{description}</p>}
      {children}
    </fieldset>
  );
}

/**
 * A yes/no (or small closed-set) question as real radios in a fieldset.
 *
 * Native inputs, `sr-only` rather than a zero-size box, and a selected state
 * carried by border, tint AND a filled dot — the same rules the Step 1 product
 * cards follow, for the same reasons.
 */
function ChoiceGroup({
  legend, name, value, onChange, options, error,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  error?: string;
}) {
  const errorId = error ? `${name}-error` : undefined;
  return (
    <fieldset aria-describedby={errorId} aria-invalid={error ? true : undefined}>
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label key={option.value}
              className={[
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-all",
                "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
                selected
                  ? "border-primary bg-primary/[0.06] font-medium text-foreground ring-1 ring-primary/20"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40",
              ].join(" ")}>
              <input type="radio" name={name} value={option.value} checked={selected}
                onChange={() => onChange(option.value)} className="peer sr-only" />
              <span aria-hidden="true"
                className={[
                  "flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  selected ? "border-primary" : "border-input",
                ].join(" ")}>
                {selected && <span className="size-2 rounded-full bg-primary" />}
              </span>
              {option.label}
            </label>
          );
        })}
      </div>
      {error && <p id={errorId} role="alert" className="mt-2 text-sm font-medium text-destructive">{error}</p>}
    </fieldset>
  );
}

function Field({
  id, label, hint, error, children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium text-foreground">{label}</Label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error && <p id={errorId} className="text-sm font-medium text-destructive">{error}</p>}
      {hint && !error && <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function MoneyField({
  id, label, hint, error, value, onChange,
}: {
  id: string; label: string; hint?: string; error?: string;
  value: string; onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      {(p) => (
        <div className="relative">
          <span aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input {...p} inputMode="decimal" value={value}
            onChange={(e) => onChange(e.target.value)} className="h-11 pl-7" />
        </div>
      )}
    </Field>
  );
}

function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props}
      className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive" />
  );
}

/**
 * The account number, which is the one field in Step 2 that must not be
 * round-tripped.
 *
 * When an account is already stored the customer sees ONLY the
 * database-generated last four and an explicit "replace" action. Nothing sends
 * the stored number to the browser, so nothing can send it back — and leaving
 * this field alone leaves the stored value untouched (see BankAccountWrite).
 */
function BankAccountNumber({
  id, label, storedMask, maskedLabel, replaceLabel, hint, error, value, onChange,
}: {
  id: string;
  label: string;
  storedMask: string;
  maskedLabel: string;
  replaceLabel: string;
  hint: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [replacing, setReplacing] = useState(!storedMask);

  // An account already on file: show the mask and nothing else. "Replace" is a
  // deliberate action, so an accidental keystroke cannot change a bank account.
  if (storedMask && !replacing) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-input bg-muted/40 px-3 py-2.5">
          <span className="font-mono text-sm text-foreground">{maskedLabel}</span>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2"
            onClick={() => { setReplacing(true); onChange(""); }}>
            {replaceLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Field id={id} label={label} hint={hint} error={error}>
      {(p) => (
        <Input {...p} inputMode="numeric" autoComplete="off" value={value}
          onChange={(e) => onChange(e.target.value)} className="h-11" />
      )}
    </Field>
  );
}

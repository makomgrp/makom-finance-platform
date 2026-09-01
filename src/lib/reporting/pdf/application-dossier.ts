import "server-only";
import PDFDocument from "pdfkit";
type DocInstance = InstanceType<typeof PDFDocument>;
import { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/format";
import { BUSINESS_TIME_ZONE } from "@/lib/config/business-time";
import { INK, PAGE, reserve, sectionTitle, statRow, table } from "@/lib/reporting/pdf/layout";
import type { ApplicationListItem } from "@/types/application";
import type { ApplicationStep2 } from "@/types/application-step2";
import type { ApplicationDeclarationSet } from "@/types/application-declaration";
import type { RequirementSlot } from "@/types/requirement-slot";
import type { DocumentEvidence } from "@/types/document-evidence";
import type { Client } from "@/types/client";
import type { ApplicationReviewView } from "@/lib/services/application-review";
import type { Locale } from "@/i18n/config";

/**
 * ============================================================================
 * MILESTONE 26B-27A — EL EXPEDIENTE EN PAPEL
 * ============================================================================
 *
 * La misma solicitud que ODL abre en pantalla, impresa para el comité, para el
 * archivo y para la reunión donde nadie va a tener el CRM delante.
 *
 * ----------------------------------------------------------------------------
 * ES UNA FOTO DE HOY, NO UN CIERRE
 * ----------------------------------------------------------------------------
 * A diferencia de los cierres mensuales de 26B-26G, esto NO es un registro
 * inmutable. Refleja el expediente en el momento de generarlo, y si mañana
 * alguien sube un documento o cambia el estado, el siguiente PDF será distinto.
 * Por eso lleva la fecha y hora de generación en el pie de todas las páginas:
 * un papel sin fecha se cita meses después como si siguiera vigente.
 *
 * ----------------------------------------------------------------------------
 * LO QUE NO ENTRA, Y POR QUÉ
 * ----------------------------------------------------------------------------
 *   * CONTENIDO DE DOCUMENTOS. Ni archivos, ni rutas de almacenamiento, ni
 *     enlaces firmados, ni hashes. Solo la lista de requisitos con su estado:
 *     qué falta, qué llegó y qué se revisó. Un PDF que arrastrara la cédula
 *     escaneada de alguien sería un expediente completo circulando por correo.
 *   * NOTAS INTERNAS. Ni las observaciones libres del cliente, ni las notas por
 *     ítem de la revisión, ni el cuerpo de las observaciones del analista. Son
 *     apuntes escritos entre compañeros —impresiones, dudas a medio resolver— y
 *     no están redactados para salir de la herramienta.
 *   * NÚMEROS DE CUENTA COMPLETOS. El expediente carga el resumen bancario, que
 *     por contrato solo lleva los cuatro últimos dígitos. Aquí no se pide más.
 *
 * SÍ entra la NOTA DE LA RECOMENDACIÓN, y es una decisión deliberada: no es un
 * apunte privado sino la razón declarada de una recomendación formal, que es
 * exactamente lo que un comité necesita leer para no tener que preguntarla.
 *
 * ----------------------------------------------------------------------------
 * ESTE DOCUMENTO CONTIENE DATOS PERSONALES
 * ----------------------------------------------------------------------------
 * Nombre, identificación, teléfono, correo, dirección, patrono y salario. Eso
 * es lo que un expediente ES, y por eso la ruta que lo genera exige exactamente
 * el mismo permiso que abrir la pantalla: quien no puede ver el expediente no
 * puede imprimirlo. El pie de cada página lo declara confidencial.
 */

export interface ApplicationDossierPdfInput {
  application: ApplicationListItem;
  client?: Client;
  step2?: ApplicationStep2;
  declarations?: ApplicationDeclarationSet;
  requirementSlots: RequirementSlot[];
  evidence: DocumentEvidence[];
  review?: ApplicationReviewView;
  locale: Locale;
}

function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "es-PA";
}

/** El guion largo del proyecto para «no consta». Nunca una celda en blanco. */
const EMPTY = "—";

/**
 * Una pareja etiqueta/valor, o nada.
 *
 * Devuelve `null` cuando el valor no existe, para que quien construye una
 * sección pueda descartarla entera si no quedó ninguna fila. Una sección con
 * seis guiones se lee como un expediente incompleto; una sección ausente se lee
 * como lo que es: ese producto no tiene esos campos.
 */
function fact(label: string, value: string | number | undefined | null) {
  if (value === undefined || value === null || value === "") return null;
  return { label, value: String(value) };
}

/**
 * Una pareja etiqueta/valor a ancho completo, con el valor ajustado en varias
 * líneas si hace falta.
 *
 * `statRow` reparte hasta cuatro celdas en una fila de altura FIJA (36pt) y con
 * el salto de línea desactivado: es perfecto para cifras y fechas, y se rompe
 * con un texto largo. En la primera versión «Préstamos con Descuento por
 * Nómina» y el nombre de un patrono desbordaban su celda y se montaban encima
 * de la fila siguiente. Los valores que pueden ser largos vienen aquí.
 */
function wrappedFact(doc: DocInstance, label: string, value: string): void {
  reserve(doc, 34);
  doc
    .fillColor(INK.muted)
    .font("Helvetica")
    .fontSize(7.5)
    .text(label.toUpperCase(), PAGE.margin, doc.y, { width: PAGE.contentWidth });
  doc
    .fillColor(INK.body)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(value, PAGE.margin, doc.y + 1, { width: PAGE.contentWidth });
  doc.moveDown(0.55);
  doc.fillColor(INK.body);
}

export async function renderApplicationDossierPdf(
  input: ApplicationDossierPdfInput
): Promise<Buffer> {
  const { application, client, step2, declarations, requirementSlots, evidence, review, locale } =
    input;

  const t = await getTranslations({ locale, namespace: "applicationDossier" });
  const tPdf = await getTranslations({ locale, namespace: "applicationDossier.pdf" });
  const tReview = await getTranslations({ locale, namespace: "review" });
  const tStatus = await getTranslations({ locale, namespace: "statuses" });
  const tCommon = await getTranslations({ locale, namespace: "common" });
  // Los vocabularios de valores viven en espacios RAÍZ —identificationTypes,
  // employmentStatuses, bankAccountTypes…— y son los mismos que usa la pantalla
  // del expediente. Se reutilizan para que el papel diga exactamente las mismas
  // palabras que el CRM, no un sinónimo.
  const tRoot = await getTranslations({ locale });

  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "long",
    timeZone: BUSINESS_TIME_ZONE,
  });
  const stampFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: BUSINESS_TIME_ZONE,
  });
  const date = (iso?: string) => (iso ? dateFmt.format(new Date(iso)) : undefined);
  const money = (amount?: number) => (amount === undefined ? undefined : formatCurrency(amount));

  /** Traduce un código del vocabulario cerrado; si falta, devuelve el código. */
  const label = (
    translate: { (key: string): string; has: (key: string) => boolean },
    key: string,
    code?: string | null
  ): string | undefined => {
    if (!code) return undefined;
    return translate.has(`${key}.${code}`) ? translate(`${key}.${code}`) : code;
  };

  const isDraft = !application.applicationNumber;
  const generatedAt = stampFmt.format(new Date());

  const doc = new PDFDocument({
    size: PAGE.size,
    margin: PAGE.margin,
    bufferPages: true,
    info: {
      Title: `${tPdf("documentTitle")} ${application.applicationNumber ?? tPdf("draft")}`,
      Author: "ODL Financial Corporation",
      Creator: "ODL LoanFlow CRM",
      // SIN el nombre del solicitante ni el de quien descarga: los metadatos de
      // un PDF viajan con el archivo y se leen sin abrirlo.
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  // ==========================================================================
  // A. ENCABEZADO
  // ==========================================================================
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(INK.accent)
    .text("ODL FINANCIAL CORPORATION", { characterSpacing: 1.1 });

  doc.moveDown(0.35);
  doc.font("Helvetica-Bold").fontSize(19).fillColor(INK.body).text(tPdf("documentTitle"));

  doc.moveDown(0.3);
  if (isDraft) {
    // UN BORRADOR SE ANUNCIA. Sin esto, un papel sin número se confunde con uno
    // cuyo número se olvidó de imprimir, y acaba discutido en un comité como si
    // fuera una solicitud formalizada.
    doc
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .fillColor(INK.muted)
      .text(tPdf("draftNotice"));
  } else {
    doc
      .font("Courier-Bold")
      .fontSize(13)
      .fillColor(INK.body)
      .text(application.applicationNumber!);
  }

  doc.moveDown(0.9);

  // ==========================================================================
  // B. RESUMEN DE LA SOLICITUD
  // ==========================================================================
  sectionTitle(doc, tPdf("sectionSummary"));
  wrappedFact(doc, t("product"), application.productName[locale]);
  statRow(
    doc,
    [
      fact(tPdf("status"), tStatus(`applicationStatus.${application.status}`)),
      fact(t("createdAt"), date(application.createdAt)),
      fact(t("submittedAt"), date(application.statusChangedAt)),
    ].filter((row) => row !== null)
  );
  statRow(
    doc,
    [
      fact(t("requestedAmount"), money(application.requestedAmount)),
      // MONTO APROBADO ≠ DINERO ENTREGADO. ODL no registra desembolsos: no hay
      // tabla, ni fecha, ni saldo. Cuando no hay decisión se dice, en vez de
      // imprimir un B/. 0,00 que se leería como «se aprobó cero».
      fact(
        tReview("approvedAmountLabel"),
        money(application.approvedAmount) ?? tPdf("noApprovedAmount")
      ),
      fact(
        t("term"),
        application.requestedTermMonths !== undefined
          ? t("months", { count: application.requestedTermMonths })
          : t("termNoPreference")
      ),
      fact(t("advisor"), application.assignedAdvisorFullName ?? tCommon("unassigned")),
    ].filter((row) => row !== null)
  );

  // ==========================================================================
  // C. DATOS DEL SOLICITANTE
  // ==========================================================================
  if (client) {
    sectionTitle(doc, t("sectionApplicant"));
    statRow(
      doc,
      [
        fact(t("fullName"), client.fullName),
        fact(
          t("identification"),
          `${label(tRoot, "identificationTypes", client.identificationType) ?? client.identificationType} ${client.identificationNumber}`
        ),
        fact(t("phone"), client.phone),
        fact(t("email"), client.email),
      ].filter((row) => row !== null)
    );
    if (client.address) wrappedFact(doc, tPdf("address"), client.address);
    const extra = [
      fact(tPdf("birthDate"), date(client.birthDate)),
      fact(tPdf("nationality"), client.nationality),

      fact(tPdf("clientStatus"), label(tStatus, "client", client.status)),
    ].filter((row) => row !== null);
    if (extra.length > 0) statRow(doc, extra);
  }

  // ==========================================================================
  // D + E. LABORAL Y FINANCIERO
  // ==========================================================================
  const employment = step2?.employment;
  const financial = step2?.financialProfile;

  if (employment || financial) {
    sectionTitle(doc, t("sectionFinancial"));

    if (employment) {
      if (employment.employerName) {
        wrappedFact(doc, t("employer"), employment.employerName);
      }
      const rows = [
        fact(
          t("employmentStatus"),
          label(tRoot, "employmentStatuses", employment.employmentStatus) ??
            employment.employmentStatus
        ),

        fact(t("position"), employment.jobTitle),
        fact(t("employmentStart"), date(employment.startDate)),
        fact(t("monthlySalary"), money(employment.monthlyIncome)),
        fact(t("contractType"), label(tRoot, "contractTypes", employment.contractType)),
        fact(
          t("payrollDeduction"),
          label(tRoot, "payrollDeduction", employment.payrollDeductionAvailable)
        ),
      ].filter((row) => row !== null);
      if (rows.length > 0) statRow(doc, rows);
    }

    if (financial) {
      const rows = [
        fact(t("monthlyExpenses"), money(financial.monthlyExpenses)),
        fact(t("additionalIncomeAmount"), money(financial.additionalMonthlyIncome)),
        fact(t("additionalIncomeSource"), financial.additionalIncomeSource),
      ].filter((row) => row !== null);
      if (rows.length > 0) statRow(doc, rows);
    }
  }

  // Cuentas bancarias — SOLO los cuatro últimos dígitos, que es lo único que el
  // contrato del expediente carga.
  if (step2 && step2.bankAccounts.length > 0) {
    reserve(doc, 70);
    table(
      doc,
      [
        { header: t("bank"), width: 200 },
        { header: t("accountType"), width: 149 },
        { header: t("account"), width: 150 },
      ],
      step2.bankAccounts.map((account) => [
        account.bankName,
        label(tRoot, "bankAccountTypes", account.accountType) ?? account.accountType,
        `•••• ${account.accountNumberLast4}`,
      ])
    );
  }

  // Obligaciones — solo si el expediente las tiene de verdad.
  if (step2 && step2.obligations.length > 0) {
    sectionTitle(doc, t("sectionObligations"));
    table(
      doc,
      [
        { header: t("lender"), width: 199 },
        { header: t("outstandingBalance"), width: 150, align: "right" },
        { header: t("monthlyPayment"), width: 150, align: "right" },
      ],
      step2.obligations.map((obligation) => [
        obligation.lenderName,
        money(obligation.outstandingBalance) ?? EMPTY,
        money(obligation.monthlyPayment) ?? EMPTY,
      ])
    );
  }

  // ==========================================================================
  // F. INFORMACIÓN ESPECÍFICA DEL PRODUCTO
  // ==========================================================================
  // Cada bloque aparece SOLO si la solicitud lo tiene. Un préstamo de nómina no
  // imprime una sección de vehículo vacía: una sección presente pero en blanco
  // sugiere que falta información, cuando lo cierto es que no aplica.
  const business = step2?.businessProfile;
  if (business) {
    sectionTitle(doc, tPdf("sectionBusiness"));
    statRow(
      doc,
      [
        fact(t("legalName"), business.legalName),
        fact(t("tradeName"), business.tradeName),
        fact(t("registrationNumber"), business.registrationNumber),
        fact(t("economicActivity"), business.economicActivity),
        fact(t("operationsStart"), date(business.operationsStartDate)),
        fact(t("monthlyRevenue"), money(business.averageMonthlyRevenue)),
        fact(t("businessExpenses"), money(business.averageMonthlyExpenses)),
        fact(t("loanPurpose"), label(tRoot, "loanPurposes", business.loanPurpose)),
        fact(
          t("relationship"),
          label(tRoot, "businessRelationships", business.applicantRelationship)
        ),
      ].filter((row) => row !== null)
    );
    if (business.purposeDescription) {
      wrappedFact(doc, tPdf("purposeDescription"), business.purposeDescription);
    }
  }

  if (step2 && step2.collateral.length > 0) {
    sectionTitle(doc, tPdf("sectionCollateral"));
    for (const item of step2.collateral) {
      const rows = [
        fact(
          t("vehicle"),
          [item.vehicleMake, item.vehicleModel, item.vehicleYear].filter(Boolean).join(" ") ||
            undefined
        ),
        fact(t("plate"), item.vehiclePlate),
        fact(t("lien"), label(tRoot, "lienStatuses", item.lienStatus)),
        fact(tPdf("lienBalance"), money(item.lienBalance)),
        fact(t("propertyType"), item.propertyType),
        fact(t("propertyLocation"), item.propertyLocation),
      ].filter((row) => row !== null);
      if (rows.length > 0) statRow(doc, rows);
    }
  }

  if (step2 && step2.guarantors.length > 0) {
    sectionTitle(doc, t("sectionGuarantor"));
    table(
      doc,
      [
        { header: t("guarantorName"), width: 199 },
        { header: t("phone"), width: 150 },
        { header: t("email"), width: 150 },
      ],
      step2.guarantors.map((guarantor) => [
        guarantor.fullName,
        guarantor.phone ?? EMPTY,
        guarantor.email ?? EMPTY,
      ])
    );
  }

  // ==========================================================================
  // G. DOCUMENTOS — LISTA DE REQUISITOS, NUNCA CONTENIDO
  // ==========================================================================
  if (requirementSlots.length > 0) {
    sectionTitle(doc, t("sectionDocuments"));

    // Las evidencias se resumen por requisito: cuántas y cuándo. Ni nombre de
    // archivo, ni ruta, ni hash — nada de eso se lee siquiera aquí.
    const bySlot = new Map<string, { count: number; lastUploadedAt?: string; lastReviewedAt?: string }>();
    for (const item of evidence) {
      const current = bySlot.get(item.requirementSlotId) ?? { count: 0 };
      current.count += 1;
      if (!current.lastUploadedAt || item.uploadedAt > current.lastUploadedAt) {
        current.lastUploadedAt = item.uploadedAt;
      }
      if (item.reviewedAt && (!current.lastReviewedAt || item.reviewedAt > current.lastReviewedAt)) {
        current.lastReviewedAt = item.reviewedAt;
      }
      bySlot.set(item.requirementSlotId, current);
    }

    table(
      doc,
      [
        // ANCHURAS EN PUNTOS, no fracciones, y su suma cabe en
        // PAGE.contentWidth (499,28). Pasarlas como fracciones dejaba el ancho
        // efectivo de cada celda en negativo, y pdfkit ajustando texto en una
        // caja de ancho negativo no termina nunca: agotó 4 GB de heap y mató el
        // servidor. TypeScript no lo veía porque ambas cosas son `number`.
        { header: tPdf("requirement"), width: 150 },
        { header: tPdf("required"), width: 76 },
        { header: tPdf("status"), width: 96 },
        { header: tPdf("files"), width: 52, align: "right" },
        { header: tPdf("lastUpload"), width: 125 },
      ],
      requirementSlots.map((slot) => {
        const summary = bySlot.get(slot.id);
        return [
          slot.name[locale] ?? slot.name.es,
          slot.required ? tPdf("yes") : tPdf("no"),
          label(tStatus, "requirementSlotStatus", slot.status) ?? slot.status,
          String(summary?.count ?? 0),
          date(summary?.lastUploadedAt) ?? EMPTY,
        ];
      })
    );
  }

  // ==========================================================================
  // H. DECLARACIONES
  // ==========================================================================
  if (declarations?.pep || declarations?.sourceOfFunds) {
    sectionTitle(doc, t("sectionDeclarations"));
    const rows = [
      declarations.pep
        ? fact(t("pep"), declarations.pep.isPep ? t("pepYes") : t("pepNo"))
        : null,
      // El DETALLE de una declaración PEP es información de cumplimiento
      // estructurada y forma parte del expediente que el analista ya lee.
      declarations.pep?.pepDetails
        ? fact(t("pepDetails"), declarations.pep.pepDetails)
        : null,
    ].filter((row) => row !== null);
    if (rows.length > 0) statRow(doc, rows);
  }

  // ==========================================================================
  // I. EVALUACIÓN Y DECISIÓN
  // ==========================================================================
  if (review) {
    sectionTitle(doc, tReview("sectionTitle"));
    statRow(
      doc,
      [
        fact(tPdf("reviewStatus"), tReview(`statuses.${review.status}`)),
        fact(tReview("reviewer"), review.reviewerFullName),
        fact(tReview("completedAt"), date(review.completedAt)),
        fact(tReview("recommendedBy"), review.recommendationByFullName),
      ].filter((row) => row !== null)
    );

    // LA RAZÓN DECLARADA DE LA RECOMENDACIÓN sí se imprime: es la explicación
    // formal que acompaña a una decisión, no un apunte privado entre colegas.
    // Las notas por ítem y el cuerpo de las observaciones quedan fuera.
    if (review.recommendationNote) {
      wrappedFact(doc, tPdf("recommendationNote"), review.recommendationNote);
    }

    const attention = review.attention;
    const pending = [
      attention.pendingRequiredItems > 0
        ? tReview("attention.pendingItems", { count: attention.pendingRequiredItems })
        : null,
      attention.issueItems > 0 ? tReview("attention.issues", { count: attention.issueItems }) : null,
      attention.documentsAwaitingReview > 0
        ? tReview("attention.documentsAwaiting", { count: attention.documentsAwaitingReview })
        : null,
      attention.rejectedDocuments > 0
        ? tReview("attention.documentsRejected", { count: attention.rejectedDocuments })
        : null,
    ].filter((line): line is string => line !== null);

    if (pending.length > 0) {
      wrappedFact(doc, tReview("attentionTitle"), pending.join(" · "));
    }
  }

  // ==========================================================================
  // PIE EN TODAS LAS PÁGINAS
  // ==========================================================================
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);

    // EL MARGEN INFERIOR SE ANULA ANTES DE ESCRIBIR EL PIE. pdfkit pagina solo
    // en cuanto un texto rebasa ese margen, y el pie va deliberadamente por
    // debajo: sin esto cada línea del pie añadiría una página, que a su vez
    // recibiría pie. Es el mismo defecto que dejó el primer informe ejecutivo
    // con seis páginas en blanco.
    doc.page.margins.bottom = 0;

    const y = 841.89 - PAGE.margin + 6;
    doc
      .moveTo(PAGE.margin, y - 10)
      .lineTo(PAGE.margin + PAGE.contentWidth, y - 10)
      .lineWidth(0.4)
      .strokeColor(INK.hairline)
      .stroke();

    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(INK.muted)
      .text(tPdf("confidential"), PAGE.margin, y - 3, {
        width: PAGE.contentWidth * 0.62,
        lineBreak: false,
      });

    doc.text(
      `${application.applicationNumber ?? tPdf("draft")} · ${generatedAt} · ${tPdf("pageOf", {
        page: i + 1,
        total: range.count,
      })}`,
      PAGE.margin + PAGE.contentWidth * 0.62,
      y - 3,
      { width: PAGE.contentWidth * 0.38, align: "right", lineBreak: false }
    );
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

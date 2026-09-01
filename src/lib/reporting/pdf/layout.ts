import "server-only";
import type PDFDocument from "pdfkit";

/**
 * ============================================================================
 * MILESTONE 26B-26E — EL MOTOR DE MAQUETACIÓN
 * ============================================================================
 *
 * pdfkit dibuja donde le digas y no sabe nada de secciones ni de tablas. Este
 * módulo añade lo único que un informe necesita de verdad: saber cuándo NO
 * empezar algo en el hueco que queda.
 *
 * ----------------------------------------------------------------------------
 * LA REGLA QUE JUSTIFICA TODO ESTO: NADA SE PARTE POR LA MITAD
 * ----------------------------------------------------------------------------
 * Un encabezado solo al pie de una página, una tabla separada de su título, una
 * fila cortada — cada uno convierte un informe de dirección en algo que parece
 * roto. `reserve()` mide ANTES de dibujar: si lo que viene no cabe entero, la
 * página cambia primero.
 *
 * Es la razón por la que se eligió pdfkit y no un motor declarativo. Aquí el
 * salto de página es una decisión explícita en cada punto, no un
 * comportamiento que hay que persuadir.
 *
 * ----------------------------------------------------------------------------
 * SIN ESTADO GLOBAL
 * ----------------------------------------------------------------------------
 * Toda la posición vive en `doc.y`, que es de pdfkit. Este módulo no lleva su
 * propio cursor en paralelo: dos cursores que deben coincidir son dos cursores
 * que acabarán no coincidiendo.
 */

export const PAGE = {
  size: "A4" as const,
  margin: 48,
  /** Ancho útil: A4 son 595.28pt. */
  contentWidth: 595.28 - 48 * 2,
  /** Dónde empieza a invadir el pie. Nada de contenido pasa de aquí. */
  bottomLimit: 841.89 - 48 - 26,
};

/** La paleta: sobria, corporativa, un solo acento. */
export const INK = {
  /** Negro de texto. No `#000`: en papel el negro puro vibra. */
  body: "#16181d",
  muted: "#6b7280",
  hairline: "#d9dce1",
  /** El azul corporativo del CRM, usado SOLO como acento. */
  accent: "#1e3a5f",
  /** Fondo de cabecera de tabla y de tarjeta. */
  surface: "#f4f5f7",
};

export type Doc = InstanceType<typeof PDFDocument>;

/**
 * ¿Cabe `height` en lo que queda de página?
 *
 * Si no cabe, salta. Se llama ANTES de dibujar, siempre — llamarlo después
 * sería comprobar si cupo algo que ya se pintó fuera.
 */
export function reserve(doc: Doc, height: number): void {
  if (doc.y + height > PAGE.bottomLimit) {
    doc.addPage();
  }
}

/** Un título de sección, con su regla fina y el espacio de lo que sigue. */
export function sectionTitle(doc: Doc, title: string, followingHeight = 60): void {
  // El título reserva SU alto MÁS el del primer bloque que viene detrás: un
  // encabezado solo al pie de página es exactamente lo que hay que evitar.
  reserve(doc, 30 + followingHeight);
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(INK.accent)
    .text(title, PAGE.margin, doc.y);
  doc.moveDown(0.25);
  const y = doc.y;
  doc
    .moveTo(PAGE.margin, y)
    .lineTo(PAGE.margin + PAGE.contentWidth, y)
    .lineWidth(0.5)
    .strokeColor(INK.hairline)
    .stroke();
  doc.y = y + 10;
  doc.fillColor(INK.body);
}

/** Un párrafo explicativo, en gris y pequeño. */
export function note(doc: Doc, text: string): void {
  const height = doc.heightOfString(text, { width: PAGE.contentWidth });
  reserve(doc, height + 8);
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(INK.muted)
    .text(text, PAGE.margin, doc.y, { width: PAGE.contentWidth, align: "left" });
  doc.moveDown(0.6);
  doc.fillColor(INK.body);
}

/**
 * Un aviso de cobertura: mismo papel que en el Dashboard.
 *
 * Fondo gris, no rojo. Dice «esto todavía no se medía», que es una verdad sobre
 * el sistema y no un fallo; pintarlo como alerta enseñaría a saltárselo.
 */
export function calloutBox(doc: Doc, text: string): void {
  const inner = PAGE.contentWidth - 20;
  const textHeight = doc.font("Helvetica").fontSize(8.5).heightOfString(text, { width: inner });
  const boxHeight = textHeight + 16;
  reserve(doc, boxHeight + 8);

  const top = doc.y;
  doc
    .roundedRect(PAGE.margin, top, PAGE.contentWidth, boxHeight, 3)
    .fillColor(INK.surface)
    .fill();
  doc
    .fillColor(INK.muted)
    .font("Helvetica")
    .fontSize(8.5)
    .text(text, PAGE.margin + 10, top + 8, { width: inner });
  doc.y = top + boxHeight + 10;
  doc.fillColor(INK.body);
}

export interface KpiTile {
  label: string;
  value: string;
  /** Segunda línea: la comparación, o el motivo de que no la haya. */
  caption?: string;
  /** Tercera línea, aún más discreta. */
  footnote?: string;
}

/**
 * La rejilla de cifras ejecutivas: tres por fila.
 *
 * El número manda y la comparación es discreta, igual que en pantalla. Seis
 * cifras del mismo tamaño compitiendo entre sí obligan a buscar, y buscar es lo
 * que un director no va a hacer.
 */
export function kpiGrid(doc: Doc, tiles: KpiTile[]): void {
  const perRow = 3;
  const gap = 10;
  const cellWidth = (PAGE.contentWidth - gap * (perRow - 1)) / perRow;
  const cellHeight = 62;

  for (let i = 0; i < tiles.length; i += perRow) {
    const row = tiles.slice(i, i + perRow);
    reserve(doc, cellHeight + gap);
    const top = doc.y;

    row.forEach((tile, column) => {
      const x = PAGE.margin + column * (cellWidth + gap);
      doc.roundedRect(x, top, cellWidth, cellHeight, 3).fillColor(INK.surface).fill();

      doc
        .fillColor(INK.muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(tile.label.toUpperCase(), x + 10, top + 9, { width: cellWidth - 20, lineBreak: false });

      doc
        .fillColor(INK.body)
        .font("Helvetica-Bold")
        .fontSize(15)
        .text(tile.value, x + 10, top + 22, { width: cellWidth - 20, lineBreak: false });

      let captionY = top + 42;
      if (tile.caption) {
        doc
          .fillColor(INK.muted)
          .font("Helvetica")
          .fontSize(7.5)
          .text(tile.caption, x + 10, captionY, { width: cellWidth - 20, lineBreak: false });
        captionY += 10;
      }
      if (tile.footnote) {
        doc
          .fillColor(INK.muted)
          .font("Helvetica")
          .fontSize(7)
          .text(tile.footnote, x + 10, captionY, { width: cellWidth - 20, lineBreak: false });
      }
    });

    doc.y = top + cellHeight + gap;
  }
  doc.fillColor(INK.body);
}

export interface TableColumn {
  header: string;
  /** Ancho en puntos. La suma debe caber en `PAGE.contentWidth`. */
  width: number;
  align?: "left" | "right";
}

/**
 * Una tabla con cabecera repetida en cada página.
 *
 * FILA A FILA, comprobando antes de cada una. Una fila cortada por la mitad es
 * peor que una página con más aire, y una tabla que continúa sin repetir su
 * cabecera obliga a volver atrás a ver qué columna era cuál.
 */
export function table(doc: Doc, columns: TableColumn[], rows: string[][]): void {
  // ANCHURA MÍNIMA — MILESTONE 26B-27A.
  //
  // `width` son PUNTOS, pero el tipo es `number` y nada impedía pasar una
  // fracción. Al hacerlo, `column.width - 12` queda en negativo y pdfkit,
  // intentando ajustar texto en una caja de ancho negativo, no termina nunca:
  // concatena cadenas hasta agotar el heap. En el expediente de solicitud eso
  // se llevó por delante 4 GB y mató el servidor de Next.
  //
  // Un error se arregla en un minuto; un proceso muerto sin mensaje cuesta una
  // tarde. Esto convierte lo segundo en lo primero.
  for (const column of columns) {
    if (!Number.isFinite(column.width) || column.width < 24) {
      throw new Error(
        `table(): la columna "${column.header}" tiene un ancho de ${column.width}pt. ` +
          "Las anchuras son PUNTOS y deben sumar como mucho PAGE.contentWidth."
      );
    }
  }

  const rowHeight = 18;
  const headerHeight = 20;

  const drawHeader = () => {
    const top = doc.y;
    doc.rect(PAGE.margin, top, PAGE.contentWidth, headerHeight).fillColor(INK.surface).fill();
    let x = PAGE.margin;
    columns.forEach((column) => {
      doc
        .fillColor(INK.muted)
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(column.header.toUpperCase(), x + 6, top + 6.5, {
          width: column.width - 12,
          align: column.align ?? "left",
          lineBreak: false,
        });
      x += column.width;
    });
    doc.y = top + headerHeight;
    doc.fillColor(INK.body);
  };

  reserve(doc, headerHeight + rowHeight * 2);
  drawHeader();

  rows.forEach((row) => {
    if (doc.y + rowHeight > PAGE.bottomLimit) {
      doc.addPage();
      drawHeader();
    }
    const top = doc.y;
    let x = PAGE.margin;
    columns.forEach((column, index) => {
      doc
        .fillColor(INK.body)
        .font("Helvetica")
        .fontSize(8.5)
        .text(row[index] ?? "", x + 6, top + 5, {
          width: column.width - 12,
          align: column.align ?? "left",
          lineBreak: false,
          ellipsis: true,
        });
      x += column.width;
    });
    doc
      .moveTo(PAGE.margin, top + rowHeight)
      .lineTo(PAGE.margin + PAGE.contentWidth, top + rowHeight)
      .lineWidth(0.4)
      .strokeColor(INK.hairline)
      .stroke();
    doc.y = top + rowHeight;
  });

  doc.y += 8;
}

/**
 * Una lista de etiqueta/valor en columnas.
 *
 * Para bloques de tres o cuatro cifras que no merecen una tabla — seguimientos,
 * correo, estado de oportunidades.
 */
export function statRow(doc: Doc, stats: { label: string; value: string }[]): void {
  const perRow = Math.min(4, Math.max(1, stats.length));
  const gap = 10;
  const cellWidth = (PAGE.contentWidth - gap * (perRow - 1)) / perRow;
  const cellHeight = 36;

  for (let i = 0; i < stats.length; i += perRow) {
    const row = stats.slice(i, i + perRow);
    reserve(doc, cellHeight + 6);
    const top = doc.y;
    row.forEach((stat, column) => {
      const x = PAGE.margin + column * (cellWidth + gap);
      doc
        .fillColor(INK.muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(stat.label.toUpperCase(), x, top, { width: cellWidth, lineBreak: false });
      doc
        .fillColor(INK.body)
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(stat.value, x, top + 12, { width: cellWidth, lineBreak: false });
    });
    doc.y = top + cellHeight;
  }
  doc.fillColor(INK.body);
}

/** Una línea de viñeta, para «Requiere atención». */
export function bullet(doc: Doc, text: string): void {
  const height = doc.font("Helvetica").fontSize(9).heightOfString(text, {
    width: PAGE.contentWidth - 14,
  });
  reserve(doc, height + 6);
  const top = doc.y;
  doc.circle(PAGE.margin + 3, top + 4.5, 1.8).fillColor(INK.accent).fill();
  doc
    .fillColor(INK.body)
    .font("Helvetica")
    .fontSize(9)
    .text(text, PAGE.margin + 14, top, { width: PAGE.contentWidth - 14 });
  doc.moveDown(0.35);
}

import type { Worksheet } from "exceljs";
import { sanitizeCellText } from "./sanitize.ts";
import { BUSINESS_TIME_ZONE } from "../../config/business-time.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26F — CÓMO SE ESCRIBE UNA CELDA
 * ============================================================================
 *
 * Módulo PURO a propósito: ni `server-only`, ni `next-intl`, ni Supabase. Todo
 * lo que decide qué acaba dentro de una celda vive aquí, para que pueda
 * ejercitarse de verdad con `node --test` —generar un libro y volver a leerlo—
 * en lugar de comprobarse leyendo el código fuente.
 *
 * Las cuatro garantías que este fichero existe para dar:
 *
 *   1. NINGÚN TEXTO SE CONVIERTE EN FÓRMULA. Todo pasa por `sanitizeCellText` y
 *      se asigna como cadena plana, que exceljs escribe como texto compartido.
 *   2. EL DINERO ES UN NÚMERO. Nunca `"B/. 1,234.56"` como cadena: un importe
 *      en texto no se suma, y una columna de importes que no se puede sumar es
 *      una columna que alguien va a teclear a mano.
 *   3. LAS FECHAS SON FECHAS, Y SON DE PANAMÁ. Fechas reales de Excel, no
 *      cadenas ISO, desplazadas a la hora del negocio (ver `panamaWallClock`).
 *   4. NINGÚN HIPERVÍNCULO. No se escribe ni un `hyperlink` en todo el módulo.
 *      Un correo o un dominio que llegó de un formulario público no debe
 *      convertirse en algo en lo que se pueda hacer clic.
 */

/** Qué es cada columna. El tipo decide el formato, no el nombre del campo. */
export type CellKind =
  | "text"
  | "integer"
  | "decimal"
  | "currency"
  | "percent"
  | "date"
  | "datetime"
  | "boolean";

export interface ColumnSpec<T> {
  header: string;
  /**
   * Un tipo fijo, o uno que depende de la fila.
   *
   * La forma de función existe para la hoja «Resumen», donde una misma columna
   * «Valor» lleva recuentos, importes en balboas y tasas. La alternativa era
   * escribir los importes como texto ya formateado para que cupieran en una
   * columna de un solo tipo — es decir, romper la regla de que el dinero es un
   * número. Se prefirió que la columna supiera de qué es cada fila.
   */
  kind: CellKind | ((row: T) => CellKind);
  width: number;
  value: (row: T) => unknown;
}

export interface SheetOptions {
  /** «Sí» / «No», ya traducidos por quien llama. */
  yes: string;
  no: string;
  /** Frase para una hoja sin filas. Nunca un guion: ver el porqué más abajo. */
  emptyMessage: string;
  locale: string;
}

/**
 * `"B/. "#,##0.00` y no `B/. #,##0.00`.
 *
 * En un formato de Excel, `/` es el código de fracción y `.` el separador
 * decimal: sin comillas, `B/.` no se imprime, se interpreta. Entrecomillado, la
 * celda muestra exactamente `B/. 1,234.56`, que es el resultado que pide el
 * negocio — el balboa panameño, a la par con el dólar.
 */
export const CURRENCY_FORMAT = '"B/. "#,##0.00';

/**
 * Los formatos numéricos, uno por tipo.
 *
 * `percent` es `0.0"%"` y NO `0.0%`. El formato de porcentaje nativo de Excel
 * multiplica por cien al mostrar, y las tasas de este proyecto ya vienen en
 * 0–100 desde SQL (`rate()` en el servicio de reporting). Con el formato nativo
 * un 66,7% se vería como 6670%. Entrecomillando el símbolo, la celda guarda el
 * mismo número que devolvió la base y muestra exactamente lo que muestra el
 * Dashboard.
 */
const NUMBER_FORMAT: Partial<Record<CellKind, string>> = {
  currency: CURRENCY_FORMAT,
  integer: "#,##0",
  decimal: "#,##0.00",
  percent: '0.0"%"',
};

const DATE_FORMAT: Record<string, string> = { es: "dd/mm/yyyy", en: "mm/dd/yyyy" };
const DATETIME_FORMAT: Record<string, string> = {
  es: "dd/mm/yyyy hh:mm",
  en: "mm/dd/yyyy hh:mm",
};

/**
 * Convierte un instante en una fecha cuyos campos UTC son la hora de Panamá.
 *
 * ----------------------------------------------------------------------------
 * POR QUÉ HACE FALTA ESTE RODEO
 * ----------------------------------------------------------------------------
 * Una fecha de Excel es un número de días desde 1900: no lleva zona horaria
 * ninguna. exceljs lo calcula desde `getTime()`, es decir desde UTC. Vercel
 * corre en UTC. Resultado sin corregir: una solicitud creada a las 19:00 del
 * 31 de agosto en Panamá aparecería en la hoja como el 1 de septiembre a las
 * 00:00 — un día distinto, en un informe de cierre de mes.
 *
 * NUNCA UN DESPLAZAMIENTO DE -5 HORAS A MANO. Se resuelve con `Intl` y la zona
 * `America/Panama`, igual que el resto del proyecto. Panamá no aplica horario
 * de verano hoy, pero un número mágico sería una decisión que nadie tomó y que
 * dejaría de ser cierta sin avisar.
 */
export function panamaWallClock(
  iso: string,
  timeZone: string = BUSINESS_TIME_ZONE
): Date | null {
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
  const hour = field("hour");

  const year = field("year");
  const month = field("month");
  const day = field("day");
  const minute = field("minute");
  const second = field("second");
  if ([year, month, day, minute, second].some((n) => !Number.isFinite(n))) return null;

  // `hourCycle` h23 puede devolver 24 para medianoche en algunos entornos.
  const normalizedHour = Number.isFinite(hour) ? hour % 24 : 0;

  return new Date(Date.UTC(year, month - 1, day, normalizedHour, minute, second));
}

/**
 * Escribe una hoja completa: encabezados, filas, formatos, panel fijo y filtro.
 *
 * ORDEN DE LAS FILAS: encabezado en la 1, datos desde la 2. El panel se fija en
 * la primera fila para que los títulos sigan a la vista al bajar por trescientas
 * solicitudes, y el autofiltro cubre exactamente el rango escrito.
 */
export function writeSheet<T>(
  sheet: Worksheet,
  columns: ColumnSpec<T>[],
  rows: T[],
  options: SheetOptions
): void {
  sheet.columns = columns.map((column) => ({ width: column.width }));

  const headerRow = sheet.getRow(1);
  columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    // El encabezado también se sanea. Hoy sale de un fichero de traducciones,
    // pero la regla es «ninguna celda de texto sin pasar por aquí», y una regla
    // con una excepción es una regla que alguien va a ampliar.
    cell.value = sanitizeCellText(column.header);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  headerRow.height = 28;
  headerRow.commit();

  rows.forEach((row, rowIndex) => {
    const target = sheet.getRow(rowIndex + 2);
    columns.forEach((column, columnIndex) => {
      const kind = typeof column.kind === "function" ? column.kind(row) : column.kind;
      writeCell(target.getCell(columnIndex + 1), kind, column.value(row), options);
    });
    target.commit();
  });

  sheet.views = [{ state: "frozen", ySplit: 1 }];

  // El filtro cubre solo lo escrito. Extenderlo a filas vacías haría que Excel
  // ofreciera filtrar por «(vacías)» en una hoja que no tiene ninguna.
  const lastColumn = columns.length;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: lastColumn },
  };

  if (rows.length === 0) {
    // UNA FRASE, NO UN GUION NI UNA HOJA EN BLANCO. Una hoja vacía sin explicar
    // se lee como un fallo del sistema; con la frase se lee como lo que es: en
    // este período no hubo ninguno.
    const cell = sheet.getRow(2).getCell(1);
    cell.value = sanitizeCellText(options.emptyMessage);
    cell.font = { italic: true, color: { argb: "FF6B7280" } };
    sheet.getRow(2).commit();
  }
}

/** Una celda, del tipo que dice su columna. */
function writeCell(
  cell: import("exceljs").Cell,
  kind: CellKind,
  raw: unknown,
  options: SheetOptions
): void {
  // VACÍO ES VACÍO, Y NO ES CERO. Un `null` del negocio deja la celda sin
  // valor en vez de escribir 0 o «-»: un cero en una columna de importes se
  // suma, y sumar «no lo sabemos» como si fuera «nada» falsea el total.
  if (raw === null || raw === undefined || raw === "") return;

  switch (kind) {
    case "integer":
    case "decimal":
    case "currency":
    case "percent": {
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) {
        cell.value = sanitizeCellText(raw);
        return;
      }
      cell.value = value;
      cell.numFmt = NUMBER_FORMAT[kind] ?? "#,##0.00";
      return;
    }

    case "date":
    case "datetime": {
      const wallClock = panamaWallClock(String(raw));
      if (!wallClock) {
        // Una marca de tiempo ilegible se muestra tal cual, saneada, en vez de
        // desaparecer: quien lea el informe debe poder ver que ese dato está mal.
        cell.value = sanitizeCellText(raw);
        return;
      }
      cell.value = wallClock;
      const formats = kind === "date" ? DATE_FORMAT : DATETIME_FORMAT;
      cell.numFmt = formats[options.locale] ?? formats.es;
      return;
    }

    case "boolean":
      cell.value = raw ? options.yes : options.no;
      return;

    case "text":
    default:
      cell.value = sanitizeCellText(raw);
  }
}

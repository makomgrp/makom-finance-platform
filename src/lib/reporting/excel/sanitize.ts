/**
 * ============================================================================
 * MILESTONE 26B-26F — LO QUE UNA CELDA DE TEXTO NO DEBE PODER HACER
 * ============================================================================
 *
 * Una hoja de cálculo no es un documento: es un intérprete. Si una celda
 * empieza por `=`, `+`, `-` o `@`, Excel y LibreOffice la leen como una
 * fórmula, y una fórmula puede referenciar otras celdas, llamar funciones y —
 * con DDE — pedirle al usuario permiso para ejecutar un programa.
 *
 * Los nombres, correos, direcciones y patronos de este libro los escribió el
 * público en un formulario web. Ninguno de esos valores debe poder convertirse
 * en algo que se evalúa.
 *
 * ----------------------------------------------------------------------------
 * DOS DEFENSAS, NO UNA
 * ----------------------------------------------------------------------------
 *   1. ESTRUCTURAL. El generador asigna siempre cadenas planas, así que exceljs
 *      las escribe como texto compartido (`t="s"`) y nunca como `<f>`. En el
 *      .xlsx tal cual, una celda saneada por este módulo no puede ser una
 *      fórmula aunque este módulo fallara entero.
 *   2. ESTE MÓDULO. Existe para el momento en que alguien reexporta la hoja a
 *      CSV y la vuelve a abrir — donde la defensa estructural desaparece y solo
 *      queda el primer carácter del valor.
 *
 * ----------------------------------------------------------------------------
 * POR QUÉ NO SE ANTEPONE UN APÓSTROFO A TODO LO QUE EMPIEZA POR `+`
 * ----------------------------------------------------------------------------
 * Porque en ODL hay teléfonos reales guardados como `+507 6000-0000`. La receta
 * de manual —apóstrofo a los cuatro caracteres, sin excepciones— convertiría el
 * teléfono de un cliente en `'+507 6000-0000` dentro del archivo. No sería una
 * molestia estética: sería el CRM corrompiendo un dato de contacto verdadero
 * cada vez que alguien exporta.
 *
 * La excepción está delimitada por lo que un valor puede HACER, no por lo que
 * parece. Un token compuesto solo de dígitos, espacios, paréntesis, puntos,
 * comas, barras, signos y guiones no puede nombrar una función, referenciar una
 * celda ni abrir un canal DDE: lo peor que Excel hace con `+507 6000-0000` es
 * mostrar `#¿NOMBRE?`. En cambio `+SUM(A1)`, `=cmd|' /C calc'!A0` o
 * `@WEBSERVICE(...)` sí pueden, y ninguno encaja en esa forma. Se anteponen.
 */

/** Caracteres que una hoja de cálculo interpreta como inicio de fórmula. */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@"]);

/**
 * Un literal numérico o telefónico. Sin letras, sin `|`, sin `!`, sin comillas
 * y sin `(` precedido de nombre: nada con lo que construir una llamada.
 */
const PLAIN_NUMERIC_LITERAL = /^[+-]?[\d\s().,+/-]+$/;

/** Límite duro de una celda en el formato xlsx. */
export const EXCEL_MAX_CELL_LENGTH = 32767;

/**
 * Convierte cualquier valor de texto de origen público en una celda inerte.
 *
 * Devuelve SIEMPRE una cadena. Un `null` del negocio se resuelve antes de
 * llegar aquí, en el generador, que decide si la celda va vacía o lleva una
 * frase — porque «no lo sabemos» y «está vacío» son cosas distintas, y esa
 * decisión no le corresponde a un saneador.
 */
export function sanitizeCellText(value: unknown): string {
  if (value === null || value === undefined) return "";

  const raw = typeof value === "string" ? value : String(value);

  // Los caracteres de control se van primero: además de ser inválidos en xlsx,
  // un carácter invisible delante de un `=` escondería justo el carácter que
  // esta función necesita mirar.
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned.length === 0) return "";

  const capped =
    cleaned.length > EXCEL_MAX_CELL_LENGTH ? cleaned.slice(0, EXCEL_MAX_CELL_LENGTH) : cleaned;

  const first = capped[0];
  if (!FORMULA_TRIGGERS.has(first)) return capped;

  // La excepción documentada arriba: un literal telefónico o numérico se deja
  // intacto porque no puede ejecutar nada.
  if (PLAIN_NUMERIC_LITERAL.test(capped)) return capped;

  // El apóstrofo es la neutralización estándar. Se aplica solo aquí, donde de
  // verdad hace falta.
  return `'${capped}`;
}

/**
 * ¿Este valor, tal cual está, sería interpretado como fórmula?
 *
 * Comprueba el RESULTADO, no la entrada. Las pruebas lo usan sobre lo que
 * `sanitizeCellText` ya devolvió, de modo que una regresión en el saneador no
 * pueda esconderse haciendo que las dos funciones se equivoquen igual.
 */
export function isFormulaCell(value: string): boolean {
  return value.length > 0 && FORMULA_TRIGGERS.has(value[0]) && !PLAIN_NUMERIC_LITERAL.test(value);
}

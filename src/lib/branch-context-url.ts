/**
 * ============================================================================
 * WHERE BRANCH VIEW CONTEXT TRAVELS (Milestone 25C-1)
 * ============================================================================
 *
 * Shared by client components (nav links, the selector) and server components
 * (the pages that read the parameter), so the answer to "does this surface
 * carry branch context?" is written once.
 *
 * THE DISTINCTION THIS FILE ENCODES IS A SECURITY BOUNDARY, not a convenience:
 *
 *   GLOBAL LIST CONTEXT — Dashboard, Clientes, Solicitudes, Documentos,
 *     Alertas. These answer "what am I looking ACROSS?", so a selected branch
 *     narrows them and should follow the user from one to the next.
 *
 *   DIRECT ENTITY ACCESS — /expedientes/[id] and any specific record. These
 *     answer "may I open THIS?", which depends only on the entity's own current
 *     branch versus the caller's authorized scope. They deliberately DO NOT
 *     read this parameter. A dossier someone legitimately holds must never 404
 *     because a display filter was left set on a list page they visited
 *     earlier — that would turn a view preference into an authorization input,
 *     which is the one thing this milestone must not do.
 *
 * Note there is no `src/lib/services` import here and no data access: this file
 * knows about routes and query strings, never about scopes or permissions.
 */

/** The single query parameter carrying view context. Spanish, matching the
 * app's user-facing route vocabulary (/clientes, /solicitudes, /expedientes). */
export const BRANCH_CONTEXT_PARAM = "sucursal";

/**
 * The only routes that honour and propagate branch context.
 *
 * Deliberately NOT including /expedientes (see the header), /chat (global by
 * an explicit 25C product decision) or /configuracion (administration, not
 * operations).
 */
const BRANCH_CONTEXT_PATHS = [
  "/dashboard",
  "/clientes",
  "/solicitudes",
  "/documentos",
  "/alertas",
] as const;

/** True when this path is a global list surface that honours branch context. */
export function isBranchContextPath(pathname: string): boolean {
  return BRANCH_CONTEXT_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

/**
 * Adds the current branch context to a navigation target, when — and only
 * when — the destination is a surface that honours it.
 *
 * Passing context to a page that ignores it would write a parameter nothing
 * reads and quietly suggest the filter is doing something. Returning `href`
 * untouched keeps the URL honest.
 */
export function withBranchContext(href: string, context: string | null | undefined): string {
  if (!context || !isBranchContextPath(href)) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${BRANCH_CONTEXT_PARAM}=${encodeURIComponent(context)}`;
}

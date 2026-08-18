import { getTranslations } from "next-intl/server";
import { EMPTY_BRANCH_SCOPE } from "@/lib/services/branch-scope-query";
import { resolveBranchViewScope } from "@/lib/services/branch-view-context";
import { viewSpansMultipleBranches } from "@/lib/services/branch-origin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { PageHeader } from "@/components/shared/page-header";
import { DocumentsTable } from "@/components/documents/documents-table";
import { getDocumentEvidenceWorkspace } from "@/lib/services/document-workspace";

export default async function DocumentosPage({ searchParams }: { searchParams: Promise<{ sucursal?: string }> }) {
  const t = await getTranslations("documentsModule");
  // Milestone 14E: each row's client display (and Dossier link) is now
  // resolved server-side via document-workspace.ts's own embedded join —
  // no separate getClients() fetch needed here anymore.
  // MILESTONE 25B-1 — scope resolved server-side, passed explicitly.
  const profile = await getCurrentProfile();
  // MILESTONE 25C-1 — VIEW CONTEXT. `scope` below is no longer the caller's
  // authorized scope directly: it is the INTERSECTION of that scope with the
  // branch they are currently viewing. resolveBranchViewScope() can only ever
  // narrow — an unreachable, inactive, unknown or stale `?sucursal=` silently
  // falls back to their authorized default, with no error and no signal about
  // whether that branch exists. Everything downstream keeps receiving one
  // server-resolved BranchScope and is unchanged.
  const { sucursal } = await searchParams;
  const { viewScope: scope } = await resolveBranchViewScope(
    profile?.branchScope ?? EMPTY_BRANCH_SCOPE,
    sucursal
  );
  // MILESTONE 25C-2 — does THIS view span more than one branch? Computed
  // server-side from the effective view scope and passed as a single boolean:
  // the component never receives the scope itself, so it cannot recompute — or
  // misread — authorization. The deciding factor is the VIEW, not the role.
  const showBranchOrigin = viewSpansMultipleBranches(scope);
  const result = await getDocumentEvidenceWorkspace(scope);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <DocumentsTable
        showBranchOrigin={showBranchOrigin}
        initialRows={result.status === "ok" ? result.rows : []}
        loadError={result.status === "error"}
      />
    </div>
  );
}

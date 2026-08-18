import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isBranchDeniedError, isEmptyScope } from "@/lib/services/branch-scope-query";
import { CLIENT_STATUS_VALUES } from "@/lib/config/client-status";
import type {
  ApplicationSource,
  BranchScope,
  Client,
  ClientStatus,
  IdentificationType,
} from "@/types";

/**
 * Server-only service for the Client Engine's identity table (Milestone
 * 14B — see the Milestone 14A architecture review). Uses the Admin
 * Client, same posture as every other service in this app: RLS is
 * enabled on `clients` with zero policies, so this is the only way to
 * read or write it until a real permissions model exists.
 *
 * Deliberately minimal, matching the approved 14B scope: read, create,
 * a narrow profile-update (never a generic unrestricted patch), and two
 * dedicated lifecycle functions (status / restricted), mirroring how
 * applications.ts and products.ts each separate ordinary field edits
 * from status transitions. No consumer in this codebase calls any of
 * this yet — every current UI surface still reads the demo Client model
 * (src/lib/demo-data/clients.ts). Migrating those consumers is explicitly
 * out of scope for Milestone 14B (see 14C/14D/14E).
 */

interface ClientRow {
  id: string;
  legacy_id: string | null;
  full_name: string;
  identification_type: string;
  identification_number: string;
  phone: string;
  email: string;
  employer_name: string | null;
  company_legacy_id: string | null;
  position: string;
  monthly_salary: number;
  birth_date: string;
  nationality: string;
  address: string;
  observations: string | null;
  status: string;
  restricted: boolean;
  created_at: string;
  created_by_profile_id: string | null;
  created_source: string;
}

const CLIENT_SELECT =
  "id, legacy_id, full_name, identification_type, identification_number, phone, email, employer_name, company_legacy_id, " +
  "position, monthly_salary, birth_date, nationality, address, observations, status, restricted, created_at, " +
  "created_by_profile_id, created_source";

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    legacyId: row.legacy_id ?? undefined,
    fullName: row.full_name,
    identificationType: row.identification_type as IdentificationType,
    identificationNumber: row.identification_number,
    phone: row.phone,
    email: row.email,
    employerName: row.employer_name ?? undefined,
    companyLegacyId: row.company_legacy_id ?? undefined,
    position: row.position,
    monthlySalary: row.monthly_salary,
    birthDate: row.birth_date,
    nationality: row.nationality,
    address: row.address,
    observations: row.observations ?? undefined,
    status: row.status as ClientStatus,
    restricted: row.restricted,
    createdAt: row.created_at,
    createdByProfileId: row.created_by_profile_id ?? undefined,
    createdSource: row.created_source as ApplicationSource,
  };
}

export type GetClientsResult = { status: "ok"; clients: Client[] } | { status: "error" };

/** Loads every real client, alphabetically by full name — no filter
 * params, matching getApplications()'s established "load everything,
 * filter client-side" precedent (the current Clients list already does
 * its own search/filter/paginate over a full array). */
export async function getClients(scope: BranchScope): Promise<GetClientsResult> {
  // Empty scope can never match. Return without querying rather than emitting a
  // predicate — see branch-scope-query.ts on the empty-scope trap.
  if (isEmptyScope(scope)) return { status: "ok", clients: [] };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase.from("clients").select(CLIENT_SELECT),
      scope
    ).order("full_name", { ascending: true });

    if (error) {
      console.error("[clients service] Failed to load clients:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as ClientRow[];
    return { status: "ok", clients: rows.map(toClient) };
  } catch (error) {
    console.error(
      "[clients service] Unexpected failure loading clients:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type GetClientResult =
  | { status: "ok"; client: Client }
  | { status: "error"; code: "NOT_FOUND" | "QUERY_FAILED" };

/** Loads a single real client by its real uuid id. */
export async function getClientById(scope: BranchScope, id: string): Promise<GetClientResult> {
  // OUT OF SCOPE => NOT_FOUND, NEVER FORBIDDEN. The scope is part of the same
  // query as the id, so an inaccessible client simply does not come back and
  // the existing null path yields the right answer. Fetch-then-compare would be
  // a second code path that could drift, and returning a distinct code would
  // itself confirm the record exists in another branch.
  if (isEmptyScope(scope)) return { status: "error", code: "NOT_FOUND" };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase.from("clients").select(CLIENT_SELECT).eq("id", id),
      scope
    ).maybeSingle<ClientRow>();

    if (error) {
      console.error("[clients service] Failed to load client by id:", error.message);
      return { status: "error", code: "QUERY_FAILED" };
    }
    if (!data) {
      return { status: "error", code: "NOT_FOUND" };
    }

    return { status: "ok", client: toClient(data) };
  } catch (error) {
    console.error(
      "[clients service] Unexpected failure loading client by id:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "QUERY_FAILED" };
  }
}

export type FindClientByIdentificationResult =
  | { status: "ok"; client: Client | null }
  | { status: "error" };

/** Narrow lookup used only for duplicate-detection ahead of createClient
 * — "no match" is a normal, successful outcome here (client is null),
 * distinct from getClientById's NOT_FOUND-is-an-error semantics. Not
 * intended as a general-purpose read API.
 *
 * MILESTONE 25B-1 — DELIBERATELY UNSCOPED, AND THE ONLY APPROVED EXCEPTION.
 * Client identification uniqueness is NATIONAL across ODL (a cédula identifies
 * one person, not one person per branch), and this function is the guard that
 * enforces it. Scoping it would let the same identification be created twice in
 * different branches, splitting one human's compliance flags — including
 * `restricted` — across duplicate records.
 *
 * IT IS NOT AN ENUMERATION CHANNEL: it is reachable only from createClient's
 * duplicate check and the intake matcher, never from a search surface, and its
 * caller must surface an OPAQUE duplicate error that names no branch, no client
 * and no other field. */
export async function findClientByIdentification(
  identificationType: IdentificationType,
  identificationNumber: string
): Promise<FindClientByIdentificationResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("clients")
      .select(CLIENT_SELECT)
      .eq("identification_type", identificationType)
      .eq("identification_number", identificationNumber)
      .maybeSingle<ClientRow>();

    if (error) {
      console.error("[clients service] Failed to look up client by identification:", error.message);
      return { status: "error" };
    }

    return { status: "ok", client: data ? toClient(data) : null };
  } catch (error) {
    console.error(
      "[clients service] Unexpected failure looking up client by identification:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type FindClientsByEmailResult = { status: "ok"; clients: Client[] } | { status: "error" };

/** Narrow lookup used only by the Application Intake matching service
 * (src/lib/services/client-matching.ts) — email has no unique
 * constraint on this table, so this deliberately returns every match
 * rather than assuming at most one, letting the caller distinguish "no
 * match" / "exactly one match" / "ambiguous" itself. Not intended as a
 * general-purpose read API. */
export async function findClientsByEmail(
  scope: BranchScope,
  email: string
): Promise<FindClientsByEmailResult> {
  // SEARCH IS A DISCOVERY CHANNEL: a user must not learn that an inaccessible
  // client exists by searching for their e-mail.
  if (isEmptyScope(scope)) return { status: "ok", clients: [] };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase.from("clients").select(CLIENT_SELECT).eq("email", email),
      scope
    );

    if (error) {
      console.error("[clients service] Failed to look up clients by email:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as ClientRow[];
    return { status: "ok", clients: rows.map(toClient) };
  } catch (error) {
    console.error(
      "[clients service] Unexpected failure looking up clients by email:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type FindClientsByPhoneResult = { status: "ok"; clients: Client[] } | { status: "error" };

/** Same rationale as findClientsByEmail, for phone — no unique
 * constraint on this table either. */
export async function findClientsByPhone(
  scope: BranchScope,
  phone: string
): Promise<FindClientsByPhoneResult> {
  // Same discovery reasoning as findClientsByEmail.
  if (isEmptyScope(scope)) return { status: "ok", clients: [] };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase.from("clients").select(CLIENT_SELECT).eq("phone", phone),
      scope
    );

    if (error) {
      console.error("[clients service] Failed to look up clients by phone:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as ClientRow[];
    return { status: "ok", clients: rows.map(toClient) };
  } catch (error) {
    console.error(
      "[clients service] Unexpected failure looking up clients by phone:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export interface CreateClientInput {
  fullName: string;
  identificationType: IdentificationType;
  identificationNumber: string;
  phone: string;
  email: string;
  /** Free-text employer as stated by the client (Milestone 23). Optional —
   * an omitted employer persists NULL, which is the honest value for "we did
   * not ask". This input deliberately has NO companyLegacyId: the CRM stopped
   * writing that column entirely, so a newly created client can never carry a
   * fabricated company code. */
  employerName?: string;
  position: string;
  monthlySalary: number;
  birthDate: string;
  nationality: string;
  address: string;
  observations?: string;
  source: ApplicationSource;
  /** Only valid (and only used) when source === "crm_manual" — see
   * clients_created_by_source_check. */
  actorProfileId: string | null;
}

export type CreateClientResult =
  | { status: "ok"; client: Client }
  | { status: "error"; code: "INVALID_INPUT" | "INVALID_ACTOR" | "DUPLICATE_IDENTIFICATION" | "INSERT_FAILED" };

/**
 * Creates a real client. Never trusts created_at from the caller (the
 * column DEFAULT sets it) and never generates a legacy_id — a newly
 * created real client is not a legacy client, it simply has no legacy
 * identity to bridge (see the migration's header comment). status and
 * restricted are left to their column DEFAULTs ('prospecto' / false);
 * this function has no path to set either at creation, matching
 * createProduct's identical "new rows always start at the default
 * lifecycle state" posture.
 *
 * Duplicate detection relies on the database's own composite unique
 * constraint (identification_type, identification_number) as the
 * authoritative guard — not a separate pre-check query, which would be
 * race-prone under concurrent creates. A 23505 unique-violation on this
 * insert can only ever be that constraint (legacy_id is never set on
 * this path, so it cannot collide), mirroring createProduct's identical
 * "blanket-map 23505 to the one real duplicate code" pattern.
 */
export async function createClient(input: CreateClientInput): Promise<CreateClientResult> {
  if (input.actorProfileId !== null && input.source !== "crm_manual") {
    return { status: "error", code: "INVALID_ACTOR" };
  }
  if (
    !input.fullName.trim() ||
    !input.identificationNumber.trim() ||
    !input.phone.trim() ||
    !input.email.trim() ||
    !input.position.trim() ||
    !input.nationality.trim() ||
    !input.address.trim() ||
    !(input.monthlySalary >= 0)
  ) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("clients")
    .insert({
      full_name: input.fullName,
      identification_type: input.identificationType,
      identification_number: input.identificationNumber,
      phone: input.phone,
      email: input.email,
      // MILESTONE 23: company_legacy_id is NOT written here and has no
      // input to write from. It is left to its column DEFAULT (NULL) on every
      // new client, so the static COMPANIES bridge can never acquire a new
      // dependant. employer_name is the only employer this path records.
      employer_name: input.employerName ?? null,
      position: input.position,
      monthly_salary: input.monthlySalary,
      birth_date: input.birthDate,
      nationality: input.nationality,
      address: input.address,
      observations: input.observations ?? null,
      created_by_profile_id: input.actorProfileId,
      created_source: input.source,
    })
    .select(CLIENT_SELECT)
    .single<ClientRow>();

  if (error || !data) {
    if (error?.code === "23505") {
      return { status: "error", code: "DUPLICATE_IDENTIFICATION" };
    }
    console.error("[clients service] Failed to insert client:", error?.message ?? "no row returned");
    return { status: "error", code: "INSERT_FAILED" };
  }

  return { status: "ok", client: toClient(data) };
}

export interface UpdateClientProfileInput {
  fullName: string;
  identificationType: IdentificationType;
  identificationNumber: string;
  phone: string;
  email: string;
  address: string;
  /** Free-text employer (Milestone 23) — the field the form actually
   * edits. */
  employerName?: string;
  /** PASS-THROUGH ONLY, never edited. record_client_profile_update writes
   * every column it is given, so a fixture row's existing company code has to
   * be handed back unchanged or the update would silently erase the one value
   * that still renders its employer. New clients never have one. */
  companyLegacyId?: string;
  position: string;
  monthlySalary: number;
  birthDate: string;
  nationality: string;
  observations?: string;
}

export type UpdateClientProfileResult =
  | { status: "ok"; client: Client }
  | { status: "error"; code: "CLIENT_NOT_FOUND" | "DUPLICATE_IDENTIFICATION" | "UPDATE_FAILED" };

/**
 * Updates only the approved mutable profile fields — deliberately cannot
 * change id, legacyId, status, restricted, createdAt, createdByProfileId,
 * or createdSource. status/restricted go through their own dedicated
 * functions below, mirroring how updateProductDetails cannot change
 * status either (see products.ts).
 */
export async function updateClientProfile(
  clientId: string,
  input: UpdateClientProfileInput,
  actorProfileId: string | null
): Promise<UpdateClientProfileResult> {
  const supabase = getSupabaseServerClient();

  // MILESTONE 20: atomic mutation + audit append, with the changed-field diff
  // computed inside the transaction.
  //
  // PRIVACY: the resulting event records WHICH fields changed and nothing
  // else. Client PII is never written to crm_events — that table is
  // append-only with no delete path, so a personal value copied into it could
  // never be corrected or erased. What the values were is what `clients` is
  // for. A save that changes nothing writes no event.
  const { data: changedId, error: rpcError } = await supabase.rpc("record_client_profile_update", {
    p_client_id: clientId,
    p_full_name: input.fullName,
    p_identification_type: input.identificationType,
    p_identification_number: input.identificationNumber,
    p_phone: input.phone,
    p_email: input.email,
    p_address: input.address,
    p_company_legacy_id: input.companyLegacyId ?? null,
    p_position: input.position,
    p_monthly_salary: input.monthlySalary,
    p_birth_date: input.birthDate,
    p_nationality: input.nationality,
    p_observations: input.observations ?? null,
    p_employer_name: input.employerName ?? null,
    p_actor_profile_id: actorProfileId,
  });

  if (rpcError) {
    // MILESTONE 25B-2 — out of branch scope is reported as CLIENT_NOT_FOUND,
    // exactly like a client that does not exist. See BRANCH_DENIED_SQLSTATE.
    if (isBranchDeniedError(rpcError.code)) {
      return { status: "error", code: "CLIENT_NOT_FOUND" };
    }
    // clients_identification_type_identification_number_key still raises
    // 23505 from inside the function, aborting both the update and the event.
    if (rpcError.code === "23505") {
      return { status: "error", code: "DUPLICATE_IDENTIFICATION" };
    }
    console.error("[clients service] Failed to update client profile:", rpcError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!changedId) {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }

  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_SELECT)
    .eq("id", clientId)
    .maybeSingle<ClientRow>();

  if (error || !data) {
    console.error(
      "[clients service] Profile updated but the client could not be re-read:",
      error?.message ?? "no row returned"
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }

  return { status: "ok", client: toClient(data) };
}

export type SetClientStatusResult =
  | { status: "ok"; client: Client }
  | { status: "error"; code: "CLIENT_NOT_FOUND" | "INVALID_STATUS" | "UPDATE_FAILED" };

/**
 * Sets a client's lifecycle status. No transition-legality graph is
 * enforced (unlike setApplicationStatus/setProductStatus) — per the
 * Milestone 14A architecture review, client status changes are
 * administrative, not business-rule-gated; staff may move freely between
 * prospecto/activo/inactivo. Still validates the target is one of the
 * three real values this table understands, since callers may eventually
 * sit behind a Server Action taking less-trusted input.
 */
export async function setClientStatus(
  clientId: string,
  status: ClientStatus,
  actorProfileId: string | null
): Promise<SetClientStatusResult> {
  if (!CLIENT_STATUS_VALUES.includes(status)) {
    return { status: "error", code: "INVALID_STATUS" };
  }

  const supabase = getSupabaseServerClient();

  // MILESTONE 20: atomic mutation + audit append. This update used to be
  // blind, so it never knew the value it was replacing; the read now happens
  // inside the function under `for update`, which is the only place it can be
  // taken safely — previous_value is genuinely the value being replaced, not
  // one another transaction has already changed. A same-status write remains
  // a success and writes no event.
  const { data: changedId, error: rpcError } = await supabase.rpc("record_client_status_change", {
    p_client_id: clientId,
    p_new_status: status,
    p_actor_profile_id: actorProfileId,
  });

  if (rpcError) {
    // MILESTONE 25B-2 — see updateClientProfile above.
    if (isBranchDeniedError(rpcError.code)) {
      return { status: "error", code: "CLIENT_NOT_FOUND" };
    }
    console.error("[clients service] Failed to update client status:", rpcError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!changedId) {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }

  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_SELECT)
    .eq("id", clientId)
    .maybeSingle<ClientRow>();

  if (error || !data) {
    console.error(
      "[clients service] Status changed but the client could not be re-read:",
      error?.message ?? "no row returned"
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }

  return { status: "ok", client: toClient(data) };
}

export type SetClientRestrictedResult =
  | { status: "ok"; client: Client }
  | { status: "error"; code: "CLIENT_NOT_FOUND" | "UPDATE_FAILED" };

/**
 * Independently toggles the compliance/risk flag — never changes
 * lifecycle status, matching this table's deliberate status/restricted
 * split (see the migration's column comment on `restricted`).
 *
 * MILESTONE 23: this used to be a blind direct UPDATE with no audit and no
 * caller. It now goes through record_client_restriction_change, so the
 * mutation and its `client_restriction_changed` event commit together or not
 * at all — the same atomicity every other audited mutation here has had since
 * Milestone 20. The event carries the two booleans and nothing else: no client
 * name, no identification, no reason text.
 *
 * `actorProfileId` is a NEW required parameter. It was absent before precisely
 * because nothing called this; an audit trail with no actor would be worthless,
 * so the signature says the actor is not optional.
 *
 * A no-op (already in the requested state) is a success and writes no event.
 */
export async function setClientRestricted(
  clientId: string,
  restricted: boolean,
  actorProfileId: string | null
): Promise<SetClientRestrictedResult> {
  const supabase = getSupabaseServerClient();

  const { data: changedId, error: rpcError } = await supabase.rpc(
    "record_client_restriction_change",
    {
      p_client_id: clientId,
      p_restricted: restricted,
      p_actor_profile_id: actorProfileId,
    }
  );

  if (rpcError) {
    // MILESTONE 25B-2 — see updateClientProfile above.
    if (isBranchDeniedError(rpcError.code)) {
      return { status: "error", code: "CLIENT_NOT_FOUND" };
    }
    console.error("[clients service] Failed to update client restricted flag:", rpcError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!changedId) {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }

  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_SELECT)
    .eq("id", clientId)
    .maybeSingle<ClientRow>();

  if (error || !data) {
    console.error(
      "[clients service] Restriction changed but the client could not be re-read:",
      error?.message ?? "no row returned"
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }

  return { status: "ok", client: toClient(data) };
}

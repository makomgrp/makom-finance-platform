-- ============================================================================
-- MILESTONE 26B-3A — THE IDENTIFICATION DESCRIPTION STOPPED CLAIMING RECEIPT
-- ============================================================================
--
-- A forward correction to the 26A-3 catalog seed, found while building the
-- public Step 3. A SEPARATE MIGRATION, NOT AN EDIT: 20260820071835 is applied
-- and this schema never rewrites an applied migration.
--
-- WHAT WAS WRONG. `applicant_id`'s description read:
--
--     "Cédula o pasaporte del solicitante. Ya recibido en la solicitud inicial."
--     "Applicant's ID or passport. Already received in the initial application."
--
-- That second sentence states a FACT ABOUT RUNTIME STATE inside a static
-- catalog string. It was written in anticipation of the ODL website supplying
-- the identity document, and that integration is not live yet — so on the real
-- Step 3 the customer saw a card that said "already received" directly above a
-- status chip that said "Pendiente".
--
-- 26B-3 is explicit that a missing identification must read as missing and that
-- no fake completion state may be shown. A description asserting receipt is
-- exactly such a state as far as the person reading it is concerned, and it is
-- worse than a wrong badge: it tells them not to bother uploading.
--
-- THE FIX IS TO MAKE THE COPY STATE-NEUTRAL, not to special-case it in the UI.
-- Whether a document has arrived is something the portal already knows from
-- `dossier_documents`, and it renders that honestly — "Pendiente" with an
-- upload control, or "recibido" with View and Replace. The catalog's job is to
-- say WHAT the document is; the application's job is to say whether it is here.
-- When the website integration does begin supplying identity documents, that
-- same UI will show them as received with no further copy change.
--
-- SEMANTICS ARE UNTOUCHED. required, min_files, allows_multiple_files, stage,
-- actor, condition_key, applicant_visible, original_required_later and
-- subject_type are all left exactly as 26A-3 seeded them. This changes one
-- human-readable sentence in two languages.
--
-- EXISTING SLOTS ARE NOT REWRITTEN, deliberately. 26A-3 snapshots the
-- description onto each slot precisely so an application's requirement list
-- cannot change under the applicant, and that guarantee is worth more than
-- retrofitting copy. There are zero applications at the time of writing, so no
-- customer is holding the old text; any that ever did would keep the wording
-- they were originally shown, which is the intended behaviour.

update public.requirement_templates
   set description = jsonb_build_object(
         'es', 'Cédula o pasaporte del solicitante.',
         'en', 'Applicant''s ID or passport.'
       )
 where code = 'applicant_id';

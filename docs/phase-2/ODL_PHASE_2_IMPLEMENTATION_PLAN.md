# ODL FINANCE — PHASE 2 IMPLEMENTATION PLAN

**Project:** ODL Finance Corporation — Digital Transformation  
**Prepared by:** Makom Capital Group  
**Phase:** 2 — Intelligent Business Automation  
**Commercial proposal:** USD $5,000  
**Estimated duration:** 4–6 weeks  
**Foundation:** Phase 1 Operational CRM Platform  
**Working repository:** `makomgrp/makom-finance-platform`  
**Working branch:** `feature/client-engine`  
**Production:** `https://makom-finance-platform.vercel.app`  
**Correct Supabase project:** `odl-finance-crm`  
**Correct Supabase ref:** `eazqlwdfkillcwjpdkhg`

> IMPORTANT: There is another Supabase project named `makom-crm` with ref
> `yqiyzqlnqrudvldpmbbi`. It is NOT part of ODL and must never be modified
> during ODL work.

---

## 1. PURPOSE OF THIS DOCUMENT

This document is the persistent technical and execution reference for ODL Finance Phase 2.

Before doing any Phase 2 work, Claude Code should read:

1. `ODL_PROJECT_HANDOFF.md`
2. `CLAUDE.md`
3. `docs/phase-2/ODL_PHASE_2_IMPLEMENTATION_PLAN.md`

This document defines the approved Phase 2 scope, milestone order and dependencies, phase boundaries, business rules still requiring ODL confirmation, execution/deployment methodology, completion criteria, ODL progress communication rules, and the required GitHub/Supabase/Vercel pre-flight.

The goal is to make every new Claude Code session capable of understanding the Phase 2 roadmap without reconstructing the project from conversation history.

---

# 2. PHASE 2 COMMERCIAL SCOPE

Phase 2 is titled:

## INTELLIGENT BUSINESS AUTOMATION

The original commercial roadmap defines Phase 2 around:

- Native WhatsApp Integration
- Automatic Customer Follow-up
- Automatic Document Requests
- Smart Reminders
- Workflow Automation
- Business Rules Engine
- Email & Notification Automation

The technical implementation is organized into the following eleven execution milestones:

### 2.1 Native WhatsApp Integration
### 2.2 Automatic Customer Follow-up & Smart Reminders
### 2.3 Automatic Document Requests
### 2.4 Workflow Automation
### 2.5 DTI & Capacity Engine
### 2.6 Credit Score & Risk Classification Engine
### 2.7 Risk-Based Pricing & Loan Structuring
### 2.8 Security / Guarantor Rules & Dynamic Requirements
### 2.9 Counteroffer Engine
### 2.10 Underwriting Workflow & Human Decision Control
### 2.11 Email & Notification Automation

These milestones expand the original Phase 2 roadmap into an implementation sequence. They do not redefine the commercial phase.

---

# 3. PHASE 2 TARGET WORKFLOW

```text
APPLICATION
    ↓
DTI & CAPACITY
    ↓
CREDIT SCORE
    ↓
RISK TIER
    ↓
PRICING
    ↓
LOAN STRUCTURE
    ↓
COUNTEROFFER
    ↓
HUMAN APPROVAL
    ↓
CUSTOMER RESPONSE
```

Automation should support ODL staff, not replace final human credit control.

---

# 4. EXECUTION METHODOLOGY

Every milestone must follow the same execution cycle:

```text
SCOPE
↓
AUDIT EXISTING ARCHITECTURE
↓
IMPLEMENTATION
↓
DATABASE MIGRATION IF ACTUALLY REQUIRED
↓
BUILD
↓
LINT
↓
TESTS / TYPECHECK
↓
SECURITY VALIDATION
↓
SELECTIVE STAGING
↓
COMMIT
↓
PUSH
↓
PRODUCTION DEPLOYMENT
↓
POST-DEPLOY VERIFICATION
↓
ODL MILESTONE NOTIFICATION
↓
CLOSED
```

A milestone is NOT considered complete merely because code was written.

A milestone may be marked `COMPLETED` only after implementation is finished; build/lint/tests pass; security implications are reviewed; code is committed and pushed; Production deployment succeeds; Production behavior is verified; no unrelated regressions are found; a milestone completion report is prepared; and ODL is ready to be notified.

---

# 5. REQUIRED ACCESS PRE-FLIGHT

Before editing code for any Phase 2 milestone, Claude Code must verify access instead of discovering authentication problems at the end.

## GitHub

Verify:

- correct repository;
- current branch;
- `git status`;
- local HEAD;
- origin HEAD;
- branch divergence;
- working tree cleanliness;
- authenticated push capability.

If GitHub authentication is unavailable, Claude must attempt the existing approved authentication method first. If an interactive authorization is genuinely required, request only that one user action and continue afterward.

Do not wait until after implementation to discover that push is blocked.

## Supabase

Verify:

- access to project `odl-finance-crm`;
- project ref `eazqlwdfkillcwjpdkhg`;
- read access;
- migration visibility;
- current linked project.

Never operate against `makom-crm` / `yqiyzqlnqrudvldpmbbi` during ODL work.

## Vercel

Verify authenticated access, correct project, Production deployment visibility, Production alias, and deployed commit/SHA where available.

## Build baseline

Before implementation, verify that the current baseline builds successfully. When practical also verify lint, typecheck and tests.

---

# 6. PHASE 2 STATUS BOARD

## 2.1 Native WhatsApp Integration

**Status:** WAITING FOR ODL

### Objective

Move beyond the Phase 1 browser-assisted WhatsApp workflow and connect ODL's approved WhatsApp business channel natively to the CRM.

### Planned scope

- confirm ODL Meta Business ownership;
- confirm target WhatsApp number;
- audit existing Meta Business / WhatsApp Business Account configuration;
- configure approved WhatsApp Business Platform / Cloud API path;
- establish secure webhook integration;
- connect inbound/outbound events with CRM workflows;
- support controlled message templates;
- support escalation to human staff;
- preserve auditability and human intervention for sensitive credit matters.

### External dependencies

Requires confirmation/access from ODL for Meta Business / Business Portfolio, administrator or authorized technical access, WhatsApp Business Account if one already exists, WhatsApp number to integrate, access to number/SIM or verification mechanism, and account ownership/operating model.

### Important rule

ODL must remain the owner of its Meta, WhatsApp and business assets. Makom may receive authorized technical access, but should not own ODL's assets through a personal Makom account.

### Completion criteria

2.1 may be marked `COMPLETED` only when the approved WhatsApp environment is configured, webhook connection is secure, inbound/outbound testing succeeds, CRM integration is functioning, Production is verified, and no current ODL WhatsApp operation is unintentionally broken.

---

## 2.2 Automatic Customer Follow-up & Smart Reminders

**Status:** COMPLETED

### Objective

Turn the existing CRM follow-up functionality into a real automation and reminder engine without depending on WhatsApp.

### Architectural principle

```text
CRM EVENT
→ BUSINESS RULE
→ SCHEDULED ACTION
→ NOTIFICATION
→ DELIVERY CHANNEL
```

The automation engine must not be hard-wired to WhatsApp. Possible delivery channels may later include CRM internal notifications, WhatsApp and email.

### Existing areas to audit first

Before implementation inspect:

- `application_follow_ups`;
- next-action dates;
- follow-up statuses;
- advisor/user assignments;
- notification infrastructure;
- cron/scheduled jobs;
- server/background functions;
- `crm_events`;
- application state machine;
- dashboard indicators;
- reminder-related code;
- email/notification abstractions;
- Supabase tables/triggers/RPCs/RLS;
- Vercel Cron or equivalent scheduling.

### Planned capabilities

- detect follow-ups due today;
- detect overdue follow-ups;
- detect cases with pending next actions;
- generate internal reminders;
- show actionable staff notifications;
- preserve responsible advisor assignment;
- record relevant automation activity in the audit trail;
- prepare infrastructure that later supports WhatsApp/email delivery.

### Rule constraint

Do NOT hard-code unconfirmed business timings such as “contact customer after exactly 24 hours”, “send three reminders”, or “close after seven days”. Timing and communication rules should be configurable until ODL confirms them.

### Completion criteria

- automation engine exists;
- internal reminder behavior works;
- due/overdue cases are correctly identified;
- no duplicate or uncontrolled reminders;
- relevant activity is auditable;
- Production deployment verified;
- no real customer communications are triggered from unconfirmed rules.

### Completion record

```text
Milestone: 2.2
Status: COMPLETED
Commit: 49b86e837d049a9d1c42c4b2fddc62ef519cecaf
Production deployment: dpl_BEYtHKh4NdRwgW65PJAQNMytCBEU
Production verified: 2026-09-10
ODL notification prepared: YES
ODL notified: NO
Notes:
- Internal automated follow-up reminder engine
- Persistent "My Follow-ups" dashboard experience
- Pending / due-today / overdue follow-up visibility
- Advisor-specific reminders
- Idempotent daily automation
- Daily schedule at 08:00 Panama
- Realtime/toast as complementary notification
- No customer email activated
- No WhatsApp communication activated
- Future communication-channel foundation preserved
- No unconfirmed ODL business timing rules hard-coded
- Production verification passed
- 318/318 tests PASS
- ES/EN parity 2012/2012, drift 0
- Verification note: the authenticated dashboard was not visually verified
  during the automated Production verification because no staff credentials
  were used. The deployed component passed build/regression validation. This
  is a non-blocking verification note, not an open implementation defect.
```

---

## 2.3 Automatic Document Requests

**Status:** COMPLETED

### Objective

Use the existing product-specific requirement infrastructure to identify and request outstanding requirements automatically.

### Planned scope

- use current product-specific requirements;
- identify missing/outstanding requirements;
- trigger requests based on approved case conditions;
- avoid irrelevant document requests;
- track outstanding requirement follow-up;
- integrate later with communication channels.

### Boundary

Phase 2 may determine that a requirement is missing based on CRM state. Phase 2 does NOT include intelligent reading of uploaded documents. OCR, automatic classification, data extraction and file-content validation belong to Phase 3.

### Completion record

```text
Milestone: 2.3
Status: COMPLETED
Commit: 07682f3
Related security commits: 3b053b0, 3ecfd5e
Production deployment: dpl_6KptD58ephcTSqoAbGeg25WpPFtf
Production verified: 2026-09-09
ODL notification prepared: YES
ODL notified: NO
Notes:
- Deterministic internal document-request automation using the existing
  requirement_templates -> requirement_slots -> dossier_documents model.
- No OCR or AI document processing.
- Eligibility limited to required, applicant-visible, client-facing,
  application-level requirements in pending/missing status.
- Atomic/idempotent claim prevents duplicate internal requests.
- Daily automation configured for 09:00 Panama.
- Assigned advisor receives complementary internal Realtime notification.
- Persistent document-request visibility added to the CRM/dashboard.
- Customer-facing email is NOT activated.
- WhatsApp delivery is NOT activated.
- Future communication-channel compatibility preserved.
- Security remediation: the milestone audit discovered and remediated a
  pre-existing default-grant TRUNCATE exposure on dossier_documents,
  requirement_slots and requirement_templates. TRUNCATE was removed from
  anon, authenticated, and service_role. Normal required service_role
  SELECT/INSERT/UPDATE privileges remain intact. Not a breach or incident —
  a default-privilege gap with no evidence of exploitation, closed as a
  precaution, the same class already remediated for
  monthly_management_closures, which remained intact throughout this
  milestone's Production verification.
- Production deployment verified; 336/336 tests PASS; build PASS; lint PASS;
  ES/EN parity 2017/2017, drift 0; cron route fail-closed in Production; no
  customer outbound communication activated.
- Verification note: authenticated dashboard/document visual verification
  was not performed during the automated Production verification because
  staff credentials were not used. Non-blocking — not an implementation
  defect.
```

---

## 2.4 Workflow Automation

**Status:** NEXT / READY FOR ARCHITECTURE AUDIT

### Objective

Automate defined operational actions and stage transitions while preserving human controls.

### Planned scope

- stage-based actions;
- assignment/escalation;
- pending-action handling;
- exception handling;
- automation triggers;
- human approval gates;
- auditable workflow events.

Do not automatically approve or disburse credit.

---

## 2.5 DTI & Capacity Engine

**Status:** PLANNED — BUSINESS RULE CONFIRMATION REQUIRED BEFORE FINAL ACTIVATION

### Objective

Calculate affordability and projected debt burden using ODL-approved policy.

### Planned scope

- projected DTI;
- monthly repayment capacity;
- compare requested installment against capacity;
- expose calculation inputs/results clearly;
- configurable thresholds.

### Pending ODL confirmation

- definitive DTI threshold;
- whether 50% is the approved ODL maximum;
- which products the rule applies to;
- treatment of existing debts and debt consolidation.

No proposed threshold should be represented as Panamanian law unless legally verified separately.

---

## 2.6 Credit Score & Risk Classification Engine

**Status:** PLANNED — BUSINESS RULE CONFIRMATION REQUIRED

### Objective

Implement a deterministic, transparent scorecard based on ODL-approved policy.

### Proposed criteria supplied by ODL for discussion

Potential factors include projected DTI, employment stability, employer sector / repayment guarantee, APC / credit history, and income / free cash flow.

### Proposed scorecard supplied by ODL

Total proposed score: 100 points.

- Projected DTI: up to 35 points
- Employment stability: up to 20 points
- Employer sector / repayment guarantee: up to 20 points
- APC / credit history: up to 15 points
- Income / free cash flow: up to 10 points

These values remain proposed business rules until ODL formally confirms them.

### Proposed risk bands supplied by ODL

- 80–100: Low Risk
- 50–79: Medium Risk
- 25–49: High Risk
- 0–24: Critical

Do not hard-code these as final until confirmed.

---

## 2.7 Risk-Based Pricing & Loan Structuring

**Status:** PLANNED — BUSINESS RULE CONFIRMATION REQUIRED

### Objective

Apply ODL-approved pricing and loan-structure logic to eligible scenarios.

### Planned scope

- map approved risk tiers to pricing;
- calculate payment scenarios;
- evaluate eligible terms;
- distinguish gross principal from cash received;
- separate debt buyout/consolidation from liquidity;
- account for approved fees/insurance/security conditions.

### Proposed pricing examples supplied by ODL

- Low Risk: 2.50% monthly
- Medium Risk: 3.00% monthly
- High Risk: 4.00% monthly

These are proposed ODL business rules only. Do not represent them as law or activate them as final policy without ODL confirmation.

---

## 2.8 Security / Guarantor Rules & Dynamic Requirements

**Status:** PLANNED — BUSINESS RULE CONFIRMATION REQUIRED

### Objective

Apply conditional security/guarantor rules and dynamically update the required case documentation.

### Planned scope

- determine when security is required;
- determine security type;
- track whether security has been provided/verified;
- add/remove relevant requirement slots;
- prevent disbursement progression when mandatory security remains unresolved.

Potential fields include `requires_security`, `security_type`, and `security_verified`.

### Proposed ODL rule

A proposed rule supplied by ODL states that gross principal above B/.3,000 may require an eligible guarantor or registered asset pledge. This is not final until ODL confirms it.

---

## 2.9 Counteroffer Engine

**Status:** PLANNED — BUSINESS RULE CONFIRMATION REQUIRED

### Objective

When requested loan terms are not viable, calculate reasonable eligible alternatives rather than simply returning a rejection.

### Planned scope

- compare requested terms with eligible capacity;
- calculate one or more alternative scenarios;
- show amount, term, estimated payment and capacity impact;
- distinguish debt consolidation/buyout from liquidity;
- send results to human review before customer communication.

### Human-control rule

The engine may calculate alternatives. It must not independently issue a final customer credit decision.

---

## 2.10 Underwriting Workflow & Human Decision Control

**Status:** PLANNED

### Objective

Provide ODL reviewers with a consolidated underwriting workspace.

### Planned scope

- consolidated financial/risk information;
- blockers;
- conditions;
- pending requirements;
- calculated scenarios;
- staff recommendation;
- authorized approval;
- conditional approval;
- rejection;
- role-based decision controls;
- auditable decision history.

### Hard boundary

No autonomous disbursement. No unsupervised final credit decision.

---

## 2.11 Email & Notification Automation

**Status:** PLANNED

### Objective

Support internal and customer notifications triggered by approved CRM events.

### Planned scope

- event-based notifications;
- internal staff alerts;
- customer status communications;
- escalation notifications;
- message templates;
- event history;
- future integration with additional delivery channels.

Communication must use only approved templates/rules for sensitive credit matters.

---

# 7. BUSINESS RULES THAT MUST BE CONFIRMED WITH ODL

Before final activation of the underwriting/business-rule engine, ODL should confirm at minimum:

1. Is 50% the definitive DTI ceiling?
2. Does a maximum 36-month term apply to all payroll loans or only selected cases?
3. Are the proposed score weights and risk bands final?
4. Are monthly pricing rates 2.50%, 3.00% and 4.00% final by risk tier?
5. Does every loan above B/.3,000 require a guarantor/collateral?
6. Does the proposed 5% processing fee always apply?
7. What is the exact principal insurance formula/rate?
8. What are the exact legal/notary charges?
9. Should the system generate a fixed number of counteroffers automatically?
10. Who has final approval authority by risk tier or exception type?
11. Do the underwriting rules initially apply only to payroll loans or to all four products?

Do not silently convert proposed examples into Production policy.

---

# 8. POLICY / LEGAL CAUTION

Examples supplied by ODL — including proposed score bands, monthly rates, a 50% DTI threshold, the B/.3,000 security rule, a 5% processing fee and related insurance/fee concepts — are treated as proposed ODL business rules.

They are NOT considered independently verified legal or regulatory requirements.

Makom must not hard-code or describe those values as law without ODL's formal business confirmation and, where necessary, appropriate legal/regulatory verification.

---

# 9. PHASE BOUNDARIES

## Phase 3 — Intelligent Document Processing

Outside Phase 2:

- OCR;
- automatic document classification;
- AI extraction from uploaded files;
- intelligent missing-document detection based on file contents;
- automatic content validation;
- document-reading AI.

## Phase 4 — AI Decision Support

Outside Phase 2:

- generative AI customer summaries;
- AI-generated risk explanations/recommendations;
- smart search;
- general AI assistant;
- advanced AI operational analytics.

## Phase 5 — Enterprise Expansion

Outside Phase 2 unless separately approved:

- customer portal expansion;
- mobile app;
- digital signature;
- broad third-party integrations;
- banking integrations;
- BI;
- external/public APIs beyond specific Phase 2 dependencies.

Do not introduce future-phase scope merely because it is technically convenient.

---

# 10. PHASE 1 WHATSAPP VS PHASE 2 WHATSAPP

Phase 1 uses a browser-assisted, human-in-the-loop model:

```text
WHATSAPP WEB
→ CLAUDE IN CHROME
→ ODL KNOWLEDGE / INSTRUCTIONS
→ DRAFT RESPONSE
→ EMPLOYEE REVIEWS
→ EMPLOYEE SENDS
```

Phase 2 milestone 2.1 is different:

```text
CUSTOMER WHATSAPP
→ META / WHATSAPP BUSINESS PLATFORM
→ SECURE API / WEBHOOK
→ ODL CRM
→ AUTOMATION / STAFF WORKFLOW
```

Do not confuse the two implementations.

---

# 11. PRODUCTION / SECURITY RULES

Maintain the same conservative security discipline established during Phase 1.

Never:

- touch the `makom-crm` Supabase project during ODL work;
- force push;
- rewrite shared Git history;
- delete Production data casually;
- create unnecessary customer/test data in Production;
- weaken RLS without explicit technical justification;
- expose secrets;
- commit credentials;
- modify unrelated functionality;
- repair known historical migration drift unless explicitly approved;
- implement future-phase scope without authorization.

Changes should be minimal, intentional, testable and reversible where practical.

---

# 12. GIT / DEPLOYMENT OPERATING RULES

Claude Code is expected to complete technically possible work end-to-end.

When authentication is valid, Claude should itself inspect, implement, build, lint, test, stage only intended files, commit, push, inspect deployment, and verify Production.

Do not ask the user to manually commit, push or deploy when the environment already has valid authorization.

If external interactive authentication is required, request only the exact authorization step needed and resume afterward.

---

# 13. ODL PROGRESS COMMUNICATION

ODL stakeholders:

- Damion
- Randol

Operational communication channel:

- ODL WhatsApp group with Damion and Randol

The project should be communicated as a sequence of verified milestone deliveries rather than a single final delivery after several weeks.

Preferred milestone states:

- `PLANNED`
- `WAITING FOR ODL`
- `IN PROGRESS`
- `READY FOR ODL REVIEW`
- `COMPLETED`

Avoid subjective progress percentages unless there is a specific contractual reason to use them.

---

# 14. MILESTONE COMPLETION MESSAGE TEMPLATE

After a milestone has been deployed and verified, prepare a concise message for the ODL WhatsApp group.

```text
ODL Finance — Phase 2 Progress Update

✅ 2.X [Milestone Name] — COMPLETED

We have completed and deployed milestone 2.X of Phase 2.

The new functionality is now available in the ODL CRM and has passed our
post-deployment verification.

What is now available:
- [brief observable capability]
- [brief observable capability]
- [brief observable capability]

Where to review it:
[exact CRM location]

Phase 2 progress:
2.X completed.

We will now proceed with the next scheduled milestone.

Makom Capital Group
Digital Strategy • Operations
```

The actual message must describe only functionality that has genuinely been deployed and verified.

---

# 15. MILESTONE CLOSURE RECORD

When a milestone is completed, update this document with a closure record.

```text
Milestone: 2.X
Status: COMPLETED
Commit: <SHA>
Production deployment: <deployment id or URL>
Production verified: YYYY-MM-DD
ODL notification prepared: YES
ODL notified: YES/NO
Notes:
- ...
```

Do not mark `COMPLETED` before Production verification.

---

# 16. CURRENT PHASE 2 EXECUTION STATE

```text
2.1 Native WhatsApp Integration
STATUS: WAITING FOR ODL
Dependencies:
- Meta Business access
- target WhatsApp number
- WhatsApp Business Account / WABA audit
- account ownership confirmation

2.2 Automatic Customer Follow-up & Smart Reminders
STATUS: COMPLETED
Completion date: 2026-09-10
Commit: 49b86e837d049a9d1c42c4b2fddc62ef519cecaf
Production deployment: dpl_BEYtHKh4NdRwgW65PJAQNMytCBEU
See § 2.2 Completion record for full detail.

2.3 Automatic Document Requests
STATUS: COMPLETED
Completion date: 2026-09-09
Commit: 07682f3
Related security commits: 3b053b0, 3ecfd5e
Production deployment: dpl_6KptD58ephcTSqoAbGeg25WpPFtf
See § 2.3 Completion record for full detail.

2.4 Workflow Automation
STATUS: NEXT / READY FOR ARCHITECTURE AUDIT

2.5 DTI & Capacity Engine
STATUS: PLANNED
DEPENDENCY: final ODL policy confirmation before activation

2.6 Credit Score & Risk Classification Engine
STATUS: PLANNED
DEPENDENCY: final ODL policy confirmation

2.7 Risk-Based Pricing & Loan Structuring
STATUS: PLANNED
DEPENDENCY: final ODL policy confirmation

2.8 Security / Guarantor Rules & Dynamic Requirements
STATUS: PLANNED
DEPENDENCY: final ODL policy confirmation

2.9 Counteroffer Engine
STATUS: PLANNED
DEPENDENCY: final ODL policy confirmation

2.10 Underwriting Workflow & Human Decision Control
STATUS: PLANNED

2.11 Email & Notification Automation
STATUS: PLANNED
```

---

# 17. NEXT TECHNICAL ACTION

The immediate next action is:

## PHASE 2 — 2.4 PRE-FLIGHT + READ-ONLY ARCHITECTURE AUDIT

Before writing implementation code:

1. verify GitHub authentication and future push capability;
2. verify correct Supabase access;
3. verify Vercel access and Production visibility;
4. verify current branch/baseline;
5. verify build/lint/tests;
6. inspect existing 2.4-related architecture;
7. propose the minimal non-duplicative implementation.

Only after the audit is reviewed should implementation begin.

---

# 18. CORE PRINCIPLE

Phase 2 should move faster than Phase 1 without sacrificing control.

The desired operating model is:

**fewer unnecessary stops, earlier access validation, smaller milestones, automatic technical execution, Production verification, and visible progress for ODL after every completed block.**

# ODL brand assets (public portal)

## Required file

```
public/brand/odl-financial-corporation.png
```

Save the official ODL Financial Corporation logo here. A transparent PNG (or an
SVG renamed/adjusted in `portal-brand.tsx`) works; a wordmark-style asset around
3:1 to 4:1 sits best in the portal header.

**No code change is needed.** `src/components/portal/portal-brand.tsx` checks for
this file on the server at render time:

- **file present** → the real logo renders, at a fixed height with
  `object-contain`, so its proportions are preserved and it cannot distort at any
  breakpoint.
- **file absent** → the company name renders as plain text.

Add the file and restart the server. That is the whole procedure.

## Why there is a text fallback rather than a placeholder graphic

The logo must never be redrawn, traced, approximated or rebuilt in CSS. A
near-miss of a financial institution's identity is worse than no logo at all,
because it looks official while being wrong. So there are exactly two honest
states — the real asset, or the company's name as text — and this directory is
how you move from the second to the first.

## Scope

Public application portal only (`/solicitud`). The internal CRM's branding is
separate and is deliberately not affected by this file.

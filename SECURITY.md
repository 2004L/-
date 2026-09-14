# Security Policy

## Supported version

Security fixes are applied to the latest revision of the `main` branch. This repository is currently a demonstration prototype and is not approved for production handling of hotel guests, identity documents, payments, public-security registration, door locks or room cards.

## Reporting a vulnerability

Do not place valid credentials, identity document fields, payment data, hotel production URLs or exploitable details in a public Issue.

Prefer GitHub Private Vulnerability Reporting from the repository's **Security** tab when it is enabled. If private reporting is unavailable, open a public Issue containing only a request for a private maintainer contact channel; do not include the vulnerability details in that Issue.

Include the affected revision, component, impact, safe reproduction conditions and suggested remediation. Use synthetic data only. Maintainers will acknowledge receipt when available, validate the report and coordinate disclosure after a fix or mitigation is ready; no fixed response-time SLA is currently offered.

## If a secret is exposed

1. Revoke or rotate the credential immediately at its issuing service.
2. Stop affected integrations and review access/audit logs.
3. Remove the value from the current tree and, when required, rewrite Git history.
4. Re-scan the complete history before restoring service.

Deleting a secret from a later commit does not make an earlier committed value safe. Treat every committed credential as compromised.

## Data-handling boundary

- Never commit real identity, face, phone, payment, public-security or room-access data.
- Keep raw identity fields on authorized store-side systems; expose only short-lived tokens and minimum necessary business state to AI components.
- Require authorization, idempotency, audit records and verified downstream receipts for every state-changing operation.
- Do not bypass CAPTCHA, certificate validation, operator approval or regulatory controls.

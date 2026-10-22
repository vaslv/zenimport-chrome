# L11 credential-repair review

Scope: pending mode transfers, server archive recovery, native credential fences,
terminal route adoption, trusted command dispatch and scheduler continuation.
Independent reviewer: `l6_api_review` (read-only). Final result: no findings.

Fixed findings:

- Permit same-server repair after native activation/cancellation until remote
  cleanup; preserve terminal selected references and use the effective secret.
- Include local repair in trusted RPC context adoption after credentialEpoch CAS.
- Use the effective local credential when replaying a reserved destination.
- Persist own terminal adoption receipts so a second token rotation can complete
  without overwriting a later explicit configuration.
- Check request operation ID before any terminal adoption mutation.
- Adopt the verified server replacement after cancelled reverse transfers.

Adversarial evidence includes a late older repair rejected after a newer overlay,
wrong-token rejection without Root mutation, post-handoff SDK repair, simulated
termination before final credential adoption, exact-request archive cleanup and
absence of synthetic financial API writes. See progress.md for Docker results.
Full L11 UI and L12 cross-project acceptance are separate unfinished gates.

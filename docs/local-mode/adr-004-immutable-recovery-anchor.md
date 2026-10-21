# ADR 004: Immutable profile recovery anchor

Status: implemented and independently reviewed for L4.

The external `localDatasetSentinel` identifies the original profile installation,
dataset lineage and generation. These are an immutable recovery anchor, **not**
the currently selected writer. Its initializing/ready state and monotonic activity
flag retain their original loss-detection purpose. The original dataset header
must remain in IndexedDB even after that generation is retired.

The runtime Root selects the active mode/generation. Root, generation participant,
switch decision and permanent request receipt commit in one native IDB transaction.
No mode switch rewrites the external marker to another generation. This avoids a
cross-storage commit gap that could otherwise confuse recovery with activation.
Every mutation checks the marker outside IDB and its original header inside IDB,
then checks the actual Root and participant fences in the same transaction.

Reservation creates an inactive generation and fresh participant before source
export, binding the peer ID before any snapshot is accepted. Import and full graph
validation require a private permit tied to the pending switch and persisted nonce.
An old asynchronous importer cannot delete rows or an import header after discard.
Ordinary repositories reject any pending switch or `awaitingSync` participant.

Activation retains the exact validated financial rows and consumes the inactive
stage into an `activated` audit record. It retires the prior local generation,
selects the new generation and records the immutable reply atomically. Retrying
the same request returns that reply before checking the current decision epoch.
Changing a request under the same ID fails. A handed-off source cannot resume;
returning from remote creates a fresh generation, as described in ADR 003.

The first imported local sync remains blocked in L4. L6/L7 must rebind mirror and
unattempted source context, invalidate derived predictions and preserve import
provenance through an explicitly guarded initialization before L9 enables work.
These changes must not reinterpret attempted payloads or permanent target receipts.
The sealed stage remains the immutable pre-initialization evidence.

L5 must separately bootstrap control state for an existing configured remote user
who has never created IDB. `MigrationOwner.open` only opens existing, anchored
control state; it never invents local data when a remote server is unavailable.
No distributed application handler calls this L4 owner yet.

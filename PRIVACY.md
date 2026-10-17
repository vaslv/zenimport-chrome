# Data in ZenImport Chrome

The extension reads history in an already open bank session only after an explicit
Synchronize click. Users sign in on the bank website themselves. Passwords, SMS
codes, and bank authentication fields are not sent to ZenImportBackend.

Transaction history (amount, date, description, available payee details/balance)
is sent to the backend you choose. It stores history in its database, fetches a
ZenMoney mirror, predicts categories, and adds missing transactions to ZenMoney.
Financial edits are made in the official ZenMoney app. Data is stored on the
computer/server where you deploy the backend and in ZenMoney. Server history has
no automatic deletion period; the backend owner manages its lifecycle/backups.
Do not treat the delivery journal as disposable cache: removing it can reimport
previously deleted transactions.

Chrome keeps the backend address/API token, connection settings, and capture
checkpoints in private extension storage. Unfinished address/token input stays
in session storage until connection or browser/extension restart. The ZenMoney
token stays on the backend; do not enter it in the extension. Backend tokens are
never passed to bank-page JavaScript. Do not use an untrusted shared backend:
its owner receives your financial data.

Remote backends require HTTPS; HTTP is allowed only for localhost and 127.0.0.1.
Chrome requests access to the specific backend/bank host. The extension injects
no transaction editor into online banking and contains no analytics, advertising,
or data delivery to the developer.

The Discrepancies page reads information through your backend only. Do not attach
actual financial records or tokens to public GitHub Issues. Uninstalling the
extension removes local settings; it does not automatically delete the server
database or ZenMoney data.

Data migration in 0.2.0 downloads an unencrypted ZIP of the backend's financial
history and delivery journal, including account mappings and deletion records.
It excludes server and ZenMoney tokens. Store it privately and import only trusted
archives. The selected ZIP is sent only to your configured backend, which verifies
it before restoration and refuses import after its first synchronization. Export
persistently pauses the source server; the imported server waits for your explicit
Synchronize click before financial delivery. Temporary private server files are
removed after the request; downloaded files remain under your control.

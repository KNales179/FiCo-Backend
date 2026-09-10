# Fico — Backend

Node.js + Express + TypeScript API for Fico, Your Daily Financial Companion.
MongoDB (via Mongoose) for persistence; Argon2id password hashing with opaque
httpOnly cookie sessions for authentication.

See the [root README](../README.md) for the project overview and usage terms,
and [`Plan/`](../Plan/) for the product specification, architecture, and
roadmap.

## API surface

| Method | Route                                     | Access        | Description                          |
| ------ | ---------------------------------------- | ------------- | --------------------------------- |
| GET    | `/api/health`                            | public        | Service health check                |
| POST   | `/api/auth/register`                     | public        | Create an account (+ personal space) |
| POST   | `/api/auth/login`                        | public        | Sign in                             |
| POST   | `/api/auth/logout`                       | authenticated | Revoke the current session          |
| GET    | `/api/auth/me`                           | authenticated | Get the current user                |
| PATCH  | `/api/auth/me`                           | authenticated | Update username / email / display name |
| DELETE | `/api/auth/me`                           | authenticated | Disable the account                 |
| GET    | `/api/spaces`                            | authenticated | Spaces the caller belongs to        |
| POST   | `/api/spaces`                            | authenticated | Create a family space               |
| GET    | `/api/spaces/:id`                        | member        | Get one space                       |
| PATCH  | `/api/spaces/:id`                        | owner         | Rename a space                      |
| DELETE | `/api/spaces/:id`                        | owner         | Delete a family space               |
| POST   | `/api/spaces/:id/leave`                  | member        | Leave a family space                |
| GET    | `/api/spaces/:id/members`                | member        | List members                        |
| POST   | `/api/spaces/:id/members`                | owner         | Add an existing user as editor/viewer |
| PATCH  | `/api/spaces/:id/members/:userId`        | owner         | Change a member's role              |
| DELETE | `/api/spaces/:id/members/:userId`        | owner         | Remove a member                     |
| GET    | `/api/spaces/:id/invitations`            | owner         | Pending email invitations           |
| POST   | `/api/spaces/:id/invitations`            | owner         | Invite by email (adds existing users directly) |
| DELETE | `/api/spaces/:id/invitations/:iid`       | owner         | Revoke a pending invitation         |
| GET    | `/api/spaces/:id/action-logs`           | member        | Append-only activity trail          |
| POST   | `/api/spaces/:id/sync/push`             | editor        | Batch of local mutations → replicated store (idempotent per event id) |
| GET    | `/api/spaces/:id/sync/pull?since=`      | member        | Records changed since a cursor (visibility-respecting) |

`register` and `login` accept an optional `deviceId` and return
`session: { expiresAt }` alongside `user`; `me` returns the same `session`
object. Sessions are opaque tokens in an httpOnly cookie, hashed at rest, with
sliding renewal past the halfway point of their lifetime.

### Money (space-scoped)

| Method | Route                                              | Access        | Description                       |
| ------ | ------------------------------------------------- | ------------- | ------------------------------- |
| GET    | `/api/spaces/:id/accounts`                        | member        | Accounts with derived balances   |
| POST   | `/api/spaces/:id/accounts`                        | editor        | Create an account                |
| PATCH  | `/api/spaces/:id/accounts/:accountId`             | editor        | Rename / retype / archive        |
| DELETE | `/api/spaces/:id/accounts/:accountId`             | editor        | Soft-delete (refused if it has transactions) |
| GET    | `/api/spaces/:id/transactions`                    | member        | List (filters: `type`, `accountId`, `before`, `limit`) |
| POST   | `/api/spaces/:id/transactions`                    | editor        | Record income / expense / transfer |
| PATCH  | `/api/spaces/:id/transactions/:transactionId`     | editor        | Edit a transaction               |
| DELETE | `/api/spaces/:id/transactions/:transactionId`     | editor        | Soft-delete                      |
| GET    | `/api/spaces/:id/shopping-lists`                  | member        | Lists with totals (`status` filter) |
| POST   | `/api/spaces/:id/shopping-lists`                  | editor        | Create a list                    |
| GET    | `/api/spaces/:id/shopping-lists/:listId`          | member        | List + items + totals            |
| PATCH  | `/api/spaces/:id/shopping-lists/:listId`          | editor        | Rename / set budget / cancel     |
| DELETE | `/api/spaces/:id/shopping-lists/:listId`          | editor        | Soft-delete list + items         |
| POST   | `/api/spaces/:id/shopping-lists/:listId/complete` | editor        | Mark the trip done               |
| POST   | `/api/spaces/:id/shopping-lists/:listId/items`    | editor        | Add an item                      |
| PATCH  | `.../items/:itemId`                               | editor        | Rename / prices / quantity / check |
| DELETE | `.../items/:itemId`                               | editor        | Remove an item                   |
| GET    | `/api/spaces/:id/item-profiles`                   | member        | Known items                      |
| GET    | `/api/spaces/:id/item-profiles/suggest?name=`     | member        | Last price + category for a name |
| GET    | `/api/spaces/:id/item-profiles/:pid/prices`       | member        | Price history for an item        |
| PATCH  | `/api/spaces/:id/item-profiles/:pid`              | editor        | Rename / set category (future purchases only) |
| GET    | `/api/spaces/:id/bills`                           | member        | Bills (`active`, `upcomingBefore` filters) |
| POST   | `/api/spaces/:id/bills`                           | editor        | Create a bill                    |
| GET    | `/api/spaces/:id/bills/:billId`                   | member        | Bill + its payment history       |
| PATCH  | `/api/spaces/:id/bills/:billId`                   | editor        | Edit a bill                      |
| DELETE | `/api/spaces/:id/bills/:billId`                   | editor        | Soft-delete (payment history kept) |
| POST   | `/api/spaces/:id/bills/:billId/pay`               | editor        | Record a payment (+ expense), advance the due date |
| GET    | `/api/spaces/:id/bills/:billId/payments`          | member        | Payment history                  |
| GET    | `/api/spaces/:id/electricity`                     | member        | Electricity history + derived ₱/kWh |
| PUT    | `/api/spaces/:id/bill-payments/:pid/electricity`  | editor        | Add/update electricity detail for a payment |
| GET    | `/api/spaces/:id/categories`                      | member        | Category list (`kind` filter)    |
| POST   | `/api/spaces/:id/categories`                      | editor        | Add a category                   |
| PATCH  | `/api/spaces/:id/categories/:cid`                 | editor        | Rename / archive                 |
| DELETE | `/api/spaces/:id/categories/:cid`                 | editor        | Soft-delete (records keep their name snapshot) |
| GET    | `/api/spaces/:id/analytics?period=`              | member        | Space-scoped analytics (all members see the same) |
| GET    | `/api/spaces/:id/attachments?entityType=&entityId=` | member      | Attachment metadata for a record |
| POST   | `/api/spaces/:id/attachments` (multipart)         | editor        | Upload a receipt (image/PDF, ≤10 MB) |
| GET    | `/api/spaces/:id/attachments/:aid/file`           | member        | Redirects to a signed Cloudinary URL |
| DELETE | `/api/spaces/:id/attachments/:aid`                | editor        | Remove a receipt                 |
| GET    | `/api/spaces/:id/reconciliations`                | member        | Cash-check history (`accountId`, `status` filters) |
| POST   | `/api/spaces/:id/reconciliations`                | editor        | Record a cash check (expected snapshotted from balance) |
| PATCH  | `/api/spaces/:id/reconciliations/:rid`           | editor        | Mark a difference resolved       |

Receipts are uploaded to **Cloudinary** as `type: 'authenticated'` assets
(needs `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`);
nothing touches this server's disk. The download route checks space membership
and then redirects to a freshly signed Cloudinary URL. Without the env vars the
upload route returns 503.

Analytics are computed on the server so every member of a shared space sees the
same numbers; the frontend falls back to a local computation only when offline.

Space and money routes are gated by `requireSpaceMember(minRole)`, which
resolves the space, checks the caller's active membership and role, and returns
the same 404 whether a space is missing or simply not visible to the caller.

**Record privacy (§22):** transactions, shopping lists and bills carry a
`visibility` of `SPACE` (default — every member) or `PRIVATE` (creator only).
List/get/update/delete apply a visibility filter, so a private record 404s for
other members. A PRIVATE transaction is excluded from shared analytics but
still moves the account balance — privacy hides the line item, not the
arithmetic. Only a record's creator can change its visibility.

Balances are always derived (opening balance + non-deleted transactions), never
stored. A transfer moves money between two accounts of the same currency and is
never counted as an expense.

## Structure

```
src/
├── config/       Database connection
├── controllers/  Request handlers
├── middleware/   Auth, space access, error handling, rate limiting
├── models/       Mongoose schemas (User, Session, Space, Membership, Account, Transaction)
├── routes/       Express routers
├── services/     Space bootstrap, balance derivation
├── utils/        Password hashing, session helpers
├── validation/   Zod schemas
├── app.ts        Express app wiring
└── server.ts     Entry point
```

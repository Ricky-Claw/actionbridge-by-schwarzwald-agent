# F26 ActionBridge — Universal Agent Connector Design

## Goal
Build **ActionBridge**, a universal connector layer that makes customer systems agent-capable without creating 200 bespoke integrations.

ActionBridge turns customer capabilities into safe, typed, auditable **agent actions** such as `find_product`, `check_availability`, `create_cart`, `book_appointment`, `create_ticket`, or `request_quote`.

## Core Insight
APIs are developer language. Agents need action language.

Instead of exposing raw API keys, REST endpoints, OAuth complexity, or one-off integrations, ActionBridge gives agents a constrained action interface:

```json
{
  "action": "find_product",
  "input": { "query": "ergonomic office chair", "max_price": 300 },
  "risk": "read",
  "requires_approval": false
}
```

The customer system remains behind a secure gateway. Secrets stay server-side. Writes can require approval. Every action is logged.

## Product Positioning
- **Not:** 200 individual integrations.
- **Not:** raw API key proxy.
- **Not:** developer-only MCP infra.
- **Yes:** KMU-friendly universal agent connector with security, no-code setup, widget/SDK, audit, and approval flows.

## Competitive Learning
### Frontegg AgentLink
Useful patterns:
- MCP/server tool generation from existing APIs.
- Agent IAM with role/tool permissions.
- Step-up auth and human approval for risky actions.
- Data masking and tenant policies.
- Agent analytics and audit trail.

Our difference:
- DACH/KMU UX, no-code action builder, widget-first integration, Schwarzwald-Agent-native workflows.

### agentgate.org / AgentGate
Useful patterns:
- Credentials never exposed to agent.
- Read actions pass through; write actions queue for approval.
- MCP compatibility.

Name conflict:
- `AgentLink` and `AgentGate` are too close/occupied. Use **ActionBridge** as product name.

## MVP Scope
Build universal foundation, not individual connectors.

### MVP Components
1. **Action Definition Schema**
   - Action name, description, input schema, output schema.
   - Risk level: `read`, `write`, `transactional`, `destructive`.
   - Required permission and approval policy.

2. **HTTP Action Connector**
   - Maps an ActionBridge action to an HTTP request.
   - Supports GET/POST initially.
   - Server-side secret storage only.
   - Response mapping to agent-friendly output.

3. **Policy Decision Layer**
   - Decides: allow, deny, require approval.
   - Checks tenant/user/agent/action/risk/amount/volume.
   - No broad default allow for writes.

4. **Approval Queue**
   - Stores pending risky actions.
   - Human can approve/reject.
   - Agent receives pending/rejected/approved status.

5. **Audit Log**
   - Logs agent id, user id, tenant id, action id, input hash/redacted input, decision, result, latency.

6. **Agent Tool Interface**
   - Internal tool-call API for Ricky/Studio.
   - MCP-compatible shape later; do not overbuild full public MCP server in first slice.

7. **Widget/SDK Contract**
   - Customer site can expose allowed actions or pass context.
   - No secrets in browser.
   - Signed short-lived session/action tokens.

## Non-Goals for MVP
- No Amazon/Booking direct production integration.
- No full marketplace.
- No public MCP server until security model passes review.
- No F21/F22/F24 work.
- No browser-stored customer secrets.

## Security Model
### Default Rules
- Read actions may execute immediately if allowed by policy.
- Write actions require explicit allow policy; high-risk writes require approval.
- Destructive actions require approval and step-up later.
- Secrets stay server-side.
- Inputs/outputs are redacted before logs where needed.
- All actions are tenant-scoped and user-scoped.

### Risk Levels
| Risk | Examples | Default |
|---|---|---|
| `read` | search products, check availability | allowed if scoped |
| `write` | create ticket, add cart item | approval unless explicitly trusted |
| `transactional` | book, order, charge | approval required |
| `destructive` | delete, cancel, refund | approval + step-up later |

## Implemented MVP Slice (2026-05-01)
Core foundation is implemented and reviewed as a **non-executing skeleton**:
- Domain contracts: `src/frontend/lib/actionbridge/types.ts`
- Policy layer: `src/frontend/lib/actionbridge/policy.ts`
- Redaction: `src/frontend/lib/actionbridge/redaction.ts`
- Server policy lookup: `src/frontend/lib/actionbridge/server-policy.ts`
- Persistence helpers: `src/frontend/lib/actionbridge/persistence.ts`
- Agent-safe tool shape: `src/frontend/lib/actionbridge/tool-interface.ts`
- Server-only HTTP connector skeleton: `src/frontend/lib/actionbridge/http-connector.ts`
- Contract gate: `scripts/test-actionbridge-contracts.mjs`

## Data Model
Implemented by `supabase/migrations/20260501104300_actionbridge_core.sql` and follow-up hardening migrations:
- `actionbridge_connectors`
- `actionbridge_actions`
- `actionbridge_approvals`
- `actionbridge_audit_logs`

Follow-up hardening:
- `20260501185000_actionbridge_action_policy_hardening.sql`
- `20260501201500_actionbridge_connector_policy_hardening.sql`

Deliberately deferred until a vault/secret model exists:
- `actionbridge_secrets`
- `actionbridge_policy_rules`

## API Surface
Implemented:
- `GET /api/actionbridge/connectors`
- `POST /api/actionbridge/connectors`
- `GET /api/actionbridge/actions`
- `POST /api/actionbridge/actions`
- `POST /api/actionbridge/execute`
- `GET /api/actionbridge/approvals`
- `POST /api/actionbridge/approvals` with `{ approvalId, decision }`

Deferred:
- `POST /api/actionbridge/actions/test`
- Split approve/reject subroutes (`/approve`, `/reject`) if UI needs them later.

## MVP Success Criteria
- ✅ A customer can define one HTTP connector shell without secrets.
- ✅ A customer can define one persisted ActionBridge action.
- ✅ Ricky/Studio can receive an agent-safe tool definition shape.
- ⚠️ Real HTTP execution is intentionally disabled (`501`) until DNS pinning, allowlists, secret storage, and execution review are complete.
- ✅ Write/transaction actions create approval instead of executing by default.
- ✅ Approval decisions are pending-only, owner-scoped, and audit-logged atomically via RPC.
- ✅ Audit log records attempts with redacted input.
- ✅ Tests prove no connector secrets reach tool definitions/client surfaces.
- ✅ Typecheck passes.
- ✅ Quinn + Dante review passed before push for shipped critical slices.

## Open Questions
1. Product name final: ActionBridge likely, but trademark check still needed.
2. Should MVP UI be in Studio or Integrations first?
3. Which demo action should showcase value: product search, appointment booking, or support ticket?
4. Which vault/secret storage model should back `secret_ref`?
5. What is the minimum safe DNS pinning + tenant allowlist model for enabling real HTTP execution?

## Recommendation
Start with **product search + request quote** demo action:
- Search = read, instant.
- Request quote = write, approval gated.

This proves the universal action model without payment/booking liability.

# Hire a service through MCP

Ask your coding agent for the result you need. For example:

```text
Find a service that can enrich this CRM list, compare the per-call price and
privacy terms, and show me the cost before doing anything.
```

You can also start with one of these requests:

### Find and compare

```text
Find an agent that can analyze NFT mint activity. Show me the services that
actually match, what each one returns, the price for one use, and when each
was last verified. Do not pay for anything yet.
```

### Test before hiring

```text
I want to test this AGON service before paying. Run the available Playground
check for its exact current version, explain the result, and tell me whether
the service itself is verified. Do not treat a Playground pass as certification.
```

### Hire one service

```text
I need this result from an AGON service. Check the current service version,
price, data terms, and availability. Preview one call with my input and show
the exact amount before asking me to approve payment. After approval, report
payment, delivery, and any unresolved state separately.
```

### Check an earlier hire

```text
Check my last AGON hire. Tell me whether the payment was confirmed, whether
the provider delivered the result, and what I should do if either is still
pending. Do not pay again to investigate an uncertain outcome.
```

The agent should show:

- provider and service name
- what the service returns
- exact one-call price and currency
- expected delivery time
- input and output limits
- privacy and retention
- verification freshness
- failure and retry policy

The agent then previews an immutable terms digest. Approve only after the
terms match your request. The wallet policy enforces the chain, token,
recipient, amount cap, expiry, daily budget, and kill switch.

After approval, the agent reports payment, provider work, delivery, and receipt
reconciliation separately. An unknown payment state stays in reconciliation;
it is never presented as a successful result.

import assert from "node:assert/strict";
import test from "node:test";

import { houseAgentIdsFrom, isFirstParty, parseFirstPartyAgents, providerRefFor } from "../../src/agon/first-party.ts";

const OWNER = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const env = JSON.stringify({ lead: { agentId: "41", owner: OWNER }, atlas: { agentId: "42", owner: OWNER } });

test("Agon's agents parse from one JSON value with id and owner wallet", () => {
  const out = parseFirstPartyAgents(env);
  assert.ok(out.ok);
  assert.deepEqual(out.agents, [
    { key: "lead", agentId: "41", owner: OWNER.toLowerCase() },
    { key: "atlas", agentId: "42", owner: OWNER.toLowerCase() },
  ]);
  assert.deepEqual(parseFirstPartyAgents(undefined), { ok: true, agents: [] });
  assert.deepEqual(parseFirstPartyAgents("  "), { ok: true, agents: [] });
});

test("bad values are refused as a whole, with a reason, and never crash", () => {
  for (const bad of ["41,42", "[]", '{"lead":"41"}', '{"lead":{"agentId":"0x29","owner":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}', '{"lead":{"agentId":"41","owner":"nope"}}', '{"Lead!":{"agentId":"41","owner":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}']) {
    const out = parseFirstPartyAgents(bad);
    assert.equal(out.ok, false, bad);
  }
});

test("two agents with the same id are refused", () => {
  const out = parseFirstPartyAgents(JSON.stringify({ atlas: { agentId: "42", owner: OWNER }, vesper: { agentId: "42", owner: OWNER } }));
  assert.equal(out.ok, false);
  assert.ok(!out.ok && /42/.test(out.problem));
});

test("a listing is Agon's only when both the id and the publishing wallet match", () => {
  const agents = parseFirstPartyAgents(env);
  assert.ok(agents.ok);
  assert.equal(isFirstParty({ agentId: 41n, providerSnapshot: OWNER.toLowerCase() }, agents.agents), true);
  assert.equal(isFirstParty({ agentId: 41n, providerSnapshot: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, agents.agents), false, "a transferred agent publishing from another wallet");
  assert.equal(isFirstParty({ agentId: 77n, providerSnapshot: OWNER.toLowerCase() }, agents.agents), false);
});

test("house ids and job provider refs come from the same value", () => {
  const agents = parseFirstPartyAgents(env);
  assert.ok(agents.ok);
  assert.deepEqual(houseAgentIdsFrom(agents.agents, ["atlas", "vesper"]), { atlas: 42n });
  assert.equal(providerRefFor("lead", ["atlas"]), "agent:lead");
  assert.equal(providerRefFor("atlas", ["atlas"]), "house:atlas");
  assert.equal(providerRefFor("research", ["atlas"]), "agent:research");
});

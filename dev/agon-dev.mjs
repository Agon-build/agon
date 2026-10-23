#!/usr/bin/env node
// Agon dev copy: the app runs on node-services, the laptop only opens it in a
// browser. Usage (from the repo root):
//   node dev/agon-dev.mjs setup     once: keys, database copy, first start
//   node dev/agon-dev.mjs           push code, start, open the tunnel, sync every save
//   node dev/agon-dev.mjs telegram  point @arcrunBot at the dev copy
//   node dev/agon-dev.mjs test [backend test files]   backend tests inside the dev copy
//   node dev/agon-dev.mjs logs [auth|web]  |  db  |  down
// See dev/README.md. Prints no secret values.
import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = process.env.AGON_DEV_HOST ?? "node-services";
const PROD = process.env.AGON_PROD_HOST ?? "host-service";
const DIR = "~/agon-dev";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TREES = ["backend", "frontend", "contracts/deployments", "bnb-market"];
const SKIP = /(^|\/)(node_modules|\.next|dist|coverage|\.turbo)(\/|$)|(^|\/)\.env(\.[^/]*)?$|\.(log|tsbuildinfo)$/;
const SSH = ["-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=15"];
const COMPOSE = `cd ${DIR} && docker compose -f compose.yml`;

function run(cmd, args, { input, quiet } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: [input ? "pipe" : "inherit", quiet ? "pipe" : "inherit", "inherit"] });
    if (input) input.pipe(p.stdin);
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.on("error", fail);
    p.on("close", (code) => (code === 0 ? ok(out) : fail(new Error(`${cmd} ${args.slice(-1)[0]} exited ${code}`))));
  });
}
const remote = (script, opts) => run("ssh", [...SSH, HOST, script], opts);

/// Streams a tar of `paths` (relative to the repo root) into the dev copy's source folder.
const EXCLUDE = ["node_modules", ".next", "dist", "coverage", ".env", ".env.*", "*.log", "*.tsbuildinfo"].flatMap((e) => ["--exclude", e]);
function push(paths) {
  const tar = spawn("tar", ["-cf", "-", ...EXCLUDE, "-C", ROOT, ...paths], { stdio: ["ignore", "pipe", "inherit"] });
  return remote(`mkdir -p ${DIR}/src && tar -xf - -C ${DIR}/src 2>&1 | grep -v 'Ignoring unknown extended header' ; true`, { input: tar.stdout });
}

async function pushAll() {
  const trees = TREES.filter((t) => existsSync(join(ROOT, t)));
  console.log(`pushing ${trees.join(", ")} to ${HOST}`);
  await push(trees);
  await push(["dev/compose.yml", "dev/make-env.sh"]);
  await remote(`cp ${DIR}/src/dev/compose.yml ${DIR}/src/dev/make-env.sh ${DIR}/ && chmod +x ${DIR}/make-env.sh`);
}

async function seedDatabase() {
  console.log(`copying the ${PROD} database into the dev copy (the dev copy never writes to it)`);
  await remote(`${COMPOSE} up -d --wait postgres && ${COMPOSE} stop auth >/dev/null 2>&1 || true`);
  const dump = spawn("ssh", [...SSH, PROD, "sudo docker exec arcrun-postgres pg_dump -U arcrun -d arcrun -Fc"], { stdio: ["ignore", "pipe", "inherit"] });
  await remote(`${COMPOSE} exec -T postgres pg_restore -U arcrun -d arcrun --clean --if-exists --no-owner --no-privileges 2>&1 | grep -v 'does not exist' | tail -3; true`, { input: dump.stdout });
  await remote(`${COMPOSE} exec -T postgres psql -U arcrun -d arcrun -qc "select 1 from pg_database where datname='agon_test'" -At | grep -q 1 || ${COMPOSE} exec -T postgres createdb -U arcrun agon_test`);
}

async function setup() {
  await remote(`mkdir -p ${DIR} && chmod 700 ${DIR}`);
  console.log(`copying the production keys from ${PROD} to ${HOST}:${DIR}/prod.env (not printed)`);
  const env = spawn("ssh", [...SSH, PROD, "sudo cat /opt/arcrun/deploy/.env"], { stdio: ["ignore", "pipe", "inherit"] });
  await remote(`umask 077 && cat > ${DIR}/prod.env && echo "prod.env: $(grep -c = ${DIR}/prod.env) lines"`, { input: env.stdout });
  await pushAll();
  await remote(`${DIR}/make-env.sh`);
  await seedDatabase();
  await remote(`${COMPOSE} up -d auth web`);
  console.log("set up. Next: node dev/agon-dev.mjs");
}

function tunnel() {
  const open = () => {
    const p = spawn("ssh", [...SSH, "-N", "-o", "ExitOnForwardFailure=yes", "-L", "3000:127.0.0.1:3300", "-L", "8082:127.0.0.1:8382", HOST], { stdio: "inherit" });
    p.on("close", (code) => {
      console.log(`tunnel closed (${code}); reopening in 3 s`);
      setTimeout(open, 3000);
    });
  };
  open();
}

function syncOnSave() {
  const pending = new Set();
  let timer = null;
  const flush = async () => {
    timer = null;
    const paths = [...pending];
    pending.clear();
    const present = paths.filter((p) => existsSync(join(ROOT, p)));
    const gone = paths.filter((p) => !present.includes(p));
    try {
      if (present.length) await push(present);
      if (gone.length) await remote(`cd ${DIR}/src && rm -rf -- ${gone.map((p) => `'${p}'`).join(" ")}`);
      console.log(`${new Date().toLocaleTimeString()} synced ${paths.length === 1 ? paths[0] : `${paths.length} files`}`);
    } catch (e) {
      console.error(`sync failed: ${e.message}; will retry on the next save`);
      for (const p of paths) pending.add(p);
    }
  };
  for (const tree of TREES) {
    const base = join(ROOT, tree);
    if (!existsSync(base)) continue;
    watch(base, { recursive: true }, (_event, file) => {
      if (!file) return;
      const rel = relative(ROOT, join(base, file)).replace(/\\/g, "/");
      if (SKIP.test(rel)) return;
      pending.add(rel);
      timer ??= setTimeout(flush, 400);
    });
  }
  console.log("watching for saves");
}

async function start() {
  await pushAll();
  await remote(`${DIR}/make-env.sh >/dev/null && ${COMPOSE} up -d auth web`);
  console.log("\nAgon dev: http://localhost:3000   API: http://localhost:8082");
  console.log("first start installs packages on the server (a few minutes); see: node dev/agon-dev.mjs logs web\n");
  tunnel();
  syncOnSave();
}

async function telegram() {
  await remote(`${COMPOSE} --profile telegram up -d tunnel`);
  let url = "";
  for (let i = 0; i < 30 && !url; i++) {
    const logs = await remote(`${COMPOSE} logs tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\\.trycloudflare\\.com' | tail -1`, { quiet: true });
    url = logs.trim();
    if (!url) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!url) throw new Error("the tunnel gave no address; see: node dev/agon-dev.mjs logs tunnel");
  console.log(`webhook address ${url}`);
  await remote(`cd ${DIR} && sed -i '/^AGON_PUBLIC_API_URL=/d' dev.env && echo 'AGON_PUBLIC_API_URL=${url}' >> dev.env && ./make-env.sh >/dev/null && ${COMPOSE} up -d --force-recreate auth`);
  await remote(`for i in $(seq 1 60); do ${COMPOSE} exec -T auth node -e "fetch('http://127.0.0.1:8082/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break; sleep 3; done; ${COMPOSE} exec -T auth npx tsx scripts/telegram-webhook.ts`);
  console.log("Telegram: message @arcrunBot. The address changes if the tunnel restarts; run this again then.");
}

async function test(files) {
  const target = files.length ? files.map((f) => f.replace(/^backend\//, "")).join(" ") : "test/agon/*.test.ts";
  await pushAll();
  await remote(`${COMPOSE} exec -T -e TEST_DATABASE_URL=postgres://arcrun:dev@postgres:5432/agon_test auth sh -c "node --experimental-strip-types --test --test-concurrency=1 ${target} 2>&1 | grep -E '^not ok|^# (tests|pass|fail)'; npx tsc --noEmit -p . && echo typecheck clean"`);
}

const [cmd = "start", ...rest] = process.argv.slice(2);
const commands = {
  start,
  setup,
  telegram,
  test: () => test(rest),
  db: async () => { await seedDatabase(); await remote(`${COMPOSE} up -d auth`); },
  logs: () => remote(`${COMPOSE} logs -f --tail 80 ${rest.join(" ")}`),
  down: () => remote(`${COMPOSE} --profile telegram stop`),
};
if (!commands[cmd]) {
  console.error(`unknown command ${cmd}; use one of ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
commands[cmd]().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

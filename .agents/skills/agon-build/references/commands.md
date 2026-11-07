# Agon build checks

Run from the repository root unless a command says otherwise. These commands
are for inspection and validation. Git staging, commits, pushes, branch
changes, and deployment remain user-owned actions.

## Source inspection

```text
rg --files frontend/src/app
rg -n "IS_AGON_DEPLOYMENT|AGON_NETWORK|chainId|Arc" frontend/src/app frontend/src/components frontend/src/lib
rg -n "import .*lib/arc|import .*agon/network" frontend/src/app frontend/src/components frontend/src/lib
```

Before using an external dependency, inspect the installed package version and
the shipped types or source. Record the result in the relevant public-safe
reference or private research file. Do not put secrets or private planning in
the public skill.

## Validation

Run checks in a disposable workspace (the repository's rule is a VPS chosen by
the owner, never the local PC), with no env files copied.

```text
cd backend
npx tsc --noEmit -p .
TEST_DATABASE_URL=postgres://... npm run test:agon     # needs a throwaway Postgres 17

cd frontend
npx tsc --noEmit -p .
npm run test:marketplace
npx next build
```

A new test file is registered in `frontend/package.json` (`test:marketplace`)
or matched by `backend/test/agon/*.test.ts`. The deployed site is the Agon
build; `NEXT_PUBLIC_PRODUCT_VARIANT=arcrun` is the only way to see ArcRun.

## Skill validation

From the repository root, the repository packager creates the public download
at `frontend/public/downloads/agon-build.zip`:

```text
npm run package:agon-build-skill
npm run package:agon-skill        # agon-asp.zip
```

For local `.skill` validation, use the skill creator tools:

```text
python scripts/quick_validate.py .agents/skills/agon-build
python scripts/package_skill.py .agents/skills/agon-build dist
```

The first command validates frontmatter. The second creates a local `.skill`
archive. The repository packager creates the public ZIP from the same source
files. Never edit an archive by hand.

## Handoff requirements

Report the exact files changed, checks run, warnings, known unavailable
capabilities, and the next user-owned Git commands. Never report a local
fixture or prepared transaction as a live result.

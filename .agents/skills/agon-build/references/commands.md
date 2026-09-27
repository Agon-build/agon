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

## Frontend validation

```text
cd frontend
npm run typecheck
npm run build
```

For local review of the AGON variant on port 4000:

```text
set NEXT_PUBLIC_PRODUCT_VARIANT=agon&& npm run dev -- --port 4000
```

The product flag is required while the current repository still contains the
legacy ArcRun landing as the default variant. Do not infer the served product
from the port alone. Confirm the page says AGON and does not expose ArcRun
copy when reviewing the Agon surface.

## Skill validation

From the repository root, the repository packager creates the public download
at `frontend/public/downloads/agon-build.zip`:

```text
npm run package:agon-build-skill
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

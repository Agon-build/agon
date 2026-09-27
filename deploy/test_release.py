import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
class ReleaseBoundaryTests(unittest.TestCase):
    def test_bnb_changes_trigger_checks_before_deploy(self):
        workflow = (ROOT / '.github/workflows/deploy.yml').read_text()
        for path in ['bnb-market/**', 'frontend/**', 'backend/**']:
            self.assertIn(path, workflow)
        # Deploy must wait for the application checks and the Solidity tests.
        self.assertIn('needs: [contracts, verify]', workflow)
        self.assertIn('run: forge test', workflow)
        self.assertIn('foundry-rs/foundry-toolchain@908c540300062bd5a7e473851cdb4282204cee09', workflow)
        self.assertIn('test:auth', workflow)
        self.assertIn('test:lp-storage', workflow)
        self.assertIn('test:agon', workflow)
        self.assertIn('VPS_HOST_FINGERPRINT', workflow)
        for action_sha in [
            'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
            'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
            'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
            'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
        ]:
            self.assertIn(action_sha, workflow)
        self.assertIn('package-manager-cache: false', workflow)
        self.assertNotIn('uses: actions/checkout@v', workflow)
        self.assertNotIn('uses: appleboy/ssh-action@v', workflow)
    def test_release_preserves_shared_state(self):
        script = (ROOT / 'deploy/release.sh').read_text()
        commands = '\n'.join(line for line in script.splitlines() if not line.startswith('#'))
        for forbidden in ['git reset', 'compose down', '--remove-orphans', 'image prune', '--build']:
            self.assertNotIn(forbidden, commands)
        self.assertIn('trap rollback ERR', script)
        self.assertIn('pg_dump', script)
        self.assertIn('--wait', script)
        self.assertIn('test -f "$incoming/release.compose.yml"', script)
        self.assertIn('cp "$incoming/release.compose.yml" "$release/compose.yml"', script)
    def test_bnb_environment_is_separate_and_database_is_not_exposed(self):
        compose = (ROOT / 'deploy/release.compose.yml').read_text()
        bnb = compose.split('  bnb-api:', 1)[1]
        self.assertIn('deploy/bnb.env', bnb)
        self.assertNotIn('deploy/.env', bnb)
        self.assertNotIn('ports:', compose)
        self.assertIn('external: true', compose)
        self.assertIn('name: deploy_default', compose)
        self.assertIn('  bnb-lp-worker:', compose)
        self.assertIn('/opt/arcrun/deploy/secrets:/run/agon-secrets:ro', compose)
        self.assertIn('ALTANA_SESSION_FILE: /run/agon-secrets/altana-session.json', compose)

    def test_release_starts_bnb_worker(self):
        script = (ROOT / 'deploy/release.sh').read_text()
        self.assertIn('auth indexer coordinator bnb-api bnb-lp-worker', script)

    def test_bnb_image_includes_marketplace_support_modules(self):
        dockerfile = (ROOT / 'bnb-market/Dockerfile.api').read_text()
        self.assertIn('COPY src/shared/marketplace ./src/shared/marketplace', dockerfile)
    def test_caddy_keeps_other_products(self):
        caddy = (ROOT / 'deploy/caddy/Caddyfile').read_text()
        for host in ['api.agon.surf', 'api.arcrun.xyz', 'agentsqa.xyz', 'api.avow.site', 'api.sface.site']:
            self.assertIn(host + ' {', caddy)
        self.assertIn('handle /api/bnb/*', caddy)

if __name__ == '__main__': unittest.main()

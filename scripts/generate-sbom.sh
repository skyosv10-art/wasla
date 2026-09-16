#!/usr/bin/env bash
# WASLA — SBOM Generation Script (M2-01)
#
# Generates a Software Bill of Materials (SBOM) from the pnpm lockfile.
# Output: CycloneDX JSON format at artifacts/sbom/wasla-sbom.json
#
# ADR-032: Container images, SBOM, and vulnerability scanning (M2-01)
#
# Usage:
#   bash scripts/generate-sbom.sh
#
# Requirements:
#   - pnpm (for lockfile parsing)
#   - Node.js (for cyclonedx-npm or fallback)
#
# Exit codes:
#   0 — SBOM generated successfully
#   1 — SBOM generation failed

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SBOM_DIR="${REPO_ROOT}/artifacts/sbom"
SBOM_FILE="${SBOM_DIR}/wasla-sbom.json"
LOCKFILE="${REPO_ROOT}/pnpm-lock.yaml"

echo "=== WASLA SBOM Generation ==="
echo "Lockfile: ${LOCKFILE}"
echo "Output:   ${SBOM_FILE}"

mkdir -p "${SBOM_DIR}"

# Check if pnpm is available
if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm not found. Install pnpm to generate SBOM." >&2
  exit 1
fi

# Check if lockfile exists
if [ ! -f "${LOCKFILE}" ]; then
  echo "ERROR: pnpm-lock.yaml not found." >&2
  exit 1
fi

# Try cyclonedx-npm first (CycloneDX format)
if npx --yes @cyclonedx/cyclonedx-npm --version >/dev/null 2>&1; then
  echo "Generating SBOM via @cyclonedx/cyclonedx-npm..."
  cd "${REPO_ROOT}"
  npx --yes @cyclonedx/cyclonedx-npm --output-file "${SBOM_FILE}" --output-format JSON
else
  # Fallback: generate a minimal SBOM from pnpm list
  echo "cyclonedx-npm not available, generating minimal SBOM from pnpm list..."
  cd "${REPO_ROOT}"

  # Generate package list and wrap in CycloneDX-like structure
  pnpm list --all --json > "${SBOM_DIR}/pnpm-list.json"

  # Create a minimal SBOM document
  node -e "
    const fs = require('fs');
    const pkgs = JSON.parse(fs.readFileSync('${SBOM_DIR}/pnpm-list.json', 'utf8'));
    const components = [];
    const seen = new Set();

    function extractDeps(deps, prefix) {
      for (const [name, info] of Object.entries(deps || {})) {
        const version = info.version || 'unknown';
        const key = name + '@' + version;
        if (!seen.has(key)) {
          seen.add(key);
          components.push({
            type: 'library',
            name: name,
            version: version,
            purl: 'pkg:npm/' + encodeURIComponent(name) + '@' + version
          });
        }
        if (info.dependencies) {
          extractDeps(info.dependencies, prefix + name + '/');
        }
      }
    }

    for (const pkg of pkgs) {
      extractDeps(pkg.dependencies || {}, '');
    }

    const sbom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.4',
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: [{ name: 'wasla-sbom-generator', version: '1.0.0' }],
        component: {
          type: 'application',
          name: 'wasla',
          version: '0.0.0'
        }
      },
      components: components
    };

    fs.writeFileSync('${SBOM_FILE}', JSON.stringify(sbom, null, 2));
    console.log('SBOM generated: ' + components.length + ' components');
  "
fi

# Verify SBOM was created
if [ ! -f "${SBOM_FILE}" ]; then
  echo "ERROR: SBOM file was not created." >&2
  exit 1
fi

# Count components
COMPONENT_COUNT=$(node -e "
  try {
    const sbom = JSON.parse(require('fs').readFileSync('${SBOM_FILE}', 'utf8'));
    console.log(sbom.components ? sbom.components.length : 0);
  } catch(e) { console.log(0); }
")

echo "SBOM generated successfully: ${COMPONENT_COUNT} components"
echo "File: ${SBOM_FILE}"

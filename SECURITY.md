# Security policy

## Supported versions

Kestrel is pre-1.0. Security fixes land on `main` and in the latest `0.1.x` build.
Older builds are not maintained.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:

<https://github.com/Shinjiru-stack/kestrel/security/advisories/new>

Do not open a public issue for a suspected vulnerability. Include:

- the Kestrel version and Windows version;
- a minimal reproduction or the exact sequence of actions;
- the affected surface (Tauri shell, Rust core, provider adapter, approval path, CSP,
  local storage, or UI);
- the impact you believe is possible;
- relevant logs with API keys, tokens, and cluster credentials removed.

You will get an acknowledgement as soon as the report is reviewed. Please allow time
for a fix and a coordinated disclosure before publishing details.

## Scope

In scope:

- the Tauri shell, capabilities, and content security policy;
- the Rust core, cluster client, provider adapters, and diagnosis parser;
- approval, destructive-action, protected-namespace, and audit enforcement;
- local settings and audit storage;
- the static UI and its IPC bridge.

Out of scope:

- misconfiguration of a cluster, kubeconfig, provider account, or API key;
- a compromised workstation, kubeconfig, or provider endpoint;
- plaintext API-key storage, which is documented in the README and is a known
  pre-1.0 limitation;
- the quality or correctness of model output;
- vulnerabilities in third-party providers, Kubernetes, Trivy Operator, or Ollama.

## Operational guidance

- Use a least-privilege kubeconfig. Kestrel does not need cluster-admin for read-only
  observation, and it should not be given more access than the actions you intend to
  approve.
- Protect `%APPDATA%\com.kestrel.desktop\settings.json`. Provider keys are stored in
  plaintext; use full-disk encryption and restrictive account permissions.
- Leave destructive actions disabled unless you need them. Review the exact payload
  before every approval.
- Treat model output as advisory. The deterministic findings and the mutation payload
  are the source of truth.

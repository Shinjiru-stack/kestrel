# UI evaluation snippets

These are development-only scripts for the running Kestrel WebView. They are not part
of the desktop app and are not shipped in the bundle.

Most scripts assume the demo cluster used for the screenshots and may target specific
workload names. Run one against an open debug app with WebView2 remote debugging:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
.\target\debug\kestrel.exe
node tools\cdp-existing.mjs 9222 screenshot.png "@tools\evals\verify-security.js"
```

`tools/provider-mock.mjs` and `tools/evals/configure-mock-providers.js` can exercise the
provider adapters without real API keys. The mock provider is development-only.

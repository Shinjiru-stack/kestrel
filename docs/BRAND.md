# Kestrel Brand Guide

## The idea

A kestrel is small, precise, and patient. It hovers above the field, reads the whole
picture, and commits only when the moment is right.

That is the product: a calm observatory for Kubernetes that gathers evidence, explains
what is happening, and waits for a human before it changes anything.

- **Name:** Kestrel
- **Tagline:** Cluster Intelligence
- **Descriptor:** Evidence-grounded Kubernetes diagnostics and approval-gated remediation
- **Identifier:** `com.kestrel.desktop`
- **Repository:** <https://github.com/Shinjiru-stack/kestrel>

Kestrel is a product name, not an acronym. Write it as **Kestrel** in prose. Use
**KESTREL** only in the wordmark or when a monospaced label needs uppercase.

## The mark

The mark is a **Flight-path K**: three tapered shards form the stem and two swept wings,
with bright signal nodes at the leading tip, the junction, and the lower trail. The shards
read as a letter at small sizes and as a bird correcting its flight path at large sizes.
It is deliberately geometric, not literal. The upper shard points up-right; the lower
shard sweeps down-right; the stem stays offset to the left.

| Asset | File | Use |
| --- | --- | --- |
| Mark | [`kestrel-mark.svg`](brand/kestrel-mark.svg) | UI, diagrams, merchandise |
| App icon | [`kestrel-icon.svg`](brand/kestrel-icon.svg) | Launcher, store, installer |
| Lockup | [`kestrel-lockup.svg`](brand/kestrel-lockup.svg) | README hero, title slides |
| Social card | [`kestrel-social.svg`](brand/kestrel-social.svg) | GitHub social preview, link previews |
| Rendered lockup | [`kestrel-lockup.png`](brand/kestrel-lockup.png) | Raster contexts (2×) |
| Rendered social card | [`kestrel-social.png`](brand/kestrel-social.png) | Retina / 2× raster contexts |
| GitHub social preview | [`kestrel-social-1280.png`](brand/kestrel-social-1280.png) | Exact 1280 × 640 upload |

### Clear space

Keep at least the height of the mark's stem clear on every side. For the lockup, use the
height of the **K** as the minimum margin. Do not crowd the mark with borders, badges, or
other logos.

### Minimum sizes

- Mark: **16 px** (favicon), **24 px** (UI), **32 px** (launcher)
- Lockup: **120 px** wide for the wordmark to remain legible
- Social card: use the supplied 1280 × 640 composition

### Do

- Use the supplied SVG on obsidian or light backgrounds.
- Keep the mint-to-pale-mint gradient on the stroke.
- Preserve the bright node at the leading tip.
- Use the mark alone when space is tight; use the lockup when the name matters.

### Do not

- Recolor the mark outside the palette.
- Rotate, skew, stretch, or add drop shadows.
- Place the mark on a busy photograph without a solid scrim.
- Rebuild the wordmark with a different typeface or tracking.
- Use the old K8s Healer name, logo, or red/cross imagery.

## Color

Kestrel opens on a calm, paper-light observatory surface by default, with an obsidian
dark theme for low-light work. A single mint signal means "live" or "safe to proceed."
Severity colors are reserved for severity.

### Dark theme

| Token | Hex | Role |
| --- | --- | --- |
| Obsidian | `#05070A` | App void, deepest background |
| Ink | `#070A0E` | App background |
| Panel | `#0D1218` | Cards, drawers, surfaces |
| Mint | `#9EF0C0` | Primary accent, live signal, focus |
| Mint bright | `#C5FFD9` | Leading node, emphasis |
| Mint deep | `#52C98C` | Pressed states, progress |
| Rose | `#FF9AB5` | Critical, destructive |
| Amber | `#FFC978` | Warning, degraded |
| Violet | `#C2A6FF` | Informational, AI |
| Text | `#EEF3EF` | Primary text |
| Text soft | `#B6C2BA` | Secondary text |
| Text muted | `#77857D` | Labels, metadata |
| Text faint | `#4E5A54` | Disabled, dividers |

### Light theme

| Token | Hex | Role |
| --- | --- | --- |
| Mint | `#187A49` | Primary accent |
| Mint deep | `#0F8A50` | Pressed states |
| Rose | `#B53D63` | Critical |
| Amber | `#A8640B` | Warning |
| Violet | `#6A45B8` | Informational |

The UI tokens live in [`crates/kestrel/ui/css/tokens.css`](../crates/kestrel/ui/css/tokens.css).
Do not introduce one-off colors in views; add a token instead.

## Typography

| Face | Role | Notes |
| --- | --- | --- |
| **Sora** | Display, headings, wordmark | Geometric, confident, slightly technical |
| **Inter** | Body, controls, tables | Neutral and highly legible |
| **JetBrains Mono** | Data, IDs, commands, labels | Makes cluster data feel inspectable |

All three are bundled locally as WOFF2 files in
[`crates/kestrel/ui/fonts`](../crates/kestrel/ui/fonts). The app does not fetch fonts at
runtime.

Use uppercase mono labels with generous tracking for section eyebrows and data labels.
Keep body copy sentence case. Numbers are data: use tabular figures where the interface
supports them.

## Voice

Kestrel sounds like a senior SRE who has seen this failure before: calm, specific, and
unwilling to guess.

- **Evidence before action.** Say what was observed, then what it means.
- **Name the risk.** "Deleting this bare pod will not recreate it."
- **Keep the human in charge.** "Prepare action", "approval required", "you decide".
- **Prefer the concrete.** "829 restarts", "exit 1", "ImagePullBackOff".
- **Avoid magic.** No "self-healing", "autonomous repair", or "AI fixes your cluster".
- **Avoid alarmism.** A critical finding is a decision, not a catastrophe.

### Copy examples

| Instead of | Write |
| --- | --- |
| AI heals your cluster | Evidence-grounded diagnosis with approval-gated remediation |
| Fix all issues | Triage the failing workloads and rank them by blast radius |
| Something is wrong | 7 pods are failing; 3 share the same image-pull error |
| Auto-remediate | Prepare a remediation; review the exact payload before it runs |

## Motion

Motion is a signal, not decoration. Use short, eased transitions for panels and drawers;
reserve pulsing for live status and streaming responses. Respect the **Reduce motion**
setting in Appearance. Never animate a mutation into happening; the approval modal is a
hard stop.

## Applying the brand

- **App:** titlebar lockup, favicon, About panel, window title `Kestrel - Cluster Intelligence`.
- **README:** lockup hero, badges, screenshots, feature sections.
- **GitHub:** use `docs/brand/kestrel-social-1280.png` as the social preview.
- **Installer:** `Kestrel` as product name, `com.kestrel.desktop` as identifier.
- **Code:** crate names `kestrel` and `kestrel-core`; binary `kestrel`; library `kestrel_lib`.

## Asset provenance

The mark, lockup, and social card are original vector artwork created for this project.
The source HTML used to render the raster previews is kept in
[`docs/brand/lockup.html`](brand/lockup.html) and
[`docs/brand/social.html`](brand/social.html).

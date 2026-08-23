# Search result card design QA

## Evidence

- Source visual truth: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-9dd78a39-81e3-443d-8dc3-06c2bd85f7f6.jpg`
- Source pixels: 1080 × 1920; hand-drawn responsive layout reference, not a pixel-accurate production frame.
- Mobile implementation: `design-qa-assets/search-card-mobile-429x567.png`
- Mobile viewport and pixels: 429 × 567 CSS px, device pixel ratio 2, browser screenshot normalized by the in-app browser for display.
- Desktop implementation: `design-qa-assets/search-card-desktop-1280x720.png`
- Desktop viewport and pixels: 1280 × 720 CSS px, device pixel ratio 2, browser screenshot normalized by the in-app browser for display.
- State: Missevan search for “天官”; first result selected with a 2px primary border.

## Full-view comparison evidence

- The cover remains at the left of the four-row information block.
- The title uses the complete information-column width and does not reserve space for the operation rail.
- Import and more form a vertical rail beside only the ID, author, and CV rows on mobile and desktop.
- Metrics remain directly beneath the information block; trend and paid-ID actions stay at the lower right.
- The sketch's explanatory horizontal rules are not rendered.
- Selected state uses the existing primary blue token and a 2px full-card border rather than adding a new visual treatment.

## Focused region comparison evidence

- Mobile geometry: title width 272px equals the complete information-column width; metadata reserves 44px at the right; import and more are 44 × 44 with a 2px vertical gap.
- Desktop geometry: title width 907px equals the complete information-column width; metadata reserves 36px at the right; import and more are 32 × 32 with a 4px vertical gap.
- No `hr`, separator role, or title/metadata border divider exists inside the card.
- Cover and metrics clicks toggle selection. Import, more, trend, and paid-ID clicks preserve the previous selection state.

## Required fidelity surfaces

- Fonts and typography: existing Geist hierarchy, weights, line heights, wrapping, and badges are preserved; the change only releases title width.
- Spacing and layout rhythm: operation rail is scoped to the three metadata rows at both responsive breakpoints; cover alignment and compact metric spacing are preserved.
- Colors and visual tokens: existing neutral surfaces and primary selected border are reused; no new color or gradient was introduced.
- Image quality and asset fidelity: existing proxied cover artwork, crop, radius, payment badge, and icon library are unchanged.
- Copy and content: title, content-type badge, ID, author, CV, metrics, and action labels are unchanged.

## Interaction and accessibility

- The card's non-interactive surface toggles selection.
- Interactive descendants are excluded from the card click handler so their original behavior is retained.
- An accessible selection button exposes the current state through `aria-pressed` and a select/cancel label.
- Fresh-page console check produced no errors. Import and paid-ID dev-only CORS errors observed during forced action testing are unrelated to the card layout and do not occur on baseline load.

## Findings

- No actionable P0, P1, or P2 differences remain.

## Comparison history

- Initial implementation placed the vertical rail in the complete information column, which reduced title width.
- Fix: moved the rail into a metadata-only relative container and moved selection handling to the card surface.
- Post-fix evidence: both responsive captures show a full-width title, metadata-scoped action rail, whole-card selected border, and no explanatory dividers.

## Follow-up polish

- None required for this scoped change.

final result: passed

---

# Rank card unification design QA

## Evidence

- Source visual truth: `C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-05122ffd-d393-48d7-bea0-12b0a1464d61.jpg`
- Source pixels: 890 × 1068; hand-drawn hierarchy reference rather than a pixel-accurate production frame.
- Implementation surfaces: normal drama ranks, Missevan peak ranks, CV ranks, and CV search results.

## Static and behavioral verification

- Normal rank cards use a 96px cover on every viewport, a plain platform ID row, an independent compact metric row, and a right-aligned adaptive action row.
- Missevan peak cards retain their existing responsive cover size and expose the fourth row beside the cover on desktop and from the card edge on mobile.
- Shared `RankWatermark` supplies top-three semantic colors and a neutral fallback without consuming layout width.
- Action measurement observes the container and natural button widths; hidden controls are unfocusable and their menu equivalents remain available.
- CV search results are separate cards; CV rank cards retain their expandable TOP3 structure.
- Node tests, UI tests, ESLint, TypeScript, production build, and diff whitespace checks pass.

## Visual QA status

- Browser comparison is blocked in this task because no in-app browser inspection tool is available to the agent, and the user explicitly prohibited starting a new service or port.
- No implementation screenshot was fabricated and build success is not treated as visual verification.
- Required manual states: 320px, 375px, 391px, 768px, 1024px, and wide desktop; normal all/two/one-button modes; peak direct-actions/menu/menu-icon modes; long title/CV/Manbo ID; expanded CV TOP3.

final result: blocked

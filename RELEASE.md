# Release Process

Use GitHub Releases for desktop builds. Do not commit `release/*.exe` into git.

## Rules

- Commit source code to `main` as usual
- Keep local build artifacts in `release/`
- Publish desktop installers as GitHub Release assets

## Build Locally

```powershell
npm run pack:win
```

Expected artifact:

```text
release/M&M-Toolkit-<version>.exe
```

## Publish Steps

1. Make sure source changes are already committed and pushed to `main`
2. Run `npm run pack:win`
3. Create and push a version tag

```powershell
git tag v1.0.0
git push origin v1.0.0
```

4. Open the repository on GitHub
5. Go to `Releases`
6. Click `Draft a new release`
7. Select the tag, for example `v1.0.0`
8. Set a title such as `M&M Toolkit v1.0.0`
9. Upload `release/M&M-Toolkit-1.0.0.exe`
10. Publish the release

## Optional: GitHub CLI

```powershell
gh release create v1.0.0 "release/M&M-Toolkit-1.0.0.exe" --title "M&M Toolkit v1.0.0" --notes "Windows desktop build"
```

## Notes

- Do not run `git add release/*.exe`
- Repacking the app does not require a source commit
- Repeat the same build and release flow for future versions

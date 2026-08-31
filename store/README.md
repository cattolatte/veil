# Store submission package

Everything needed to publish, prepared. **Submission itself requires the
developer's own account and payment**, so the final step is manual by
necessity.

## Chrome Web Store

1. Register at <https://chrome.google.com/webstore/devconsole> (one-time $5 fee)
2. Build and package:
   ```bash
   npm run build
   npm run package        # → store/veil-chrome.zip
   ```
3. Upload the zip, paste `listing.md` into the fields, attach screenshots
4. **Justify the permissions** — the review team asks about `activeTab` and
   `<all_urls>`. Text is in `listing.md` under *Permission justification*.

## Firefox Add-ons

1. Register at <https://addons.mozilla.org/developers/>
2. Package with the Firefox manifest:
   ```bash
   npm run package:firefox   # → store/veil-firefox.zip
   ```
3. Firefox requires **reviewable source**. The bundle is generated, so include
   `build.mjs` and the source tree, and note the build command in the
   reviewer's comments: `npm install && npm run build`.

## Before submitting

- [ ] Version bumped in both manifests
- [ ] `npm test` passes (26 tests)
- [ ] Screenshots taken at 1280×800
- [ ] Privacy policy hosted somewhere reachable — both stores require a URL for
      an extension with host permissions
- [ ] Decide whether the default server URL should point at localhost. It
      currently does, which means a published extension does nothing until the
      user runs a server. That is honest for a hackathon build and wrong for a
      public listing.

## The honest caveat

This extension is a hackathon prototype. Before a public listing it needs a
hosted server or a bundled local model, a privacy policy, and a support
contact. The packaging is ready; the product decisions are not made.

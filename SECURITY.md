# Security

## Reporting a problem

If you find a security problem in this project, please report it privately:
open the **Security** tab of this repository and choose **Report a vulnerability**.
Please don't post it in a public issue.

You'll get a reply as soon as possible, usually within a few days.

## Supported versions

Only the live site (GitHub Pages) gets fixes.

## How keys are handled

- No API keys, tokens or passwords are stored in this repository. Every push is scanned
  for them (see `.github/workflows/secret-scan.yml`), and GitHub push protection is on.
- The weather, wave and tide data the app shows come from public services that need no key.
- The site editor (`editor.html`) asks the owner for a fine-grained GitHub token limited to this
  one repo. The token stays in that browser only, and the page's security policy lets it be
  sent nowhere except api.github.com.

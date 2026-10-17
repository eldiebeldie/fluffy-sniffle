# Contributing to `fluffy-sniffle`

Do the right thing!!!

---

## 🔒 Restricted-Environment Push & Write Safeguard (`allowGitPush = false`)

As a preventative security measure for engineers and contributors cloning this repository inside **restricted, corporate, or regulated environments**, outbound Git pushes and mutating GitHub API operations are **disabled by default** (`ALLOW_GIT_PUSH=false` in `.env` and `"allowGitPush": false` in `config.json`).

This fail-safe prevents accidental upstream pushes of local configuration adjustments, internal repository lists, or environment-specific modifications.

### How to Intentionally Enable Pushing When Contributing

When you are ready to push vetted commits to your branch or open a pull request, explicitly authorize pushing using any of the following methods:

1. **Via `.env`:** Set `ALLOW_GIT_PUSH=true` in your `.env` file.
2. **Via `config.json`:** Set `"allowGitPush": true` in `config.json` (ensure you revert it to `false` before committing).
3. **One-Time Command:** Run `ALLOW_GIT_PUSH=true git push`.

For full details on data privacy and security controls, see [`SECURITY.md`](SECURITY.md).

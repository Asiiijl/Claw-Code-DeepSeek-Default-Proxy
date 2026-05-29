# Upstream Sync Workflow

This fork tracks `ultraworkers/claw-code` while preserving the DeepSeek-first
runtime, proxy defaults, subagent contracts, and JSON automation surfaces.

## Remotes

- `origin`: `https://github.com/Asiiijl/Claw-Code-DeepSeek-Default-Proxy.git`
- `upstream`: `https://github.com/ultraworkers/claw-code.git`

If `upstream` is missing in a fresh clone, add it once:

```bash
git remote add upstream https://github.com/ultraworkers/claw-code.git
git fetch upstream
```

## Sync cadence

Run a small upstream sync at least weekly while active development is happening,
and immediately when upstream lands provider, security, release, or JSON output
contract fixes. Avoid mixing upstream syncs with unrelated feature work.

## Merge procedure

1. Start from a clean fork branch with the latest green local baseline.
2. Fetch upstream and create a temporary branch:

```bash
git fetch upstream
git switch -c sync/upstream-main-YYYYMMDD main
git merge --no-ff upstream/main
```

3. Resolve conflicts by preserving the fork invariants in
   [`fork-delta.md`](./fork-delta.md).
4. Re-run the full gate before merging the sync branch back to `main`:

```bash
scripts/fmt.sh --check
python3 .github/scripts/check_doc_source_of_truth.py
python3 .github/scripts/check_release_readiness.py
python3 -m unittest discover -s tests -v
cd rust
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
./scripts/run_mock_parity_harness.sh
```

5. Update [`fork-delta.md`](./fork-delta.md) with any new fork-specific
   conflict decisions or upstream features that were intentionally deferred.

## Conflict policy

- Keep upstream bug fixes unless they directly undo a documented fork invariant.
- Keep DeepSeek/OpenAI-compatible routing behavior when upstream changes provider
  selection, default models, auth hints, or request serialization.
- Keep `subagent spawn`, `subagent batch`, notification files, and
  `##SUBAGENT_REPORT##` machine contracts stable.
- Keep `--output-format json` backward compatible. Add fields only; do not
  remove existing `kind`, `status`, `error`, or exit-code semantics.
- If a conflict cannot be resolved safely in one sitting, abort the merge and
  write the blocker into `docs/fork-delta.md` before retrying.

## Rollback

For an unmerged sync branch, use `git merge --abort` during conflict resolution
or delete the temporary branch after switching away from it. For an already
merged sync, revert the merge commit rather than hand-editing upstream changes
out of `main`.


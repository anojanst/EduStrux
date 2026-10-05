#!/usr/bin/env bash
# Gives Claude Code its own GitHub identity (a "bot" account) in this repo, so its commits and
# pull requests are authored by the bot and you can review, approve or request changes as
# yourself. Your own terminal keeps using your account.
#
# Run it yourself in a terminal. It asks for the bot's token, so Claude never sees it:
#   scripts/setup-claude-bot.sh <bot-github-username>
#
# Before running: create the bot account on GitHub, and while logged in as the bot create a
# *classic* personal access token with the `repo` and `workflow` scopes.
set -euo pipefail

BOT="${1:?Usage: scripts/setup-claude-bot.sh <bot-github-username>}"
ROOT="$(git rev-parse --show-toplevel)"
SETTINGS="$ROOT/.claude/settings.local.json"
command -v jq >/dev/null || { echo "✖ jq is required (sudo apt install jq)"; exit 1; }

# Everything "as you" runs without GH_TOKEN, using your normal gh login.
as_owner() { env -u GH_TOKEN -u GITHUB_TOKEN gh "$@"; }
REPO="$(as_owner repo view --json nameWithOwner -q .nameWithOwner)"
OWNER="${REPO%%/*}"
[ "$BOT" != "$OWNER" ] || { echo "✖ The bot must be a different account from $OWNER."; exit 1; }

# The token is written to .claude/settings.local.json, so that file must never be committed.
git -C "$ROOT" check-ignore -q "$SETTINGS" || { echo "✖ $SETTINGS is not gitignored."; exit 1; }

echo "Repo: $REPO   Reviewer (you): $OWNER   Bot: $BOT"
read -rsp "Paste the bot's personal access token (input hidden): " TOKEN; echo
as_bot() { GH_TOKEN="$TOKEN" gh "$@"; }

LOGIN="$(as_bot api user -q .login)"
[ "$LOGIN" = "$BOT" ] || { echo "✖ That token belongs to '$LOGIN', not '$BOT'."; exit 1; }
BOT_ID="$(as_bot api user -q .id)"

# Give the bot write access (not admin): invite as you, accept as the bot.
if [ "$(as_bot api "repos/$REPO" -q .permissions.push 2>/dev/null || echo false)" != "true" ]; then
  echo "Inviting $BOT as a collaborator with write access…"
  as_owner api -X PUT "repos/$REPO/collaborators/$BOT" -f permission=push >/dev/null
  INVITE_ID="$(as_bot api user/repository_invitations \
    -q ".[] | select(.repository.full_name == \"$REPO\") | .id" | head -n1)"
  if [ -n "$INVITE_ID" ]; then
    as_bot api -X PATCH "user/repository_invitations/$INVITE_ID" >/dev/null
    echo "Invitation accepted as $BOT."
  fi
fi
[ "$(as_bot api "repos/$REPO" -q .permissions.push)" = "true" ] || { echo "✖ $BOT still has no write access."; exit 1; }
[ "$(as_bot api "repos/$REPO" -q .permissions.admin)" = "false" ] || echo "⚠ $BOT has admin access; write is enough."

# Claude Code sessions in this repo act as the bot: gh and git (via gh's credential helper)
# use GH_TOKEN, and commits are authored by the bot's noreply address.
EMAIL="${BOT_ID}+${BOT}@users.noreply.github.com"
mkdir -p "$ROOT/.claude"
[ -s "$SETTINGS" ] || echo '{}' > "$SETTINGS"
TMP="$(mktemp)"
jq --arg t "$TOKEN" --arg n "$BOT" --arg e "$EMAIL" \
  '.env = ((.env // {}) + {GH_TOKEN: $t, GIT_AUTHOR_NAME: $n, GIT_AUTHOR_EMAIL: $e, GIT_COMMITTER_NAME: $n, GIT_COMMITTER_EMAIL: $e})' \
  "$SETTINGS" > "$TMP"
mv "$TMP" "$SETTINGS"
chmod 600 "$SETTINGS"

echo
echo "✔ Done. Start a new Claude Code session in this repo: its commits and PRs will come from $BOT,"
echo "  and PRs will request your review ($OWNER). Your own terminal still uses $OWNER."
echo "  Rotate the token when it expires by running this script again."

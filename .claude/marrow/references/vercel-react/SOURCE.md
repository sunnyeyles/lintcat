# Vercel React best practices

`rules/` is copied from the `react-best-practices` skill in [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices) at commit `063bee9` (skill version 1.0.0, MIT per its frontmatter, by Vercel Engineering). `_template.md` was left out.

`marrow-review-ui` carries the skill's rule index in its prompt and reads a rule file here before citing it. It is a folder, not a skill, so it never claims `~/.claude/skills/vercel-react-best-practices`.

To update: copy `skills/react-best-practices/rules/` from a newer commit over `rules/`, refresh the index in `agents/marrow-review-ui.md` from that commit's `SKILL.md`, and change the commit above.

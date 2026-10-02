export type FaqItem = { question: string; answer: string };

export const HOME_FAQ: FaqItem[] = [
  {
    question: "What is LintCat?",
    answer:
      "An AI code reviewer. It reviews every pull request against the rest of your repository and leaves inline comments, and gives your coding agent the same review over MCP.",
  },
  {
    question: "Do I need to change my CI?",
    answer:
      "No. Install the GitHub App and add a model key. Reviews run on LintCat's side, so your repository gets no workflow file and your Actions minutes go untouched.",
  },
  {
    question: "Who pays for the model usage?",
    answer:
      "You do, through your own provider account. An owner saves one Anthropic or OpenAI API key on the dashboard, and reviews run on that key.",
  },
  {
    question: "Can LintCat block or merge my pull requests?",
    answer:
      "No. The AI PR Review check is advisory, and the AI reviewer can only read your code. It never approves, merges or blocks anything.",
  },
];

export const DOCS_FAQ: FaqItem[] = [
  {
    question: "Which repositories does LintCat review?",
    answer:
      "Only the ones you pick when you install the GitHub App, on your personal account or an organization.",
  },
  {
    question: "When does a review run?",
    answer:
      "By default when a pull request is opened, and again on every push. A repository can instead be reviewed only on the ai-review label, or turned off, from its settings page.",
  },
  {
    question: "Can I review changes before I push?",
    answer:
      "Yes. The MCP server runs the same reviewer inside a coding agent such as Claude Code, over your local working tree.",
  },
];

export const SECURITY_FAQ: FaqItem[] = [
  {
    question: "Does my model provider see my code?",
    answer:
      "Yes, the code it reviews. Reviews run on your account's own Anthropic or OpenAI key, under your agreement with that provider.",
  },
  {
    question: "How is my API key stored?",
    answer:
      "Encrypted. Only the review service reads it back; the dashboard shows its last four characters and nothing more.",
  },
  {
    question: "Can text in a pull request steer the reviewer?",
    answer:
      "No. LintCat treats everything in the repository as code to review, never as instructions, and the reviewer can only read.",
  },
];

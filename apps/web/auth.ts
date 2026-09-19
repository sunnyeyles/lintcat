import { db } from "@pr-review/db";
import NextAuth from "next-auth";
import GitHub, { type GitHubProfile } from "next-auth/providers/github";

import { upsertGithubUser } from "@/lib/users";

declare module "next-auth" {
  interface Session {
    githubId?: number;
    login?: string;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  callbacks: {
    // `profile` is set only on the sign-in pass; that is when the row is mirrored.
    async jwt({ token, profile }) {
      if (!profile) return token;
      const user = await upsertGithubUser(
        db(),
        profile as unknown as GitHubProfile,
      );
      return { ...token, githubId: user.githubId, login: user.login };
    },
    session({ session, token }) {
      return {
        ...session,
        githubId: typeof token.githubId === "number" ? token.githubId : undefined,
        login: typeof token.login === "string" ? token.login : undefined,
      };
    },
  },
});

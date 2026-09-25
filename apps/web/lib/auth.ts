import NextAuth from "next-auth";
import GitHub, { type GitHubProfile } from "next-auth/providers/github";

import { appDomain, sessionCookieDomain } from "@/lib/host";
import { authRedirect, SIGN_IN_PATH } from "@/lib/paths";
import { signInUser } from "@/lib/sign-in";

declare module "next-auth" {
  interface Session {
    githubId?: number;
    login?: string;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  pages: { signIn: SIGN_IN_PATH, error: SIGN_IN_PATH },
  // Scoped to the app domain so one sign-in on the apex covers every organization subdomain.
  cookies: { sessionToken: { options: { domain: sessionCookieDomain(appDomain()) } } },
  callbacks: {
    redirect({ url, baseUrl }) {
      return authRedirect(url, baseUrl, appDomain());
    },
    // `profile` is set only on the sign-in pass; that is when the row is mirrored.
    async jwt({ token, profile }) {
      if (!profile) return token;
      const user = await signInUser(profile as unknown as GitHubProfile);
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

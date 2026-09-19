import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

export interface InstallationRepository {
  id: number;
  owner: string;
  name: string;
  private: boolean;
}

/** What the dashboard asks GitHub as the App; tests pass a fake. */
export interface GithubAppClient {
  listInstallationRepositories(
    installationId: number,
  ): Promise<InstallationRepository[]>;
}

export interface GithubAppConfig {
  appId: string;
  /** The App's PEM private key. */
  privateKey: string;
}

const repositoriesSchema = z.array(
  z.object({
    id: z.number(),
    name: z.string(),
    private: z.boolean(),
    owner: z.object({ login: z.string() }),
  }),
);

/** Signs a JWT as the App and exchanges it for a short-lived installation token per call. */
export function createGithubAppClient(config: GithubAppConfig): GithubAppClient {
  return {
    async listInstallationRepositories(installationId) {
      const octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.appId,
          privateKey: config.privateKey,
          installationId,
        },
      });
      const data = await octokit.paginate(
        octokit.rest.apps.listReposAccessibleToInstallation,
        { per_page: 100 },
      );
      return repositoriesSchema.parse(data).map((repo) => ({
        id: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        private: repo.private,
      }));
    },
  };
}

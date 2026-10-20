import type {
  GithubAppClient,
  PullRequestReadClient,
  RepositoryHistoryClient,
  ReviewPublishClient,
} from "@pr-review/github";

export type HostedClient = PullRequestReadClient & RepositoryHistoryClient & ReviewPublishClient;

// Installation tokens expire after an hour; refreshing at 50 leaves room for a slow call.
const TOKEN_REFRESH_MS = 50 * 60_000;

interface JobClientDeps {
  github: Pick<GithubAppClient, "createInstallationToken">;
  createClient: (token: string) => HostedClient;
  now: () => number;
}

// Each call first re-mints a token 50 minutes old; every token minted is pushed onto `secrets`.
export async function createJobClient(
  { github, createClient, now }: JobClientDeps,
  installationId: number,
  secrets: (string | undefined)[],
): Promise<HostedClient> {
  let current: { client: HostedClient; mintedAt: number } | undefined;
  let refreshing: Promise<HostedClient> | undefined;
  const mint = async (): Promise<HostedClient> => {
    const mintedAt = now();
    const token = await github.createInstallationToken(installationId);
    secrets.push(token);
    current = { client: createClient(token), mintedAt };
    return current.client;
  };
  const fresh = (): Promise<HostedClient> => {
    if (current && now() - current.mintedAt < TOKEN_REFRESH_MS) return Promise.resolve(current.client);
    refreshing ??= mint().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  };

  const first = await fresh();
  return new Proxy(first, {
    get(_target, prop) {
      const value = Reflect.get(current!.client, prop) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const client = await fresh();
        return (Reflect.get(client, prop) as (...a: unknown[]) => unknown).apply(client, args);
      };
    },
  });
}

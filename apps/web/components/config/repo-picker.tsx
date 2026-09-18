"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";

export type RepoOption = { id: number; owner: string; name: string };

export type RepoPickerProps = {
  repos: RepoOption[];
  selectedId: number;
};

export function RepoPicker({ repos, selectedId }: RepoPickerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-[22rem]">
      <Label htmlFor="config-repo">Repository</Label>
      <Select
        value={String(selectedId)}
        disabled={pending}
        onValueChange={(value) => {
          startTransition(() => {
            router.push(`/settings/agents?repo=${value}`);
          });
        }}
      >
        <SelectTrigger id="config-repo" aria-busy={pending}>
          <SelectValue placeholder="Choose a repository" />
        </SelectTrigger>
        <SelectContent>
          {repos.map((repo) => (
            <SelectItem key={repo.id} value={String(repo.id)}>
              {repo.owner}/{repo.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

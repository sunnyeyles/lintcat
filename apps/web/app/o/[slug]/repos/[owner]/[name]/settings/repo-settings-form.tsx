"use client";

import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@pr-review/design";
import { useActionState, useId } from "react";

import { SubmitButton } from "@/components/ui/submit-button";
import type { RepoSettingsFormState } from "@/lib/repo-settings";

import { saveRepoSettingsAction } from "./actions";

export type RepoSettingsFormProps = {
  slug: string;
  owner: string;
  name: string;
  isOwner: boolean;
  modes: { value: string; label: string }[];
  models: { value: string; label: string }[];
  current: { mode: string; model: string; fixes: boolean };
};

const IDLE: RepoSettingsFormState = { status: "idle" };

export function RepoSettingsForm({
  slug,
  owner,
  name,
  isOwner,
  modes,
  models,
  current,
}: RepoSettingsFormProps) {
  const [state, formAction] = useActionState(
    saveRepoSettingsAction.bind(null, slug, owner, name),
    IDLE,
  );
  const fixesId = useId();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hosted reviews</CardTitle>
        <CardDescription>
          {isOwner
            ? "Choose when this repository is reviewed, which model runs it, and whether verified fixes are committed."
            : "Only a repository owner can change these settings."}
        </CardDescription>
      </CardHeader>

      <form action={formAction}>
        <fieldset disabled={!isOwner} className="contents">
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="repo-settings-mode">When reviews run</Label>
              <Select name="mode" defaultValue={current.mode}>
                <SelectTrigger id="repo-settings-mode" className="w-full sm:w-72">
                  <SelectValue placeholder="Choose a mode" />
                </SelectTrigger>
                <SelectContent>
                  {modes.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="repo-settings-model">Model</Label>
              <Select name="model" defaultValue={current.model}>
                <SelectTrigger id="repo-settings-model" className="w-full sm:w-72">
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label htmlFor={fixesId}>Commit verified fixes</Label>
                <p className="text-muted-foreground text-xs">
                  Off offers them as suggested changes instead, under the same limits.
                </p>
              </div>
              <Switch
                id={fixesId}
                name="fixes"
                value="on"
                defaultChecked={current.fixes}
              />
            </div>

            {state.status === "error" && (
              <Alert variant="destructive">
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            )}
            <p role="status" className="text-muted-foreground text-sm empty:hidden">
              {state.status === "saved" ? "Saved." : ""}
            </p>
          </CardContent>
          {isOwner && (
            <CardFooter className="mt-5">
              <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
            </CardFooter>
          )}
        </fieldset>
      </form>
    </Card>
  );
}

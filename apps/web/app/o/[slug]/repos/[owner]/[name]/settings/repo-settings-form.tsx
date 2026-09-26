"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Label,
  Switch,
} from "@pr-review/design";
import { useActionState, useId } from "react";

import { FormStatus } from "@/components/ui/form-status";
import { SelectField } from "@/components/ui/select-field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { Option } from "@/lib/forms";
import type { RepoSettingsFormState } from "@/lib/repo-settings";

import { saveRepoSettingsAction } from "./actions";

export type RepoSettingsFormProps = {
  slug: string;
  owner: string;
  name: string;
  isOwner: boolean;
  modes: Option[];
  models: Option[];
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
            <SelectField
              id="repo-settings-mode"
              name="mode"
              label="When reviews run"
              options={modes}
              defaultValue={current.mode}
              placeholder="Choose a mode"
              triggerClassName="sm:w-72"
            />

            <SelectField
              id="repo-settings-model"
              name="model"
              label="Model"
              options={models}
              defaultValue={current.model}
              placeholder="Choose a model"
              triggerClassName="sm:w-72"
            />

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

            <FormStatus
              error={state.status === "error" ? state.message : undefined}
              message={state.status === "saved" ? "Saved." : ""}
            />
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

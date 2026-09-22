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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from "@pr-review/design";
import { KeyRound } from "lucide-react";
import { useActionState } from "react";

import { SubmitButton } from "@/components/ui/submit-button";
import type { ModelKeyFormState } from "@/lib/model-key";

import { removeModelKeyAction, saveModelKeyAction } from "./actions";

export type ModelKeyFormProps = {
  slug: string;
  providers: { value: string; label: string }[];
  /** What is saved now; only the last four characters of the key ever reach the browser. */
  current:
    | { provider: string; providerLabel: string; last4: string; updated: string }
    | undefined;
};

const IDLE: ModelKeyFormState = { status: "idle" };

export function ModelKeyForm({ slug, providers, current }: ModelKeyFormProps) {
  const [saved, save] = useActionState(saveModelKeyAction.bind(null, slug), IDLE);
  const [removed, remove] = useActionState(removeModelKeyAction.bind(null, slug), IDLE);
  const error = [saved, removed].find((state) => state.status === "error");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{current ? "Replace the model key" : "Add a model key"}</CardTitle>
        <CardDescription>
          {current ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <KeyRound aria-hidden className="size-4" />
              {current.providerLabel} key ending in{" "}
              <code className="font-mono">{`••••${current.last4}`}</code>, updated {current.updated}.
            </span>
          ) : (
            "No key is saved. Until one is, a labelled pull request gets a neutral check run asking for a key, and no model is called."
          )}
        </CardDescription>
      </CardHeader>

      <form action={save}>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="model-key-provider">Provider</Label>
            <Select name="provider" defaultValue={current?.provider ?? providers[0]?.value}>
              <SelectTrigger id="model-key-provider" className="w-full sm:w-64">
                <SelectValue placeholder="Choose a provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.value} value={provider.value}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="model-key-api-key">API key</Label>
            <Input
              id="model-key-api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              placeholder={current ? "Paste a new key to replace the saved one" : "Paste the key"}
            />
            <p className="text-muted-foreground text-xs">
              Stored encrypted. It is never shown again, here or anywhere else.
            </p>
          </div>
          {error?.status === "error" && (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          <p role="status" className="text-muted-foreground text-sm empty:hidden">
            {saved.status === "saved" && current?.last4 === saved.last4
              ? `Saved. Reviews now use the key ending in ${saved.last4}.`
              : removed.status === "removed" && !current
                ? "Removed. Labelled pull requests will ask for a key again."
                : ""}
          </p>
        </CardContent>
        <CardFooter className="mt-5">
          <SubmitButton pendingLabel="Saving…">
            {current ? "Replace key" : "Save key"}
          </SubmitButton>
        </CardFooter>
      </form>

      {current && (
        <form action={remove}>
          <Separator />
          <CardFooter className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <p className="text-muted-foreground text-sm">
              Removing the key stops hosted reviews until a new one is added.
            </p>
            <SubmitButton variant="outline" pendingLabel="Removing…">
              Remove key
            </SubmitButton>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}

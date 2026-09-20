"use client";

import { Button } from "@pr-review/design";
import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

export type SubmitButtonProps = Omit<ComponentProps<typeof Button>, "type"> & {
  pendingLabel?: string;
};

export function SubmitButton({ pendingLabel, children, disabled, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending ? (
        <>
          <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

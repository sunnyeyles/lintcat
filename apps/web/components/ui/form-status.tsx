import { Alert, AlertDescription } from "@pr-review/design";

// The status line always renders, so its live region exists before the first message.
export function FormStatus({ error, message }: { error?: string; message: string }) {
  return (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <p role="status" className="text-muted-foreground text-sm empty:hidden">
        {message}
      </p>
    </>
  );
}

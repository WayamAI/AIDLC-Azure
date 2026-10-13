import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiErrorMessage } from "@/lib/api-error";

const CONNECTORS = /(Settings\s*(?:→|->|>)\s*Connectors)/;

/**
 * Server messages name "Settings → Connectors" when an integration is missing.
 * This turns that phrase into a link, so the fix is one click from the error.
 */
export function withConnectorsLink(text: string): ReactNode {
  const parts = text.split(CONNECTORS);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    CONNECTORS.test(part) ? (
      <Link key={index} to="/settings/connectors" className="font-medium underline underline-offset-2 hover:no-underline">
        Settings → Connectors
      </Link>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/** A failed request as readable text, with the Connectors page linked when the message points to it. */
export function ErrorText({ error, fallback }: { error: unknown; fallback?: string }) {
  return <>{withConnectorsLink(typeof error === "string" ? error : apiErrorMessage(error, fallback))}</>;
}

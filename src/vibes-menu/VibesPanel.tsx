import React, { useState, useEffect, useId } from "react";
import { VibesButton, BLUE, RED, YELLOW, GRAY } from "./VibesButton/index.js";
import { runtimeFn } from "@fireproof/core-runtime";
import { BrutalistCard } from "./BrutalistCard.js";
import { generateFreshDataUrl, generateRemixUrl } from "../../utils/appSlug.js";
import { LabelContainer } from "./LabelContainer/index.js";
import {
  getOuterContainerStyle,
  getButtonContainerStyle,
  getInviteFormStyle,
  getInviteLabelStyle,
  getInviteInputWrapperStyle,
  getInviteInputStyle,
  getInviteStatusStyle,
} from "./VibesPanel.styles.js";

export interface VibesPanelProps {
  /** Optional custom styling for the panel container */
  style?: React.CSSProperties;
  /** Optional className for the panel container */
  className?: string;
  /** Optional base URL for vibes platform (defaults to current origin or vibes.diy) */
  baseURL?: string;
  /** Authentication token for sharing functionality */
  token?: string;
}

/**
 * VibesPanel - Standard panel with Login, Remix, and Invite buttons
 *
 * This component provides the standard three-button layout used
 * throughout the Vibes DIY platform for authentication and actions.
 */
type PanelMode = "default" | "mutate" | "invite";

export function VibesPanel({
  style,
  className,
  baseURL,
  token,
}: VibesPanelProps = {}) {
  const emailId = useId();
  const [mode, setMode] = useState<PanelMode>("default");
  const [email, setEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [inviteMessage, setInviteMessage] = useState("");

  // Safe browser check for base URL
  const defaultBaseURL = runtimeFn().isBrowser
    ? window.location.origin
    : "https://vibes.diy";
  const effectiveBaseURL = baseURL ?? defaultBaseURL;

  const handleMutateClick = () => {
    if (mode === "default") {
      setMode("mutate");
    }
  };

  const handleInviteClick = () => {
    if (mode === "default") {
      setMode("invite");
      setEmail("");
      setInviteStatus("idle");
      setInviteMessage("");
    }
  };

  const handleBackClick = () => {
    setMode("default");
  };

  const handleFreshDataClick = () => {
    window.open(generateFreshDataUrl(effectiveBaseURL), "_top");
  };

  const handleChangeCodeClick = () => {
    window.open(generateRemixUrl(effectiveBaseURL), "_top");
  };

  const handleLogoutClick = () => {
    document.dispatchEvent(new CustomEvent("vibes-sync-disable"));
    document.dispatchEvent(new CustomEvent("vibes-logout-request"));
  };

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setInviteStatus("sending");
    setInviteMessage("");

    // Dispatch share request event
    document.dispatchEvent(
      new CustomEvent("vibes-share-request", {
        detail: {
          email: email.trim(),
          role: "member",
          right: "read",
          token,
        },
      }),
    );
  };

  // Listen for share response events
  useEffect(() => {
    const handleShareSuccess = (event: Event) => {
      const customEvent = event as CustomEvent<{
        email: string;
        message?: string;
      }>;
      setInviteStatus("success");
      setInviteMessage(
        customEvent.detail?.message ||
          `Invitation sent to ${customEvent.detail?.email}!`,
      );
    };

    const handleShareError = (event: Event) => {
      const customEvent = event as CustomEvent<{ error: { message: string } }>;
      setInviteStatus("error");
      setInviteMessage(
        customEvent.detail?.error?.message ||
          "Failed to send invitation. Please try again.",
      );
    };

    document.addEventListener("vibes-share-success", handleShareSuccess);
    document.addEventListener("vibes-share-error", handleShareError);

    return () => {
      document.removeEventListener("vibes-share-success", handleShareSuccess);
      document.removeEventListener("vibes-share-error", handleShareError);
    };
  }, []);

  return (
    <div style={getOuterContainerStyle(style)} className={className}>
      <LabelContainer label="Settings" disappear>
        <div style={getButtonContainerStyle()}>
          {mode === "mutate" ? (
            // Mutate mode buttons
            <>
              <VibesButton variant={BLUE} onClick={handleFreshDataClick}>
                Fresh Start
              </VibesButton>
              <VibesButton
                variant={RED}
                onClick={handleChangeCodeClick}
                icon="remix"
              >
                Remix Code
              </VibesButton>
              <VibesButton
                variant={YELLOW}
                onClick={handleBackClick}
                icon="back"
              >
                Back
              </VibesButton>
            </>
          ) : mode === "invite" ? (
            // Invite mode form
            <>
              {inviteStatus === "idle" ? (
                // Show form when idle
                <form
                  onSubmit={handleInviteSubmit}
                  style={getInviteFormStyle()}
                >
                  <label htmlFor={emailId} style={getInviteLabelStyle()}>
                    Invite by email
                  </label>
                  <BrutalistCard size="md" style={getInviteInputWrapperStyle()}>
                    <input
                      id={emailId}
                      type="email"
                      placeholder="friend@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      style={getInviteInputStyle()}
                      autoComplete="email"
                      required
                    />
                  </BrutalistCard>
                  <VibesButton
                    variant={BLUE}
                    type="submit"
                    disabled={!email.trim()}
                  >
                    Send Invite
                  </VibesButton>
                </form>
              ) : (
                // Show status when sending/complete
                <BrutalistCard
                  id="invite-status"
                  role="status"
                  aria-live="polite"
                  size="sm"
                  variant={
                    inviteStatus === "sending"
                      ? "default"
                      : inviteStatus === "error"
                        ? "error"
                        : "success"
                  }
                  style={getInviteStatusStyle()}
                >
                  {inviteStatus === "sending" ? "Inviting..." : inviteMessage}
                </BrutalistCard>
              )}
              <VibesButton
                variant={YELLOW}
                onClick={handleBackClick}
                icon="back"
              >
                Back
              </VibesButton>
            </>
          ) : (
            // Default buttons
            <>
              <VibesButton
                variant={BLUE}
                onClick={handleLogoutClick}
                icon="login"
              >
                Logout
              </VibesButton>
              <VibesButton
                variant={RED}
                onClick={handleMutateClick}
                icon="remix"
              >
                Remix
              </VibesButton>
              <VibesButton
                variant={YELLOW}
                onClick={handleInviteClick}
                icon="invite"
              >
                Invite
              </VibesButton>
              <VibesButton variant={GRAY} icon="settings">
                Settings
              </VibesButton>
            </>
          )}
        </div>
      </LabelContainer>
    </div>
  );
}

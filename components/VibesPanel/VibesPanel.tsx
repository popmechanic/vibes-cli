import React, { useState, useEffect, useId } from "react";
import { VibesButton, BLUE, YELLOW, GRAY } from "../VibesButton/VibesButton.js";
import { BrutalistCard } from "../BrutalistCard/index.js";
import { LabelContainer } from "../LabelContainer/index.js";
import {
  getOuterContainerStyle,
  getButtonContainerStyle,
  getInviteFormStyle,
  getInviteLabelStyle,
  getInviteInputStyle,
  getInviteStatusStyle,
  getInviteRowStyle,
} from "./VibesPanel.styles.js";
import { useIsMobile } from "../hooks/useIsMobile.js";

export interface VibesPanelProps {
  style?: React.CSSProperties;
  className?: string;
  token?: string;
}

type PanelMode = "default" | "invite" | "public-link";

export function VibesPanel({
  style,
  className,
  token,
}: VibesPanelProps = {}) {
  const emailId = useId();
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<PanelMode>("default");
  const [email, setEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [publicLink, setPublicLink] = useState("");
  const [publicLinkStatus, setPublicLinkStatus] = useState<
    "idle" | "generating" | "success" | "error"
  >("idle");
  const [publicLinkMessage, setPublicLinkMessage] = useState("");
  const [publicLinkCopied, setPublicLinkCopied] = useState(false);

  const handleInviteClick = () => {
    if (mode === "default") {
      setMode("invite");
      setEmail("");
      setInviteStatus("idle");
      setInviteMessage("");
      setInviteLink("");
      setLinkCopied(false);
    }
  };

  const handleBackClick = () => {
    setMode("default");
  };

  const handlePublicLinkClick = () => {
    setMode("public-link");
    setPublicLinkStatus("generating");
    setPublicLink("");
    setPublicLinkMessage("");
    setPublicLinkCopied(false);

    document.dispatchEvent(
      new CustomEvent("vibes-public-link-request", {
        detail: { right: "write" },
      }),
    );
  };

  const handleCopyPublicLink = () => {
    if (publicLink) {
      navigator.clipboard.writeText(publicLink).then(() => {
        setPublicLinkCopied(true);
        setTimeout(() => setPublicLinkCopied(false), 2000);
      });
    }
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

    document.dispatchEvent(
      new CustomEvent("vibes-share-request", {
        detail: {
          email: email.trim(),
          role: "member",
          right: "write",
          token,
        },
      }),
    );
  };

  useEffect(() => {
    const handleShareSuccess = (event: Event) => {
      const customEvent = event as CustomEvent<{
        email: string;
        message?: string;
        link?: string;
      }>;
      setInviteStatus("success");
      setInviteMessage(
        customEvent.detail?.message ||
          `Invitation sent to ${customEvent.detail?.email}!`,
      );
      if (customEvent.detail?.link) {
        setInviteLink(customEvent.detail.link);
      }
    };

    const handleShareError = (event: Event) => {
      const customEvent = event as CustomEvent<{ error: { message: string } }>;
      setInviteStatus("error");
      setInviteMessage(
        customEvent.detail?.error?.message ||
          "Failed to send invitation. Please try again.",
      );
    };

    const handlePublicLinkSuccess = (event: Event) => {
      const customEvent = event as CustomEvent<{ link: string }>;
      setPublicLinkStatus("success");
      setPublicLink(customEvent.detail?.link || "");
      setPublicLinkMessage("Public link generated!");
    };

    const handlePublicLinkError = (event: Event) => {
      const customEvent = event as CustomEvent<{ error: string }>;
      setPublicLinkStatus("error");
      setPublicLinkMessage(
        customEvent.detail?.error || "Failed to generate public link.",
      );
    };

    document.addEventListener("vibes-share-success", handleShareSuccess);
    document.addEventListener("vibes-share-error", handleShareError);
    document.addEventListener("vibes-public-link-success", handlePublicLinkSuccess);
    document.addEventListener("vibes-public-link-error", handlePublicLinkError);

    return () => {
      document.removeEventListener("vibes-share-success", handleShareSuccess);
      document.removeEventListener("vibes-share-error", handleShareError);
      document.removeEventListener("vibes-public-link-success", handlePublicLinkSuccess);
      document.removeEventListener("vibes-public-link-error", handlePublicLinkError);
    };
  }, []);

  const handleCopyLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink).then(() => {
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      });
    }
  };

  return (
    <div style={getOuterContainerStyle(style)} className={className}>
      <LabelContainer
        label="Launcher"
        disappear
      >
        <div
          key={mode}
          className={mode === "default" ? "vibes-panel-stagger" : undefined}
          style={getButtonContainerStyle(isMobile)}
        >
          {mode === "public-link" ? (
            <div className="vibes-panel-stagger" style={getInviteRowStyle(isMobile)}>
              <VibesButton
                variant={YELLOW}
                onClick={() => {}}
                icon="invite"
              >
                Share
              </VibesButton>
              <BrutalistCard
                id="public-link-status"
                role="status"
                aria-live="polite"
                size="sm"
                variant={
                  publicLinkStatus === "generating"
                    ? "default"
                    : publicLinkStatus === "error"
                      ? "error"
                      : "success"
                }
                style={getInviteStatusStyle()}
              >
                {publicLinkStatus === "generating" ? "Generating link..." : (
                  <>
                    <div>{publicLinkMessage}</div>
                    {publicLink && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <button onClick={handleCopyPublicLink} style={{
                          background: 'none', border: '2px solid currentColor', borderRadius: '6px',
                          padding: '0.25rem 0.75rem', cursor: 'pointer', color: 'inherit',
                          fontWeight: 600, fontSize: '0.85em'
                        }}>
                          {publicLinkCopied ? 'Copied!' : 'Copy Share Link'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </BrutalistCard>
              <VibesButton variant={GRAY} onClick={handleBackClick} icon="back">
                Back
              </VibesButton>
            </div>
          ) : mode === "invite" ? (
            <div className="vibes-panel-stagger" style={getInviteRowStyle(isMobile)}>
              <VibesButton
                variant={YELLOW}
                onClick={() => {}}
                icon="invite"
              >
                Invite
              </VibesButton>
              {inviteStatus === "idle" ? (
                <form
                  onSubmit={handleInviteSubmit}
                  style={getInviteFormStyle(isMobile)}
                >
                  <label htmlFor={emailId} style={getInviteLabelStyle()}>
                    Invite by email
                  </label>
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
                  <VibesButton
                    variant={YELLOW}
                    type="submit"
                    disabled={!email.trim()}
                  >
                    Submit
                  </VibesButton>
                </form>
              ) : (
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
                  {inviteStatus === "sending" ? "Inviting..." : (
                    <>
                      <div>{inviteMessage}</div>
                      {inviteLink && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <button onClick={handleCopyLink} style={{
                            background: 'none', border: '2px solid currentColor', borderRadius: '6px',
                            padding: '0.25rem 0.75rem', cursor: 'pointer', color: 'inherit',
                            fontWeight: 600, fontSize: '0.85em'
                          }}>
                            {linkCopied ? 'Copied!' : 'Copy Invite Link'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </BrutalistCard>
              )}
              <VibesButton variant={GRAY} onClick={handleBackClick} icon="back">
                Back
              </VibesButton>
            </div>
          ) : (
            <>
              <VibesButton
                variant={BLUE}
                onClick={handleLogoutClick}
                icon="login"
              >
                Logout
              </VibesButton>
              <VibesButton
                variant={YELLOW}
                onClick={handleInviteClick}
                icon="invite"
              >
                Invite
              </VibesButton>
              <VibesButton
                variant={YELLOW}
                onClick={handlePublicLinkClick}
                icon="invite"
              >
                Share Link
              </VibesButton>
            </>
          )}
        </div>
      </LabelContainer>
    </div>
  );
}

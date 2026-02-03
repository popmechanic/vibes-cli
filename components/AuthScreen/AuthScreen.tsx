import { useState, useEffect, ReactNode } from "react";
import {
  getScreenContainerStyle,
  getOverlayStyle,
  getBlackBorderWrapperStyle,
  getContainerStyle,
  getBackgroundStyle,
  getCardIconStyle,
  getAuthContentStyle,
  getTitleStyle,
  getMessageStyle,
  getErrorDetailsStyle,
  getButtonsContainerStyle,
  getAnimationStyles,
} from "./AuthScreen.styles.js";

// Card images served from deployed assets
const CARD_URLS = [
  "/cards/card-1.png",
  "/cards/card-2.png",
  "/cards/card-3.png",
  "/cards/card-4.png",
];

export interface AuthScreenProps {
  /** Content to render (buttons, forms, etc.) */
  children: ReactNode;
  /** Optional title text */
  title?: string;
  /** Optional message/description */
  message?: string;
  /** Show animated card image (default: true) */
  showCard?: boolean;
  /** Trigger shredding animation */
  isShredding?: boolean;
  /** Use error styling (red accents) */
  isError?: boolean;
  /** Technical error details (shown in expandable section) */
  errorDetails?: string;
}

export const AuthScreen = ({
  children,
  title,
  message,
  showCard = true,
  isShredding = false,
  isError = false,
  errorDetails,
}: AuthScreenProps) => {
  const [selectedCard, setSelectedCard] = useState(CARD_URLS[0]);
  const [cardLoaded, setCardLoaded] = useState(false);
  const [cardError, setCardError] = useState(false);

  // Select random card on mount
  useEffect(() => {
    const randomIndex = Math.floor(Math.random() * CARD_URLS.length);
    setSelectedCard(CARD_URLS[randomIndex]);
  }, []);

  return (
    <>
      <style>{getAnimationStyles()}</style>
      <div style={getScreenContainerStyle()}>
        <div style={getOverlayStyle()} />
        <div style={getBlackBorderWrapperStyle()}>
          <div style={getBackgroundStyle(isShredding, isError)} />
          <div style={getContainerStyle()}>
            {/* Card image (optional) */}
            {showCard && !cardError && (
              <div style={getCardIconStyle(isShredding)}>
                <img
                  src={selectedCard}
                  alt="Vibes Card"
                  style={{
                    display: cardLoaded ? "block" : "none",
                    width: "200px",
                    height: "auto",
                  }}
                  onLoad={() => setCardLoaded(true)}
                  onError={() => setCardError(true)}
                />
              </div>
            )}

            {/* Content area */}
            <div style={getAuthContentStyle()}>
              {title && <h1 style={getTitleStyle(isError)}>{title}</h1>}
              {message && <p style={getMessageStyle(isError)}>{message}</p>}

              {errorDetails && (
                <details style={{ width: "100%" }}>
                  <summary style={{ cursor: "pointer", fontSize: "0.875rem", color: "#7f1d1d" }}>
                    Technical details
                  </summary>
                  <pre style={getErrorDetailsStyle()}>{errorDetails}</pre>
                </details>
              )}
            </div>

            {/* Buttons/actions */}
            <div style={getButtonsContainerStyle()}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

import { CSSProperties } from "react";

// Full-screen container that covers the viewport
export const getScreenContainerStyle = (): CSSProperties => ({
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000,
  overflow: "hidden",
});

// Semi-transparent dark overlay behind the content
export const getOverlayStyle = (): CSSProperties => ({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  zIndex: 0,
});

// Beige wrapper with grid pattern and black border
export const getBlackBorderWrapperStyle = (): CSSProperties => ({
  position: "relative",
  width: "90%",
  maxWidth: "550px",
  backgroundImage: `
    linear-gradient(to right, rgba(0, 0, 0, 0.1) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(0, 0, 0, 0.1) 1px, transparent 1px)
  `,
  backgroundSize: "40px 40px",
  backgroundColor: "#e8e4df",
  border: "3px solid #1a1a1a",
  borderRadius: "12px",
  zIndex: 1,
  overflow: "hidden",
});

// Inner container for content layout
export const getContainerStyle = (): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  alignItems: "center",
  minHeight: "500px",
  width: "100%",
  gap: "2rem",
  padding: "3rem 0rem",
  position: "relative",
});

// Gray background panel behind content (collapses on shred)
export const getBackgroundStyle = (isShredding: boolean, isError: boolean): CSSProperties => ({
  position: "absolute",
  top: "1.5rem",
  left: "1.5rem",
  right: "1.5rem",
  bottom: "1.5rem",
  backgroundColor: isError ? "var(--vibes-red-accent, #ef4444)" : "var(--vibes-gray-lighter, #c4c4c4)",
  border: "1px solid black",
  borderRadius: "8px",
  zIndex: 0,
  transformOrigin: "center center",
  animation: isShredding ? "collapseToLine 1.2s ease-in-out forwards" : "none",
  pointerEvents: "none",
});

// Card image container (animated on shred)
export const getCardIconStyle = (isShredding: boolean): CSSProperties => ({
  marginBottom: "1rem",
  animation: isShredding ? "shredCard 0.9s ease-in forwards" : "none",
  position: "relative",
  zIndex: 1,
});

// Content wrapper (title, message, buttons)
export const getAuthContentStyle = (): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: "1rem",
  width: "100%",
  maxWidth: "400px",
  padding: "0 1.5rem",
  position: "relative",
  zIndex: 1,
});

// Title styling
export const getTitleStyle = (isError: boolean): CSSProperties => ({
  fontSize: "1.75rem",
  fontWeight: "bold",
  color: isError ? "#991b1b" : "#1a1a1a",
  margin: 0,
  lineHeight: 1.2,
});

// Message/description text
export const getMessageStyle = (isError: boolean): CSSProperties => ({
  fontSize: "1rem",
  color: isError ? "#7f1d1d" : "#555555",
  margin: 0,
  lineHeight: 1.5,
});

// Error details (for technical info)
export const getErrorDetailsStyle = (): CSSProperties => ({
  marginTop: "0.5rem",
  padding: "0.75rem",
  backgroundColor: "rgba(127, 29, 29, 0.1)",
  border: "1px solid rgba(127, 29, 29, 0.3)",
  borderRadius: "6px",
  fontSize: "0.75rem",
  color: "#7f1d1d",
  fontFamily: "monospace",
  maxWidth: "100%",
  overflow: "auto",
  textAlign: "left",
});

// Buttons container
export const getButtonsContainerStyle = (): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  width: "100%",
  maxWidth: "300px",
  position: "relative",
  zIndex: 1,
  marginTop: "0.5rem",
});

// Keyframe animations (injected via <style> tag)
export const getAnimationStyles = (): string => `
  @keyframes shredCard {
    0% {
      clip-path: inset(0 0 0% 0);
      transform: translateY(0);
    }
    45% {
      clip-path: inset(0 0 0% 0);
      transform: translateY(0);
    }
    80% {
      clip-path: inset(0 0 100% 0);
      transform: translateY(310px);
    }
    100% {
      clip-path: inset(0 0 100% 0);
      transform: translateY(310px);
    }
  }

  @keyframes collapseToLine {
    0% {
      transform: scale(1);
      border-radius: 8px;
    }
    40% {
      transform: scaleX(0.05) scaleY(0.01);
      border-radius: 50%;
      background-color: black;
    }
    45% {
      transform: scaleX(0.05) scaleY(0.01);
      border-radius: 50%;
      background-color: black;
    }
    65% {
      transform: scaleX(0.6) scaleY(0.01);
      border-radius: 0;
    }
    80% {
      transform: scaleX(0.6) scaleY(0.01);
      border-radius: 0;
    }
    100% {
      transform: scaleX(0) scaleY(0.01);
      border-radius: 0;
      background-color: black;
    }
  }
`;

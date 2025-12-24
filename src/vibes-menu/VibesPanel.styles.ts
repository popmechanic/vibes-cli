import type React from "react";

export function getOuterContainerStyle(
  customStyle?: React.CSSProperties,
): React.CSSProperties {
  return {
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: "12px",
    ...customStyle,
  };
}

export function getContainerStyle(): React.CSSProperties {
  return {
    position: "relative",
    display: "inline-flex",
    alignItems: "stretch",
    width: "auto",
    marginBottom: "40px",
  };
}

export function getLabelStyle(): React.CSSProperties {
  return {
    background: "var(--vibes-card-bg)",
    border: "2px solid var(--vibes-card-border)",
    borderLeft: "none",
    borderTopRightRadius: "8px",
    borderBottomRightRadius: "8px",
    padding: "12px 8px",
    fontWeight: 700,
    fontSize: "14px",
    textTransform: "uppercase",
    letterSpacing: "1px",
    whiteSpace: "nowrap",
    color: "var(--vibes-card-text)",
    writingMode: "vertical-rl",
    transform: "rotate(180deg)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    margin: "32px 0px",
  };
}

export function getButtonWrapperStyle(): React.CSSProperties {
  return {
    background: "var(--vibes-card-bg)",
    border: "2px solid var(--vibes-card-border)",
    borderRadius: "8px",
    padding: "24px 24px 32px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "auto",
  };
}

export function getButtonContainerStyle(): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: "24px",
    flexWrap: "wrap",
    maxWidth: "100%",
  };
}

export function getInviteFormStyle(): React.CSSProperties {
  return {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  };
}

export function getInviteLabelStyle(): React.CSSProperties {
  return {
    alignSelf: "flex-start",
    fontWeight: 600,
  };
}

export function getInviteInputWrapperStyle(): React.CSSProperties {
  return {
    width: "100%",
  };
}

export function getInviteInputStyle(): React.CSSProperties {
  return {
    width: "100%",
    border: "none",
    background: "transparent",
    color: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
    letterSpacing: "inherit",
    padding: 0,
  };
}

export function getInviteStatusStyle(): React.CSSProperties {
  return {
    textAlign: "center",
  };
}

// Media query helpers (use window.matchMedia in component for responsive behavior)
export function getResponsiveLabelStyle(
  isMobile: boolean,
): React.CSSProperties {
  if (isMobile) {
    return {
      display: "none",
    };
  }
  return getLabelStyle();
}

export function getResponsiveButtonWrapperStyle(
  isMobile: boolean,
): React.CSSProperties {
  if (isMobile) {
    return {
      background: "transparent",
      border: "none",
      borderRadius: "0",
      padding: "0",
      paddingBottom: "24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "auto",
    };
  }
  return getButtonWrapperStyle();
}

export function getResponsiveContainerStyle(
  isMobile: boolean,
): React.CSSProperties {
  if (isMobile) {
    return {
      ...getContainerStyle(),
      flexDirection: "column",
      width: "100%",
    };
  }
  return getContainerStyle();
}

// Pictures in the chat: a thumbnail that opens the picture over the chat, as big as it fits, and
// the viewer that shows it (Escape or a click closes it; a picture from a file opens in its app).
import { createContext, useContext, useState, type ReactNode } from "react";
import { call, Icon, useMetrics, useTheme } from "pumi";

import type { Image } from "../model.ts";
import { baseName, imageSource } from "../view.ts";
import { Press } from "./press.tsx";
import { swallow, tint, useType } from "./style.ts";

interface Shown {
  src: string;
  alt: string;
  /** The file it is, when it is one. */
  path?: string;
}

const Viewer = createContext<((shown: Shown) => void) | null>(null);

/** Gives the parts under it a viewer, drawn over `children`. */
export function ImageViewerHost({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  return (
    <Viewer.Provider value={setShown}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
        {children}
        {shown ? <Lightbox shown={shown} onClose={() => setShown(null)} /> : null}
      </div>
    </Viewer.Provider>
  );
}

export interface ThumbProps {
  image: Image;
  alt: string;
  maxWidth?: number;
  maxHeight?: number;
}

/** A picture in the timeline: pressed, it opens in the viewer. */
export function Thumb({ image, alt, maxWidth = 320, maxHeight = 220 }: ThumbProps) {
  const t = useTheme();
  const m = useMetrics();
  const open = useContext(Viewer);
  const src = imageSource(image);
  if (!src) return null;
  const path = src.startsWith("/") ? src : undefined;
  return (
    <Press
      aria-label={`${alt}: open it`}
      title={path ? baseName(path) : alt}
      onClick={() => (open ? open({ src, alt, path }) : path ? void call("fs.open", path).catch(swallow) : undefined)}
      style={{ display: "flex", flexShrink: 1, minWidth: 0, maxWidth: "100%", borderRadius: m.radius, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, overflow: "hidden", cursor: "pointer", hover: { borderColor: t.faint } }}
    >
      <img src={src} alt={alt} objectFit="contain" style={{ maxWidth, maxHeight, minWidth: 48, minHeight: 32 }} />
    </Press>
  );
}

function Lightbox({ shown, onClose }: { shown: Shown; onClose(): void }) {
  const t = useTheme();
  const m = useMetrics();
  const type = useType();
  return (
    <div
      role="dialog"
      aria-label={shown.alt}
      tabIndex={0}
      autoFocus
      onKeyDown={(e: any) => {
        if (e?.key === "escape") {
          e.preventDefault?.();
          onClose();
        }
      }}
      onClick={onClose}
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, display: "flex", flexDirection: "column", backgroundColor: tint(t.window, 0.94) }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 32, flexShrink: 0, paddingLeft: 12, paddingRight: 6 }}>
        <div style={{ display: "flex", flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: type.small, color: t.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{shown.path ?? shown.alt}</text>
        </div>
        {shown.path ? (
          <Press
            aria-label="Open in its app"
            title="Open in its app"
            onClick={(e) => {
              (e as any)?.stopPropagation?.();
              void call("fs.open", shown.path!).catch(swallow);
            }}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, height: 22, paddingLeft: 8, paddingRight: 8, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}
          >
            <Icon name="arrow_up_right" size={11} color={t.muted} />
            <text style={{ fontSize: type.small, color: t.muted }}>Open</text>
          </Press>
        ) : null}
        <Press aria-label="Close the picture" title="Close (Esc)" onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: m.radiusSmall, cursor: "pointer", hover: { backgroundColor: t.hover } }}>
          <Icon name="close" size={12} color={t.muted} />
        </Press>
      </div>
      <div style={{ display: "flex", flexGrow: 1, minHeight: 0, alignItems: "center", justifyContent: "center", padding: 16, paddingTop: 0 }}>
        <img src={shown.src} alt={shown.alt} objectFit="contain" style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}

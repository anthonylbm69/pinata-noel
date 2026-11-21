// Composants visuels partagés (repris de la maquette Figma).
import type { ReactNode } from "react";

export const ANSWER_STYLES = [
  { bg: "bg-xred", text: "text-xred", shape: "tri" },
  { bg: "bg-xblue", text: "text-xblue", shape: "dia" },
  { bg: "bg-xgreen", text: "text-xgreen", shape: "cir" },
  { bg: "bg-xyellow", text: "text-xyellow", shape: "sq" },
] as const;

export function Shape({ kind, className = "h-8 w-8" }: { kind: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="white">
      {kind === "tri" && <path d="M12 3 22 21H2z" />}
      {kind === "dia" && <path d="M12 2 22 12 12 22 2 12z" />}
      {kind === "cir" && <circle cx="12" cy="12" r="10" />}
      {kind === "sq" && <rect x="3" y="3" width="18" height="18" rx="2" />}
    </svg>
  );
}

export function Avatar({ color, size = 32 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ background: color, width: size, height: size }} />;
}

export function PlayerChip({
  name,
  color,
  dim,
  highlight,
  children,
}: {
  name: string;
  color: string;
  dim?: boolean;
  highlight?: boolean;
  children?: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-3 rounded-full border py-2 pr-5 pl-2 ${
        highlight ? "border-xgold border-[3px]" : "border-white/15"
      } bg-white/8 ${dim ? "opacity-35" : ""}`}
    >
      <Avatar color={color} />
      <span className="font-semibold">{name}</span>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  color = "bg-xred",
  disabled,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  color?: string;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${color} rounded-full px-8 py-4 text-xl font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return <p className="text-xgold font-semibold tracking-wide uppercase">{children}</p>;
}

export const PLAYER_COLORS = ["#2a9e88", "#e673a0", "#4d80f2", "#f29933", "#b373f2", "#33bfd9", "#99cc4d", "#e2333f"];

export function formatPoints(n: number) {
  return n.toLocaleString("fr-FR").replace(/ | /g, " ");
}

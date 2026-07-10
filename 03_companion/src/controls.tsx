// v0.8.2 共通コントロール規格。寸法を統一し、ピクトグラム主体のUIを組むための部品。
// スタイルは App.css の `.ctl-*` 群。フェーズ2以降で各画面がこの部品へ移行する。
import type { ReactNode } from "react";
import { InfoIcon } from "./icons";

type Tone = "ok" | "warn" | "err";

/** 状態バッジ（小面積・状態色）。*/
export function Pill({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill${tone ? ` ${tone}` : ""}`}>{children}</span>;
}

/** 汎用カード面。*/
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`ctl-card${className ? ` ${className}` : ""}`}>{children}</div>;
}

type ButtonVariant = "default" | "primary" | "ghost";

/** アクションボタン（高さ44px統一）。*/
export function Button({
  children,
  onClick,
  variant = "default",
  small,
  disabled,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  small?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const cls = ["ctl-btn"];
  if (variant === "primary") cls.push("primary");
  if (variant === "ghost") cls.push("ghost");
  if (small) cls.push("sm");
  return (
    <button type={type} className={cls.join(" ")} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

type IconButtonSize = "default" | "lg" | "sm";

/** アイコンのみのボタン（動作単体・44×44）。label は必須で aria/tooltip に使う。*/
export function IconButton({
  icon,
  label,
  onClick,
  size = "default",
  danger,
  active,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  size?: IconButtonSize;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  const cls = ["ctl-iconbtn"];
  if (size === "lg") cls.push("lg");
  if (size === "sm") cls.push("sm");
  if (danger) cls.push("danger");
  if (active) cls.push("on");
  return (
    <button
      type="button"
      className={cls.join(" ")}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

/** 真偽値スイッチ。*/
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`ctl-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="ctl-knob" />
    </button>
  );
}

/** パネルON/OFF等のトグルタイル（アイコン＋名前＋ON/OFF、説明文なし）。*/
export function ToggleTile({
  icon,
  name,
  on,
  onClick,
}: {
  icon: ReactNode;
  name: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`ctl-tile${on ? " on" : ""}`} onClick={onClick} aria-pressed={on}>
      <span className="ctl-tile-ic">{icon}</span>
      <span className="ctl-tile-name">{name}</span>
      <span className={`ctl-onoff${on ? " on" : ""}`}>{on ? "ON" : "OFF"}</span>
    </button>
  );
}

export type SegmentOption = { value: string; label: string; icon?: ReactNode };

/** 2〜4択のセグメント。色つきpillにせず、明度差で選択を示す。*/
export function Segment({
  options,
  value,
  onChange,
}: {
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="ctl-seg" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`ctl-seg-btn${option.value === value ? " active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 数値スライダー行（ラベル / レンジ / 数値入力）。*/
export function SliderRow({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="ctl-slider">
      <span className="ctl-lbl">{label}</span>
      <input
        type="range"
        className="ctl-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        className="ctl-num"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** 軸値のステッパー（−[値]+）。位置・回転などの微調整用。*/
export function Stepper({
  axis,
  value,
  step = 0.01,
  min,
  max,
  decimals,
  onChange,
}: {
  axis?: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  onChange: (value: number) => void;
}) {
  const dp = decimals ?? (String(step).split(".")[1]?.length ?? 0);
  const clamp = (next: number) => {
    let n = next;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };
  return (
    <div className="ctl-stepper">
      <button type="button" aria-label={`${axis ?? ""} 減`} onClick={() => onChange(clamp(value - step))}>
        &minus;
      </button>
      {axis && <span className="ctl-axname">{axis}</span>}
      <span className="ctl-stepval">{value.toFixed(dp)}</span>
      <button type="button" aria-label={`${axis ?? ""} 増`} onClick={() => onChange(clamp(value + step))}>
        +
      </button>
    </div>
  );
}

/** 見出し脇の ⓘ。長い説明文を画面から退避し、ホバー/フォーカスのツールチップに収める。*/
export function InfoHint({ text, label = "説明" }: { text: string; label?: string }) {
  return (
    <button type="button" className="ctl-info" title={text} aria-label={`${label}: ${text}`}>
      <InfoIcon />
    </button>
  );
}

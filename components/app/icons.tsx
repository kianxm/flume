import type { ReactNode, SVGProps } from "react";

/**
 * Flume's small icon set: 24-unit grid, 1.75 stroke, round joins. Icons are
 * decorative by default (aria-hidden); the control that holds one carries the
 * label.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Rendered width and height in px. Default 18. */
  size?: number;
}

function Icon({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none" }}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </Icon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 14.4A8.3 8.3 0 0 1 9.6 4a8.3 8.3 0 1 0 10.4 10.4Z" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2.5" />
      <path d="M15 5.5V5.25A2.25 2.25 0 0 0 12.75 3h-7.5A2.25 2.25 0 0 0 3 5.25v7.5A2.25 2.25 0 0 0 5.25 15h.25" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5 9.5 17 19 7" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </Icon>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15.5v-11M7.5 9 12 4.5 16.5 9" />
      <path d="M4.5 15.5v1.75a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V15.5" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5" />
      <path d="M4.5 15.5v1.75a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V15.5" />
    </Icon>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 4.75H7.5A2.25 2.25 0 0 0 5.25 7v11.5a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25V7a2.25 2.25 0 0 0-2.25-2.25H15" />
      <rect x="9" y="3" width="6" height="3.5" rx="1.25" />
    </Icon>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 20 1-4.2L16.1 4.7a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19 4 20Z" />
      <path d="m14.25 6.5 3.25 3.25" />
    </Icon>
  );
}

export function ReplayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12a8 8 0 1 0 8-8 8.6 8.6 0 0 0-5.9 2.4L4 8.5" />
      <path d="M4 4v4.5h4.5" />
    </Icon>
  );
}

export function LandscapeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="6.75" width="17" height="10.5" rx="2.25" />
    </Icon>
  );
}

export function PortraitIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6.75" y="3.5" width="10.5" height="17" rx="2.25" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.25 10.5V8a3.75 3.75 0 0 1 7.5 0v2.5" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />
    </Icon>
  );
}

export function SpinnerIcon({ className, ...props }: IconProps) {
  return (
    <Icon {...props} className={`spin${className ? ` ${className}` : ""}`}>
      <circle cx="12" cy="12" r="8.25" opacity="0.25" />
      <path d="M20.25 12A8.25 8.25 0 0 0 12 3.75" />
    </Icon>
  );
}

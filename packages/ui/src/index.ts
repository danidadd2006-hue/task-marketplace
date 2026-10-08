import type { ReactNode } from "react";
export interface ShellNavItem { href: string; label: string; }
export interface ShellProps { children: ReactNode; nav: ShellNavItem[]; title?: string; }
export function uiPackageBoundary(): string { return "web-admin-ui"; }
export type { ReactNode };

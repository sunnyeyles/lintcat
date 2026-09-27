import * as Isx from "iconsax-reactjs";
import { forwardRef, type ComponentType, type ForwardRefExoticComponent, type RefAttributes } from "react";

import { cn } from "#src/cn";
import {
  BugGlyph,
  CheckGlyph,
  CloseGlyph,
  DotGlyph,
  GitPullRequestGlyph,
  type GlyphProps,
  LinkOffGlyph,
  LoaderGlyph,
} from "#src/icons/extra";

const MOTION = {
  spin: "animate-icon-spin",
  turn: "animate-icon-turn",
  "nudge-x": "animate-icon-nudge-x",
  "nudge-y": "animate-icon-nudge-y",
  pulse: "animate-icon-pulse",
  float: "animate-icon-float",
} as const;

export interface IconProps extends GlyphProps {
  animate?: "loop" | "none";
}

export type IconComponent = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;

function icon(name: string, Glyph: ComponentType<GlyphProps & RefAttributes<SVGSVGElement>>, motion: keyof typeof MOTION) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(({ animate = "loop", className, ...rest }, ref) => (
    <Glyph ref={ref} className={cn(animate === "loop" && MOTION[motion], className)} {...rest} />
  ));
  Icon.displayName = name;
  return Icon as IconComponent;
}

export const ArrowLeft = icon("ArrowLeft", Isx.ArrowLeft, "nudge-x");
export const ArrowRight = icon("ArrowRight", Isx.ArrowRight, "nudge-x");
export const ArrowUp = icon("ArrowUp", Isx.ArrowUp, "nudge-y");
export const ChevronDown = icon("ChevronDown", Isx.ArrowDown2, "nudge-y");
export const ChevronUp = icon("ChevronUp", Isx.ArrowUp2, "nudge-y");
export const ChevronRight = icon("ChevronRight", Isx.ArrowRight2, "nudge-x");
export const LogIn = icon("LogIn", Isx.Login, "nudge-x");

export const Loader2 = icon("Loader2", LoaderGlyph, "spin");
export const RotateCcw = icon("RotateCcw", Isx.RotateLeft, "turn");

export const CircleCheck = icon("CircleCheck", Isx.TickCircle, "pulse");
export const CircleSlash = icon("CircleSlash", Isx.Slash, "pulse");
export const Clock = icon("Clock", Isx.Clock, "pulse");
export const Info = icon("Info", Isx.InfoCircle, "pulse");
export const Link2Off = icon("Link2Off", LinkOffGlyph, "pulse");
export const MailCheck = icon("MailCheck", Isx.MessageTick, "pulse");
export const MapPinOff = icon("MapPinOff", Isx.LocationSlash, "pulse");
export const SearchX = icon("SearchX", Isx.SearchStatus, "pulse");
export const ShieldOff = icon("ShieldOff", Isx.ShieldCross, "pulse");
export const Sparkles = icon("Sparkles", Isx.MagicStar, "pulse");
export const Square = icon("Square", Isx.Stop, "pulse");
export const TriangleAlert = icon("TriangleAlert", Isx.Warning2, "pulse");
export const UserX = icon("UserX", Isx.UserRemove, "pulse");

export const BookOpen = icon("BookOpen", Isx.Book1, "float");
export const BookText = icon("BookText", Isx.DocumentText, "float");
export const Bot = icon("Bot", Isx.Cpu, "float");
export const Bug = icon("Bug", BugGlyph, "float");
export const ChartLine = icon("ChartLine", Isx.Chart, "float");
export const Check = icon("Check", CheckGlyph, "float");
export const Circle = icon("Circle", DotGlyph, "float");
export const Coins = icon("Coins", Isx.Coin1, "float");
export const FlaskConical = icon("FlaskConical", Isx.Microscope, "float");
export const FolderGit2 = icon("FolderGit2", Isx.Folder2, "float");
export const Gauge = icon("Gauge", Isx.Speedometer, "float");
export const GitPullRequest = icon("GitPullRequest", GitPullRequestGlyph, "float");
export const KeyRound = icon("KeyRound", Isx.Key, "float");
export const LayoutDashboard = icon("LayoutDashboard", Isx.Category, "float");
export const Menu = icon("Menu", Isx.HamburgerMenu, "float");
export const Monitor = icon("Monitor", Isx.Monitor, "float");
export const Moon = icon("Moon", Isx.Moon, "float");
export const Radius = icon("Radius", Isx.Radar, "float");
export const Settings = icon("Settings", Isx.Setting2, "float");
export const ShieldCheck = icon("ShieldCheck", Isx.ShieldTick, "float");
export const Sun = icon("Sun", Isx.Sun1, "float");
export const X = icon("X", CloseGlyph, "float");

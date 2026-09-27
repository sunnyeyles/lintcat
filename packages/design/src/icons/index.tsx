import {
  ArrowDown2 as IsxArrowDown2,
  ArrowLeft as IsxArrowLeft,
  ArrowRight as IsxArrowRight,
  ArrowRight2 as IsxArrowRight2,
  ArrowUp as IsxArrowUp,
  ArrowUp2 as IsxArrowUp2,
  Book1 as IsxBook1,
  Category as IsxCategory,
  Chart as IsxChart,
  Clock as IsxClock,
  Coin1 as IsxCoin1,
  Cpu as IsxCpu,
  DocumentText as IsxDocumentText,
  Folder2 as IsxFolder2,
  HamburgerMenu as IsxHamburgerMenu,
  InfoCircle as IsxInfoCircle,
  Key as IsxKey,
  LocationSlash as IsxLocationSlash,
  Login as IsxLogin,
  MagicStar as IsxMagicStar,
  MessageTick as IsxMessageTick,
  Microscope as IsxMicroscope,
  Monitor as IsxMonitor,
  Moon as IsxMoon,
  Radar as IsxRadar,
  RotateLeft as IsxRotateLeft,
  SearchStatus as IsxSearchStatus,
  Setting2 as IsxSetting2,
  ShieldCross as IsxShieldCross,
  ShieldTick as IsxShieldTick,
  Slash as IsxSlash,
  Speedometer as IsxSpeedometer,
  Stop as IsxStop,
  Sun1 as IsxSun1,
  TickCircle as IsxTickCircle,
  UserRemove as IsxUserRemove,
  Warning2 as IsxWarning2,
} from "iconsax-reactjs";
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
    <Glyph
      ref={ref}
      // Decorative unless named, as lucide did.
      aria-hidden={rest["aria-label"] || rest["aria-labelledby"] ? undefined : true}
      className={cn(animate === "loop" && MOTION[motion], className)}
      {...rest}
    />
  ));
  Icon.displayName = name;
  return Icon as IconComponent;
}

export const ArrowLeft = icon("ArrowLeft", IsxArrowLeft, "nudge-x");
export const ArrowRight = icon("ArrowRight", IsxArrowRight, "nudge-x");
export const ArrowUp = icon("ArrowUp", IsxArrowUp, "nudge-y");
export const ChevronDown = icon("ChevronDown", IsxArrowDown2, "nudge-y");
export const ChevronUp = icon("ChevronUp", IsxArrowUp2, "nudge-y");
export const ChevronRight = icon("ChevronRight", IsxArrowRight2, "nudge-x");
export const LogIn = icon("LogIn", IsxLogin, "nudge-x");

export const Loader2 = icon("Loader2", LoaderGlyph, "spin");
export const RotateCcw = icon("RotateCcw", IsxRotateLeft, "turn");

export const CircleCheck = icon("CircleCheck", IsxTickCircle, "pulse");
export const CircleSlash = icon("CircleSlash", IsxSlash, "pulse");
export const Clock = icon("Clock", IsxClock, "pulse");
export const Info = icon("Info", IsxInfoCircle, "pulse");
export const Link2Off = icon("Link2Off", LinkOffGlyph, "pulse");
export const MailCheck = icon("MailCheck", IsxMessageTick, "pulse");
export const MapPinOff = icon("MapPinOff", IsxLocationSlash, "pulse");
export const SearchX = icon("SearchX", IsxSearchStatus, "pulse");
export const ShieldOff = icon("ShieldOff", IsxShieldCross, "pulse");
export const Sparkles = icon("Sparkles", IsxMagicStar, "pulse");
export const Square = icon("Square", IsxStop, "pulse");
export const TriangleAlert = icon("TriangleAlert", IsxWarning2, "pulse");
export const UserX = icon("UserX", IsxUserRemove, "pulse");

export const BookOpen = icon("BookOpen", IsxBook1, "float");
export const BookText = icon("BookText", IsxDocumentText, "float");
export const Bot = icon("Bot", IsxCpu, "float");
export const Bug = icon("Bug", BugGlyph, "float");
export const ChartLine = icon("ChartLine", IsxChart, "float");
export const Check = icon("Check", CheckGlyph, "float");
export const Circle = icon("Circle", DotGlyph, "float");
export const Coins = icon("Coins", IsxCoin1, "float");
export const FlaskConical = icon("FlaskConical", IsxMicroscope, "float");
export const FolderGit2 = icon("FolderGit2", IsxFolder2, "float");
export const Gauge = icon("Gauge", IsxSpeedometer, "float");
export const GitPullRequest = icon("GitPullRequest", GitPullRequestGlyph, "float");
export const KeyRound = icon("KeyRound", IsxKey, "float");
export const LayoutDashboard = icon("LayoutDashboard", IsxCategory, "float");
export const Menu = icon("Menu", IsxHamburgerMenu, "float");
export const Monitor = icon("Monitor", IsxMonitor, "float");
export const Moon = icon("Moon", IsxMoon, "float");
export const Radius = icon("Radius", IsxRadar, "float");
export const Settings = icon("Settings", IsxSetting2, "float");
export const ShieldCheck = icon("ShieldCheck", IsxShieldTick, "float");
export const Sun = icon("Sun", IsxSun1, "float");
export const X = icon("X", CloseGlyph, "float");

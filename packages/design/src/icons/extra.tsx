import { forwardRef, type ReactNode, type SVGAttributes } from "react";

export interface GlyphProps extends SVGAttributes<SVGElement> {
  size?: string | number;
  color?: string;
}

// Glyphs Iconsax lacks, drawn to its Linear grid: 24px, 1.5 stroke, round caps.
function glyph(name: string, body: ReactNode) {
  const Glyph = forwardRef<SVGSVGElement, GlyphProps>(({ size = 24, color = "currentColor", ...rest }, ref) => (
    <svg
      {...rest}
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {body}
    </svg>
  ));
  Glyph.displayName = name;
  return Glyph;
}

export const CheckGlyph = glyph("CheckGlyph", <path d="M5 12.5l4.5 4.5L19 7.5" />);

export const CloseGlyph = glyph("CloseGlyph", <path d="M6 6l12 12M18 6L6 18" />);

export const DotGlyph = glyph("DotGlyph", <circle cx="12" cy="12" r="4" fill="currentColor" />);

export const LoaderGlyph = glyph("LoaderGlyph", <path d="M12 3a9 9 0 1 0 9 9" />);

export const GitPullRequestGlyph = glyph(
  "GitPullRequestGlyph",
  <>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M6 8.5V21M13 6h3a2 2 0 0 1 2 2v7.5" />
    <path d="M15 3.5L12.5 6 15 8.5" />
  </>,
);

export const LinkOffGlyph = glyph(
  "LinkOffGlyph",
  <path d="M9 17H7A5 5 0 0 1 5.5 7.2M15 7h2a5 5 0 0 1 3.4 8.7M8 12h2M3 3l18 18" />,
);

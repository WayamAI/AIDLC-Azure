import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { LOGO_SRC, LOGO_LIGHT_SRC, BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  /** Prefer compact layout when collapsed */
  alt?: string;
};

/** Picks dark/light wordmark from resolved theme. */
export function BrandLogo({ className, alt = BRAND_NAME }: BrandLogoProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Default to dark wordmark before hydration (product is dark-first).
  const src = mounted && resolvedTheme === "light" ? LOGO_LIGHT_SRC : LOGO_SRC;

  return (
    <img
      src={src}
      alt={alt}
      className={cn("object-contain object-left", className)}
    />
  );
}

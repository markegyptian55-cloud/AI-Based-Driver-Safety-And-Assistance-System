import logoAsset from "@/assets/adas-logo.png.asset.json";
import { cn } from "@/lib/utils";

/**
 * Product mark. Single source of truth so the sidebar, the sign-in card and
 * the landing page never drift apart.
 */
export function BrandLogo({
  className,
  alt = "ADAS — AI-based driver safety and assistance system",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src={logoAsset.url}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn("h-6 w-6 rounded-sm object-contain", className)}
    />
  );
}

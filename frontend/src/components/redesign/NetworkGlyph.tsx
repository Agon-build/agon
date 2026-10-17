import type { AgonNetworkDescriptor } from "@/lib/agon/network";

type NetworkGlyphProps = {
  brand: AgonNetworkDescriptor["brand"];
  className?: string;
};

/**
 * Small official network marks for the selector. Text remains the authority;
 * these images are visual orientation cues only.
 *
 * Arc is the supplied Arc brand mark already used by AGON elsewhere.
 */
export function NetworkGlyph({ className = "h-4 w-4" }: NetworkGlyphProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brands/arc.png"
      alt=""
      aria-hidden="true"
      width={16}
      height={16}
      draggable={false}
      className={`${className} object-contain rounded-full`}
    />
  );
}

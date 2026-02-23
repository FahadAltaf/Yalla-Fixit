

// SVG Imports
import siteLogo from "@/public/site-logo.webp";
import Image from "next/image";
// Util Imports
import { cn } from "@/lib/utils";

const Logo = ({ className }: { className?: string }) => {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
   <Image src={siteLogo} alt="logo" width={224} height={224} unoptimized className="w-[224px] h-auto relative left-[-16px]" />
    </div>
  );
};

export default Logo;
